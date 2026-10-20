import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse } from "yaml";
import config from "../app.commerce.config.js";
import packageJson from "../package.json" with { type: "json" };
import { main as createSession } from "../src/commerce-extensibility-1/actions/create-session/index.js";
import { main as paymentStatus } from "../src/commerce-extensibility-1/actions/payment-status/index.js";
import { main as validatePayment } from "../src/commerce-extensibility-1/actions/validate-payment/index.js";
import { publicRequest, validateReturnUrl } from "../src/shared/http.js";
import { commerceAdapter } from "../src/shared/runtime.js";
import { checkoutCompletion } from "../storefront/commerce.js";

it("uses one package/App Builder release version", () => {
  assert.equal(config.metadata.version, packageJson.version);
});

describe("public HTTP boundaries", () => {
  const params = {
    AZUPAY_STOREFRONT_ORIGINS: "https://shop.example",
    __ow_headers: { origin: "https://shop.example" },
    __ow_method: "post",
  };
  it("accepts exact origins only and supports preflight without API calls", async () => {
    assert.equal(
      publicRequest(params).headers["access-control-allow-origin"],
      "https://shop.example",
    );
    for (const origin of [
      undefined,
      "null",
      "https://shop.example.evil.test",
      "http://shop.example",
    ]) {
      assert.throws(
        () => publicRequest({ ...params, __ow_headers: { origin } }),
        { code: "ORIGIN_DENIED" },
      );
    }
    for (const main of [createSession, paymentStatus]) {
      const preflight = await main({ ...params, __ow_method: "options" });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers["cache-control"], "no-store");
    }
  });
  it("rejects wrong method before looking up Commerce", async () => {
    const response = await createSession({ ...params, __ow_method: "get" });
    assert.equal(response.statusCode, 405);
    assert.equal(response.body.error, "METHOD_NOT_ALLOWED");
  });
  it("rejects off-origin, credentialed and query-bearing return URLs", () => {
    assert.equal(
      validateReturnUrl(
        "https://shop.example/azupay-return",
        "https://shop.example",
      ),
      "https://shop.example/azupay-return",
    );
    for (const value of [
      "https://evil.test",
      "https://user@shop.example/return",
      "https://shop.example/return?secret=1",
      "https://shop.example/return#x",
      "invalid",
    ]) {
      assert.throws(() => validateReturnUrl(value, "https://shop.example"), {
        code: "INVALID_RETURN_URL",
      });
    }
  });
  it("does not interfere with unrelated payment methods", async () => {
    const response = await validatePayment({ payment_method: "checkmo" });
    assert.deepEqual(response.body, { op: "success" });
  });
});

