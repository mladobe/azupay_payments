import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { installEds } from "../eds/installer.js";

const checkoutPath = "blocks/commerce-checkout/commerce-checkout.js";
const containersPath = "blocks/commerce-checkout/containers.js";
const initializerPath = "scripts/initializers/checkout.js";
const initializer = `import { initialize, setEndpoint } from '@dropins/storefront-checkout/api.js';
import { CORE_FETCH_GRAPHQL } from '../commerce.js';
setEndpoint(CORE_FETCH_GRAPHQL);
initialize({ models: { MerchantModel: { transformer: data => data } } });
`;
const checkout = `import { events } from '@dropins/tools/event-bus.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { rootLink } from '../../scripts/commerce.js';
export default async function decorate(block) {
  const isB2BEnabled = getConfigValue('commerce-b2b-enabled');
  let b2bIsPoEnabled = false;
  let b2bPoApi = null;
  const $login = block, $shippingForm = block, $billToShipping = block;
  const $delivery = block, $billingForm = block, $cartSummary = block;
  const $orderSummary = block, $giftOptions = block, $paymentMethods = block;
  const handlePlaceOrder = async ({cartId, code}) => {
    return orderApi.placeOrder(cartId);
  };
  await renderPlaceOrder(block, { handlePlaceOrder, handleValidation });
}`;
const containers = `
export const renderPaymentMethods = () => CheckoutProvider.render(PaymentMethods, {
  slots: { Methods: {
    existing: { render: (ctx) => ctx.replaceHTML(document.createElement('div')) },
  } },
});
export const renderPlaceOrder = (container, options) => CheckoutProvider.render(PlaceOrder, {
  handleValidation: options.handleValidation,
  handlePlaceOrder: options.handlePlaceOrder,
  slots: { Content: (ctx) => {
    const span = document.createElement('span');
    span.innerText = options.b2bIsPoEnabled ? 'Place Purchase Order' : 'Place Order';
    ctx.replaceWith(span);
  } },
});`;

async function fixture(t, customized = false) {
  const root = await mkdtemp(join(tmpdir(), "azupay-eds-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "blocks/commerce-checkout"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "another-merchants-own-name",
      version: "1.0.0",
      dependencies: { "@dropins/storefront-checkout": "^3.3.1" },
    }),
  );
  await writeFile(
    join(root, checkoutPath),
    customized
      ? checkout.replace(
          "handlePlaceOrder, handleValidation",
          "handlePlaceOrder: merchantGuard(handlePlaceOrder), handleValidation",
        )
      : checkout,
  );
  await writeFile(join(root, containersPath), containers);
  await mkdir(join(root, "scripts/initializers"), { recursive: true });
  await writeFile(join(root, initializerPath), initializer);
  await writeFile(join(root, ".eslintignore"), "existing-generated.js\n");
  const asset = join(root, "test-client.js");
  await writeFile(asset, "export const testClient = true;\n");
  return { target: root, asset };
}

