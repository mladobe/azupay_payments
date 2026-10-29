import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CHECKOUT_TITLE } from "../src/shared/identity.js";
import {
  deactivatePaymentMethod,
  paymentStoreCodes,
  registerPaymentMethod,
} from "../src/shared/payment-registration.js";

const views = [
  { id: 0, code: "admin", is_active: 1 },
  { id: 1, code: "default", is_active: 1 },
  { id: 7, code: "b2b", is_active: true },
  { id: 8, code: "inactive", is_active: 0 },
  { id: 9, code: "other_disabled", is_active: false },
];
const existing = {
  id: 42,
  code: "azupay",
  title: "Merchant bank payment",
  active: false,
  backend_integration_url:
    "https://merchant-runtime.adobeioruntime.net/api/v1/web/azupay/create-session",
  order_status: "pending",
  countries: ["AU"],
  currencies: ["AUD"],
  stores: ["default"],
  custom_config: [{ key: "merchant_setting", value: "preserve" }],
};

function fixture(options = {}) {
  let saved =
    options.existing === undefined ? null : structuredClone(options.existing);
  const calls = [];
  const client = {
    get(path) {
      calls.push({ method: "get", path });
      return {
        async json() {
          if (path === "store/storeViews") {
            if (options.discoveryError) throw options.discoveryError;
            return options.views === undefined ? views : options.views;
          }
          assert.equal(path, "oope_payment_method/azupay");
          if (options.readError) throw options.readError;
          if (!saved) {
            const error = new Error("Not registered");
            error.response = { status: 404 };
            throw error;
          }
          return { success: true, message: structuredClone(saved) };
        },
      };
    },
    post(path, { json }) {
      assert.equal(path, "oope_payment_method/");
      calls.push({ method: "post", path, body: structuredClone(json) });
      return {
        async json() {
          if (options.postError) throw options.postError;
          if (options.postResult) return options.postResult;
          if (!options.staleReadback)
            saved = structuredClone(json.payment_method);
          return { success: true };
        },
      };
    },
  };
  return {
    client,
    calls,
    register: () =>
      registerPaymentMethod({ client, namespace: "merchant-runtime" }),
  };
}

