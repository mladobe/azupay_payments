import { DEFAULT_CHECKOUT_TITLE } from "./identity.js";
import { requireValue } from "./payment.js";

const fields = [
  "code",
  "title",
  "active",
  "backend_integration_url",
  "order_status",
  "countries",
  "currencies",
  "stores",
  "custom_config",
];

export function paymentStoreCodes(views) {
  const valid =
    Array.isArray(views) &&
    views.every(
      (view) =>
        view &&
        Number.isSafeInteger(view.id) &&
        view.id >= 0 &&
        typeof view.code === "string" &&
        /^[A-Za-z0-9_]{1,64}$/.test(view.code) &&
        (view.id === 0 || [true, false, 1, 0].includes(view.is_active)),
    );
  requireValue(
    valid &&
      new Set(views.map((view) => view.code)).size === views.length &&
      new Set(views.map((view) => view.id)).size === views.length,
    "COMMERCE_INVALID_STORES",
    "Commerce returned invalid or duplicate store views. Payment registration was not updated.",
    502,
  );
  const stores = views
    .filter(
      (view) =>
        view.id > 0 && view.code !== "admin" && Number(view.is_active) === 1,
    )
    .map((view) => view.code)
    .sort();
  requireValue(
    stores.length > 0,
    "COMMERCE_NO_PAYMENT_STORES",
    "Commerce has no active storefront store views. Payment registration was not updated.",
    502,
  );
  return stores;
}

function registrationValue(response) {
  const method =
    response?.success === true
      ? response.message
      : response?.success === undefined
        ? response
        : null;
  return method?.code === "azupay" &&
    typeof method.active === "boolean" &&
    Array.isArray(method.stores) &&
    method.stores.every((code) => typeof code === "string")
    ? method
    : null;
}

async function readRegistration(client) {
  let response;
  try {
    response = await client.get("oope_payment_method/azupay").json();
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
  const method = registrationValue(response);
  requireValue(
    method !== null,
    "COMMERCE_INVALID_REGISTRATION",
    "Commerce returned an invalid Azupay payment registration.",
    502,
  );
  return Object.fromEntries(
    fields
      .filter((name) => Object.hasOwn(method, name))
      .map((name) => [name, method[name]]),
  );
}

function sameStores(left, right) {
  const sorted = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((code, index) => code === sorted[index])
  );
}

async function saveRegistration(client, method) {
  const response = await client
    .post("oope_payment_method/", {
      json: { payment_method: method },
    })
    .json();
  requireValue(
    response?.success === true || registrationValue(response) !== null,
    "COMMERCE_REGISTRATION_FAILED",
    "Commerce did not confirm the Azupay payment registration. Retry synchronization to verify the saved registration.",
    502,
  );
  const saved = await readRegistration(client);
  requireValue(
    saved?.active === method.active && sameStores(saved.stores, method.stores),
    "COMMERCE_REGISTRATION_UNCONFIRMED",
    "The saved Azupay payment registration could not be verified. Retry synchronization.",
    502,
  );
}

export async function registerPaymentMethod({ client, namespace }) {
  requireValue(
    typeof namespace === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace),
    "MISSING_NAMESPACE",
    "Runtime namespace is required to register Azupay.",
    503,
  );
  const stores = paymentStoreCodes(await client.get("store/storeViews").json());
  const existing = await readRegistration(client);
  const actionBaseUrl = `https://${namespace}.adobeioruntime.net/api/v1/web/azupay`;
  const method = {
    ...(existing ?? {
      code: "azupay",
      title: DEFAULT_CHECKOUT_TITLE,
      active: true,
      backend_integration_url: `${actionBaseUrl}/create-session`,
      order_status: "pending",
      countries: ["AU"],
      currencies: ["AUD"],
      custom_config: [
        { key: "action_base_url", value: actionBaseUrl },
        { key: "can_refund", value: false },
        { key: "can_authorize", value: false },
        { key: "can_capture", value: false },
      ],
    }),
    stores,
  };
  const changed = !existing || !sameStores(existing.stores, stores);
  if (changed) await saveRegistration(client, method);
  return { paymentMethod: "azupay", active: method.active, stores, changed };
}

export async function deactivatePaymentMethod(client) {
  const existing = await readRegistration(client);
  if (existing?.active)
    await saveRegistration(client, { ...existing, active: false });
  return {
    paymentMethod: "azupay",
    active: false,
    stores: existing?.stores ?? [],
    changed: existing?.active === true,
    registered: existing !== null,
  };
}
