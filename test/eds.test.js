import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  azupayButtonLabel,
  guardAzupayPlaceOrder,
  paymentActionBase,
} from "../storefront/eds.js";

function method(
  base = "https://other-namespace.adobeioruntime.net/api/v1/web/azupay",
) {
  return {
    code: "azupay",
    oope_payment_method_config: {
      backend_integration_url: `${base}/create-session`,
      custom_config: [{ key: "action_base_url", value: base }],
    },
  };
}

function fixture() {
  let stored = null;
  let paid = false;
  let confirmed = { number: "test-order" };
  let failOrder = false;
  let configError = false;
  const calls = [];
  const redirects = [];
  const status = { setAttribute() {}, textContent: "" };
  const storage = {
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
    removeItem: () => {
      stored = null;
    },
  };
  const options = {
    block: {
      querySelector: (selector) =>
        selector === "[data-azupay-status]" ? status : null,
      querySelectorAll: () => [],
    },
    graphql: async (query, variables) => {
      calls.push({ kind: "graphql", query, variables });
      if (query.includes("AzupayPaymentConfiguration"))
        return configError
          ? { errors: [{ message: "Configuration unavailable" }] }
          : {
              data: { cart: { available_payment_methods: [method()] } },
            };
      return { data: { setPaymentMethodOnCart: { cart: {} } } };
    },
    storeCode: "another_store",
    authorization: () => "Bearer test-customer-token",
    returnUrl: "https://another-store.example/au/custom-checkout",
    confirmedOrder: () => confirmed,
    lockCart: (locked) => calls.push({ kind: "lock", locked }),
    storage,
    location: {
      origin: "https://another-store.example",
      assign: (url) => redirects.push(url),
    },
    fetcher: async (url, request) => {
      calls.push({ kind: "http", url, request });
      return {
        ok: true,
        json: async () =>
          url.endsWith("create-session")
            ? {
                receipt: "test-signed-receipt",
                checkoutUrl: "https://pay.uat.apps.azupay.com.au/test",
              }
            : { paid, status: paid ? "COMPLETE" : "WAITING" },
      };
    },
  };
  const native = async (request) => {
    calls.push({ kind: "native", request });
    if (failOrder) throw new Error("Order failed");
  };
  return {
    options,
    calls,
    redirects,
    status,
    storage,
    handler: () => guardAzupayPlaceOrder(native, options),
    saved: () => stored,
    paid: () => {
      paid = true;
    },
    unconfirmed: () => {
      confirmed = null;
    },
    failOrder: () => {
      failOrder = true;
    },
    configError: () => {
      configError = true;
    },
  };
}
const request = { cartId: "existing-cart", code: "azupay" };

