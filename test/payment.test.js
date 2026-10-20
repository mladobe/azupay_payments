import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOrderMatches,
  assertPaymentMatches,
  minorUnits,
  newSessionSettings,
  normalizePaymentConfig,
  receiptFromInfo,
  safeCheckoutUrl,
  selectProfile,
  signReceipt,
  transactionId,
  verifyReceipt,
} from "../src/shared/payment.js";

const params = {
  AZUPAY_SIGNING_SECRET: "ab".repeat(32),
  AZUPAY_UAT_PAYID_CLIENT_ID: "client-uat",
  AZUPAY_UAT_PAYID_API_KEY: "test-placeholder",
  AZUPAY_CHECKOUT_HOSTS: "pay.azupay.com.au",
};
const receipt = {
  version: 1,
  quoteId: 42,
  storeId: 1,
  amount: 12345,
  transactionId: "commerce-test",
  requestId: "id+/=",
  environment: "uat",
  methods: "payid",
  expiresAt: 200000,
};
const profile = { clientId: "client-uat" };
function result(overrides = {}) {
  return {
    PaymentRequest: {
      clientId: "client-uat",
      clientTransactionId: receipt.transactionId,
      paymentAmount: 123.45,
      multiPayment: false,
      ...overrides.request,
    },
    PaymentRequestStatus: {
      paymentRequestId: receipt.requestId,
      status: "COMPLETE",
      amountReceived: 123.45,
      settledBy: "PayID",
      ...overrides.status,
    },
  };
}

describe("AUD arithmetic", () => {
  it("uses exact cents and accepts Commerce decimal padding", () => {
    assert.equal(minorUnits("123.4500"), 12345);
    assert.equal(minorUnits(0.01), 1);
    assert.equal(minorUnits(0.29), 29);
    assert.equal(minorUnits("0.1"), 10);
    assert.equal(minorUnits(0), 0);
  });
  it("rejects fractional cents, negative, non-finite and unsafe values", () => {
    for (const value of [
      "1.001",
      "1.0001",
      -1,
      NaN,
      Infinity,
      null,
      undefined,
      "1e3",
      "9007199254740992",
    ]) {
      assert.throws(() => minorUnits(value), { code: "INVALID_AMOUNT" });
    }
  });
});

describe("profiles and rollout gates", () => {
  it("normalizes scalar and native UI singleton selections without mutating configuration", () => {
    for (const environment of ["uat", "production"]) {
      for (const methods of ["payid", "payto", "both"]) {
        for (const stored of [
          { environment, methods },
          { environment: [environment], methods },
          { environment, methods: [methods] },
          { environment: [environment], methods: [methods] },
        ]) {
          const config = { ...stored, enabled: false, expiryMinutes: "31" };
          const original = structuredClone(config);
          assert.deepEqual(normalizePaymentConfig(config), {
            ...config,
            environment,
            methods,
          });
          assert.deepEqual(config, original);
        }
      }
    }
  });
  it("rejects empty, multiple, nested and invalid single-selection values", () => {
    for (const name of ["environment", "methods"]) {
      for (const value of [
        [],
        ["uat", "production"],
        ["payid", "payto"],
        [["both"]],
        ["unknown"],
        ["both", "both"],
        "unknown",
        undefined,
        null,
        true,
        1,
      ]) {
        assert.throws(
          () =>
            normalizePaymentConfig({
              environment: "uat",
              methods: "both",
              [name]: value,
            }),
          { code: "INVALID_PROFILE" },
        );
      }
    }
  });
  it("selects all six profiles without arbitrary API URLs", () => {
    for (const environment of ["uat", "production"]) {
      for (const methods of ["payid", "payto", "both"]) {
        const prefix = `AZUPAY_${environment.toUpperCase()}_${methods.toUpperCase()}`;
        const selected = selectProfile(
          {
            AZUPAY_ALLOW_PRODUCTION: "true",
            [`${prefix}_CLIENT_ID`]: prefix,
            [`${prefix}_API_KEY`]: "placeholder",
          },
          environment,
          methods,
        );
        assert.equal(selected.clientId, prefix);
        assert.equal(
          selected.baseUrl,
          environment === "uat"
            ? "https://api-uat.azupay.com.au/v1"
            : "https://api.azupay.com.au/v1",
        );
      }
    }
  });
  it("rejects missing credentials, unknown choices and production by default", () => {
    assert.throws(() => selectProfile(params, "uat", "payto"), {
      code: "PROFILE_NOT_CONFIGURED",
    });
    assert.throws(
      () => selectProfile(params, "https://evil.example", "payid"),
      { code: "INVALID_PROFILE" },
    );
    assert.throws(() => selectProfile(params, "production", "payid"), {
      code: "PRODUCTION_BLOCKED",
    });
  });
  it("requires enablement, signing secret, admin approval and valid expiry", () => {
    const config = {
      enabled: true,
      environment: "uat",
      methods: "payid",
      expiryMinutes: "30",
    };
    assert.equal(newSessionSettings(config, params).expiryMinutes, 30);
    assert.throws(
      () => newSessionSettings({ ...config, enabled: false }, params),
      { code: "DISABLED" },
    );
    assert.throws(() => newSessionSettings(config, {}), {
      code: "SIGNING_NOT_CONFIGURED",
    });
    for (const expiryMinutes of ["4", "121", "30.5", "garbage"]) {
      assert.throws(
        () => newSessionSettings({ ...config, expiryMinutes }, params),
        { code: "INVALID_EXPIRY" },
      );
    }
    assert.throws(
      () =>
        newSessionSettings({ ...config, environment: "production" }, params),
      { code: "PRODUCTION_NOT_CONFIRMED" },
    );
  });
});

