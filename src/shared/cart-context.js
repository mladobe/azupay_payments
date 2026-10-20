import { randomUUID } from "node:crypto";
import { requireValue } from "./payment.js";

const ATTRIBUTE = "azupay_context";
const CAPTURE_ATTRIBUTE = "azupay_context_capture";
const TTL = 300;

function marker(quote) {
  const values = quote.custom_attributes?.filter(
    ({ attribute_code }) => attribute_code === ATTRIBUTE,
  );
  requireValue(
    !values || values.length <= 1,
    "CART_CONTEXT_AMBIGUOUS",
    "The cart payment context is ambiguous. Contact support.",
    409,
  );
  return values?.[0]?.value;
}

export function cartContext({
  client,
  getState,
  fetcher = fetch,
  nonce = randomUUID,
  logError,
}) {
  let statePromise;
  const state = () => {
    statePromise ??= getState();
    return statePromise;
  };
  const key = (value) => `azupay-cart-${value}`;
  async function quote(id) {
    const result = await client.get(`carts/${id}`).json();
    requireValue(
      Number.isSafeInteger(Number(result.id)) &&
        Number(result.id) === Number(id) &&
        result.is_active === true,
      "INACTIVE_CART",
      "The Commerce cart is no longer active.",
      409,
    );
    return result;
  }
  async function graph(query, variables, { authorization, storeCode }) {
    requireValue(
      typeof storeCode === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(storeCode),
      "MISSING_STORE_CODE",
      "The storefront must supply its Commerce store-view code.",
    );
    requireValue(
      !authorization ||
        (typeof authorization === "string" &&
          /^Bearer [A-Za-z0-9._-]+$/.test(authorization) &&
          authorization.length <= 16384),
      "INVALID_SHOPPER_AUTH",
      "The customer session is invalid. Sign in again before paying.",
      401,
    );
    const endpoint = new URL(
      `${client.config.baseUrl.replace(/\/$/, "")}/graphql`,
    );
    requireValue(
      endpoint.protocol === "https:" &&
        !endpoint.username &&
        !endpoint.password,
      "INVALID_COMMERCE_ENDPOINT",
      "The associated Commerce endpoint must use HTTPS.",
      503,
    );
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Store: storeCode,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    const privateValues = [
      variables.id,
      variables.input?.cart_id,
      authorization,
      authorization?.slice(7),
      ...(variables.input?.custom_attributes?.map(
        (attribute) => attribute.value,
      ) || []),
    ].filter((value) => typeof value === "string" && value.length > 0);
    const message = result.errors?.[0]?.message;
    const detail =
      typeof message === "string"
        ? privateValues
            .reduce(
              (text, value) => text.split(value).join("[redacted]"),
              message,
            )
            .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]")
            .slice(0, 300)
        : "";
    if (!response.ok || result.errors?.length || !result.data) {
      logError("COMMERCE_CART_GRAPHQL_FAILED", {
        status: response.status,
        endpoint: `${endpoint.origin}${endpoint.pathname}`,
        operation: query.startsWith("query") ? "read" : "save",
        categories: result.errors?.map(
          (error) => error.extensions?.category || error.extensions?.code,
        ),
      });
    }
    requireValue(
      response.ok && !result.errors?.length && result.data,
      "COMMERCE_CART_ACCESS",
      `Commerce cart lookup failed (HTTP ${response.status}). ${detail || "Refresh checkout before paying."}`,
      502,
    );
    return result.data;
  }
  return {
    async getQuote(cartId, request) {
      const owned = await graph(
        "query AzupayOwnedCart($id:String!){cart(cart_id:$id){id}}",
        { id: cartId },
        request,
      );
      requireValue(
        owned.cart?.id === cartId,
        "CART_CONTEXT_MISMATCH",
        "Commerce returned a different cart. Refresh checkout before paying.",
        409,
      );
      const value = nonce();
      const storage = await state();
      await storage.put(
        key(value),
        JSON.stringify({ cartId, storeCode: request.storeCode }),
        { ttl: TTL },
      );
      // Quote-save callbacks run before commit; a second save exposes the first marker.
      for (const capture of [false, true]) {
        const customAttributes = [
          { attribute_code: ATTRIBUTE, value },
          ...(capture
            ? [{ attribute_code: CAPTURE_ATTRIBUTE, value: nonce() }]
            : []),
        ];
        const result = await graph(
          "mutation AzupayBindCart($input:CartCustomAttributesInput!){setCustomAttributesOnCart(input:$input){cart{id custom_attributes{attribute_code value}}}}",
          {
            input: {
              cart_id: cartId,
              custom_attributes: customAttributes,
            },
          },
          request,
        );
        const cart = result.setCustomAttributesOnCart?.cart;
        requireValue(
          cart?.id === cartId && marker(cart) === value,
          "CART_CONTEXT_MISMATCH",
          "Commerce could not save the payment context for this cart.",
          409,
        );
      }
      const saved = await storage.get(key(value));
      const binding = saved ? JSON.parse(saved.value) : null;
      requireValue(
        binding?.cartId === cartId &&
          binding.storeCode === request.storeCode &&
          /^[1-9][0-9]*$/.test(String(binding.quoteId)),
        "CART_CONTEXT_UNAVAILABLE",
        "The native cart mapping is unavailable. Check the authenticated Azupay quote-save webhook before retrying.",
        503,
      );
      const canonical = await quote(binding.quoteId);
      requireValue(
        marker(canonical) === value,
        "CART_CONTEXT_MISMATCH",
        "The cart changed while preparing bank checkout. Refresh before paying.",
        409,
      );
      return canonical;
    },
    async capture(input) {
      const id = String(input.quote_id ?? input.quote_entity_id ?? "");
      requireValue(
        /^[1-9][0-9]*$/.test(id),
        "MISSING_CAPTURE_QUOTE",
        "The Azupay quote-save webhook requires a native quote ID.",
      );
      requireValue(
        input.quote_id == null ||
          input.quote_entity_id == null ||
          String(input.quote_id) === String(input.quote_entity_id),
        "CART_CONTEXT_AMBIGUOUS",
        "The Azupay quote-save webhook returned conflicting quote identities.",
        409,
      );
      let canonical;
      try {
        canonical = await quote(id);
      } catch (error) {
        if (error.response?.status !== 404) throw error;
        logError("CART_CAPTURE_NOT_COMMITTED");
        return;
      }
      const value = marker(canonical);
      if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) return;
      const storage = await state();
      const saved = await storage.get(key(value));
      if (!saved) return;
      const pending = JSON.parse(saved.value);
      requireValue(
        !pending.quoteId || pending.quoteId === id,
        "CART_CONTEXT_MISMATCH",
        "A payment context cannot be bound to another quote.",
        409,
      );
      await storage.put(
        key(value),
        JSON.stringify({ ...pending, quoteId: id }),
        { ttl: TTL },
      );
    },
  };
}