for (const customized of [false, true]) {
  it(`installs into ${customized ? "customized" : "clean"} merchant checkout and reruns unchanged`, async (t) => {
    const options = await fixture(t, customized);
    const installed = await installEds(options);
    assert.equal(installed.status, "installed");
    const source = await readFile(join(options.target, checkoutPath), "utf8");
    assert.match(source, /guardAzupayPlaceOrder\(azupayNativePlaceOrder/);
    assert.match(source, /window.location.pathname/);
    assert.ok(!source.includes("\n\n\n"));
    assert.ok(!source.includes("adobecouncil"));
    assert.ok(!source.includes("ticketing"));
    if (customized)
      assert.ok(source.includes("merchantGuard(handlePlaceOrder)"));
    const slots = await readFile(join(options.target, containersPath), "utf8");
    assert.match(slots, /azupay: azupayPaymentSlot/);
    assert.match(slots, /withAzupaySelector\(CheckoutProvider.render/);
    assert.match(slots, /\(\) => azupayGetCartDataFromCache\(\)\?\.id/);
    assert.match(slots, /existing: \{ render:/);
    assert.match(slots, /handleValidation: options.handleValidation/);
    assert.equal((await installEds(options)).status, "unchanged");
    const manifest = JSON.parse(
      await readFile(
        join(options.target, ".azupay-eds-installation.json"),
        "utf8",
      ),
    );
    assert.equal(Object.keys(manifest.files).length, 5);
    const init = await readFile(join(options.target, initializerPath), "utf8");
    assert.match(init, /setupAzupayBranding\(CORE_FETCH_GRAPHQL\)/);
    assert.match(init, /MerchantModel/);
    const ignore = await readFile(
      join(options.target, ".eslintignore"),
      "utf8",
    );
    assert.match(ignore, /^existing-generated.js/m);
  });
}
it("dry-run performs no writes", async (t) => {
  const options = await fixture(t);
  assert.equal(
    (await installEds({ ...options, dryRun: true })).status,
    "dry-run",
  );
  assert.equal(
    await readFile(join(options.target, checkoutPath), "utf8"),
    checkout,
  );
  assert.ok(
    !(await readdir(options.target)).includes(".azupay-eds-installation.json"),
  );
  assert.equal(
    await readFile(join(options.target, initializerPath), "utf8"),
    initializer,
  );
});
it("reuses a merchant's existing namespace cart import for selector branding", async (t) => {
  const options = await fixture(t);
  await writeFile(
    join(options.target, containersPath),
    `import * as merchantCart from '@dropins/storefront-cart/api.js';\n${containers}`,
  );
  await installEds(options);
  const source = await readFile(join(options.target, containersPath), "utf8");
  assert.match(source, /\(\) => merchantCart.getCartDataFromCache\(\)\?\.id/);
  assert.equal(source.match(/@dropins\/storefront-cart\/api.js/g).length, 1);
});
it("rejects unsupported or conflicting layouts before changing any files", async (t) => {
  for (const source of [
    "export const different = true;",
    `${checkout}\n// scripts/azupay/client.js`,
  ]) {
    const options = await fixture(t);
    await writeFile(join(options.target, checkoutPath), source);
    await assert.rejects(installEds(options), /Unsupported|unmanaged/);
    assert.equal(
      await readFile(join(options.target, checkoutPath), "utf8"),
      source,
    );
    assert.equal(
      await readFile(join(options.target, containersPath), "utf8"),
      containers,
    );
    assert.deepEqual(await readdir(join(options.target, "scripts")), [
      "initializers",
    ]);
  }
});
it("rejects conflicting payment slots without partial checkout edits", async (t) => {
  const options = await fixture(t);
  await writeFile(
    join(options.target, containersPath),
    containers.replace("existing:", "azupay:"),
  );
  await assert.rejects(installEds(options), /conflicting/);
  assert.equal(
    await readFile(join(options.target, checkoutPath), "utf8"),
    checkout,
  );
});
it("refuses unmanaged assets, unsupported versions, edited installations and silent upgrades", async (t) => {
  const options = await fixture(t);
  await installEds(options);
  await writeFile(
    join(options.target, checkoutPath),
    `${checkout}\n// Merchant edits`,
  );
  await assert.rejects(installEds(options), /was modified/);
  const clean = await fixture(t);
  await installEds(clean);
  await writeFile(clean.asset, "export const changedRelease = true;");
  await assert.rejects(installEds(clean), /different Azupay release/);
  const unmanaged = await fixture(t);
  await mkdir(join(unmanaged.target, "scripts/azupay"), { recursive: true });
  await writeFile(
    join(unmanaged.target, "scripts/azupay/client.js"),
    "merchant code",
  );
  await assert.rejects(installEds(unmanaged), /unmanaged/);
  const unsupported = await fixture(t);
  await writeFile(
    join(unsupported.target, "package.json"),
    JSON.stringify({
      dependencies: { "@dropins/storefront-checkout": "^4.0.0" },
    }),
  );
  await assert.rejects(installEds(unsupported), /supports Checkout/);
});
it("refuses symlinked target paths", async (t) => {
  const options = await fixture(t);
  const elsewhere = await mkdtemp(join(tmpdir(), "azupay-eds-other-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  await rm(join(options.target, "scripts"), { recursive: true });
  await symlink(elsewhere, join(options.target, "scripts"));
  await assert.rejects(installEds(options), /symlinked/);
  assert.deepEqual(await readdir(elsewhere), []);
  assert.equal(
    await readFile(join(options.target, checkoutPath), "utf8"),
    checkout,
  );
});

async function earlierRelease(options, version) {
  const manifestPath = join(options.target, ".azupay-eds-installation.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  if (["0.1.0", "0.1.1"].includes(version)) {
    delete manifest.files[initializerPath];
    await writeFile(join(options.target, initializerPath), initializer);
  }
  const path = join(options.target, containersPath);
  const current = await readFile(path, "utf8");
  const installed = ["0.1.12", "0.1.13"].includes(version)
    ? current
    : current
        .replace("  withAzupaySelector,\n", "")
        .replace(
          "withAzupaySelector(CheckoutProvider.render(PaymentMethods,",
          "CheckoutProvider.render(PaymentMethods,",
        )
        .replace(", () => azupayGetCartDataFromCache()?.id)", "")
        .replace(
          /import \{\n  getCartDataFromCache as azupayGetCartDataFromCache,\n\} from '@dropins\/storefront-cart\/api.js';\n?/,
          "",
        );
  const source = [
    "0.1.3",
    "0.1.4",
    "0.1.5",
    "0.1.6",
    "0.1.7",
    "0.1.8",
    "0.1.9",
    "0.1.10",
    "0.1.11",
    "0.1.12",
    "0.1.13",
  ].includes(version)
    ? installed
    : installed.replace(
        "azupayButtonLabel(undefined, span)",
        "azupayButtonLabel()",
      );
  await writeFile(path, source);
  manifest.files[containersPath] = createHash("sha256")
    .update(source)
    .digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

for (const version of [
  "0.1.0",
  "0.1.1",
  "0.1.2",
  "0.1.3",
  "0.1.4",
  "0.1.5",
  "0.1.6",
  "0.1.7",
  "0.1.8",
  "0.1.9",
  "0.1.10",
  "0.1.11",
  "0.1.12",
  "0.1.13",
]) {
  it(`explicitly upgrades ${version} without rewriting merchant checkout`, async (t) => {
    const options = await fixture(t);
    await installEds(options);
    const manifestPath = await earlierRelease(options, version);
    const before = await readFile(join(options.target, checkoutPath), "utf8");
    await writeFile(
      options.asset,
      "export const improvedReturnMessage = true;",
    );
    await assert.rejects(installEds(options), /different Azupay release/);
    assert.equal(
      (await installEds({ ...options, upgrade: true, dryRun: true })).status,
      "dry-run",
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, "utf8")).version,
      version,
    );
    assert.equal(
      (await installEds({ ...options, upgrade: true })).status,
      "upgraded",
    );
    assert.equal(
      await readFile(join(options.target, checkoutPath), "utf8"),
      before,
    );
    assert.match(
      await readFile(join(options.target, initializerPath), "utf8"),
      /setupAzupayBranding/,
    );
    assert.match(
      await readFile(join(options.target, containersPath), "utf8"),
      /azupayButtonLabel\(undefined, span\)/,
    );
    assert.equal(
      await readFile(join(options.target, "scripts/azupay/client.js"), "utf8"),
      await readFile(options.asset, "utf8"),
    );
    assert.equal((await installEds(options)).status, "unchanged");
  });
}

for (const version of [
  "0.1.5",
  "0.1.6",
  "0.1.7",
  "0.1.8",
  "0.1.9",
  "0.1.10",
  "0.1.11",
  "0.1.12",
  "0.1.13",
]) {
  it(`upgrades unchanged ${version} assets without adding a second button registration`, async (t) => {
    const options = await fixture(t);
    await installEds(options);
    const manifestPath = await earlierRelease(options, version);
    const before = await Promise.all(
      [
        checkoutPath,
        containersPath,
        initializerPath,
        "scripts/azupay/client.js",
      ].map((path) => readFile(join(options.target, path), "utf8")),
    );
    assert.equal(
      (await installEds({ ...options, upgrade: true })).status,
      "upgraded",
    );
    const after = await Promise.all(
      [
        checkoutPath,
        containersPath,
        initializerPath,
        "scripts/azupay/client.js",
      ].map((path) => readFile(join(options.target, path), "utf8")),
    );
    assert.deepEqual(
      [after[0], after[2], after[3]],
      [before[0], before[2], before[3]],
    );
    assert.equal(
      after[1].match(/withAzupaySelector\(CheckoutProvider.render/g).length,
      1,
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, "utf8")).version,
      "0.1.14",
    );
    assert.equal((await installEds(options)).status, "unchanged");
  });
}

it("does not upgrade a modified installation or unsupported release", async (t) => {
  const options = await fixture(t);
  await installEds(options);
  await earlierRelease(options, "0.1.0");
  await writeFile(options.asset, "export const newBundle = true;");
  await writeFile(join(options.target, checkoutPath), "merchant edits");
  await assert.rejects(
    installEds({ ...options, upgrade: true }),
    /was modified/,
  );
  const unsupported = await fixture(t);
  await installEds(unsupported);
  await writeFile(unsupported.asset, "export const sameVersion = true;");
  await assert.rejects(
    installEds({ ...unsupported, upgrade: true }),
    /Only the reviewed/,
  );
});
