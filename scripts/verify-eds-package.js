import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { documentationProblems } from "./check-repository.js";

const root = new URL("../", import.meta.url);
const { version, license } = JSON.parse(
  await readFile(new URL("package.json", root)),
);
const archive = new URL(`dist/azupay-commerce-eds-${version}.tgz`, root);
const entries = execFileSync("tar", ["-tzf", archive.pathname], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .sort();
assert.deepEqual(
  entries,
  [
    "package/OPERATIONS.md",
    "package/ARCHITECTURE.md",
    "package/STOREFRONT.md",
    "package/THIRD_PARTY_NOTICES.md",
    "package/ACORN-LICENSE.txt",
    "package/INSTALLATION.md",
    "package/PUBLISHING.md",
    "package/CONTRIBUTING.md",
    "package/SECURITY.md",
    "package/CHANGELOG.md",
    "package/README.md",
    "package/SETUP.md",
    "package/bin/install.js",
    "package/package.json",
    "package/payload/client.js",
    ...(license && license !== "UNLICENSED" ? ["package/LICENSE"] : []),
  ].sort(),
  "Only approved code/documentation may be distributed",
);
const directory = await mkdtemp(join(tmpdir(), "azupay-package-verify-"));
try {
  execFileSync("tar", ["-xzf", archive.pathname, "-C", directory]);
  assert.match(
    await readFile(join(directory, "package/ACORN-LICENSE.txt"), "utf8"),
    /MIT License/,
  );
  const help = execFileSync(
    process.execPath,
    [join(directory, "package/bin/install.js"), "--help"],
    { cwd: directory, encoding: "utf8" },
  );
  assert.match(help, /azupay-eds-install --target/);
  const client = join(directory, "package/payload/client.js");
  const source = await readFile(client, "utf8");
  assert.ok(!/https:\/\/\d+-[a-z0-9-]+\.adobeioruntime\.net/i.test(source));
  assert.ok(
    !/https:\/\/[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.aem\.(?:page|live)/i.test(
      source,
    ),
  );
  const packagedFiles = entries.map((name) => name.slice("package/".length));
  assert.deepEqual(
    await documentationProblems(join(directory, "package"), packagedFiles),
    [],
  );
  const { paymentActionBase } = await import(pathToFileURL(client).href);
  const base = "https://independent-merchant.example/api/v1/web/azupay";
  assert.equal(
    paymentActionBase([
      {
        code: "azupay",
        oope_payment_method_config: {
          backend_integration_url: `${base}/create-session`,
          custom_config: [{ key: "action_base_url", value: base }],
        },
      },
    ]),
    base,
  );
  console.log(
    "PASS: archive allowlist, bundled documentation links, isolated dependency-free CLI and alternate-deployment browser bundle.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
