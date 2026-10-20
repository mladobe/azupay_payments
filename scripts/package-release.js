import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkRepository } from "./check-repository.js";

const root = new URL("../", import.meta.url);
const result = await checkRepository(fileURLToPath(root), { release: true });
if (result.errors.length) throw new Error(result.errors.join("\n"));
const { version } = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const names = [
  `azupay-commerce-source-${version}.tgz`,
  `azupay-commerce-eds-${version}.tgz`,
];
await mkdir(new URL("dist/", root), { recursive: true });
execFileSync("git", [
  "-C",
  fileURLToPath(root),
  "archive",
  "--format=tar.gz",
  "--output",
  fileURLToPath(new URL(`dist/${names[0]}`, root)),
  "HEAD",
]);
const checksums = await Promise.all(
  names.map(async (name) => {
    const contents = await readFile(new URL(`dist/${name}`, root));
    return `${createHash("sha256").update(contents).digest("hex")}  ${name}`;
  }),
);
await writeFile(new URL("dist/SHA256SUMS", root), `${checksums.join("\n")}\n`);
console.log(
  `Prepared ${names.join(", ")} and SHA256SUMS. Nothing was uploaded.`,
);
