import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { brandingSettings } from "../src/shared/branding.js";
import { setupAzupayBranding } from "../storefront/eds.js";

describe("public store-scoped checkout branding", () => {
  it("uses safe text defaults and gates official logos on merchant permission", () => {
    assert.deepEqual(brandingSettings({ methods: "both" }), {
      title: "Azupay Real Time Payments",
      byline: "Pay securely from your bank account.",
      logos: [],
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

function transportFixture({ failed = false } = {}) {
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
          logos: [],
        }),
      };
    },
  });
  const response = {
    data: {
      cart: {
        id: `cart-${failed ? "failed" : "success"}`,
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
