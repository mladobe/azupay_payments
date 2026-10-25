import { attachPaymentMethod } from "./commerce.js";
import { hasPendingPayment, hostedCheckout } from "./flow.js";

export { hasPendingPayment };

const brandingByCart = new Map();
const configuredTransports = new WeakSet();

function validateBranding(value) {
  if (
    typeof value?.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 100 ||
    typeof value.byline !== "string" ||
    value.byline.length > 250 ||
    !Array.isArray(value.logos) ||
    value.logos.length > 3
  )
    throw new Error("Invalid checkout branding response.");
  for (const logo of value.logos) {
    const url = new URL(logo.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      typeof logo.alt !== "string" ||
      !logo.alt.trim() ||
      logo.alt.length > 100
    )
      throw new Error("Invalid checkout logo response.");
  }
  return value;
}

export function setupAzupayBranding(transport, { fetcher = fetch } = {}) {
  if (configuredTransports.has(transport)) return;
  if (typeof transport.addAfterHook !== "function")
    throw new Error(
      "Azupay branding requires the storefront GraphQL after-hook API.",
    );
  const settings = new Map();
  transport.addAfterHook(async (_request, response) => {
    if (response.errors?.length) return response;
    async function transform(value) {
      if (Array.isArray(value)) return Promise.all(value.map(transform));
      if (!value || typeof value !== "object") return value;
      if (
        typeof value.id === "string" &&
        value.available_payment_methods?.some(
          (method) => method.code === "azupay",
        )
      ) {
        try {
          const graphql = (query, variables) =>
            transport.fetchGraphQl(query, {
              variables,
              method: "POST",
              cache: "no-store",
            });
          // This metadata-only query omits cart.id, so it cannot re-enter this branch.
          const base = await getActionBase(graphql, value.id);
          const storeCode =
            transport.getFetchGraphQlHeader("Store") ??
            transport.getFetchGraphQlHeader("store") ??
            "default";
          const key = `${base}|${storeCode}`;
          if (!settings.has(key)) {
            const pending = (async () => {
              const result = await fetcher(`${base}/checkout-branding`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ storeCode }),
                credentials: "omit",
                cache: "no-store",
                signal: AbortSignal.timeout(15000),
              });
              if (!result.ok)
                throw new Error("Checkout branding could not be loaded.");
              return validateBranding(await result.json());
            })();
            settings.set(key, pending);
          }
          const branding = await settings.get(key);
          brandingByCart.set(value.id, branding);
          return {
            ...value,
            available_payment_methods: value.available_payment_methods.map(
              (method) =>
                method.code === "azupay"
                  ? { ...method, title: branding.title }
                  : method,
            ),
            ...(value.selected_payment_method?.code === "azupay"
              ? {
                  selected_payment_method: {
                    ...value.selected_payment_method,
                    title: branding.title,
                  },
                }
              : {}),
          };
        } catch {
          // Branding is cosmetic: report it visibly without disabling other payment methods.
          console.error("[azupay] CHECKOUT_BRANDING_UNAVAILABLE");
          brandingByCart.set(value.id, { error: true });
          return value;
        }
      }
      return Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([key, entry]) => [
            key,
            await transform(entry),
          ]),
        ),
      );
    }
    return { ...response, data: await transform(response.data) };
  });
  configuredTransports.add(transport);
}

export function paymentActionBase(methods) {
  const matches = methods?.filter((method) => method.code === "azupay");
  if (matches?.length !== 1)
    throw new Error("Azupay is not available for this cart.");
  const config = matches[0].oope_payment_method_config;
  const entries = config?.custom_config?.filter(
    (entry) => entry.key === "action_base_url",
  );
  if (entries?.length !== 1 || typeof entries[0].value !== "string")
    throw new Error("Azupay action_base_url is missing or ambiguous.");
  const base = new URL(entries[0].value);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Azupay requires an HTTPS action base URL.");
  if (
    config.backend_integration_url !==
    `${base.href.replace(/\/$/, "")}/create-session`
  )
    throw new Error("Azupay payment endpoint configuration does not match.");
  return base.href.replace(/\/$/, "");
}

async function getActionBase(graphql, cartId) {
  const response = await graphql(
    `query AzupayPaymentConfiguration($cartId: String!) {
      cart(cart_id: $cartId) {
        available_payment_methods {
          code
          oope_payment_method_config {
            backend_integration_url
            custom_config {
              ... on CustomConfigKeyValue { key value }
            }
          }
        }
      }
    }`,
    { cartId },
  );
  if (response.errors?.length || !response.data?.cart)
    throw new Error("Could not read Azupay configuration for this cart.");
  return paymentActionBase(response.data.cart.available_payment_methods);
}

