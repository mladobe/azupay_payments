import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openHostedCheckout } from "../storefront/modal.js";

class Element extends EventTarget {
  children = [];
  style = {};
  attributes = {};
  contentWindow = {};
  open = false;
  isConnected = true;
  constructor(tag) {
    super();
    this.tag = tag;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  append(...elements) {
    this.children.push(...elements);
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
  remove() {
    this.isConnected = false;
  }
  focus() {
    this.focused = true;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}

function fixture({ disabledTrigger = false } = {}) {
  const timers = new Map();
  const host = new EventTarget();
  host.setTimeout = (callback) => {
    const key = {};
    timers.set(key, callback);
    return key;
  };
  host.clearTimeout = (key) => timers.delete(key);
  const doc = new EventTarget();
  doc.body = new Element("body");
  doc.body.style.overflow = "auto";
  doc.activeElement = new Element("button");
  const trigger = doc.activeElement;
  if (disabledTrigger) {
    trigger.disabled = true;
    doc.activeElement = doc.body;
  }
  doc.createElement = (tag) => new Element(tag);
  let paid = false;
  let failure = false;
  let checks = 0;
  const redirects = [];
  const promise = openHostedCheckout({
    checkoutUrl:
      "https://pay.example/checkout/same-session?token=public&redirectURL=https%3A%2F%2Fshop.example%2Fcheckout",
    host,
    doc,
    location: { assign: (url) => redirects.push(url) },
    focusTarget: trigger,
    checkPayment: async () => {
      checks += 1;
      if (failure) throw new Error("Provider unavailable");
      return paid;
    },
  });
  const dialog = doc.body.children[0];
  const [heading, message, controls, frame] = dialog.children;
  const [close, help] = controls.children;
  const [check, redirect] = help.children[2].children;
  return {
    promise,
    host,
    doc,
    dialog,
    heading,
    message,
    frame,
    close,
    check,
    redirect,
    help,
    timers,
    redirects,
    trigger,
    checks: () => checks,
    paid: () => {
      paid = true;
    },
    fail: () => {
      failure = true;
    },
    messageEvent(origin, source, data) {
      const event = new Event("message");
      Object.assign(event, { origin, source, data });
      host.dispatchEvent(event);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("accessible hosted payment modal", () => {
  it("uses documented iframe mode, removes return navigation and restores focus/scroll on Escape", async () => {
    const f = fixture();
    const url = new URL(f.frame.src);
    assert.equal(url.searchParams.get("type"), "iframe");
    assert.equal(url.searchParams.has("redirectURL"), false);
    assert.equal(url.searchParams.get("token"), "public");
    assert.equal(f.frame.title, "Secure bank payment");
    assert.equal(f.heading.textContent, "Pay securely from your bank account");
    assert.equal(f.heading.style.fontSize, "1.25rem");
    assert.equal(f.help.open, false);
    assert.match(f.help.children[0].textContent, /Need help/);
    assert.match(f.help.children[1].textContent, /does not charge you again/);
    assert.equal(f.dialog.attributes["aria-labelledby"], f.heading.id);
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.body.style.overflow, "hidden");
    const escape = new Event("cancel", { cancelable: true });
    f.dialog.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.deepEqual(await f.promise, { paid: false, redirected: false });
    assert.equal(f.doc.activeElement.focused, true);
    assert.equal(f.doc.body.style.overflow, "auto");
    assert.equal(f.timers.size, 0);
    assert.equal(f.dialog.isConnected, false);
  });
  it("ignores wrong origins/sources/types and never trusts a provider COMPLETE claim", async () => {
    const f = fixture();
    const payload = {
      EventType: "PaymentRequest",
      Data: { PaymentRequestStatus: { status: "COMPLETE" } },
    };
    f.messageEvent("https://evil.example", f.frame.contentWindow, payload);
    f.messageEvent("https://pay.example", {}, payload);
    f.messageEvent("https://pay.example", f.frame.contentWindow, {
      EventType: "UserInterface",
    });
    it("closes on Escape from the help controls without relying on a native cancel event", async () => {
      const f = fixture();
      f.help.open = true;
      const escape = new Event("keydown", { cancelable: true });
      Object.assign(escape, { key: "Escape" });
      f.dialog.dispatchEvent(escape);
      assert.equal(escape.defaultPrevented, true);
      assert.deepEqual(await f.promise, { paid: false, redirected: false });
      assert.equal(f.trigger.focused, true);
      assert.equal(f.timers.size, 0);
    });
    assert.equal(f.checks(), 0);
    f.messageEvent("https://pay.example", f.frame.contentWindow, payload);
    await settle();
    assert.equal(f.checks(), 1);
    assert.equal(f.dialog.open, true);
    assert.match(f.message.textContent, /not been confirmed/);
    f.paid();
    f.check.click();
    assert.deepEqual(await f.promise, { paid: true, redirected: false });
    f.messageEvent("https://pay.example", f.frame.contentWindow, payload);
    assert.equal(f.checks(), 2);
    assert.equal(f.timers.size, 0);
  });
  it("polls without messages, bounds automatic checks and allows an explicit retry", async () => {
    const f = fixture();
    for (let index = 0; index < 60; index += 1) {
      const callback = f.timers.values().next().value;
      assert.equal(typeof callback, "function");
      callback();
      await settle();
    }
    assert.equal(f.checks(), 60);
    assert.equal(f.timers.size, 0);
    assert.match(f.message.textContent, /Automatic checks have paused/);
    assert.equal(f.help.open, true);
    f.paid();
    f.check.click();
    assert.deepEqual(await f.promise, { paid: true, redirected: false });
  });
  it("offers a same-session full-page escape with its original return URL", async () => {
    const f = fixture();
    f.redirect.click();
    assert.deepEqual(await f.promise, { paid: false, redirected: true });
    assert.equal(f.redirects.length, 1);
    const url = new URL(f.redirects[0]);
    assert.equal(url.pathname, "/checkout/same-session");
    assert.equal(
      url.searchParams.get("redirectURL"),
      "https://shop.example/checkout",
    );
    assert.equal(url.searchParams.has("type"), false);
    assert.equal(f.timers.size, 0);
  });
  it("reports failed verification and frame failures without clearing or claiming payment", async (t) => {
    const logged = [];
    t.mock.method(console, "error", (code) => logged.push(code));
    const f = fixture();
    f.fail();
    f.check.click();
    await settle();
    assert.equal(f.dialog.open, true);
    assert.equal(f.message.attributes.role, "alert");
    assert.match(f.message.textContent, /verification is unavailable/);
    assert.equal(f.help.open, true);
    assert.equal(f.timers.size, 0);
    f.frame.dispatchEvent(new Event("error"));
    assert.match(f.message.textContent, /Open payment in full page/);
    f.close.click();
    assert.deepEqual(await f.promise, { paid: false, redirected: false });
    assert.deepEqual(logged, [
      "[azupay] CHECKOUT_PAYMENT_CHECK_FAILED",
      "[azupay] CHECKOUT_FRAME_UNAVAILABLE",
    ]);
  });
  it("cleans up when closed during verification and does not resolve again after late payment", async () => {
    const f = fixture();
    f.check.click();
    f.close.click();
    assert.deepEqual(await f.promise, { paid: false, redirected: false });
    await settle();
    assert.equal(f.timers.size, 0);
    assert.equal(f.redirects.length, 0);
  });
  it("restores focus after native checkout re-enables the invoking button", async () => {
    const f = fixture({ disabledTrigger: true });
    const trigger = f.trigger;
    f.close.click();
    await f.promise;
    assert.equal(trigger.focused, undefined);
    assert.equal(f.timers.size, 1);
    trigger.disabled = false;
    f.timers.values().next().value();
    assert.equal(trigger.focused, true);
  });
  it("offers explicit full-page navigation when native modal dialogs are unavailable", async () => {
    const host = new EventTarget();
    host.setTimeout = () => 1;
    host.clearTimeout = () => {};
    const doc = new EventTarget();
    doc.body = new Element("body");
    doc.activeElement = new Element("button");
    doc.createElement = (tag) => {
      const element = new Element(tag);
      if (tag === "dialog") element.showModal = undefined;
      return element;
    };
    const redirects = [];
    const result = openHostedCheckout({
      checkoutUrl: "https://pay.example/same-session",
      doc,
      host,
      location: { assign: (url) => redirects.push(url) },
      checkPayment: async () => false,
    });
    const dialog = doc.body.children[0];
    assert.equal(dialog.children[3].hidden, true);
    assert.match(dialog.children[1].textContent, /cannot open an embedded/);
    const help = dialog.children[2].children[1];
    assert.equal(help.open, true);
    help.children[2].children[1].click();
    assert.deepEqual(await result, { paid: false, redirected: true });
    assert.deepEqual(redirects, ["https://pay.example/same-session"]);
  });
});
