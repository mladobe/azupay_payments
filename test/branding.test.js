import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { brandingSettings } from "../src/shared/branding.js";
import {
  checkoutGuidanceWarnings,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_INSTRUCTIONS_LABEL,
  DEFAULT_TERMS_LABEL,
  helpUrl,
} from "../src/shared/checkout-guidance.js";
import { azupayPaymentSlot, setupAzupayBranding } from "../storefront/eds.js";

describe("public store-scoped checkout branding", () => {
  it("preserves multiline plain-text tooltip content, supports hiding and enforces exact limits", () => {
    const text =
      "1. Follow our bank instructions.\n\n2. <b>Do not pay twice.</b>";
    const result = brandingSettings({
      checkoutInstructions: text,
      checkoutInstructionsLabel: "How do I pay?",
    });
    assert.deepEqual(result.guidance.tooltip, {
      label: "How do I pay?",
      text,
    });
    assert.deepEqual(
      brandingSettings({
        checkoutInstructions: "",
        checkoutInstructionsLabel: "",
      }).guidance.tooltip,
      { label: "", text: "" },
    );
    assert.equal(
      brandingSettings({ checkoutInstructions: "x".repeat(4000) }).guidance
        .tooltip.text.length,
      4000,
    );
    assert.equal(
      brandingSettings({ checkoutInstructionsLabel: "x".repeat(100) }).guidance
        .tooltip.label.length,
      100,
    );
    for (const config of [
      { checkoutInstructions: "x".repeat(4001) },
      { checkoutInstructions: 42 },
      { checkoutInstructionsLabel: "x".repeat(101) },
      { checkoutInstructionsLabel: "" },
      { checkoutInstructionsLabel: " " },
    ])
      assert.throws(() => brandingSettings(config), {
        code: "INVALID_BRANDING",
      });
  });
  it("shows terms only for PayTo, accepts singleton settings and preserves merchant titles", () => {
    for (const methods of ["payid", "payto", "both"]) {
      const result = brandingSettings({
        methods: [methods],
        checkoutTitle: "Merchant label",
        paytoTermsUrl: "https://merchant.example/terms",
      });
      assert.equal(result.title, "Merchant label");
      assert.deepEqual(
        result.guidance.methods,
        methods === "both" ? ["payid", "payto"] : [methods],
      );
      assert.deepEqual(
        result.guidance.links,
        methods === "payid"
          ? []
          : [
              {
                method: "payto",
                kind: "terms",
                label: DEFAULT_TERMS_LABEL,
                url: "https://merchant.example/terms",
              },
            ],
      );
    }
  });
  it("ignores all saved legacy link values, including invalid ones, without affecting tooltip or terms", () => {
    const legacyValues = Object.fromEntries(
      [
        "payidEducation",
        "payidInstructions",
        "payidBenefits",
        "payidLearnMore",
        "paytoInstructions",
      ].flatMap((name) => [
        [`${name}Url`, "javascript:alert(1)"],
        [`${name}Label`, 42],
      ]),
    );
    const config = {
      methods: "both",
      checkoutInstructions: "Our current instructions.\nDo not pay twice.",
      checkoutInstructionsLabel: "How do I pay?",
      paytoTermsUrl: "https://merchant.example/terms",
    };
    assert.deepEqual(
      brandingSettings({ ...config, ...legacyValues }),
      brandingSettings(config),
    );
  });
  it("supports scoped merchant terms independently of instructions and permits clearing the URL", () => {
    const result = brandingSettings({
      methods: "both",
      checkoutGuidanceEnabled: false,
      paytoTermsUrl: "https://merchant.example/payto-terms",
      paytoTermsLabel: "Our PayTo terms",
    });
    assert.equal(result.guidance.showInstructions, false);
    assert.deepEqual(result.guidance.links, [
      {
        method: "payto",
        kind: "terms",
        label: "Our PayTo terms",
        url: "https://merchant.example/payto-terms",
      },
    ]);
    assert.deepEqual(
      brandingSettings({
        methods: "payto",
        paytoTermsUrl: "",
        paytoTermsLabel: "",
      }).guidance.links,
      [],
    );
  });
  it("rejects unsafe links, invalid labels and instructions without fetching merchant URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://merchant.example/help",
      "//merchant.example/help",
      "https://user:password@merchant.example/help",
    ]) {
      assert.throws(() => helpUrl(url));
      assert.throws(
        () => brandingSettings({ methods: "payto", paytoTermsUrl: url }),
        {
          code: "INVALID_BRANDING",
        },
      );
    }
    for (const config of [
      { paytoTermsLabel: "" },
      { paytoTermsLabel: "x".repeat(101) },
      { checkoutGuidanceEnabled: "false" },
    ])
      assert.throws(
        () =>
          brandingSettings({
            methods: "payto",
            paytoTermsUrl: "https://merchant.example/terms",
            ...config,
          }),
        {
          code: "INVALID_BRANDING",
        },
      );
  });
  it("warns admins about missing PayTo terms and logo approval without inventing merchant terms", () => {
    assert.match(
      checkoutGuidanceWarnings({ methods: "both" })[0],
      /merchant PayTo terms/,
    );
    assert.deepEqual(checkoutGuidanceWarnings({ methods: "payid" }), []);
    assert.deepEqual(
      checkoutGuidanceWarnings({
        methods: ["payto"],
        paytoTermsUrl: "https://merchant.example/terms",
      }),
      [],
    );
    assert.deepEqual(
      checkoutGuidanceWarnings({
        methods: "both",
        paytoTermsInHostedCheckout: true,
      }),
      [],
    );
    assert.match(
      checkoutGuidanceWarnings({
        methods: "payid",
        checkoutLogoMode: "none",
      })[0],
      /approved payment marks/,
    );
  });
  it("uses safe text defaults and gates official logos on merchant permission", () => {
    assert.deepEqual(brandingSettings({ methods: "both" }), {
      title: "Pay by Bank",
      byline: "Pay securely from your bank account.",
      logos: [],
      guidance: {
        methods: ["payid", "payto"],
        showInstructions: true,
        tooltip: {
          label: DEFAULT_INSTRUCTIONS_LABEL,
          text: DEFAULT_INSTRUCTIONS,
        },
        links: [],
      },
    });
    for (const [methods, expected] of [
      ["payid", ["PayID"]],
      ["payto", ["PayTo"]],
      ["both", ["PayID", "PayTo"]],
    ]) {
      const settings = brandingSettings({
        methods,
        officialLogoPermission: true,
      });
      assert.deepEqual(
        settings.logos.map((logo) => logo.alt),
        expected,
      );
      assert.ok(
        settings.logos.every((logo) =>
          logo.url.startsWith("https://firebasestorage.googleapis.com/"),
        ),
      );
    }
  });
  it("supports three custom HTTPS logos, plain text and an optional byline", () => {
    const settings = brandingSettings({
      checkoutTitle: "My bank payment",
      checkoutByline: "",
      checkoutLogoMode: ["custom"],
      ...Object.fromEntries(
        [1, 2, 3].flatMap((index) => [
          [
            `checkoutLogo${index}Url`,
            `https://merchant.example/logo-${index}.png`,
          ],
          [`checkoutLogo${index}Alt`, `Logo ${index}`],
        ]),
      ),
      apiKey: "must-not-be-exposed",
    });
    assert.equal(settings.title, "My bank payment");
    assert.equal(settings.byline, "");
    assert.equal(settings.logos.length, 3);
    assert.ok(!JSON.stringify(settings).includes("must-not-be-exposed"));
  });
  it("rejects invalid text, modes, image URLs and missing accessible descriptions", () => {
    for (const config of [
      { checkoutTitle: " " },
      { checkoutTitle: "x".repeat(101) },
      { checkoutByline: 42 },
      { checkoutLogoMode: ["custom", "none"] },
      ...[
        "javascript:alert(1)",
        "data:image/svg+xml,script",
        "http://merchant.example/logo.png",
        "https://user:pass@merchant.example/logo.png",
      ].map((url) => ({
        checkoutLogoMode: "custom",
        checkoutLogo1Url: url,
        checkoutLogo1Alt: "Logo",
      })),
      {
        checkoutLogoMode: "custom",
        checkoutLogo1Url: "https://merchant.example/logo.png",
      },
    ])
      assert.throws(() => brandingSettings(config), {
        code: "INVALID_BRANDING",
      });
  });
});