describe("portable Azupay EDS adapter", () => {
  it("labels a returning session as order completion without claiming it is paid", async () => {
    const f = fixture();
    assert.equal(azupayButtonLabel(f.storage), "Pay by Bank");
    await f.handler()(request);
    assert.equal(azupayButtonLabel(f.storage), "Complete your order");
  });
  it("opens the configured modal and requires a final native click after server verification", async () => {
    const f = fixture();
    const original = f.options.fetcher;
    f.options.fetcher = async (...args) => {
      const response = await original(...args);
      const body = await response.json();
      return {
        ...response,
        json: async () => ({
          ...body,
          ...(args[0].endsWith("create-session")
            ? { checkoutPresentation: "modal" }
            : {}),
        }),
      };
    };
    const label = { dataset: {}, textContent: "" };
    azupayButtonLabel(f.storage, label);
    assert.equal(label.dataset.azupayOrderLabel, "");
    const trigger = { disabled: true };
    label.closest = () => trigger;
    const query = f.options.block.querySelector;
    f.options.block.querySelector = (selector) =>
      selector === "[data-azupay-order-label]" ? label : query(selector);
    f.options.block.querySelectorAll = () => [label];
    let opened = 0;
    f.options.presentCheckout = async ({ checkPayment, focusTarget }) => {
      assert.equal(focusTarget, trigger);
      opened += 1;
      assert.equal(await checkPayment(), false);
      f.paid();
      assert.equal(await checkPayment(), true);
      return { paid: true, redirected: false };
    };
    const handler = f.handler();
    assert.equal((await handler(request)).status, "AWAITING_ORDER");
    assert.equal(opened, 1);
    assert.equal(f.redirects.length, 0);
    assert.equal(f.calls.filter((call) => call.kind === "native").length, 0);
    assert.equal(label.textContent, "Complete your order");
    assert.match(f.status.textContent, /payment has been received/);
    assert.ok(f.saved());
    await handler(request);
    assert.equal(f.calls.filter((call) => call.kind === "native").length, 1);
    assert.equal(opened, 1);
    assert.equal(f.saved(), null);
  });
  it("reopens the same modal after closing, retains receipts on modal failure and rejects invalid status", async () => {
    const f = fixture();
    const original = f.options.fetcher;
    let brokenStatus = false;
    f.options.fetcher = async (...args) => {
      const response = await original(...args);
      const body = await response.json();
      return {
        ...response,
        json: async () =>
          args[0].endsWith("create-session")
            ? { ...body, checkoutPresentation: "modal" }
            : brokenStatus
              ? { status: "COMPLETE", paid: false }
              : body,
      };
    };
    const urls = [];
    f.options.presentCheckout = async ({ checkoutUrl }) => {
      urls.push(checkoutUrl);
      return { paid: false, redirected: false };
    };
    const handler = f.handler();
    await handler(request);
    await handler(request);
    assert.equal(urls.length, 2);
    assert.equal(urls[0], urls[1]);
    assert.equal(
      f.calls.filter((call) => call.url?.endsWith("create-session")).length,
      1,
    );
    assert.match(f.status.textContent, /reopen the same payment window/);
    brokenStatus = true;
    await assert.rejects(handler(request), /Payment request is COMPLETE/);
    assert.equal(urls.length, 2);
    brokenStatus = false;
    f.options.presentCheckout = async () => {
      throw new Error("Modal unavailable");
    };
    await assert.rejects(f.handler()(request), /Modal unavailable/);
    assert.ok(f.saved());
    assert.equal(f.redirects.length, 0);
    assert.equal(f.calls.filter((call) => call.kind === "native").length, 0);
  });
  it("preserves other payment methods without payment or metadata requests", async () => {
    const f = fixture();
    await f.handler()({ ...request, code: "checkmo" });
    assert.deepEqual(
      f.calls.map((call) => call.kind),
      ["native"],
    );
  });
  it("uses another deployment/store/path and never places an unpaid order", async () => {
    const f = fixture();
    await f.handler()(request);
    assert.equal(f.redirects.length, 1);
    assert.ok(f.saved());
    assert.equal(f.calls.filter((call) => call.kind === "native").length, 0);
    const create = f.calls.find((call) => call.url?.endsWith("create-session"));
    assert.match(create.url, /^https:\/\/other-namespace\./);
    assert.equal(
      create.request.headers.Authorization,
      "Bearer test-customer-token",
    );
    assert.deepEqual(JSON.parse(create.request.body), {
      cartId: request.cartId,
      returnUrl: f.options.returnUrl,
      storeCode: "another_store",
    });
    assert.ok(!f.saved().includes("test-customer-token"));
    const statusCall = f.calls.find((call) =>
      call.url?.endsWith("payment-status"),
    );
    assert.equal(statusCall.request.headers.Authorization, undefined);
  });
  it("checks pending payments without another creation or redirect loop", async () => {
    const f = fixture();
    const handler = f.handler();
    await handler(request);
    await handler(request);
    assert.equal(
      f.calls.filter((call) => call.url?.endsWith("create-session")).length,
      1,
    );
    assert.equal(f.redirects.length, 1);
    assert.match(f.status.textContent, /has not been confirmed/);
    assert.match(f.status.textContent, /will not request another payment/);
    assert.doesNotMatch(f.status.textContent, /Azupay/);
  });
  it("attaches a verified receipt before native placement and clears after confirmation", async () => {
    const f = fixture();
    const handler = f.handler();
    await handler(request);
    f.paid();
    await handler(request);
    const attach = f.calls.findIndex((call) =>
      call.query?.includes("AzupaySetPayment"),
    );
    const place = f.calls.findIndex((call) => call.kind === "native");
    assert.ok(attach >= 0 && place > attach);
    assert.deepEqual(f.calls[attach].variables.method, {
      code: "azupay",
      additional_data: [
        { key: "azupay_receipt", value: "test-signed-receipt" },
      ],
    });
    assert.equal(f.saved(), null);
  });
  it("retains the receipt after placement failure or missing confirmation", async () => {
    for (const fail of ["failOrder", "unconfirmed"]) {
      const f = fixture();
      const handler = f.handler();
      await handler(request);
      f.paid();
      f[fail]();
      await assert.rejects(handler(request));
      assert.ok(f.saved());
      assert.match(f.status.textContent, /do not pay again/);
    }
  });
  it("prevents changing methods, carts or using B2B purchase-order approval", async () => {
    const f = fixture();
    const handler = f.handler();
    await handler(request);
    await assert.rejects(
      handler({ ...request, code: "checkmo" }),
      /outstanding/,
    );
    await assert.rejects(
      handler({ ...request, cartId: "another-cart" }),
      /Another cart/,
    );
    assert.equal(f.calls.filter((call) => call.kind === "native").length, 0);
    const b2b = fixture();
    b2b.options.purchaseOrder = () => true;
    await assert.rejects(b2b.handler()(request), /synchronous checkout/);
    assert.equal(b2b.calls.length, 0);
  });
  it("does not redirect or place an order when storage or configuration fails", async () => {
    for (const failure of ["storage", "configuration"]) {
      const f = fixture();
      if (failure === "storage")
        f.storage.setItem = () => {
          throw new Error("Storage unavailable");
        };
      else f.configError();
      await assert.rejects(f.handler()(request));
      assert.equal(f.redirects.length, 0);
      assert.equal(f.calls.filter((call) => call.kind === "native").length, 0);
      assert.equal(f.status.textContent.length > 0, true);
    }
  });
  it("rejects concurrent checks before issuing a second request", async () => {
    const f = fixture();
    const handler = f.handler();
    const first = handler(request);
    await assert.rejects(handler(request), /already in progress/);
    await first;
    assert.equal(
      f.calls.filter((call) => call.url?.endsWith("create-session")).length,
      1,
    );
  });
  it("rejects missing, duplicate, insecure and conflicting deployment metadata", () => {
    assert.throws(() => paymentActionBase([]), /not available/);
    assert.throws(
      () => paymentActionBase([method(), method()]),
      /not available/,
    );
    assert.throws(
      () => paymentActionBase([method("http://unsafe.example")]),
      /HTTPS/,
    );
    const duplicate = method();
    duplicate.oope_payment_method_config.custom_config.push({
      key: "action_base_url",
      value: "https://other.example",
    });
    assert.throws(() => paymentActionBase([duplicate]), /ambiguous/);
    const mismatch = method();
    mismatch.oope_payment_method_config.backend_integration_url =
      "https://other.example/create-session";
    assert.throws(() => paymentActionBase([mismatch]), /does not match/);
  });
});
