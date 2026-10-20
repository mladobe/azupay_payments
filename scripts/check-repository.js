import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootFiles = new Set([
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".nvmrc",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  "LICENSE.md",
  "app.commerce.config.js",
  "app.config.yaml",
  "install.yaml",
  "biome.json",
  "package.json",
  "package-lock.json",
  "webpack-config.cjs",
]);
const sourceDirectories = new Set([
  ".github",
  "docs",
  "eds",
  "scripts",
  "src",
  "storefront",
  "test",
]);
const privatePath =
  /(^|\/)(?:\.generated|node_modules|dist|build|coverage|onboarding|private|\.local|\.aio(?:\..*)?|\.env(?:\..*)?|workspace\.json|console\.json|ws\.json)(\/|$)|\.(?:log|pem|key|p12|pfx|keystore|zip|tgz|bak|orig)$/i;
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["provider secret", /\bSECR[A-Za-z0-9_-]{16,}\b/],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    "bearer token",
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ],
  [
    "embedded credential",
    /["'](?:client_secret|api_key|AIO_runtime_auth|AZUPAY_SIGNING_SECRET)["']\s*:\s*["'][A-Za-z0-9/+_.:-]{24,}["']/i,
  ],
  ["machine-specific path", /\/Users\/[^/\s]+\/(?:Documents|Desktop)\//],
  ["merchant Runtime URL", /https:\/\/\d+-[a-z0-9-]+\.adobeioruntime\.net/i],
  [
    "merchant Commerce URL",
    /https:\/\/[a-z0-9-]+\.api\.commerce\.adobe\.com\/[A-Za-z0-9_-]{12,}/i,
  ],
];

export function allowedSourcePath(name) {
  return (
    !name.startsWith("/") &&
    !name.split("/").includes("..") &&
    (name === ".env.example" || !privatePath.test(name)) &&
    (rootFiles.has(name) || sourceDirectories.has(name.split("/")[0]))
  );
}

export async function sourceFiles(root) {
  const files = [];
  async function visit(name) {
    const info = await lstat(resolve(root, name));
    if (info.isSymbolicLink())
      throw new Error(`${name}: source symlinks are not allowed.`);
    if (info.isDirectory()) {
      for (const entry of await readdir(resolve(root, name))) {
        const child = `${name}/${entry}`;
        if (allowedSourcePath(child)) await visit(child);
      }
    } else if (info.isFile()) {
      files.push(name);
    } else throw new Error(`${name}: unsupported source file type.`);
  }
  for (const entry of await readdir(root)) {
    if (allowedSourcePath(entry)) await visit(entry);
  }
  return files.sort();
}

export function contentProblems(name, source) {
  return patterns.flatMap(([rule, pattern]) =>
    source
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line)
          ? [`${name}:${index + 1}: ${rule}; value withheld.`]
          : [],
      ),
  );
}

function anchors(source) {
  const seen = new Map();
  const result = new Set();
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .toLowerCase()
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

export async function documentationProblems(root, files) {
  const problems = [];
  for (const name of files.filter((file) => file.endsWith(".md"))) {
    const source = (await readFile(resolve(root, name), "utf8")).replace(
      /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
      "",
    );
    for (const match of source.matchAll(
      /!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*)?\)/g,
    )) {
      const link = match[1].replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:)/i.test(link)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) {
        problems.push(`${name}: unsupported local-link scheme.`);
        continue;
      }
      const [path, fragment] = link.split("#");
      const target = path
        ? resolve(root, dirname(name), decodeURIComponent(path))
        : resolve(root, name);
      if (
        relative(root, target).startsWith("..") ||
        !files.includes(relative(root, target))
      ) {
        problems.push(
          `${name}: local link target is outside the checked source or missing: ${link}`,
        );
        continue;
      }
      if (fragment && target.endsWith(".md")) {
        const targetSource = await readFile(target, "utf8");
        if (!anchors(targetSource).has(decodeURIComponent(fragment)))
          problems.push(`${name}: missing local heading: ${link}`);
      }
    }
  }
  return problems;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error("Git could not be executed.");
  return result;
}

export async function checkRepository(
  root,
  { release = false, docsOnly = false, tag = process.env.RELEASE_TAG } = {},
) {
  root = await realpath(root);
  const files = await sourceFiles(root);
  const errors = await documentationProblems(root, files);
  const notices = [];
  if (docsOnly) return { files, errors, notices };
  for (const name of files)
    errors.push(
      ...contentProblems(name, await readFile(resolve(root, name), "utf8")),
    );

  const top = git(root, ["rev-parse", "--show-toplevel"]);
  const hasGit =
    top.status === 0 && resolve(top.stdout.trim()) === resolve(root);
  if (hasGit) {
    const index = git(root, ["ls-files", "--stage", "-z"]);
    if (index.status !== 0)
      throw new Error("Git index could not be inspected.");
    for (const entry of index.stdout.split("\0").filter(Boolean)) {
      const [metadata, name] = entry.split("\t");
      const [mode, , stage] = metadata.split(" ");
      if (!allowedSourcePath(name) || mode === "120000" || stage !== "0") {
        errors.push(
          `${name}: private, unmanaged, symlinked or unmerged index entry.`,
        );
        continue;
      }
      const staged = git(root, ["show", `:${name}`]);
      if (staged.status !== 0)
        throw new Error("Staged source could not be inspected.");
      errors.push(...contentProblems(name, staged.stdout));
    }
  } else
    notices.push(
      "No project Git index exists; staged files/history have not been checked.",
    );
  notices.push(
    "Pattern checks are heuristic. Review historical commits separately before publication.",
  );

  if (release) {
    const pkg = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const licenses = files.filter((name) =>
      ["LICENSE", "LICENSE.md"].includes(name),
    );
    if (
      !pkg.license ||
      pkg.license === "UNLICENSED" ||
      licenses.length !== 1 ||
      !(await readFile(resolve(root, licenses[0]), "utf8")).trim()
    )
      errors.push(
        "Release blocked: approve a project licence, add its text and update package.json first.",
      );
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version))
      errors.push(
        "Release blocked: package version must be a valid release identifier.",
      );
    if (tag && tag !== `v${pkg.version}`)
      errors.push(
        "Release blocked: tag must exactly match the package version.",
      );
    if (!hasGit)
      errors.push(
        "Release blocked: a committed source repository is required.",
      );
    else {
      if (git(root, ["rev-parse", "--verify", "HEAD"]).status !== 0)
        errors.push("Release blocked: no committed source revision exists.");
      const status = git(root, [
        "status",
        "--porcelain",
        "--untracked-files=normal",
      ]);
      if (status.status !== 0)
        throw new Error("Git working tree could not be inspected.");
      if (status.stdout.trim())
        errors.push(
          "Release blocked: commit/review all non-ignored source changes first.",
        );
    }
  }
  return { files, errors, notices };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--release", "--docs-only"].includes(flag))) {
    console.error("Use check-repository.js [--docs-only | --release].");
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const result = await checkRepository(root, {
      release: flags.includes("--release"),
      docsOnly: flags.includes("--docs-only"),
    });
    for (const notice of result.notices) console.log(`NOTICE: ${notice}`);
    for (const error of result.errors) console.error(error);
    if (result.errors.length) process.exitCode = 1;
    else
      console.log(
        `PASS: ${result.files.length} approved source files; local documentation${flags.includes("--docs-only") ? "" : " and publication patterns"}.`,
      );
  }
}