describe("Commerce REST adapter", () => {
  it("resolves branding to one active native store-view ID, never a browser numeric ID", async () => {
    const commerce = commerceAdapter({
      get: (path) => {
        assert.equal(path, "store/storeViews");
        return {
          json: async () => [
            { code: "default", id: 1, is_active: 1 },
            { code: "other_store", id: 7, is_active: true },
            { code: "disabled", id: 8, is_active: 0 },
          ],
        };
      },
    });
    assert.equal(await commerce.storeIdByCode("other_store"), 7);
    await assert.rejects(commerce.storeIdByCode("disabled"), {
      code: "INVALID_STORE",
    });
    await assert.rejects(commerce.storeIdByCode("7"), {
      code: "INVALID_STORE",
    });
    const duplicated = commerceAdapter({
      get: () => ({
        json: async () => [
          { code: "default", id: 1, is_active: 1 },
          { code: "default", id: 2, is_active: 1 },
        ],
      }),
    });
    await assert.rejects(duplicated.storeIdByCode("default"), {
      code: "INVALID_STORE",
    });
  });
  it("reads mapped native quote totals and shipping assignment, with no browser amount", async () => {
    const paths = [];
    const commerce = commerceAdapter(
      {
        get: (path) => ({
          json: async () => {
            paths.push(path);
            return { grand_total: 50.29 };
          },
        }),
      },
      {
        getQuote: async (cartId, request) => {
          assert.equal(cartId, "cart+/=");
          assert.equal(request.storeCode, "default");
          return {
            id: 2,
            grand_total: 999,
            currency: { quote_currency_code: "AUD" },
            extension_attributes: {
              shipping_assignments: [
                { shipping: { address: { country_id: "AU" } } },
              ],
            },
          };
        },
      },
    );
    const quote = await commerce.getQuote("cart+/=", {
      storeCode: "default",
    });
    assert.deepEqual(paths, ["carts/2/totals"]);
    assert.equal(quote.grand_total, 50.29);
    assert.equal(quote.quote_currency_code, "AUD");
    assert.equal(quote.shipping_address.country_id, "AU");
  });
  it("collects all pages before returning and requests only pending orders", async () => {
    const pages = [];
    const commerce = commerceAdapter({
      get: (path) => ({
        json: async () => {
          const query = new URL(`https://commerce.example/${path}`)
            .searchParams;
          assert.equal(
            query.get("searchCriteria[filter_groups][0][filters][0][value]"),
            "pending",
          );
          const page = Number(query.get("searchCriteria[currentPage]"));
          pages.push(page);
          return {
            total_count: 101,
            items: Array.from({ length: page === 1 ? 100 : 1 }, () => ({})),
          };
        },
      }),
    });
    assert.equal((await commerce.pendingOrders()).length, 101);
    assert.deepEqual(pages, [1, 2]);
  });
  it("fails explicitly for an incomplete scan or API failure", async () => {
    const incomplete = commerceAdapter({
      get: () => ({ json: async () => ({ items: [], total_count: 1 }) }),
    });
    await assert.rejects(incomplete.pendingOrders(), {
      code: "COMMERCE_PAGINATION_ERROR",
    });
    const unavailable = commerceAdapter({
      get: () => ({
        json: async () => {
          throw new Error("private response");
        },
      }),
    });
    await assert.rejects(unavailable.pendingOrders(), {
      code: "COMMERCE_API_ERROR",
    });
  });
  it("creates an offline invoice and never initiates a capture", async () => {
    let captured;
    const commerce = commerceAdapter({
      post: (path, options) => ({
        json: async () => {
          captured = { path, ...options };
          return 77;
        },
      }),
    });
    assert.equal(await commerce.invoice(9), 77);
    assert.equal(captured.path, "order/9/invoice");
    assert.equal(captured.json.capture, false);
    assert.equal(captured.json.notify, true);
  });
});

