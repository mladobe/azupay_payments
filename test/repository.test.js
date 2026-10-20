import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { parse } from "yaml";
import {
  allowedSourcePath,
  checkRepository,
  contentProblems,
  documentationProblems,
  sourceFiles,
} from "../scripts/check-repository.js";

async function fixture(t, { git = false, license = "UNLICENSED" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "azupay-publication-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "README.md"),
    "# Test\n\n[Setup](docs/README.md#install)\n",
  );
  await writeFile(join(root, "docs/README.md"), "# Install\n");
  await writeFile(
    join(root, ".gitignore"),
    ".env\n.aio\ndist/\nsrc/**/.generated/\nscripts/onboarding/\n",
  );
  await writeFile(join(root, ".env.example"), "AZUPAY_UAT_PAYID_API_KEY=\n");
  await writeFile(join(root, ".env"), `PRIVATE_FIXTURE=${"not-a-live-key"}\n`);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "publication-fixture",
      type: "module",
      private: true,
      version: "1.2.3",
      license,
    }),
  );
  if (license !== "UNLICENSED")
    await writeFile(
      join(root, "LICENSE"),
      "Synthetic licence text for automated fixtures only.\n",
    );
  if (git) execFileSync("git", ["-C", root, "init", "--quiet"]);
  return root;
}

function commit(root) {
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "Create isolated test fixture",
    "-m",
    "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
  ]);
}

it("allowlists source paths and excludes private/generated artifacts regardless of Git", async (t) => {
  for (const name of [
    ".env",
    ".aio",
    ".aio.json",
    "workspace.json",
    "downloaded-workspace-export.json",
    "scripts/onboarding/credentials.txt",
    "src/example/.generated/action.js",
    "docs/customer.log",
    "private/key.txt",
    "dist/app.zip",
    "docs/key.pem",
  ])
    assert.equal(allowedSourcePath(name), false, name);
  for (const name of [
    ".env.example",
    ".github/workflows/ci.yml",
    "src/shared/payment.js",
    "LICENSE",
  ])
    assert.equal(allowedSourcePath(name), true, name);
  const root = await fixture(t);
  const files = await sourceFiles(root);
  assert.ok(files.includes(".env.example"));
  assert.ok(!files.includes(".env"));
  const result = await checkRepository(root);
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.notices.some((notice) => notice.includes("No project Git index")),
  );
});

it("checks local documentation links and heading anchors without fetching external links", async (t) => {
  const root = await fixture(t);
  const files = await sourceFiles(root);
  assert.deepEqual(await documentationProblems(root, files), []);
  await writeFile(
    join(root, "README.md"),
    [
      "# Test",
      "[Missing](docs/not-present.md)",
      "[Heading](docs/README.md#missing)",
      "[Outside](../private.md)",
      "[External](https://example.com/missing)",
      "```md",
      "[Illustrative](not-a-real-file.md)",
      "```",
    ].join("\n"),
  );
  assert.equal((await documentationProblems(root, files)).length, 3);
});

it("identifies secret patterns without returning the secret or source line", () => {
  const secret = ["SE", "CR", "a".repeat(32)].join("");
  const result = contentProblems("src/bad.js", `const key = "${secret}";`);
  assert.equal(result.length, 1);
  assert.match(result[0], /provider secret; value withheld/);
  assert.ok(!JSON.stringify(result).includes(secret));
});

it("inspects staged contents even when the working file has been cleaned", async (t) => {
  const root = await fixture(t, { git: true });
  await mkdir(join(root, "src"));
  const path = join(root, "src/example.js");
  const secret = ["SE", "CR", "b".repeat(32)].join("");
  await writeFile(path, `export const key = "${secret}";\n`);
  execFileSync("git", ["-C", root, "add", "src/example.js"]);
  await writeFile(path, "export const key = '';\n");
  const result = await checkRepository(root);
  assert.ok(result.errors.some((error) => error.includes("provider secret")));
  assert.ok(!JSON.stringify(result).includes(secret));
});