function transportFixture({
  failed = false,
  logos = [],
  guidance,
  cartId = `cart-${failed ? "failed" : "success"}`,
} = {}) {
  let hook;
  let hookCount = 0;
  const requests = [];
  const method = {
    code: "azupay",
    title: "Old title",
    oope_payment_method_config: {
      backend_integration_url:
        "https://another-runtime.example/azupay/create-session",
      custom_config: [
        {
          key: "action_base_url",
          value: "https://another-runtime.example/azupay",
        },
      ],
    },
  };
  const transport = {
    addAfterHook(value) {
      hook = value;
      hookCount += 1;
    },
    getFetchGraphQlHeader: () => "french_store",
    async fetchGraphQl() {
      return hook(
        {},
        { data: { cart: { available_payment_methods: [method] } } },
      );
    },
  };
  setupAzupayBranding(transport, {
    fetcher: async (url, request) => {
      requests.push({ url, request });
      return {
        ok: !failed,
        json: async () => ({
          title: "Pay securely",
          byline: "Your bank, your choice",
          logos,
          ...(guidance === undefined ? {} : { guidance }),
        }),
      };
    },
  });
  const response = {
    data: {
      cart: {
        id: cartId,
        email: "preserved",
        available_payment_methods: [
          method,
          { code: "checkmo", title: "Other method" },
        ],
        selected_payment_method: { code: "azupay", title: "Old title" },
      },
    },
  };
  return {
    transport,
    response,
    requests,
    run: () => hook({}, response),
    hookCount: () => hookCount,
  };
}