describe("dynamic OOPE payment-store registration", () => {
  it("discovers all active storefront codes, not website/store IDs or only default", () => {
    assert.deepEqual(paymentStoreCodes(views), ["b2b", "default"]);
    assert.deepEqual(
      paymentStoreCodes([
        { id: 12, code: "new_merchant_view", is_active: true },
      ]),
      ["new_merchant_view"],
    );
    assert.deepEqual(
      paymentStoreCodes([{ id: 13, code: "admin", is_active: 1 }, views[1]]),
      ["default"],
    );
  });

  it("rejects malformed, empty, inactive-only and duplicate discovery without changing registration", async () => {
    for (const invalid of [
      null,
      {},
      [],
      [null],
      [{ id: 1, code: "bad/code", is_active: 1 }],
      [{ id: 1, code: "view" }],
      [{ id: 1, code: "view", is_active: "yes" }],
      [{ id: -1, code: "view", is_active: 1 }],
      [{ id: 0, code: "admin", is_active: 1 }],
      [{ id: 1, code: "disabled", is_active: 0 }],
      [views[1], { id: 10, code: "default", is_active: true }],
      [views[1], { id: 1, code: "another", is_active: true }],
    ]) {
      const { register, calls } = fixture({ views: invalid });
      await assert.rejects(register(), /Commerce/);
      assert.deepEqual(calls, [{ method: "get", path: "store/storeViews" }]);
    }
  });

  it("creates the canonical method with discovered stores only when it is absent", async () => {
    const { register, calls } = fixture();
    assert.deepEqual(await register(), {
      paymentMethod: "azupay",
      active: true,
      stores: ["b2b", "default"],
      changed: true,
    });
    const method = calls.find((call) => call.method === "post").body
      .payment_method;
    assert.equal(method.title, DEFAULT_CHECKOUT_TITLE);
    assert.equal(method.order_status, "pending");
    assert.deepEqual(method.countries, ["AU"]);
    assert.deepEqual(method.currencies, ["AUD"]);
    assert.equal(
      method.custom_config.find((entry) => entry.key === "can_capture").value,
      false,
    );
    assert.equal(
      method.custom_config.find((entry) => entry.key === "can_refund").value,
      false,
    );
    assert.equal(
      method.backend_integration_url,
      "https://merchant-runtime.adobeioruntime.net/api/v1/web/azupay/create-session",
    );
    assert.equal(calls.at(-1).path, "oope_payment_method/azupay");
  });

  it("updates only the store list and preserves a disabled registration and merchant settings", async () => {
    const { register, calls } = fixture({ existing });
    const result = await register();
    assert.equal(result.active, false);
    const { id: _id, ...writable } = existing;
    assert.deepEqual(
      calls.find((call) => call.method === "post").body.payment_method,
      {
        ...writable,
        stores: ["b2b", "default"],
      },
    );
    const firstWriteCount = calls.filter(
      (call) => call.method === "post",
    ).length;
    assert.equal((await register()).changed, false);
    assert.equal(
      calls.filter((call) => call.method === "post").length,
      firstWriteCount,
    );
  });

  it("removes inactive/deleted store assignments and treats reordered matching codes as a no-op", async () => {
    const removed = fixture({
      existing: { ...existing, stores: ["default", "deleted", "inactive"] },
    });
    assert.deepEqual((await removed.register()).stores, ["b2b", "default"]);
    const unchanged = fixture({
      existing: { ...existing, stores: ["default", "b2b"] },
    });
    assert.equal((await unchanged.register()).changed, false);
    assert.ok(unchanged.calls.every((call) => call.method === "get"));
  });

  it("does not turn denied access, timeouts or invalid registration data into fresh defaults", async () => {
    for (const status of [401, 403, 500]) {
      const error = new Error("Commerce read failed");
      error.response = { status };
      const { register, calls } = fixture({ readError: error });
      await assert.rejects(register(), error);
      assert.ok(calls.every((call) => call.method === "get"));
    }
    for (const method of [
      { ...existing, code: "other" },
      { ...existing, active: "false" },
      { ...existing, stores: null },
    ]) {
      const { register, calls } = fixture({ existing: method });
      await assert.rejects(register(), {
        code: "COMMERCE_INVALID_REGISTRATION",
      });
      assert.ok(calls.every((call) => call.method === "get"));
    }
    const discovery = fixture({
      discoveryError: new Error("Discovery timeout"),
    });
    await assert.rejects(discovery.register(), /Discovery timeout/);
    assert.equal(discovery.calls.length, 1);
  });

  it("requires explicit write success and a matching readback, without automatic retries", async () => {
    for (const postResult of [{ success: false }, {}, { message: "OK" }]) {
      const { register } = fixture({ postResult });
      await assert.rejects(register(), {
        code: "COMMERCE_REGISTRATION_FAILED",
      });
    }
    const stale = fixture({ existing, staleReadback: true });
    await assert.rejects(stale.register(), {
      code: "COMMERCE_REGISTRATION_UNCONFIRMED",
    });
    const missing = fixture({ staleReadback: true });
    await assert.rejects(missing.register(), {
      code: "COMMERCE_REGISTRATION_UNCONFIRMED",
    });
    const timedOut = fixture({ postError: new Error("Write timeout") });
    await assert.rejects(timedOut.register(), /Write timeout/);
    assert.equal(
      timedOut.calls.filter((call) => call.method === "post").length,
      1,
    );
  });

  it("refuses a missing or invalid runtime namespace before any Commerce operation", async () => {
    for (const namespace of [undefined, "", "attacker.example/path"]) {
      const { client, calls } = fixture();
      await assert.rejects(registerPaymentMethod({ client, namespace }), {
        code: "MISSING_NAMESPACE",
      });
      assert.deepEqual(calls, []);
    }
  });

  it("deactivates without discovering stores and preserves all existing registration fields", async () => {
    const method = { ...existing, active: true, stores: ["deleted_store"] };
    const { client, calls } = fixture({
      existing: method,
      discoveryError: new Error("No stores"),
    });
    const result = await deactivatePaymentMethod(client);
    assert.equal(result.active, false);
    assert.equal(result.changed, true);
    assert.deepEqual(result.stores, ["deleted_store"]);
    const { id: _id, ...writable } = method;
    assert.deepEqual(
      calls.find((call) => call.method === "post").body.payment_method,
      { ...writable, active: false },
    );
    assert.ok(calls.every((call) => call.path !== "store/storeViews"));
    assert.equal((await deactivatePaymentMethod(client)).changed, false);
  });

  it("reports an already-absent registration explicitly on uninstall without creating one", async () => {
    const { client, calls } = fixture();
    assert.deepEqual(await deactivatePaymentMethod(client), {
      paymentMethod: "azupay",
      active: false,
      stores: [],
      changed: false,
      registered: false,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "get");
  });
});
