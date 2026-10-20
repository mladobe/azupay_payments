import { openHostedCheckout } from "./modal.js";

const STORAGE_KEY = "azupay-checkout-v1";

export function hasPendingPayment(storage = sessionStorage) {
  return storage.getItem(STORAGE_KEY) !== null;
}

export function hostedCheckout({
  actionBaseUrl,
  cartId,
  returnUrl,
  storeCode,
  completePayment,
  authorization = () => undefined,
  fetcher = fetch,
  storage = sessionStorage,
  location = window.location,
  presentCheckout = openHostedCheckout,
  focusTarget,
}) {
  const base = new URL(actionBaseUrl);
  const returnPage = new URL(returnUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    returnPage.origin !== location.origin ||
    returnPage.search ||
    returnPage.hash
  )
    throw new Error("Use HTTPS checkout actions and a same-origin return URL.");
  if (typeof completePayment !== "function")
    throw new Error("A payment completion callback is required.");
  let busy = false;

  function savedSession() {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      throw new Error(
        "The saved payment cannot be read. Contact support before paying again.",
      );
    }
    if (saved?.cartId !== cartId)
      throw new Error(
        "Another cart has an outstanding payment session. Contact support before paying again.",
      );
    if (typeof saved.receipt !== "string" || !saved.receipt)
      throw new Error(
        "The saved payment is incomplete. Contact support before paying again.",
      );
    return saved;
  }

  async function post(action, body) {
    const token = action === "create-session" ? await authorization() : null;
    const response = await fetcher(
      `${base.href.replace(/\/$/, "")}/${action}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: token } : {}),
        },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message || `Payment request failed (${response.status}).`,
      );
    return result;
  }

  async function paymentStatus(saved) {
    const status = await post("payment-status", { receipt: saved.receipt });
    if (
      (status.status === "COMPLETE" && status.paid === true) ||
      (status.status === "WAITING" && status.paid === false)
    )
      return status;
    throw new Error(
      `Payment request is ${status.status}. Contact support; do not pay again.`,
    );
  }

  return {
    hasSession: () => savedSession() !== null,
    async run({ redirect = true, present = true } = {}) {
      if (busy) throw new Error("A payment check is already in progress.");
      busy = true;
      try {
        let saved = savedSession();
        if (!saved) {
          const session = await post("create-session", {
            cartId,
            returnUrl: returnPage.href,
            ...(storeCode ? { storeCode } : {}),
          });
          saved = { ...session, cartId };
          storage.setItem(STORAGE_KEY, JSON.stringify(saved));
        }
        const presentation = saved.checkoutPresentation ?? "redirect";
        if (!["redirect", "modal"].includes(presentation))
          throw new Error("The saved checkout experience is invalid.");
        const status = await paymentStatus(saved);
        if (status.status === "COMPLETE" && status.paid === true) {
          const order = await completePayment({
            code: "azupay",
            additional_data: [{ key: "azupay_receipt", value: saved.receipt }],
          });
          if (!order)
            throw new Error(
              "The order was not confirmed. Contact support; do not pay again.",
            );
          storage.removeItem(STORAGE_KEY);
          return { status: "COMPLETE", order };
        }
        if (presentation === "modal" && present) {
          const result = await presentCheckout({
            checkoutUrl: saved.checkoutUrl,
            location,
            focusTarget,
            checkPayment: async () => (await paymentStatus(saved)).paid,
          });
          return {
            status: result.paid ? "AWAITING_ORDER" : "WAITING",
            redirected: result.redirected,
            modal: true,
          };
        }
        if (redirect) {
          const checkout = new URL(saved.checkoutUrl);
          if (
            checkout.protocol !== "https:" ||
            checkout.username ||
            checkout.password
          )
            throw new Error("The saved bank checkout URL is invalid.");
          location.assign(checkout.href);
        }
        return { status: "WAITING", redirected: redirect };
      } finally {
        busy = false;
      }
    },
  };
}
