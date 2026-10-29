import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
  configClient,
  configurationModel,
  configurationPatch,
  flattenScopes,
  runtimeBase,
} from "../src/commerce-backend-ui-2/web-src/src/config-client.js";
import { main as adminMain } from "../src/commerce-extensibility-1/actions/admin-config/index.js";
import { adminConfigHandler } from "../src/shared/admin-config.js";

describe("permission-checked native configuration adapter", () => {
  it("loads the real SDK entrypoint and refuses missing user tokens without using deployment credentials", async () => {
    const response = await adminMain({
      __ow_method: "get",
      __ow_path: "/scopes",
    });
    assert.equal(response.statusCode, 401);
    assert.equal(
      (await adminMain({ __ow_method: "post", __ow_path: "/scopes/sync" }))
        .statusCode,
      401,
    );
  });
  function fixture(
    authorize = async () => ({ kind: "forwarded-admin" }),
    syncResult = { synced: true, scopeTree: [{ id: "fresh-scope" }] },
    registrationResult = {
      paymentMethod: "azupay",
      active: true,
      stores: ["b2b", "default"],
      changed: true,
    },
  ) {
    const calls = [],
      logs = [];
    const main = adminConfigHandler({
      authorize,
      configAction: async (params) => {
        calls.push(params);
        return { statusCode: 200, body: { values: "native configuration" } };
      },
      scopeAction: async (params) => {
        calls.push(params);
        return { statusCode: 203, body: { scopes: [] } };
      },
      getCommerceInstance: async () => {
        calls.push({ operation: "instance" });
        return { baseUrl: "https://associated.example/tenant", env: "saas" };
      },
      syncScopes: async (config) => {
        calls.push({ operation: "sync", config });
        if (syncResult instanceof Error) throw syncResult;
        return syncResult;
      },
      registerPaymentStores: async (auth) => {
        calls.push({ operation: "register", auth });
        if (registrationResult instanceof Error) throw registrationResult;
        return registrationResult;
      },
      logError: (code) => logs.push(code),
    });
    return { main, calls, logs };
  }

  it("reuses native config/scopes actions and preserves patch values and response statuses", async () => {
    const { main, calls } = fixture();
    const patch = [
      { name: "enabled", value: false },
      { name: "checkoutTitle", value: null },
    ];
    const response = await main({
      __ow_method: "patch",
      __ow_path: "/config",
      scopeId: "scope-1",
      config: patch,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(calls[0].config, patch);
    assert.equal(calls[0].__ow_path, "/");
    assert.equal(calls[0].scopeId, "scope-1");
    assert.equal(
      (await main({ __ow_method: "get", __ow_path: "/scopes" })).statusCode,
      203,
    );
    assert.equal(
      (
        await main({
          __ow_method: "get",
          __ow_path: "/config",
          scopeId: "global",
        })
      ).statusCode,
      200,
    );
  });

  it("synchronizes fresh scopes only after authorization, using the stored instance and signed-in auth", async () => {
    let authorized = false;
    const auth = { kind: "signed-in-provider" };
    const { main, calls } = fixture(async () => {
      authorized = true;
      return auth;
    });
    const response = await main({
      __ow_method: "post",
      __ow_path: "/scopes/sync",
      commerceBaseUrl: "https://attacker.example",
      commerceEnv: "paas",
      AIO_COMMERCE_API_BASE_URL: "https://attacker.example",
      auth: { kind: "caller" },
    });
    assert.equal(authorized, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.body, {
      scopes: [{ id: "fresh-scope" }],
      synced: true,
      registration: {
        paymentMethod: "azupay",
        active: true,
        stores: ["b2b", "default"],
        changed: true,
      },
    });
    assert.deepEqual(calls, [
      { operation: "instance" },
      {
        operation: "sync",
        config: {
          auth,
          config: {
            baseUrl: "https://associated.example/tenant",
            flavor: "saas",
          },
          fetchOptions: { timeout: 20000, retry: 0 },
        },
      },
      { operation: "register", auth },
    ]);
  });

  it("rejects cached, empty and failed syncs explicitly without leaking provider failures", async () => {
    for (const result of [
      { synced: false, scopeTree: [{ id: "old-scope" }] },
      { synced: true, scopeTree: [], error: "Private upstream detail" },
      { synced: true, scopeTree: [] },
      new Error("Private upstream detail"),
    ]) {
      const { main, calls, logs } = fixture(undefined, result);
      const response = await main({
        __ow_method: "post",
        __ow_path: "/scopes/sync",
      });
      assert.equal(response.statusCode, 503);
      assert.match(response.body.message, /could not both be confirmed/);
      assert.doesNotMatch(JSON.stringify(response), /Private upstream/);
      assert.deepEqual(logs, ["ADMIN_CONFIG_UNAVAILABLE"]);
      assert.ok(!calls.some((call) => call.operation === "register"));
    }
  });

  it("reports failed registration as unconfirmed even after the hierarchy has synchronized", async () => {
    for (const status of [403, 502]) {
      const error = new Error("Private Commerce registration response");
      error.response = { status };
      const { main, calls, logs } = fixture(undefined, undefined, error);
      const result = await main({
        __ow_method: "post",
        __ow_path: "/scopes/sync",
      });
      assert.equal(result.statusCode, status === 403 ? 403 : 503);
      assert.equal(calls.at(-1).operation, "register");
      assert.doesNotMatch(JSON.stringify(result), /Private Commerce/);
      if (status === 502) {
        assert.match(
          result.body.message,
          /hierarchy or registration may already have changed/,
        );
        assert.deepEqual(logs, ["ADMIN_CONFIG_UNAVAILABLE"]);
      } else {
        assert.deepEqual(logs, ["ADMIN_CONFIG_FORBIDDEN"]);
      }
    }
  });

  it("does not synchronize with deployment credentials when forwarded auth is unavailable", async () => {
    const { main, calls } = fixture(async () => undefined);
    const response = await main({
      __ow_method: "post",
      __ow_path: "/scopes/sync",
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(calls, []);
  });

  it("never reads or writes configuration when user authorization fails", async () => {
    for (const status of [401, 403, 500]) {
      const { main, calls, logs } = fixture(async () => {
        const error = new Error(
          "Private upstream message must not be returned.",
        );
        error.status = status;
        throw error;
      });
      for (const [method, path] of [
        ["patch", "/config"],
        ["post", "/scopes/sync"],
      ]) {
        const result = await main({ __ow_method: method, __ow_path: path });
        assert.equal(result.statusCode, status === 500 ? 503 : status);
        assert.deepEqual(calls, []);
        assert.ok(!JSON.stringify(result).includes("Private upstream"));
      }
      assert.equal(logs.length, 2);
    }
  });

  it("does not expose scope mutation or unrelated management routes", async () => {
    for (const [method, path] of [
      ["put", "/scopes"],
      ["post", "/scopes/commerce"],
      ["get", "/scopes/sync"],
      ["put", "/scopes/sync"],
      ["delete", "/scopes/sync"],
      ["delete", "/config"],
      ["get", "/"],
    ]) {
      const { main, calls } = fixture();
      assert.equal(
        (await main({ __ow_method: method, __ow_path: path })).statusCode,
        405,
      );
      assert.deepEqual(calls, []);
    }
  });

  it("retains Adobe authentication and native encryption-key input on the new action", async () => {
    const manifest = parse(
      await readFile(
        new URL(
          "../src/commerce-extensibility-1/ext.config.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const action =
      manifest.runtimeManifest.packages.azupay.actions["admin-config"];
    assert.equal(action.annotations["require-adobe-auth"], true);
    assert.equal(action.limits.timeout, 120000);
    assert.equal(
      action.inputs.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY,
      "$AIO_COMMERCE_CONFIG_ENCRYPTION_KEY",
    );
    const source = await readFile(
      new URL(
        "../src/commerce-extensibility-1/actions/admin-config/index.js",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /getForwardedImsAuthProvider/);
    assert.match(source, /from: "headers"/);
    assert.match(
      source,
      /\.require\(getMenuAclResourceId\(APP_ID, "Azupay::payments"\)\)/,
    );
    assert.doesNotMatch(source, /resolveImsAuthParams/);
  });
});

describe("admin configuration browser client", () => {
  const credentials = () => ({
    imsToken: "fake-admin-token",
    imsOrgId: "test-org",
  });
  it("uses public deployment identity, never a tenant-specific source URL or query override", () => {
    assert.equal(
      runtimeBase("other-workspace", "https://localhost/"),
      "https://other-workspace.adobeioruntime.net/api/v1/web/azupay/admin-config",
    );
    assert.equal(
      runtimeBase("", "https://merchant-app.adobeio-static.net/index.html"),
      "https://merchant-app.adobeioruntime.net/api/v1/web/azupay/admin-config",
    );
    assert.throws(
      () => runtimeBase("", "https://localhost/?runtime=evil.test"),
      /namespace is unavailable/,
    );
    assert.throws(
      () => runtimeBase("bad/namespace", "https://localhost/"),
      /namespace is unavailable/,
    );
  });

  it("sends authenticated requests without cookies, caching, redirects or token-bearing URLs", async () => {
    const calls = [];
    let token = "first-admin-token";
    const client = configClient({
      baseUrl: "https://runtime.example/admin-config",
      credentials: () => ({ ...credentials(), imsToken: token }),
      fetch: async (url, options) => {
        calls.push({ url, ...options });
        return Response.json({ scopes: [] });
      },
    });
    await client.scopes();
    token = "refreshed-admin-token";
    await client.read("scope with / characters");
    await client.save("global", [
      { name: "enabled", value: false },
      { name: "checkoutTitle", value: null },
    ]);
    await client.syncScopes();
    assert.equal(
      calls[3].url,
      "https://runtime.example/admin-config/scopes/sync",
    );
    assert.equal(calls[3].method, "POST");
    assert.equal(calls[3].body, undefined);
    assert.equal(calls[0].headers.Authorization, "Bearer first-admin-token");
    assert.equal(
      calls[1].headers.Authorization,
      "Bearer refreshed-admin-token",
    );
    assert.match(calls[1].url, /scopeId=scope%20with%20%2F%20characters/);
    assert.deepEqual(JSON.parse(calls[2].body), {
      scopeId: "global",
      config: [
        { name: "enabled", value: false },
        { name: "checkoutTitle", value: null },
      ],
    });
    for (const call of calls) {
      assert.equal(call.headers["x-gw-ims-org-id"], "test-org");
      assert.equal(call.credentials, "omit");
      assert.equal(call.cache, "no-store");
      assert.equal(call.redirect, "error");
      assert.ok(!call.url.includes("token"));
    }
  });

  it("fails explicitly on missing auth, denied access, invalid JSON and ambiguous network errors without retry", async () => {
    const missing = configClient({
      baseUrl: "https://runtime.example",
      credentials: () => ({}),
    });
    await assert.rejects(missing.scopes(), /Authenticated/);
    for (const status of [401, 403, 500]) {
      let calls = 0;
      const client = configClient({
        baseUrl: "https://runtime.example",
        credentials,
        fetch: async () => {
          calls++;
          return new Response("Private upstream body", { status });
        },
      });
      await assert.rejects(
        client.save("global", []),
        status === 401 ? /expired/ : status === 403 ? /permission/ : /HTTP 500/,
      );
      assert.equal(calls, 1);
    }
    const invalid = configClient({
      baseUrl: "https://runtime.example",
      credentials,
      fetch: async () => new Response("not JSON"),
    });
    await assert.rejects(invalid.scopes(), /invalid response/);
    const empty = configClient({
      baseUrl: "https://runtime.example",
      credentials,
      fetch: async () => Response.json(null),
    });
    await assert.rejects(empty.scopes(), /invalid response/);
    let calls = 0;
    const offline = configClient({
      baseUrl: "https://runtime.example",
      credentials,
      fetch: async () => {
        calls++;
        throw new Error("offline");
      },
    });
    await assert.rejects(offline.save("global", []), /Reload saved values/);
    assert.equal(calls, 1);
  });

  it("propagates cancellation to reads and saves without retrying stale requests", async () => {
    for (const operation of ["read", "save", "syncScopes"]) {
      const controller = new AbortController();
      let calls = 0;
      const client = configClient({
        baseUrl: "https://runtime.example",
        credentials,
        fetch: (_url, { signal }) => {
          calls++;
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      });
      const pending =
        operation === "read"
          ? client.read("global", controller.signal)
          : operation === "save"
            ? client.save("global", [], controller.signal)
            : client.syncScopes(controller.signal);
      controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
      assert.equal(calls, 1);
    }
  });
});

describe("native scope inheritance and minimal changes", () => {
  const scope = {
    id: "store-view",
    code: "store",
    level: "store_view",
    parentId: "global",
  };
  const schema = [
    { name: "enabled", label: "Enabled", type: "boolean", default: false },
    {
      name: "environment",
      label: "Environment",
      type: "list",
      selectionMode: "single",
      default: "uat",
      options: [
        { label: "UAT", value: "uat" },
        { label: "Production", value: "production" },
      ],
    },
    {
      name: "checkoutTitle",
      label: "Title",
      type: "text",
      default: "Default name",
    },
  ];
  const document = {
    schema,
    values: {
      scope,
      config: [
        {
          name: "enabled",
          value: true,
          origin: { code: "global", level: "global" },
        },
        {
          name: "environment",
          value: ["uat"],
          origin: { code: "store", level: "store_view" },
        },
        {
          name: "checkoutTitle",
          value: "Merchant title",
          origin: { code: "store", level: "store_view" },
        },
      ],
    },
  };
  const parent = {
    values: {
      scope: { id: "global" },
      config: [
        { name: "enabled", value: false },
        { name: "environment", value: ["uat"] },
        { name: "checkoutTitle", value: "Parent title" },
      ],
    },
  };

  it("retains native IDs, nested scopes, noneditable scopes and parent identity", () => {
    const scopes = flattenScopes([
      {
        id: "global",
        code: "global",
        level: "global",
        label: "Global",
        is_editable: true,
        children: [{ ...scope, label: "Store view", is_editable: false }],
      },
    ]);
    assert.equal(scopes[1].parentId, "global");
    assert.equal(scopes[1].depth, 1);
    assert.equal(scopes[1].is_editable, false);
    assert.throws(() => flattenScopes([{}]), /scope is invalid/);
  });

  it("normalizes singleton lists and resolves inherited/default values without materializing overrides", () => {
    const fields = configurationModel(document, parent, scope);
    assert.equal(fields[0].inherited, true);
    assert.equal(fields[1].value, "uat");
    assert.equal(fields[1].parentValue, "uat");
    assert.equal(fields[2].parentValue, "Parent title");
    assert.deepEqual(configurationPatch(fields, {}), []);
    assert.deepEqual(
      configurationPatch(fields, {
        enabled: null,
        environment: "uat",
        checkoutTitle: "Merchant title",
      }),
      [],
    );
    assert.deepEqual(
      configurationPatch(fields, { enabled: false, checkoutTitle: null }),
      [
        { name: "enabled", value: false },
        { name: "checkoutTitle", value: null },
      ],
    );
    assert.deepEqual(configurationPatch(fields, { enabled: true }), [
      { name: "enabled", value: true },
    ]);
  });

  it("rejects mismatched or unsupported responses rather than presenting default success-shaped values", () => {
    assert.throws(
      () =>
        configurationModel(document, parent, { ...scope, id: "wrong-scope" }),
      /does not match/,
    );
    assert.throws(
      () =>
        configurationModel(
          { ...document, schema: [{ ...schema[0], type: "password" }] },
          parent,
          scope,
        ),
      /not supported/,
    );
    const invalid = structuredClone(document);
    invalid.values.config[0].value = "false";
    assert.throws(
      () => configurationModel(invalid, parent, scope),
      /value is invalid/,
    );
    assert.throws(
      () =>
        configurationModel(
          document,
          { values: { scope: { id: "wrong" }, config: [] } },
          scope,
        ),
      /parent configuration does not match/,
    );
    assert.throws(
      () =>
        configurationModel(
          document,
          { values: { scope: { id: "global" }, config: [] } },
          scope,
        ),
      /parent configuration is missing/,
    );
  });
});
