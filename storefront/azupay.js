import { hostedCheckout } from "./flow.js";

/**
 * Framework-independent adapter. Mount in your storefront's custom payment slot.
 * completePayment must set additional_data then placeOrder using the existing
 * shopper context. It must NOT invoice or mark an order paid in the browser.
 */
export function mountAzupay({
  container,
  actionBaseUrl,
  cartId,
  returnUrl,
  storeCode,
  authorization,
  completePayment,
  onError,
  onOrderPlaced,
  fetcher = fetch,
  storage = sessionStorage,
  location = window.location,
  presentCheckout,
}) {
  if (!(container instanceof HTMLElement))
    throw new Error("An Azupay container is required.");
  if (typeof completePayment !== "function" || typeof onError !== "function") {
    throw new Error("Provide completePayment and onError callbacks.");
  }
  const base = new URL(actionBaseUrl);
  if (base.protocol !== "https:")
    throw new Error("Use HTTPS Runtime action URLs.");
  const returnPage = new URL(returnUrl);
  if (
    returnPage.origin !== location.origin ||
    returnPage.search ||
    returnPage.hash
  ) {
    throw new Error("Use a same-origin return URL without query parameters.");
  }
  const root = document.createElement("section");
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.textContent =
    "Pay securely from your bank account. After payment is verified, select Complete your order to finish.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Pay by Bank";
  root.append(message, button);
  container.replaceChildren(root);
  let disposed = false;
  const flow = hostedCheckout({
    actionBaseUrl,
    cartId,
    returnUrl,
    storeCode,
    authorization,
    completePayment: (method) => {
      if (disposed)
        throw new Error(
          "The payment view changed. Return to checkout; do not pay again.",
        );
      return completePayment(method);
    },
    fetcher,
    storage,
    location,
    presentCheckout,
    focusTarget: button,
  });

  async function run({ present = true } = {}) {
    button.disabled = true;
    try {
      message.textContent = "Checking your bank payment...";
      const result = await flow.run({
        redirect: location.pathname !== returnPage.pathname,
        present,
      });
      if (disposed) return;
      if (result.status === "COMPLETE") {
        button.hidden = true;
        message.textContent = "Your order has been placed.";
        onOrderPlaced?.(result.order);
        return;
      }
      if (result.status === "AWAITING_ORDER") {
        message.textContent =
          "Your bank payment has been received. Select Complete your order to finish. Do not pay again.";
        button.textContent = "Complete your order";
        return;
      }
      if (result.modal && !result.redirected) {
        message.textContent =
          "Your payment is saved. Check payment or reopen the same window; closing it did not cancel your bank payment. Do not pay again.";
        button.textContent = "Check payment / reopen window";
        return;
      }
      if (location.pathname === returnPage.pathname) {
        message.textContent =
          "Your bank payment is still pending. Wait, then select Check payment. Do not pay again.";
        button.textContent = "Check payment";
        return;
      }
      message.textContent = "Opening secure bank payment...";
    } catch (error) {
      if (!disposed) {
        message.textContent = `${error.message} If money has left your bank, do not pay again.`;
        button.textContent = "Retry / check payment";
        onError(error);
      }
    } finally {
      if (!disposed) button.disabled = false;
    }
  }
  button.addEventListener("click", run);
  if (location.pathname === returnPage.pathname) {
    if (storage.getItem("azupay-checkout-v1")) {
      void run({ present: false });
    } else {
      message.textContent =
        "No saved payment session was found. Return to checkout, or contact support if you have already paid.";
      button.hidden = true;
    }
  }
  return () => {
    disposed = true;
    button.removeEventListener("click", run);
    root.remove();
  };
}