it("rejects a private file that was force-added despite ignore rules", async (t) => {
  const root = await fixture(t, { git: true });
  execFileSync("git", ["-C", root, "add", "-f", ".env"]);
  const result = await checkRepository(root);
  assert.ok(result.errors.some((error) => error.startsWith(".env:")));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_FIXTURE"));
});

it("blocks unlicensed, dirty and mismatched-tag releases and accepts a clean approved fixture", async (t) => {
  const pending = await fixture(t);
  const blocked = await checkRepository(pending, { release: true });
  assert.ok(blocked.errors.some((error) => error.includes("licence")));
  assert.ok(blocked.errors.some((error) => error.includes("committed source")));
  const root = await fixture(t, { git: true, license: "MIT" });
  commit(root);
  assert.deepEqual(
    (await checkRepository(root, { release: true, tag: "v1.2.3" })).errors,
    [],
  );
  assert.ok(
    (await checkRepository(root, { release: true, tag: "v9.0.0" })).errors.some(
      (error) => error.includes("tag"),
    ),
  );
  await writeFile(join(root, "README.md"), "# Changed source\n");
  assert.ok(
    (await checkRepository(root, { release: true })).errors.some((error) =>
      error.includes("commit/review"),
    ),
  );
});

it("packages only committed source and checksums the exact source/EDS pair", async (t) => {
  const root = await fixture(t, { git: true, license: "MIT" });
  await mkdir(join(root, "scripts"));
  for (const name of ["check-repository.js", "package-release.js"])
    await cp(
      new URL(`../scripts/${name}`, import.meta.url),
      join(root, "scripts", name),
    );
  commit(root);
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "dist/azupay-commerce-eds-1.2.3.tgz"),
    "fixture-archive-bytes",
  );
  execFileSync(process.execPath, [join(root, "scripts/package-release.js")], {
    env: { ...process.env, RELEASE_TAG: "v1.2.3" },
    stdio: "pipe",
  });
  const source = join(root, "dist/azupay-commerce-source-1.2.3.tgz");
  const entries = execFileSync("tar", ["-tzf", source], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert.ok(entries.includes(".env.example"));
  assert.ok(!entries.includes(".env"));
  assert.ok(
    !entries.some(
      (name) => name.startsWith(".git/") || name.startsWith("dist/"),
    ),
  );
  const checksums = (await readFile(join(root, "dist/SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(checksums.length, 2);
  for (const line of checksums) {
    const [digest, name] = line.split("  ");
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(root, "dist", name)))
        .digest("hex"),
      digest,
    );
  }
});

it("keeps CI credential-free and release publication draft-only with minimal permissions", async () => {
  const load = async (name) =>
    parse(
      await readFile(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8",
      ),
    );
  const ci = await load("ci");
  const release = await load("release");
  assert.equal(ci.permissions.contents, "read");
  assert.deepEqual(ci.jobs.validate.strategy.matrix.node, [22, 24]);
  assert.equal(ci.on.pull_request_target, undefined);
  assert.equal(release.permissions.contents, "read");
  assert.equal(release.jobs.draft.permissions.contents, "write");
  assert.equal(release.jobs.draft.needs, "prepare");
  assert.ok(
    release.jobs.prepare.steps.some(
      (step) => step.run === "npm run release:package",
    ),
  );
  const publish = release.jobs.draft.steps.find((step) => step.run);
  assert.match(publish.run, /--verify-tag --draft --prerelease/);
  for (const workflow of [ci, release]) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses)
          assert.match(step.uses, /^actions\/[\w-]+@[a-f0-9]{40}$/);
      }
    }
    assert.ok(!JSON.stringify(workflow).includes("secrets."));
    assert.ok(!JSON.stringify(workflow).includes("aio app deploy"));
  }
});
