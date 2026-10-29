import {
  DEFAULT_INSTRUCTIONS_LABEL,
  helpUrl,
  paymentInstructions,
} from "../src/shared/checkout-guidance.js";
import { attachPaymentMethod } from "./commerce.js";
import { hasPendingPayment, hostedCheckout } from "./flow.js";

export { hasPendingPayment };

const brandingByCart = new Map();
const configuredTransports = new WeakSet();
const brandingListeners = new Set();

function validateBranding(value) {
  if (
    typeof value?.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 100 ||
    typeof value.byline !== "string" ||
    value.byline.length > 250 ||
    (value.badge !== undefined &&
      (typeof value.badge !== "string" || value.badge.length > 32)) ||
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
  // Older deployed branding actions may not provide guidance yet.
  if (value.guidance !== undefined) {
    const guidance = value.guidance;
    if (
      !Array.isArray(guidance?.methods) ||
      guidance.methods.length < 1 ||
      guidance.methods.length > 2 ||
      new Set(guidance.methods).size !== guidance.methods.length ||
      guidance.methods.some(
        (method) => !Object.hasOwn(paymentInstructions, method),
      ) ||
      typeof guidance.showInstructions !== "boolean" ||
      !Array.isArray(guidance.links) ||
      guidance.links.length > 6
    )
      throw new Error("Invalid payment guidance response.");
    if (guidance.tooltip !== undefined) {
      const tooltip = guidance.tooltip;
      if (
        typeof tooltip?.text !== "string" ||
        tooltip.text.length > 4000 ||
        typeof tooltip.label !== "string" ||
        tooltip.label.length > 100 ||
        (tooltip.text.trim() && !tooltip.label.trim())
      )
        throw new Error("Invalid payment instructions tooltip.");
    }
    for (const link of guidance.links) {
      if (
        !guidance.methods.includes(link.method) ||
        !["education", "terms"].includes(link.kind) ||
        typeof link.label !== "string" ||
        !link.label.trim() ||
        link.label.length > 100 ||
        typeof link.url !== "string"
      )
        throw new Error("Invalid payment education link.");
      helpUrl(link.url);
    }
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
          for (const listener of brandingListeners) listener();
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
          for (const listener of brandingListeners) listener();
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
    throw new Error("Pay by Bank is not available for this cart.");
  const config = matches[0].oope_payment_method_config;
  const entries = config?.custom_config?.filter(
    (entry) => entry.key === "action_base_url",
  );
  if (entries?.length !== 1 || typeof entries[0].value !== "string")
    throw new Error("Bank payment endpoint is missing or ambiguous.");
  const base = new URL(entries[0].value);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Bank payment requires an HTTPS action base URL.");
  if (
    config.backend_integration_url !==
    `${base.href.replace(/\/$/, "")}/create-session`
  )
    throw new Error("Bank payment endpoint configuration does not match.");
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
    throw new Error("Could not read bank payment configuration for this cart.");
  return paymentActionBase(response.data.cart.available_payment_methods);
}

let instructionSequence = 0;

function instructionPopover({ label, text }) {
  const details = document.createElement("details");
  details.className = "azupay-payment-instructions";
  Object.assign(details.style, {
    position: "relative",
    maxWidth: "100%",
    margin: "16px 0",
  });
  const trigger = document.createElement("summary");
  trigger.textContent = label;
  Object.assign(trigger.style, {
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    color: "var(--link-color, #005fcc)",
    cursor: "pointer",
    textDecoration: "underline dotted",
    textUnderlineOffset: "4px",
    overflowWrap: "anywhere",
  });
  const panel = document.createElement("div");
  panel.id = `azupay-instructions-${++instructionSequence}`;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", label);
  panel.tabIndex = 0;
  trigger.setAttribute("aria-controls", panel.id);
  Object.assign(panel.style, {
    position: "absolute",
    top: "100%",
    left: "0",
    width: "min(36rem, 100%)",
    maxHeight: "min(60vh, 28rem)",
    boxSizing: "border-box",
    overflow: "auto",
    overflowWrap: "anywhere",
    padding: "20px",
    border: "1px solid #ddd",
    borderRadius: "12px",
    background: "#fff",
    color: "#242424",
    boxShadow: "0 4px 20px #0003",
    zIndex: "10",
  });
  const heading = document.createElement("strong");
  heading.textContent = label;
  const content = document.createElement("p");
  content.textContent = text;
  content.style.whiteSpace = "pre-wrap";
  panel.append(heading, content);
  details.append(trigger, panel);
  let pinned = false;
  function close() {
    pinned = false;
    details.open = false;
  }
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    trigger.focus();
    pinned = !pinned;
    details.open = pinned;
  });
  details.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") details.open = true;
  });
  details.addEventListener("pointerleave", () => {
    if (!details.contains(document.activeElement)) close();
  });
  details.addEventListener("focusin", () => {
    details.open = true;
  });
  details.addEventListener("focusout", (event) => {
    if (!details.contains(event.relatedTarget)) close();
  });
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      event.stopPropagation();
      trigger.focus();
      close();
    }
  });
  return details;
}

function paymentBadge(text) {
  const badge = document.createElement("span");
  badge.className = "azupay-payment-badge";
  badge.textContent = text;
  Object.assign(badge.style, {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "4px",
    background: "#176b37",
    color: "#fff",
    fontSize: "0.875rem",
    lineHeight: "1.5",
    overflowWrap: "anywhere",
  });
  return badge;
}

