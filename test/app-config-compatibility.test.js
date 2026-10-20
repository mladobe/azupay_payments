import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import appConfig from "../app.commerce.config.js";
import { wrapAppConfig } from "../src/shared/app-config-compatibility.js";

const require = createRequire(import.meta.url);
const configure = require("../scripts/configure-app-config-compatibility.cjs");
const root = new URL("../src/commerce-extensibility-1/", import.meta.url)
  .pathname;
const generated = ".generated/actions/app-management/app-config.js";

describe("association discovery compatibility", () => {
  it("omits only the discovery URL from successful root GET without mutation", async () => {
    const source = {
      statusCode: 200,
      headers: { "Cache-Control": "no-store" },
      body: {
        metadata: { id: "azupay-pay-by-bank" },
        webhooks: [{ label: "verify" }],
        hasBusinessConfig: true,
        openApiSpecUrl: "https://runtime.example/app-config/openapi.json",
      },
    };
    const handler = wrapAppConfig(async () => source);
    for (const params of [
      {},
      { __ow_method: "GET", __ow_path: "/" },
      { __ow_method: "get", __ow_path: "" },
    ]) {
      const result = await handler(params);
      const expected = structuredClone(source);
      delete expected.body.openApiSpecUrl;
      assert.deepEqual(result, expected);
      assert.ok(Object.hasOwn(source.body, "openApiSpecUrl"));
    }
  });
  it("preserves OpenAPI routes, non-GET requests, errors and non-object responses", async () => {
    for (const params of [
      { __ow_method: "get", __ow_path: "/openapi.json" },
      { __ow_method: "post", __ow_path: "/" },
      { __ow_method: 123, __ow_path: "/" },
    ]) {
      const source = { statusCode: 200, body: { openApiSpecUrl: "keep" } };
      assert.equal(await wrapAppConfig(async () => source)(params), source);
    }
    for (const source of [
      { statusCode: 500, body: { openApiSpecUrl: "keep", error: "failed" } },
      { statusCode: 200, body: null },
      { statusCode: 200, body: [] },
      { statusCode: 200, body: "text" },
      { statusCode: 200, body: { metadata: {} } },
    ])
      assert.equal(await wrapAppConfig(async () => source)({}), source);
  });
  it("supports an explicit opt-out and propagates SDK failures", async () => {
    const source = { statusCode: 200, body: { openApiSpecUrl: "keep" } };
    assert.equal(await wrapAppConfig(async () => source, false)({}), source);
    await assert.rejects(
      wrapAppConfig(async () => {
        throw new Error("SDK failure");
      })({}),
      /SDK failure/,
    );
    assert.throws(() => wrapAppConfig(null), TypeError);
    assert.throws(() => wrapAppConfig(() => {}, "true"), TypeError);
  });
  it("omits webhook discovery only when explicitly enabled without mutating installer configuration", async () => {
    const before = structuredClone(appConfig);
    const source = {
      statusCode: 200,
      body: {
        ...appConfig,
        hasBusinessConfig: true,
        openApiSpecUrl: "https://runtime.example/app-config/openapi.json",
      },
    };
    const result = await wrapAppConfig(async () => source, true, true)({});
    const expected = { ...source.body };
    delete expected.openApiSpecUrl;
    delete expected.webhooks;
    assert.deepEqual(result.body, expected);
    assert.deepEqual(appConfig, before);
    assert.equal(source.body.webhooks, appConfig.webhooks);
    assert.equal(appConfig.webhooks.length, 3);
    assert.equal(
      appConfig.webhooks.find(
        (hook) => hook.runtimeAction === "azupay/validate-payment",
      ).webhook.required,
      true,
    );
    assert.ok(appConfig.webhooks.every((hook) => hook.requireAdobeAuth));
    assert.deepEqual(
      appConfig.webhooks.find(
        (hook) => hook.runtimeAction === "azupay/capture-cart",
      ).webhook.fields,
      [
        { name: "quote_id", source: "data.quote.id" },
        { name: "quote_entity_id", source: "data.quote.entity_id" },
      ],
    );
    assert.equal(
      await wrapAppConfig(async () => source, false, true)({}),
      source,
    );
    for (const __ow_path of ["/openapi.json", "/other"]) {
      assert.equal(
        await wrapAppConfig(async () => source, true, true)({ __ow_path }),
        source,
      );
    }
  });
  it("also removes webhooks without OpenAPI discovery and rejects invalid flags", async () => {
    const source = { statusCode: 200, body: { metadata: {}, webhooks: [] } };
    const handler = wrapAppConfig(async () => source, true, true);
    assert.deepEqual(await handler({}), {
      statusCode: 200,
      body: { metadata: {} },
    });
    assert.equal(await wrapAppConfig(async () => source)({}), source);
    assert.throws(
      () => wrapAppConfig(async () => source, true, "true"),
      /boolean flags/,
    );
    const failure = { statusCode: 500, body: source.body };
    assert.equal(
      await wrapAppConfig(async () => failure, true, true)({}),
      failure,
    );
  });
  it("keeps installation wired to the full configuration rather than filtered discovery", () => {
    const source = readFileSync(
      new URL(
        "../src/commerce-extensibility-1/.generated/actions/app-management/installation.js",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /import appConfig from "#app\.commerce\.config"/);
    assert.match(source, /const args = \{ appConfig, customScriptsLoader \}/);
    assert.doesNotMatch(source, /wrapAppConfig|app-config-compatibility/);
  });
});

describe("persistent Adobe build-hook wiring", () => {
  function fixture() {
    const action = {
      function: generated,
      annotations: { final: true, "require-adobe-auth": true },
    };
    const config = {
      root,
      manifest: {
        full: {
          packages: { "app-management": { actions: { "app-config": action } } },
        },
      },
    };
    return { config, action };
  }
  it("selects the wrapper by default without editing generated sources or annotations", () => {
    const { config, action } = fixture();
    configure({ config }, {});
    assert.equal(
      action.function,
      path.join(root, "actions/app-config-compatibility/index.js"),
    );
    assert.deepEqual(action.annotations, {
      final: true,
      "require-adobe-auth": true,
    });
    configure({ config }, { AZUPAY_APP_CONFIG_COMPATIBILITY: "true" });
    assert.equal(
      action.function,
      path.join(root, "actions/app-config-compatibility/index.js"),
    );
    configure({ config }, { AZUPAY_APP_CONFIG_COMPATIBILITY: "false" });
    assert.equal(action.function, path.join(root, generated));
  });
  it("fails explicitly for invalid flags, missing actions or unexpected SDK entrypoints", () => {
    const { config, action } = fixture();
    assert.throws(
      () => configure({ config }, { AZUPAY_APP_CONFIG_COMPATIBILITY: "yes" }),
      /true or false/,
    );
    action.function = "unexpected.js";
    assert.throws(() => configure({ config }, {}), /entrypoint changed/);
    assert.throws(() => configure({ root }, {}), /requires the generated/);
  });
  it("selects an opt-in entrypoint without changing inputs or authentication", () => {
    const { config, action } = fixture();
    action.inputs = { LOG_LEVEL: "$LOG_LEVEL" };
    configure({ config }, { AZUPAY_APP_CONFIG_OMIT_WEBHOOKS: "true" });
    assert.deepEqual(action.inputs, {
      LOG_LEVEL: "$LOG_LEVEL",
    });
    assert.equal(
      action.function,
      path.join(root, "actions/app-config-webhook-compatibility/index.js"),
    );
    assert.equal(action.annotations.final, true);
    assert.equal(action.annotations["require-adobe-auth"], true);
    configure({ config }, {});
    assert.equal(
      action.function,
      path.join(root, "actions/app-config-compatibility/index.js"),
    );
    assert.throws(
      () => configure({ config }, { AZUPAY_APP_CONFIG_OMIT_WEBHOOKS: "yes" }),
      /must be true or false/,
    );
    assert.throws(
      () =>
        configure(
          { config },
          {
            AZUPAY_APP_CONFIG_COMPATIBILITY: "false",
            AZUPAY_APP_CONFIG_OMIT_WEBHOOKS: "true",
          },
        ),
      /requires AZUPAY_APP_CONFIG_COMPATIBILITY=true/,
    );
  });
});
