import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { azupayClient } from "../src/shared/azupay-client.js";
import {
  normalizePaymentConfig,
  transactionId,
  verifyReceipt,
} from "../src/shared/payment.js";
import { paymentService } from "../src/shared/service.js";

function fixture() {
  const params = {
    AZUPAY_SIGNING_SECRET: "cd".repeat(32),
    AZUPAY_UAT_BOTH_CLIENT_ID: "uat-both",
    AZUPAY_UAT_BOTH_API_KEY: "placeholder",
    AZUPAY_CHECKOUT_HOSTS: "pay-uat.azupay.com.au",
  };
  const config = {
    enabled: true,
    environment: "uat",
    methods: "both",
    expiryMinutes: "30",
    autoInvoice: true,
  };
  const quote = {
    id: 42,
    store_id: 1,
    is_active: true,
    is_virtual: false,
    quote_currency_code: "AUD",
    grand_total: 10.29,
    billing_address: { country_id: "AU" },
    shipping_address: { country_id: "AU" },
  };
  let response;
  const calls = { create: [], get: [], invoice: [], errors: [] };
  const deps = {
    params,
    now: () => 100000,
    getConfig: async () => normalizePaymentConfig(config),
    commerce: {
      getQuote: async () => quote,
      pendingOrders: async () => [],
      invoice: async (id) => calls.invoice.push(id),
    },
    azupay: () => ({
      create: async (request) => {
        calls.create.push(request);
        response = {
          PaymentRequest: {
            ...request,
            checkoutUrl: "https://pay-uat.azupay.com.au/v2/checkout/abc",
          },
          PaymentRequestStatus: {
            paymentRequestId: "request+/=",
            status: "WAITING",
          },
        };
        return response;
      },
      get: async (id) => {
        calls.get.push(id);
        return response;
      },
    }),
    logError: (code, info) => calls.errors.push({ code, info }),
  };
  return {
    params,
    config,
    quote,
    calls,
    deps,
    service: paymentService(deps),
    paid: () =>
      Object.assign(response.PaymentRequestStatus, {
        status: "COMPLETE",
        amountReceived: 10.29,
        settledBy: "PayTo",
      }),
    setStatus: (status) => {
      response.PaymentRequestStatus.status = status;
    },
  };
}
const input = {
  cartId: "maskedcart012345678901234567890123",
  returnUrl: "https://shop.example/payment-return",
};
const order = {
  payment_method: "azupay",
  quote_id: 42,
  store_id: 1,
  grand_total: 10.29,
  currency: "AUD",
};