describe("configuration and deployment contracts", () => {
  it("declares a five-minute private reconciliation schedule", async () => {
    const manifest = parse(
      await readFile(
        new URL(
          "../src/commerce-extensibility-1/ext.config.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const payment = manifest.runtimeManifest.packages.azupay;
    assert.deepEqual(payment.triggers["reconcile-timer"], {
      feed: "/whisk.system/alarms/interval",
      inputs: { minutes: 5 },
    });
    assert.deepEqual(payment.rules["reconcile-rule"], {
      trigger: "reconcile-timer",
      action: "reconcile",
    });
    assert.equal(payment.actions.reconcile.web, "no");
  });
  it("provides help on every admin field, safe defaults and all choices", () => {
    const fields = config.businessConfig.schema;
    assert.ok(
      fields.every((field) => field.label && field.description?.length > 30),
    );
    assert.equal(
      fields.find((field) => field.name === "enabled").default,
      false,
    );
    assert.equal(
      fields.find((field) => field.name === "environment").default,
      "uat",
    );
    assert.deepEqual(
      fields
        .find((field) => field.name === "methods")
        .options.map((option) => option.value),
      ["payid", "payto", "both"],
    );
    assert.equal(
      fields.some((field) => field.type === "password"),
      false,
    );
  });
  it("declares required SaaS payment binding fields and the correct availability payload", () => {
    const validation = config.webhooks.find(
      (hook) => hook.runtimeAction === "azupay/validate-payment",
    );
    assert.equal(validation.requireAdobeAuth, true);
    assert.equal(validation.webhook.required, true);
    assert.equal(validation.webhook.timeout, 20000);
    assert.deepEqual(validation.env, ["saas"]);
    assert.deepEqual(
      validation.webhook.fields.map((field) => field.name).sort(),
      [
        "currency",
        "grand_total",
        "payment_additional_information",
        "payment_method",
        "quote_id",
        "store_id",
      ],
    );
    assert.deepEqual(
      config.webhooks.find((hook) => hook.category === "append").webhook.fields,
      [{ name: "payload" }],
    );
  });
  it("protects action inputs and keeps reconciliation private", async () => {
    const manifest = parse(
      await readFile(
        new URL(
          "../src/commerce-extensibility-1/ext.config.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const payment = manifest.runtimeManifest.packages.azupay;
    assert.ok(
      Object.values(payment.actions).every(
        (action) => action.annotations.final === true,
      ),
    );
    assert.equal(
      payment.actions["validate-payment"].annotations["require-adobe-auth"],
      true,
    );
    assert.equal(
      payment.actions["filter-payment"].annotations["require-adobe-auth"],
      true,
    );
    for (const action of ["create-session", "payment-status"])
      assert.equal(
        payment.actions[action].annotations["web-custom-options"],
        true,
      );
    assert.ok(["no", false].includes(payment.actions.reconcile.web));
    const env = await readFile(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );
    for (const key of Object.keys(payment.inputs)) {
      assert.ok(env.includes(`${key}=`), `${key} needs an example`);
    }
    const app = parse(
      await readFile(new URL("../app.config.yaml", import.meta.url), "utf8"),
    );
    assert.ok(app.extensions["commerce/configuration/1"]);
    const install = parse(
      await readFile(new URL("../install.yaml", import.meta.url), "utf8"),
    );
    assert.ok(
      install.extensions.some(
        (item) => item.extensionPointId === "commerce/configuration/1",
      ),
    );
  });
});

describe("GraphQL checkout completion", () => {
  it("persists exact additional_data then places the same cart", async () => {
    const calls = [];
    const complete = checkoutCompletion({
      cartId: "masked",
      graphql: async (query, variables) => {
        calls.push({ query, variables });
        return query.includes("AzupaySetPayment")
          ? { data: { setPaymentMethodOnCart: { cart: {} } } }
          : {
              data: {
                placeOrder: { orderV2: { number: "100000001" }, errors: [] },
              },
            };
      },
    });
    const method = {
      code: "azupay",
      additional_data: [{ key: "azupay_receipt", value: "signed" }],
    };
    assert.deepEqual(await complete(method), { number: "100000001" });
    assert.deepEqual(calls[0].variables, { cartId: "masked", method });
    assert.deepEqual(calls[1].variables, { cartId: "masked" });
  });
  it("does not place an order when setting payment fails", async () => {
    let calls = 0;
    const complete = checkoutCompletion({
      cartId: "masked",
      graphql: async () => {
        calls += 1;
        return { errors: [{ message: "No" }] };
      },
    });
    await assert.rejects(complete({}), /do not|not payment/);
    assert.equal(calls, 1);
  });
  it("surfaces business errors and missing confirmation instead of success", async () => {
    for (const placed of [
      { errors: [{ message: "No" }] },
      { data: { placeOrder: { errors: [{ code: "ERROR" }] } } },
      { data: { placeOrder: {} } },
    ]) {
      const complete = checkoutCompletion({
        cartId: "masked",
        graphql: async (query) =>
          query.includes("AzupaySetPayment")
            ? { data: { setPaymentMethodOnCart: { cart: {} } } }
            : placed,
      });
      await assert.rejects(complete({}), /do not pay again/);
    }
  });
});