describe("signed receipts and payment binding", () => {
  it("validates signatures and expiry, with explicit trusted-order expiry override", () => {
    const token = signReceipt(receipt, params);
    assert.deepEqual(verifyReceipt(token, params, { now: 100000 }), receipt);
    assert.throws(() => verifyReceipt(token, params, { now: 200001 }), {
      code: "RECEIPT_EXPIRED",
    });
    assert.deepEqual(
      verifyReceipt(token, params, { now: 200001, checkExpiry: false }),
      receipt,
    );
    assert.throws(() => verifyReceipt(`${token}x`, params), {
      code: "INVALID_RECEIPT",
    });
    const [payload, signature] = token.split(".");
    assert.throws(() => verifyReceipt(`${payload}x.${signature}`, params), {
      code: "INVALID_RECEIPT",
    });
    assert.throws(() => verifyReceipt(undefined, params), {
      code: "INVALID_RECEIPT",
    });
  });
  it("rejects signed but malformed fields", () => {
    assert.throws(
      () =>
        verifyReceipt(
          signReceipt({ ...receipt, quoteId: "42" }, params),
          params,
        ),
      { code: "INVALID_RECEIPT" },
    );
  });
  it("normalizes Commerce map and key/value payment info", () => {
    assert.equal(receiptFromInfo({ azupay_receipt: "token" }), "token");
    const token = signReceipt(receipt, params);
    assert.equal(
      receiptFromInfo([{ key: "azupay_receipt", value: token }]),
      token,
    );
    assert.equal(receiptFromInfo(["Azupay", token]), token);
    assert.throws(() => receiptFromInfo([token, token]), {
      code: "INVALID_RECEIPT",
    });
    assert.throws(() => receiptFromInfo(null), {
      code: "MISSING_PAYMENT_INFO",
    });
  });
  it("rejects replay on another quote, store, amount or currency", () => {
    const order = {
      quote_id: 42,
      store_id: 1,
      currency: "AUD",
      grand_total: "123.4500",
    };
    assertOrderMatches(receipt, order);
    for (const change of [
      { quote_id: 43 },
      { store_id: 2 },
      { currency: "USD" },
      { grand_total: 123.44 },
    ]) {
      assert.throws(
        () => assertOrderMatches(receipt, { ...order, ...change }),
        { code: "ORDER_MISMATCH" },
      );
    }
  });
  it("accepts only COMPLETE and exact received amount on the selected rail", () => {
    assertPaymentMatches(receipt, result(), profile);
    for (const status of [
      "WAITING",
      "EXPIRED",
      "COMPLETED",
      "RETURN_IN_PROGRESS",
      "RETURN_COMPLETE",
      "RETURN_FAILED",
      "UNKNOWN",
    ]) {
      assert.throws(
        () =>
          assertPaymentMatches(
            receipt,
            result({ status: { status } }),
            profile,
          ),
        { code: "PAYMENT_NOT_COMPLETE" },
      );
    }
    for (const status of [
      { amountReceived: 123.44 },
      { amountReceived: 124 },
      { settledBy: "PayTo" },
      { settledBy: "BSBAndAccountNumber" },
    ]) {
      assert.throws(
        () => assertPaymentMatches(receipt, result({ status }), profile),
        { code: "SETTLEMENT_MISMATCH" },
      );
    }
    assertPaymentMatches(
      { ...receipt, methods: "both" },
      result({ status: { settledBy: "PayTo" } }),
      profile,
    );
    assertPaymentMatches(
      { ...receipt, methods: "payto" },
      result({ status: { settledBy: "PayTo" } }),
      profile,
    );
  });
  it("binds client, transaction, request ID and fixed amount", () => {
    for (const request of [
      { clientId: "other" },
      { clientTransactionId: "other" },
      { multiPayment: true },
      { paymentAmount: 1 },
    ]) {
      assert.throws(
        () => assertPaymentMatches(receipt, result({ request }), profile),
        { code: "PAYMENT_MISMATCH" },
      );
    }
    assert.throws(
      () =>
        assertPaymentMatches(
          receipt,
          result({ status: { paymentRequestId: "other" } }),
          profile,
        ),
      { code: "PAYMENT_MISMATCH" },
    );
  });
  it("uses deterministic idempotency IDs and changes them only for a changed payment", () => {
    const quote = { id: 42, store_id: 1, grand_total: 123.45 };
    const id = transactionId(quote, "uat", "payid");
    assert.equal(id, transactionId({ ...quote }, "uat", "payid"));
    for (const args of [
      [{ ...quote, id: 43 }, "uat", "payid"],
      [{ ...quote, grand_total: 123.46 }, "uat", "payid"],
      [quote, "production", "payid"],
      [quote, "uat", "payto"],
    ])
      assert.notEqual(id, transactionId(...args));
    assert.ok(id.length <= 100);
  });
});

describe("hosted URL validation", () => {
  it("encodes same-origin return URLs using redirectURL", () => {
    const url = new URL(
      safeCheckoutUrl(
        "https://pay.azupay.com.au/v2/checkout/abc?x=1",
        params,
        "https://shop.example/payment-return",
      ),
    );
    assert.equal(
      url.searchParams.get("redirectURL"),
      "https://shop.example/payment-return",
    );
    assert.equal(url.searchParams.get("x"), "1");
  });
  it("rejects open redirect, HTTP, credentials, ports and lookalike domains", () => {
    for (const url of [
      "http://pay.azupay.com.au/x",
      "https://pay.azupay.com.au.evil.example/x",
      "https://user@pay.azupay.com.au/x",
      "https://pay.azupay.com.au:444/x",
      "javascript:alert(1)",
      "garbage",
    ]) {
      assert.throws(() => safeCheckoutUrl(url, params), {
        code: "INVALID_CHECKOUT_URL",
      });
    }
  });
});