export const azupayPaymentSlot = {
  render(ctx) {
    const container = document.createElement("div");
    container.className = "azupay-payment-details";
    const branding = brandingByCart.get(ctx.cartId);
    if (branding?.error) {
      const warning = document.createElement("p");
      warning.setAttribute("role", "alert");
      warning.textContent =
        "Custom payment display settings could not be loaded. Refresh checkout to try again.";
      container.append(warning);
    }
    if (branding?.byline) {
      const byline = document.createElement("p");
      byline.textContent = branding.byline;
      container.append(byline);
    }
    if (branding?.logos?.length) {
      const logos = document.createElement("div");
      logos.className = "azupay-payment-logos";
      logos.style.display = "flex";
      logos.style.flexWrap = "wrap";
      logos.style.gap = "16px";
      logos.style.alignItems = "center";
      for (const logo of branding.logos) {
        const image = document.createElement("img");
        image.alt = logo.alt;
        image.width = 100;
        image.height = 48;
        // CSS dimensions must override storefront rules such as main img { width: auto; height: auto; }.
        Object.assign(image.style, {
          width: "100px",
          height: "48px",
          maxWidth: "100%",
          maxHeight: "48px",
          minWidth: "0",
          flex: "0 1 100px",
          objectFit: "contain",
        });
        image.referrerPolicy = "no-referrer";
        image.addEventListener(
          "error",
          () => {
            console.error("[azupay] CHECKOUT_LOGO_UNAVAILABLE");
            const warning = document.createElement("span");
            warning.setAttribute("role", "status");
            warning.textContent = `${logo.alt} image unavailable.`;
            image.replaceWith(warning);
          },
          { once: true },
        );
        image.src = logo.url;
        logos.append(image);
      }
      container.append(logos);
    }
    const message = document.createElement("p");
    message.dataset.azupayStatus = "";
    message.setAttribute("role", "status");
    message.textContent = hasPendingPayment()
      ? "Your bank payment session is saved. Review your details and select Complete your order below. We'll verify your existing payment without creating another bank payment."
      : "Continue to Azupay to pay securely by bank. Your order is placed after payment is verified.";
    container.append(message);
    ctx.replaceHTML(container);
  },
};

export function azupayButtonLabel(storage = sessionStorage, label) {
  if (label) label.dataset.azupayOrderLabel = "";
  return hasPendingPayment(storage)
    ? "Complete your order"
    : "Continue to Azupay";
}

export function guardAzupayPlaceOrder(
  placeOrder,
  {
    block,
    graphql,
    storeCode,
    authorization,
    returnUrl,
    confirmedOrder,
    purchaseOrder = () => false,
    lockCart,
    storage = sessionStorage,
    location = window.location,
    fetcher = fetch,
    presentCheckout,
  },
) {
  let running = false;
  const showStatus = (message, error = false) => {
    let status = block.querySelector("[data-azupay-status]");
    if (!status) {
      status = document.createElement("p");
      status.dataset.azupayStatus = "";
      block.prepend(status);
    }
    status.setAttribute("role", error ? "alert" : "status");
    status.textContent = message;
  };
  return async (request) => {
    if (running)
      throw new Error("An Azupay payment check is already in progress.");
    if (request.code !== "azupay" && !hasPendingPayment(storage))
      return placeOrder(request);
    if (request.code !== "azupay") {
      const error = new Error(
        "An Azupay payment is outstanding. Select Azupay and check it before using another payment method. Do not pay again.",
      );
      showStatus(error.message, true);
      throw error;
    }
    if (purchaseOrder()) {
      const error = new Error(
        "Azupay requires standard synchronous checkout, not B2B purchase-order approval.",
      );
      showStatus(error.message, true);
      throw error;
    }
    running = true;
    try {
      lockCart(true);
      showStatus("Preparing secure Azupay checkout...");
      const flow = hostedCheckout({
        actionBaseUrl: await getActionBase(graphql, request.cartId),
        cartId: request.cartId,
        returnUrl,
        storeCode,
        authorization,
        storage,
        location,
        fetcher,
        presentCheckout,
        focusTarget: block
          .querySelector("[data-azupay-order-label]")
          ?.closest("button"),
        completePayment: async (paymentMethod) => {
          await attachPaymentMethod({
            graphql,
            cartId: request.cartId,
            paymentMethod,
          });
          await placeOrder(request);
          const order = confirmedOrder();
          if (!order)
            throw new Error(
              "The order was not confirmed. Contact support; do not pay again.",
            );
          return order;
        },
      });
      const returning = flow.hasSession();
      if (returning) showStatus("Checking your existing bank payment...");
      const result = await flow.run({ redirect: !returning });
      if (result.status === "AWAITING_ORDER")
        showStatus(
          "Your bank payment has been received. Review your details and select Complete your order to finish. Do not pay again.",
        );
      else if (
        result.status === "WAITING" &&
        !result.redirected &&
        result.modal
      )
        showStatus(
          "Your payment session is saved. Select Complete your order to check payment or reopen the same payment window. Closing the window did not cancel your bank payment. If you've paid, do not pay again.",
        );
      else if (result.status === "WAITING" && !result.redirected)
        showStatus(
          "Your bank payment has not been confirmed yet. If you've paid, allow a little time, then select Complete your order again. This only checks your existing payment; it will not send you back to Azupay or request another payment.",
        );
      return result;
    } catch (error) {
      showStatus(
        `${error.message} If money has left your bank, do not pay again.`,
        true,
      );
      throw error;
    } finally {
      running = false;
      lockCart(hasPendingPayment(storage));
      for (const label of block.querySelectorAll("[data-azupay-order-label]"))
        label.textContent = azupayButtonLabel(storage);
    }
  };
}