function paymentLogos(values) {
  const logos = document.createElement("span");
  logos.className = "azupay-payment-logos";
  Object.assign(logos.style, {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: "16px",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
  });
  for (const logo of values) {
    const image = document.createElement("img");
    image.alt = logo.alt;
    image.width = 100;
    image.height = 48;
    // Override storefront rules that otherwise expand images to intrinsic size.
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
  return logos;
}

// Drop-in 3.x has no rich-label slot. Enhance only its existing bank radio label.
export function withAzupaySelector(render, getCartId) {
  return async (container) => {
    let decoration;
    let previousBranding;
    let stopped = false;
    function update() {
      if (stopped) return;
      const branding = brandingByCart.get(getCartId());
      const radio = container.querySelector(
        'input[type="radio"][name="payment-method"][value="azupay"]',
      );
      let label = radio?.closest("label");
      // ToggleButton nests the radio's own label inside the full method label.
      let enclosing = label?.parentElement?.closest("label");
      while (enclosing && container.contains(enclosing)) {
        label = enclosing;
        enclosing = label.parentElement?.closest("label");
      }
      if (!branding || branding.error || !label) {
        decoration?.remove();
        decoration = undefined;
        container.removeAttribute("data-azupay-selector-enhanced");
        return;
      }
      if (decoration?.parentElement === label && branding === previousBranding)
        return;
      decoration?.remove();
      previousBranding = branding;
      decoration = document.createElement("span");
      decoration.className = "azupay-selector-display";
      Object.assign(decoration.style, {
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px 12px",
        maxWidth: "100%",
        minWidth: "0",
        margin: "8px 0 0 32px",
      });
      const style = document.createElement("style");
      style.textContent = `
        [data-azupay-selector-enhanced] .azupay-payment-details > .azupay-payment-logos,
        [data-azupay-selector-enhanced] .azupay-payment-details > .azupay-payment-byline,
        [data-azupay-selector-enhanced] .azupay-payment-details > .azupay-payment-badge { display: none !important; }
      `;
      decoration.append(style);
      if (branding.byline) {
        const byline = document.createElement("span");
        byline.textContent = branding.byline;
        Object.assign(byline.style, {
          flexBasis: "100%",
          textAlign: "center",
          fontSize: "0.875rem",
          fontWeight: "normal",
        });
        decoration.append(byline);
      }
      if (branding.logos.length)
        decoration.append(paymentLogos(branding.logos));
      if (branding.badge?.trim())
        decoration.append(paymentBadge(branding.badge));
      label.append(decoration);
      container.setAttribute("data-azupay-selector-enhanced", "");
    }
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true });
    brandingListeners.add(update);
    function cleanup() {
      stopped = true;
      observer.disconnect();
      brandingListeners.delete(update);
      decoration?.remove();
      container.removeAttribute("data-azupay-selector-enhanced");
    }
    try {
      const api = await render(container);
      update();
      const remove = api.remove.bind(api);
      api.remove = (...args) => {
        cleanup();
        return remove(...args);
      };
      return api;
    } catch (error) {
      cleanup();
      throw error;
    }
  };
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
      byline.className = "azupay-payment-byline";
      byline.textContent = branding.byline;
      container.append(byline);
    }
    if (branding?.logos?.length) container.append(paymentLogos(branding.logos));
    if (branding?.badge?.trim()) container.append(paymentBadge(branding.badge));
    const guidance = branding?.guidance;
    const tooltip = guidance?.tooltip ?? {
      label: DEFAULT_INSTRUCTIONS_LABEL,
      text: guidance?.methods
        .map((method) => paymentInstructions[method])
        .join("\n\n"),
    };
    if (guidance?.showInstructions && tooltip.text?.trim())
      container.append(instructionPopover(tooltip));
    const terms = guidance?.links.filter((link) => link.kind === "terms");
    if (terms?.length) {
      const links = document.createElement("ul");
      links.className = "azupay-payment-help";
      links.setAttribute("aria-label", "Payment terms");
      for (const link of terms) {
        const item = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.href = link.url;
        anchor.textContent = `${link.label} (opens in a new tab)`;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.referrerPolicy = "no-referrer";
        item.append(anchor);
        links.append(item);
      }
      container.append(links);
    }
    const message = document.createElement("p");
    message.dataset.azupayStatus = "";
    message.setAttribute("role", "status");
    message.textContent = hasPendingPayment()
      ? "Your bank payment session is saved. Review your details and select Complete your order below. We'll verify your existing payment without creating another bank payment."
      : "Pay securely from your bank account. After payment is verified, select Complete your order to finish.";
    container.append(message);
    ctx.replaceHTML(container);
  },
};

export function azupayButtonLabel(storage = sessionStorage, label) {
  if (label) label.dataset.azupayOrderLabel = "";
  return hasPendingPayment(storage) ? "Complete your order" : "Pay by Bank";
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
      throw new Error("A bank payment check is already in progress.");
    if (request.code !== "azupay" && !hasPendingPayment(storage))
      return placeOrder(request);
    if (request.code !== "azupay") {
      const error = new Error(
        "A bank payment is outstanding. Select the bank payment method and check it before using another payment method. Do not pay again.",
      );
      showStatus(error.message, true);
      throw error;
    }
    if (purchaseOrder()) {
      const error = new Error(
        "Bank payment requires standard synchronous checkout, not B2B purchase-order approval.",
      );
      showStatus(error.message, true);
      throw error;
    }
    running = true;
    try {
      lockCart(true);
      showStatus("Preparing secure bank payment...");
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
          "Your bank payment has not been confirmed yet. If you've paid, allow a little time, then select Complete your order again. This only checks your existing payment; it will not request another payment.",
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