describe("end-to-end payment service with Commerce/Azupay boundaries stubbed", () => {
  it("defaults to redirect and selects modal only from trusted scoped configuration", async () => {
    const defaults = fixture();
    assert.equal(
      (
        await defaults.service.createSession({
          ...input,
          checkoutPresentation: "modal",
        })
      ).checkoutPresentation,
      "redirect",
    );
    for (const value of ["modal", ["modal"], "redirect", ["redirect"]]) {
      const f = fixture();
      f.config.checkoutPresentation = value;
      assert.equal(
        (await f.service.createSession(input)).checkoutPresentation,
        Array.isArray(value) ? value[0] : value,
      );
    }
    for (const value of [
      "popup",
      [],
      ["modal", "redirect"],
      [["modal"]],
      true,
    ]) {
      const f = fixture();
      f.config.checkoutPresentation = value;
      await assert.rejects(f.service.createSession(input), {
        code: "INVALID_CHECKOUT_PRESENTATION",
      });
      assert.equal(f.calls.create.length, 0);
    }
  });
  it("uses canonical profile values throughout sessions and receipts after native UI saves", async () => {
    const f = fixture();
    f.config.environment = ["uat"];
    f.config.methods = ["both"];
    const session = await f.service.createSession(input);
    assert.equal(session.environment, "uat");
    assert.equal(session.methods, "both");
    const receipt = verifyReceipt(session.receipt, f.params, { now: 100000 });
    assert.equal(receipt.environment, "uat");
    assert.equal(receipt.methods, "both");
    assert.equal(receipt.transactionId, transactionId(f.quote, "uat", "both"));
    f.paid();
    assert.equal((await f.service.status(session.receipt)).paid, true);
    assert.equal(
      (
        await f.service.validate({
          ...order,
          payment_additional_information: { azupay_receipt: session.receipt },
        })
      ).requestId,
      receipt.requestId,
    );
  });
  it("creates a fixed-amount session from Commerce totals, never browser totals", async () => {
    const f = fixture();
    const session = await f.service.createSession({
      ...input,
      amount: 0.01,
      clientId: "evil",
    });
    assert.equal(session.amount, 10.29);
    assert.equal(session.methods, "both");
    assert.equal(f.calls.create[0].paymentAmount, 10.29);
    assert.equal(f.calls.create[0].clientId, "uat-both");
    assert.equal(f.calls.create[0].multiPayment, false);
    assert.equal(
      f.calls.create[0].paymentExpiryDatetime,
      new Date(1900000).toISOString(),
    );
    assert.equal(
      verifyReceipt(session.receipt, f.params, { now: 100000 }).quoteId,
      42,
    );
    assert.equal(JSON.stringify(session).includes("placeholder"), false);
    assert.equal(
      await f.service
        .validate({
          payment_method: "azupay",
          payment_additional_information: null,
        })
        .catch((e) => e.code),
      "MISSING_PAYMENT_INFO",
    );
  });
  it("never creates payments for invalid, foreign, inactive, zero or unconfigured carts", async () => {
    for (const change of [
      { is_active: false },
      { quote_currency_code: "USD" },
      { billing_address: { country_id: "NZ" } },
      { shipping_address: undefined },
      { grand_total: 0 },
    ]) {
      const f = fixture();
      Object.assign(f.quote, change);
      await assert.rejects(f.service.createSession(input));
      assert.equal(f.calls.create.length, 0);
    }
    const f = fixture();
    await assert.rejects(
      f.service.createSession({ ...input, cartId: "../orders" }),
      { code: "INVALID_CART" },
    );
    f.config.enabled = false;
    await assert.rejects(f.service.createSession(input), { code: "DISABLED" });
    assert.equal(f.calls.create.length, 0);
  });
  it("accepts virtual AUD carts without a shipping address", async () => {
    const f = fixture();
    f.quote.is_virtual = true;
    delete f.quote.shipping_address;
    assert.equal((await f.service.createSession(input)).amount, 10.29);
  });
  it("requires settlement and verifies paid sessions after a later admin disable", async () => {
    const f = fixture();
    const session = await f.service.createSession(input);
    assert.deepEqual(await f.service.status(session.receipt), {
      status: "WAITING",
      paid: false,
    });
    const checkoutOrder = {
      ...order,
      payment_additional_information: { azupay_receipt: session.receipt },
    };
    await assert.rejects(f.service.validate(checkoutOrder), {
      code: "PAYMENT_NOT_COMPLETE",
    });
    f.paid();
    f.config.enabled = false;
    assert.deepEqual(await f.service.status(session.receipt), {
      status: "COMPLETE",
      paid: true,
    });
    const paid = await f.service.validate(checkoutOrder);
    assert.equal(paid.quoteId, 42);
    await assert.rejects(
      f.service.validate({ ...checkoutOrder, quote_id: 43 }),
      { code: "ORDER_MISMATCH" },
    );
  });
  it("reports returns as unpaid and never treats an agreement approval as settlement", async () => {
    const f = fixture();
    const session = await f.service.createSession(input);
    f.setStatus("RETURN_COMPLETE");
    assert.deepEqual(await f.service.status(session.receipt), {
      status: "RETURN_COMPLETE",
      paid: false,
    });
  });
  it("offline-invoices only verified complete orders and surfaces partial batch failures", async () => {
    const f = fixture();
    const session = await f.service.createSession(input);
    f.paid();
    const commerceOrder = {
      entity_id: 7,
      quote_id: 42,
      store_id: 1,
      grand_total: 10.29,
      order_currency_code: "AUD",
      total_paid: 0,
      total_invoiced: 0,
      payment: {
        method: "azupay",
        additional_information: { azupay_receipt: session.receipt },
      },
    };
    f.deps.commerce.pendingOrders = async () => [
      commerceOrder,
      { ...commerceOrder, entity_id: 8, quote_id: 43 },
      { ...commerceOrder, entity_id: 9, total_invoiced: 1 },
      { payment: { method: "checkmo" } },
    ];
    const reconciler = paymentService(f.deps);
    const result = await reconciler.reconcile();
    assert.equal(result.invoiced, 1);
    assert.equal(result.inspected, 4);
    assert.deepEqual(f.calls.invoice, [7]);
    assert.deepEqual(result.failures, [
      { orderId: 8, code: "ORDER_MISMATCH" },
      { orderId: 9, code: "MANUAL_RECONCILIATION" },
    ]);
    assert.equal(f.calls.errors.length, 2);
    f.config.autoInvoice = false;
    assert.equal((await reconciler.reconcile()).invoiced, 0);
  });
});

describe("Azupay HTTP contract", () => {
  it("uses raw Authorization, v1 API, documented envelope and escaped GET id", async () => {
    const calls = [];
    const client = azupayClient(
      { baseUrl: "https://api-uat.azupay.com.au/v1", apiKey: "placeholder" },
      async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    );
    await client.create({ clientId: "client" });
    await client.get("id+/=");
    assert.equal(
      calls[0].url,
      "https://api-uat.azupay.com.au/v1/paymentRequest",
    );
    assert.equal(calls[0].options.headers.Authorization, "placeholder");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      PaymentRequest: { clientId: "client" },
    });
    assert.equal(
      calls[1].url,
      "https://api-uat.azupay.com.au/v1/paymentRequest?id=id%2B%2F%3D",
    );
    assert.equal(calls[0].options.redirect, "error");
  });
  it("surfaces network, HTTP and invalid JSON without echoing provider bodies", async () => {
    const profile = {
      baseUrl: "https://api-uat.azupay.com.au/v1",
      apiKey: "placeholder",
    };
    await assert.rejects(
      azupayClient(profile, async () => {
        throw new Error("credential");
      }).get("x"),
      { code: "AZUPAY_UNAVAILABLE" },
    );
    await assert.rejects(
      azupayClient(profile, async () => ({ ok: false, status: 401 })).get("x"),
      { code: "AZUPAY_API_ERROR" },
    );
    await assert.rejects(
      azupayClient(profile, async () => ({
        ok: true,
        json: async () => {
          throw new Error("secret");
        },
      })).get("x"),
      { code: "AZUPAY_INVALID_RESPONSE" },
    );
  });
});