describe("documented GraphQL branding hook", () => {
  it("rejects malformed tooltip payloads without disabling checkout", async (t) => {
    const logs = [];
    t.mock.method(console, "error", (code) => logs.push(code));
    for (const tooltip of [
      null,
      { label: "", text: "Instructions" },
      { label: "x".repeat(101), text: "Instructions" },
      { label: "Help", text: "x".repeat(4001) },
      { label: "Help", text: 42 },
    ]) {
      const f = transportFixture({
        guidance: {
          methods: ["payid"],
          showInstructions: true,
          links: [],
          tooltip,
        },
      });
      assert.deepEqual(await f.run(), f.response);
    }
    assert.equal(logs.length, 5);
  });
  function mockRender(t, cartId) {
    const doc = {
      activeElement: null,
      createElement(tagName) {
        return {
          tagName,
          style: {},
          dataset: {},
          attributes: {},
          events: {},
          open: false,
          children: [],
          append(...children) {
            this.children.push(...children);
          },
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          addEventListener(name, handler) {
            this.events[name] = handler;
          },
          focus() {
            doc.activeElement = this;
          },
          contains(node) {
            return (
              node === this ||
              this.children.some((child) => child.contains(node))
            );
          },
        };
      },
    };
    for (const [name, value] of Object.entries({
      document: doc,
      sessionStorage: { getItem: () => null },
    })) {
      const original = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { configurable: true, value });
      t.after(() => {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
      });
    }
    let rendered;
    azupayPaymentSlot.render({
      cartId,
      replaceHTML: (node) => {
        rendered = node;
      },
    });
    return { rendered, doc };
  }
  it("renders one safe multiline disclosure and keeps merchant terms outside it", async (t) => {
    const guidance = brandingSettings({
      methods: "both",
      checkoutInstructions: "1. First step\n\n2. <img src=x onerror=alert(1)>",
      paytoTermsUrl: "https://merchant.example/terms",
    }).guidance;
    const f = transportFixture({ guidance, cartId: "tooltip-custom" });
    await f.run();
    const { rendered, doc } = mockRender(t, "tooltip-custom");
    const details = rendered.children.find(
      (node) => node.tagName === "details",
    );
    const [trigger, panel] = details.children;
    assert.equal(trigger.textContent, DEFAULT_INSTRUCTIONS_LABEL);
    assert.equal(trigger.attributes["aria-controls"], panel.id);
    assert.equal(panel.attributes.role, "region");
    assert.equal(panel.children[1].textContent, guidance.tooltip.text);
    assert.equal(panel.children[1].style.whiteSpace, "pre-wrap");
    assert.equal(panel.children[1].children.length, 0);
    const links = rendered.children.find((node) => node.tagName === "ul");
    assert.equal(links.children.length, 1);
    assert.equal(
      links.children[0].children[0].href,
      "https://merchant.example/terms",
    );
    assert.equal(links.children[0].children[0].rel, "noopener noreferrer");
    assert.equal(details.open, false);
    details.events.pointerenter({ pointerType: "touch" });
    assert.equal(details.open, false);
    details.events.pointerenter({ pointerType: "mouse" });
    assert.equal(details.open, true);
    details.events.pointerleave();
    assert.equal(details.open, false);
    details.events.focusin();
    trigger.focus();
    details.events.pointerleave();
    assert.equal(details.open, true);
    const event = { preventDefault() {}, stopPropagation() {} };
    trigger.events.click(event);
    assert.equal(details.open, true);
    trigger.events.click(event);
    assert.equal(details.open, false);
    trigger.events.click(event);
    details.events.keydown({ ...event, key: "Escape" });
    assert.equal(details.open, false);
    assert.equal(doc.activeElement, trigger);
    details.events.focusin();
    details.events.focusout({ relatedTarget: null });
    assert.equal(details.open, false);
  });
  it("uses legacy rail-specific guidance inside one disclosure when an older backend has no tooltip", async (t) => {
    const f = transportFixture({
      cartId: "tooltip-legacy",
      guidance: { methods: ["payid"], showInstructions: true, links: [] },
    });
    await f.run();
    const { rendered } = mockRender(t, "tooltip-legacy");
    const details = rendered.children.find(
      (node) => node.tagName === "details",
    );
    assert.match(
      details.children[1].children[1].textContent,
      /recipient PayID/,
    );
    assert.doesNotMatch(details.children[1].children[1].textContent, /PayTo/);
  });
  for (const settings of [
    { checkoutGuidanceEnabled: false },
    { checkoutInstructions: "" },
  ]) {
    it(`hides the tooltip without hiding terms: ${JSON.stringify(settings)}`, async (t) => {
      const cartId = `hidden-tooltip-${JSON.stringify(settings)}`;
      const f = transportFixture({
        cartId,
        guidance: brandingSettings({
          methods: "payto",
          paytoTermsUrl: "https://merchant.example/terms",
          ...settings,
        }).guidance,
      });
      await f.run();
      const { rendered } = mockRender(t, cartId);
      assert.ok(!rendered.children.some((node) => node.tagName === "details"));
      assert.equal(
        rendered.children.find((node) => node.tagName === "ul").children.length,
        1,
      );
    });
  }
  it("preserves Commerce payment ordering and other method settings exactly", async () => {
    const f = transportFixture({
      guidance: brandingSettings({ methods: "both" }).guidance,
    });
    const before = { code: "card_first", title: "Card", sort_order: 1 };
    const after = { code: "bank_last", title: "Other bank", sort_order: 100 };
    f.response.data.cart.available_payment_methods.unshift(before);
    f.response.data.cart.available_payment_methods.push(after);
    const result = await f.run();
    assert.deepEqual(
      result.data.cart.available_payment_methods.map((method) => method.code),
      f.response.data.cart.available_payment_methods.map(
        (method) => method.code,
      ),
    );
    assert.deepEqual(result.data.cart.available_payment_methods[0], before);
    assert.deepEqual(result.data.cart.available_payment_methods.at(-1), after);
  });
  it("rejects untrusted guidance while keeping checkout available and logging the failure", async (t) => {
    const logs = [];
    t.mock.method(console, "error", (code) => logs.push(code));
    for (const guidance of [
      {
        methods: ["payto"],
        showInstructions: true,
        links: [
          {
            method: "payto",
            label: "Help",
            kind: "education",
            url: "javascript:alert(1)",
          },
        ],
      },
      { methods: ["unknown"], showInstructions: true, links: [] },
      {
        methods: ["payid"],
        showInstructions: true,
        links: [
          {
            method: "payto",
            label: "Wrong rail",
            kind: "education",
            url: "https://example.com",
          },
        ],
      },
    ]) {
      const f = transportFixture({ guidance });
      assert.deepEqual(await f.run(), f.response);
    }
    assert.equal(logs.length, 3);
    assert.ok(
      logs.every((code) => code === "[azupay] CHECKOUT_BRANDING_UNAVAILABLE"),
    );
  });
  it("bounds every official/custom logo with CSS, not just overridable HTML dimensions", async (t) => {
    const official = brandingSettings({
      methods: "both",
      officialLogoPermission: true,
    }).logos;
    const custom = {
      url: "https://merchant.example/wide-logo.png",
      alt: "Merchant logo",
    };
    const f = transportFixture({ logos: [...official, custom] });
    await f.run();
    function element(tagName) {
      return {
        tagName,
        style: {},
        dataset: {},
        children: [],
        append(child) {
          this.children.push(child);
        },
        setAttribute() {},
        addEventListener() {},
      };
    }
    let rendered;
    for (const [name, value] of Object.entries({
      document: { createElement: element },
      sessionStorage: { getItem: () => null },
    })) {
      const original = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { configurable: true, value });
      t.after(() => {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
      });
    }
    azupayPaymentSlot.render({
      cartId: f.response.data.cart.id,
      replaceHTML: (node) => {
        rendered = node;
      },
    });
    const logos = rendered.children.find(
      (node) => node.className === "azupay-payment-logos",
    );
    assert.equal(logos.style.flexWrap, "wrap");
    assert.equal(logos.children.length, 3);
    for (const [index, image] of logos.children.entries()) {
      assert.equal(image.alt, [...official, custom][index].alt);
      assert.equal(image.width, 100);
      assert.equal(image.height, 48);
      assert.deepEqual(image.style, {
        width: "100px",
        height: "48px",
        maxWidth: "100%",
        maxHeight: "48px",
        minWidth: "0",
        flex: "0 1 100px",
        objectFit: "contain",
      });
      assert.equal(image.referrerPolicy, "no-referrer");
    }
  });
  it("updates actual selector and selected titles without changing other methods/data/auth", async () => {
    const f = transportFixture();
    const result = await f.run();
    assert.equal(
      result.data.cart.available_payment_methods[0].title,
      "Pay securely",
    );
    assert.equal(
      result.data.cart.selected_payment_method.title,
      "Pay securely",
    );
    assert.equal(
      result.data.cart.available_payment_methods[1].title,
      "Other method",
    );
    assert.equal(result.data.cart.email, "preserved");
    assert.equal(
      f.response.data.cart.available_payment_methods[0].title,
      "Old title",
    );
    assert.deepEqual(JSON.parse(f.requests[0].request.body), {
      storeCode: "french_store",
    });
    assert.equal(f.requests[0].request.headers.Authorization, undefined);
    await f.run();
    assert.equal(f.requests.length, 1);
    setupAzupayBranding(f.transport);
    assert.equal(f.hookCount(), 1);
  });
  it("logs branding failure and preserves checkout availability instead of breaking other methods", async (t) => {
    const logged = [];
    t.mock.method(console, "error", (code) => logged.push(code));
    const f = transportFixture({ failed: true });
    const result = await f.run();
    assert.deepEqual(result, f.response);
    assert.deepEqual(logged, ["[azupay] CHECKOUT_BRANDING_UNAVAILABLE"]);
  });
});

