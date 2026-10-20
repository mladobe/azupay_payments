import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mountAzupay } from "../storefront/azupay.js";

class Element {
  children = [];
  listeners = {};
  textContent = "";
  setAttribute() {}
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  addEventListener(event, handler) {
    this.listeners[event] = handler;
  }
  removeEventListener(event) {
    delete this.listeners[event];
  }
  remove() {}
}

function fixture(t, { returning = false, saved = null } = {}) {
  const originalElement = globalThis.HTMLElement;
  const originalDocument = globalThis.document;
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Element() };
  t.after(() => {
    globalThis.HTMLElement = originalElement;
    globalThis.document = originalDocument;
  });
  let stored = saved ? JSON.stringify(saved) : null;
  const storage = {
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
    removeItem: () => {
      stored = null;
    },
  };
  const redirects = [];
  const requests = [];
  const errors = [];
  const completions = [];
  const orders = [];
  const container = new Element();
  const options = {
    container,
    actionBaseUrl: "https://runtime.example/api/v1/web/azupay",
    cartId: "masked",
    returnUrl: "https://shop.example/azupay-return",
    storage,
    location: {
      origin: "https://shop.example",
      pathname: returning ? "/azupay-return" : "/checkout",
      assign: (url) => redirects.push(url),
    },
    completePayment: async (method) => {
      completions.push(method);
      return { number: "10001" };
    },
    onOrderPlaced: (order) => orders.push(order),
    onError: (error) => errors.push(error),
    fetcher: async (url, config) => {
      requests.push({ url, body: JSON.parse(config.body) });
      return {
        ok: true,
        json: async () =>
          url.endsWith("/create-session")
            ? { receipt: "signed", checkoutUrl: "https://pay.example/checkout" }
            : { status: "WAITING", paid: false },
      };
    },
  };
  return {
    options,
    container,
    redirects,
    requests,
    errors,
    completions,
    orders,
    saved: () => stored,
    click: async () => container.children[0].children[1].listeners.click(),
    message: () => container.children[0].children[0].textContent,
  };
}

describe("hosted checkout browser adapter (DOM/storage boundary stubs)", () => {
  it("persists the session before redirect and never submits a browser amount", async (t) => {
    const f = fixture(t);
    const unmount = mountAzupay(f.options);
    await f.click();
    assert.deepEqual(f.requests[0].body, {
      cartId: "masked",
      returnUrl: "https://shop.example/azupay-return",
    });
    assert.equal(JSON.parse(f.saved()).receipt, "signed");
    assert.deepEqual(f.redirects, ["https://pay.example/checkout"]);
    assert.equal(f.completions.length, 0);
    unmount();
  });
  it("does not redirect if durable same-tab storage fails", async (t) => {
    const f = fixture(t);
    f.options.storage.setItem = () => {
      throw new Error("Storage blocked");
    };
    mountAzupay(f.options);
    await f.click();
    assert.equal(f.redirects.length, 0);
    assert.equal(f.errors.length, 1);
    assert.match(f.message(), /do not pay again/);
  });
  it("does not create a new payment for a saved session or another cart", async (t) => {
    const f = fixture(t, { saved: { cartId: "other", receipt: "signed" } });
    mountAzupay(f.options);
    await f.click();
    assert.equal(f.requests.length, 0);
    assert.match(f.message(), /Another cart/);
  });
  it("does not silently start a session when returning without saved state", (t) => {
    const f = fixture(t, { returning: true });
    mountAzupay(f.options);
    assert.equal(f.requests.length, 0);
    assert.match(f.message(), /No saved payment session/);
  });
  it("keeps a WAITING session and offers explicit payment checks", async (t) => {
    const f = fixture(t, {
      returning: true,
      saved: { cartId: "masked", receipt: "signed" },
    });
    mountAzupay(f.options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.requests.length, 1);
    assert.match(f.message(), /still pending/);
    assert.ok(f.saved());
    assert.equal(f.completions.length, 0);
  });
  it("places a paid order with receipt data and clears state only after confirmation", async (t) => {
    const f = fixture(t, {
      returning: true,
      saved: { cartId: "masked", receipt: "signed" },
    });
    f.options.fetcher = async () => ({
      ok: true,
      json: async () => ({ status: "COMPLETE", paid: true }),
    });
    mountAzupay(f.options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.completions, [
      {
        code: "azupay",
        additional_data: [{ key: "azupay_receipt", value: "signed" }],
      },
    ]);
    assert.deepEqual(f.orders, [{ number: "10001" }]);
    assert.equal(f.saved(), null);
  });
  it("retains paid sessions when order placement fails", async (t) => {
    const f = fixture(t, {
      returning: true,
      saved: { cartId: "masked", receipt: "signed" },
    });
    f.options.fetcher = async () => ({
      ok: true,
      json: async () => ({ status: "COMPLETE", paid: true }),
    });
    f.options.completePayment = async () => {
      throw new Error("Out of stock");
    };
    mountAzupay(f.options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(f.saved());
    assert.equal(f.errors.length, 1);
    assert.match(f.message(), /do not pay again/);
  });
});
