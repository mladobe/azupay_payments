import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cartContext } from "../src/shared/cart-context.js";

function fixture({
  capture = true,
  authorized = true,
  errorMessage = "Not your cart",
} = {}) {
  const records = new Map();
  const requests = [];
  const paths = [];
  const errors = [];
  const quote = { id: 42, is_active: true, custom_attributes: [] };
  const state = {
    put: async (key, value, options) => {
      assert.equal(options.ttl, 300);
      records.set(key, value);
    },
    get: async (key) =>
      records.has(key) ? { value: records.get(key) } : undefined,
  };
  let context;
  context = cartContext({
    client: {
      config: { baseUrl: "https://commerce.example/tenant" },
      get: (path) => ({
        json: async () => {
          paths.push(path);
          return structuredClone(quote);
        },
      }),
    },
    getState: async () => state,
    logError: (code) => errors.push(code),
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url: url.href, ...options, body });
      if (!authorized)
        return {
          ok: true,
          status: 200,
          json: async () => ({ errors: [{ message: errorMessage }] }),
        };
      if (body.query.startsWith("query"))
        return {
          ok: true,
          json: async () => ({ data: { cart: { id: "masked-cart-id" } } }),
        };
      if (capture) await context.capture({ quote_id: "42" });
      quote.custom_attributes = body.variables.input.custom_attributes;
      return {
        ok: true,
        json: async () => ({
          data: {
            setCustomAttributesOnCart: {
              cart: {
                id: "masked-cart-id",
                custom_attributes: quote.custom_attributes,
              },
            },
          },
        }),
      };
    },
  });
  return { context, records, requests, paths, quote, errors };
}

describe("SaaS owned-cart to native-quote binding", () => {
  it("uses shopper-scoped GraphQL, two committed marker saves and native REST quote lookup", async () => {
    const f = fixture();
    const result = await f.context.getQuote("masked-cart-id", {
      storeCode: "default",
      authorization: "Bearer test-customer-token",
    });
    assert.equal(result.id, 42);
    assert.deepEqual(f.paths, ["carts/42", "carts/42", "carts/42"]);
    assert.equal(f.requests.length, 3);
    assert.ok(
      f.requests.every(
        (request) =>
          request.url === "https://commerce.example/tenant/graphql" &&
          request.headers.Store === "default" &&
          request.headers.Authorization === "Bearer test-customer-token",
      ),
    );
    assert.ok(
      [...f.records.values()].every(
        (record) => !record.includes("test-customer-token"),
      ),
    );
  });
  it("rejects carts not owned by the current shopper before saving state", async () => {
    const f = fixture({ authorized: false });
    await assert.rejects(
      f.context.getQuote("masked-cart-id", { storeCode: "default" }),
      { code: "COMMERCE_CART_ACCESS" },
    );
    assert.equal(f.records.size, 0);
    assert.equal(f.paths.length, 0);
  });
  it("fails explicitly without the authenticated capture hook", async () => {
    const f = fixture({ capture: false });
    await assert.rejects(
      f.context.getQuote("masked-cart-id", { storeCode: "default" }),
      { code: "CART_CONTEXT_UNAVAILABLE" },
    );
  });
  it("does not capture unrelated quotes or accept invalid quote identities", async () => {
    const f = fixture();
    await f.context.capture({ quote_id: 42 });
    assert.equal(f.records.size, 0);
    await assert.rejects(f.context.capture({ quote_id: "42/anything" }), {
      code: "MISSING_CAPTURE_QUOTE",
    });
  });
  it("accepts the native entity_id alias and rejects conflicting quote identities", async () => {
    const f = fixture();
    await f.context.capture({ quote_entity_id: "42" });
    assert.deepEqual(f.paths, ["carts/42"]);
    await assert.rejects(
      f.context.capture({ quote_id: "42", quote_entity_id: "43" }),
      { code: "CART_CONTEXT_AMBIGUOUS" },
    );
    assert.deepEqual(f.paths, ["carts/42"]);
  });
  it("redacts cart identities, customer tokens and email addresses from upstream errors", async () => {
    const token = "customer".repeat(3);
    const f = fixture({
      authorized: false,
      errorMessage: `Access denied: masked-cart-id, ${token}, shopper@example.com`,
    });
    await assert.rejects(
      f.context.getQuote("masked-cart-id", {
        storeCode: "default",
        authorization: `Bearer ${token}`,
      }),
      (error) => {
        assert.equal(error.code, "COMMERCE_CART_ACCESS");
        assert.match(error.message, /HTTP 200.*Access denied/);
        for (const value of ["masked-cart-id", token, "shopper@example.com"])
          assert.ok(!error.message.includes(value));
        return true;
      },
    );
  });
  it("never rebinds an existing context to another native quote", async () => {
    const f = fixture();
    await f.context.getQuote("masked-cart-id", { storeCode: "default" });
    f.quote.id = 43;
    await assert.rejects(f.context.capture({ quote_id: 43 }), {
      code: "CART_CONTEXT_MISMATCH",
    });
  });
  it("rejects incomplete store context and malformed forwarded customer credentials", async () => {
    const f = fixture();
    for (const request of [
      {},
      { storeCode: "default", authorization: "not-a-bearer-token" },
    ])
      await assert.rejects(f.context.getQuote("masked-cart-id", request), {
        code: request.storeCode ? "INVALID_SHOPPER_AUTH" : "MISSING_STORE_CODE",
      });
    assert.equal(f.requests.length, 0);
  });
});