const bundled = await build({
  entryPoints: [
    new URL(
      "../src/commerce-extensibility-1/actions/checkout-branding/index.js",
      import.meta.url,
    ).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "branding-runtime-boundary",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]shared[/\\]runtime\.js$/ }, () => ({
          contents: `export function logError() {}
          export async function runtimeDependencies(params) {
            return {
              commerce: { storeIdByCode: async code => {
                if(code !== 'french_store') throw new Error('Unknown store');
                return 7;
              } },
              getConfig: async id => {
                if(id !== 7) throw new Error('Wrong scope');
                return {checkoutTitle:'Store seven', checkoutByline:'Bonjour', methods:'both', secret:'never-public'};
              }
            };
          }`,
          loader: "js",
        }));
      },
    },
  ],
});
const { main } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
it("public branding action validates CORS, resolves store code server-side and exposes only branding", async () => {
  const params = {
    AZUPAY_STOREFRONT_ORIGINS: "https://merchant.example",
    __ow_method: "post",
    __ow_headers: { origin: "https://merchant.example" },
    storeCode: "french_store",
  };
  const result = await main(params);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    title: "Store seven",
    byline: "Bonjour",
    logos: [],
    guidance: brandingSettings({ methods: "both" }).guidance,
  });
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(
    (await main({ ...params, __ow_method: "options" })).statusCode,
    204,
  );
  assert.equal(
    (await main({ ...params, storeCode: "../bad" })).statusCode,
    400,
  );
  assert.equal(
    (
      await main({
        ...params,
        __ow_headers: { origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
});
