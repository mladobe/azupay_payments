import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [
    new URL(
      "../src/commerce-extensibility-1/actions/filter-payment/index.js",
      import.meta.url,
    ).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "stub-runtime-boundary",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]shared[/\\]runtime\.js$/ }, () => ({
          contents: `
            export async function runtimeDependencies(params) {
              return {
                getConfig: async (storeId) => {
                  if (storeId !== 1 || params.failConfig) {
                    throw new Error("Configuration unavailable");
                  }
                  return params.testConfig;
                },
              };
            }
            export function logError() {}
          `,
          loader: "js",
        }));
      },
    },
  ],
});
const { main } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function fixture() {
  return {
    payload: { cart: { store_id: 1 } },
    testConfig: {
      enabled: true,
      environment: "uat",
      methods: "both",
      expiryMinutes: "31",
    },
    AZUPAY_SIGNING_SECRET: "ab".repeat(32),
    AZUPAY_UAT_BOTH_CLIENT_ID: "test-client",
    AZUPAY_UAT_BOTH_API_KEY: "test-key",
  };
}

describe("Commerce payment-filter webhook response contract", () => {
  it("returns an explicit success operation when enabled, never an empty array", async () => {
    const response = await main(fixture());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { op: "success" });
  });

  it("filters only Azupay when disabled without requiring payment credentials", async () => {
    const response = await main({
      payload: { cart: { store_id: 1 } },
      testConfig: { enabled: false },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      op: "add",
      path: "result",
      value: { code: "azupay" },
    });
  });

  it("returns an exception operation for invalid input, configuration or credentials", async () => {
    const missingStore = fixture();
    delete missingStore.payload.cart.store_id;
    const invalidExpiry = fixture();
    invalidExpiry.testConfig.expiryMinutes = "0";
    const missingCredentials = fixture();
    delete missingCredentials.AZUPAY_UAT_BOTH_API_KEY;
    const blockedProduction = fixture();
    blockedProduction.testConfig.environment = "production";
    for (const params of [
      missingStore,
      invalidExpiry,
      missingCredentials,
      blockedProduction,
      { ...fixture(), failConfig: true },
    ]) {
      const response = await main(params);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.op, "exception");
      assert.match(response.body.message, /availability could not be checked/);
    }
  });
});
