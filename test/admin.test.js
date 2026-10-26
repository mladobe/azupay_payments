import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "yaml";
import config from "../app.commerce.config.js";
import { brandingSettings } from "../src/shared/branding.js";
import { configSchema } from "../src/shared/config-schema.js";
import {
  APP_ID,
  DEFAULT_CHECKOUT_TITLE,
  DEFAULT_TITLE,
} from "../src/shared/identity.js";

async function moduleFromBuild(options) {
  const { outputFiles } = await build({
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    ...options,
    plugins: [
      {
        name: "shared-react",
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
            path: import.meta.resolve(path),
            external: true,
          }));
        },
      },
      ...(options.plugins ?? []),
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  );
}

describe("V2 admin menu and payment identity", () => {
  it("removes all ten legacy guidance fields from the shared admin schema, keeping tooltip and terms", () => {
    const names = configSchema.map((field) => field.name);
    for (const prefix of [
      "payidEducation",
      "payidInstructions",
      "payidBenefits",
      "payidLearnMore",
      "paytoInstructions",
    ]) {
      assert.ok(!names.includes(`${prefix}Url`));
      assert.ok(!names.includes(`${prefix}Label`));
    }
    for (const name of [
      "checkoutGuidanceEnabled",
      "checkoutInstructions",
      "checkoutInstructionsLabel",
      "paytoTermsUrl",
      "paytoTermsLabel",
    ])
      assert.equal(names.filter((value) => value === name).length, 1);
    assert.equal(
      configSchema.find((field) => field.name === "paytoTermsUrl").default,
      "",
    );
  });
  it("registers only V2 with a dedicated Sales menu ACL and least sandbox privilege", async () => {
    assert.equal(config.metadata.id, APP_ID);
    assert.equal(APP_ID, "azupay-pay-by-bank");
    assert.equal(config.metadata.displayName, DEFAULT_TITLE);
    assert.equal(config.metadata.upgradeMode, "auto");
    assert.deepEqual(config.adminUi.menu, {
      id: "Azupay::payments",
      label: DEFAULT_TITLE,
      pageTitle: DEFAULT_TITLE,
      description:
        "Configure Azupay payments and view setup, operations and UAT documentation.",
      parentMenu: "sales",
      aclProtected: true,
      sandboxPermissions: ["allow-popups"],
    });
    const app = parse(
      await readFile(new URL("../app.config.yaml", import.meta.url), "utf8"),
    );
    assert.ok(app.extensions["commerce/backend-ui/2"]);
    assert.ok(!app.extensions["commerce/backend-ui/1"]);
    const extension = parse(
      await readFile(
        new URL(
          "../src/commerce-backend-ui-2/ext.config.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(extension.web, "web-src");
    assert.deepEqual(extension.operations.view, [
      { type: "web", impl: "index.html" },
    ]);
    assert.match(extension.hooks["pre-app-build"], /EXTENSION=backend-ui\/2/);
  });

  it("uses the new title only as the default and preserves scoped merchant text", () => {
    assert.equal(DEFAULT_TITLE, "Azupay Real Time Payments");
    assert.equal(
      configSchema.find(({ name }) => name === "checkoutTitle").default,
      DEFAULT_CHECKOUT_TITLE,
    );
    assert.equal(brandingSettings({}).title, DEFAULT_CHECKOUT_TITLE);
    for (const checkoutTitle of ["Merchant bank checkout", "Pay by bank"]) {
      assert.equal(brandingSettings({ checkoutTitle }).title, checkoutTitle);
    }
  });

  it("registers the new OOPE title without changing payment code or refund support", async () => {
    const installation = await moduleFromBuild({
      entryPoints: ["scripts/create-payment-methods.js"],
      plugins: [
        {
          name: "installation-boundary",
          setup(builder) {
            builder.onResolve({ filter: /^@adobe\// }, ({ path }) => ({
              path,
              namespace: "adobe-stub",
            }));
            builder.onLoad({ filter: /.*/, namespace: "adobe-stub" }, () => ({
              contents: `
              export const getCommerceClient = async params => params.client;
              export const resolveImsAuthParams = params => params;
              export const defineCustomInstallationStep = step => step;
            `,
            }));
          },
        },
      ],
    });
    const requests = [];
    const context = {
      params: {
        client: {
          post: (path, options) => {
            requests.push({ path, ...options.json });
            return { json: async () => ({}) };
          },
        },
      },
      logger: { info() {} },
    };
    const previous = process.env.__OW_NAMESPACE;
    process.env.__OW_NAMESPACE = "merchant-runtime";
    try {
      await installation.default.install({}, context);
      await installation.default.uninstall({}, context);
    } finally {
      if (previous === undefined) delete process.env.__OW_NAMESPACE;
      else process.env.__OW_NAMESPACE = previous;
    }
    assert.equal(requests.length, 2);
    for (const [index, request] of requests.entries()) {
      assert.equal(request.path, "oope_payment_method/");
      const method = request.payment_method;
      assert.equal(method.code, "azupay");
      assert.equal(method.title, DEFAULT_CHECKOUT_TITLE);
      assert.equal(method.active, index === 0);
      assert.equal(method.order_status, "pending");
      assert.equal(
        method.custom_config.find(({ key }) => key === "can_refund").value,
        false,
      );
      assert.match(method.backend_integration_url, /\/azupay\/create-session$/);
    }
  });
});

describe("admin operations page", () => {
  async function render(connected) {
    const { AdminPage } = await moduleFromBuild({
      entryPoints: ["src/commerce-backend-ui-2/web-src/src/page.jsx"],
    });
    return renderToStaticMarkup(createElement(AdminPage, { connected }));
  }

  it("opens Configuration by default with documentation and safe UAT links in a separate tab", async () => {
    const html = await render(true);
    assert.match(html, /<h1>Azupay Real Time Payments<\/h1>/);
    assert.match(html, /Apps &gt; App Management/);
    assert.match(html, /not a live payment dashboard/);
    assert.match(html, /Online Commerce refunds are not supported/);
    assert.match(html, /payment instructions tooltip label/);
    assert.match(
      html,
      /https:\/\/helpcentre\.azupay\.com\.au\/docs\/payid-ux-guide/,
    );
    assert.match(
      html,
      /https:\/\/helpcentre\.azupay\.com\.au\/docs\/payto-ux-guide/,
    );
    assert.match(html, /preserves Commerce&#x27;s payment-method order/);
    assert.doesNotMatch(html, /imsToken|imsOrgId|role="alert"/);
    assert.match(
      html,
      /role="tab" aria-selected="true" aria-controls="configuration-panel"/,
    );
    assert.match(
      html,
      /id="documentation-panel" role="tabpanel" aria-labelledby="documentation-tab" hidden=""/,
    );
    assert.match(
      html,
      /Configuration requires an authenticated Commerce Admin connection/,
    );
    const links = [...html.matchAll(/<a ([^>]+)>/g)];
    assert.ok(links.length >= 8);
    for (const [, attributes] of links) {
      assert.match(attributes, /href="https:\/\//);
      assert.match(attributes, /target="_blank"/);
      assert.match(attributes, /rel="noopener noreferrer"/);
    }
    for (const url of [
      "https://staging-testbank.nonprod.azupay.au/",
      "https://developer.azupay.com.au/docs/test-accounts-1-click-checkout",
      "https://dashboard-uat.azupay.com.au",
      "https://dashboard.azupay.com.au",
    ])
      assert.ok(html.includes(url));
  });

  it("explicitly warns when no authenticated admin host provides IMS context", async () => {
    const html = await render(false);
    assert.match(html, /role="alert"/);
    assert.match(html, /Adobe Admin authentication is unavailable/);
    assert.match(
      html,
      /No account settings or payment status have been loaded/,
    );
  });

  it("bundles the SDK entrypoint for browsers without server-side payment modules", async () => {
    const result = await build({
      entryPoints: ["src/commerce-backend-ui-2/web-src/src/app.jsx"],
      bundle: true,
      platform: "browser",
      format: "esm",
      outdir: "dist/admin-test",
      write: false,
      jsx: "automatic",
      metafile: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });
    assert.ok(result.outputFiles.some(({ path }) => path.endsWith(".js")));
    assert.ok(result.outputFiles.some(({ path }) => path.endsWith(".css")));
    assert.ok(
      Object.keys(result.metafile.inputs).some((path) =>
        path.includes("aio-commerce-lib-admin-ui"),
      ),
    );
    assert.ok(
      !Object.keys(result.metafile.inputs).some((path) =>
        /src\/shared\/(?:payment|runtime|service)\.js$/.test(path),
      ),
    );
  });
});
