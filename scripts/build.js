import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const manifest = parse(
  await readFile(
    new URL("src/commerce-extensibility-1/ext.config.yaml", root),
    "utf8",
  ),
);
const actions = manifest.runtimeManifest.packages.azupay.actions;
await mkdir(new URL("dist/actions/", root), { recursive: true });
await Promise.all(
  Object.entries(actions).map(([name, action]) =>
    build({
      entryPoints: [
        new URL(`src/commerce-extensibility-1/${action.function}`, root)
          .pathname,
      ],
      outfile: new URL(`dist/actions/${name}.cjs`, root).pathname,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      packages: "external",
    }),
  ),
);
await build({
  entryPoints: ["azupay", "commerce", "flow"].map(
    (name) => new URL(`storefront/${name}.js`, root).pathname,
  ),
  outdir: new URL("dist/storefront/", root).pathname,
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
});
await build({
  entryPoints: [new URL("storefront/eds.js", root).pathname],
  outfile: new URL("dist/storefront/client.js", root).pathname,
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
});
await build({
  entryPoints: [new URL("eds/bin/install.js", root).pathname],
  outfile: new URL("dist/eds/bin/install.js", root).pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
});
await build({
  entryPoints: [
    new URL("src/commerce-backend-ui-2/web-src/src/app.jsx", root).pathname,
  ],
  outfile: new URL("dist/admin/app.js", root).pathname,
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const adminHtml = await readFile(
  new URL("src/commerce-backend-ui-2/web-src/index.html", root),
  "utf8",
);
await writeFile(
  new URL("dist/admin/index.html", root),
  adminHtml
    .replace("</head>", '<link rel="stylesheet" href="./app.css" /></head>')
    .replace('src="./src/app.jsx"', 'src="./app.js"'),
);
await mkdir(new URL("dist/eds/payload/", root), { recursive: true });
await cp(
  new URL("dist/storefront/client.js", root),
  new URL("dist/eds/payload/client.js", root),
);
const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const documents = {
  "README.md": "docs/STOREFRONT.md",
  "INSTALLATION.md": "docs/README.md",
  "SETUP.md": "docs/SETUP.md",
  "OPERATIONS.md": "docs/OPERATIONS.md",
  "ARCHITECTURE.md": "docs/ARCHITECTURE.md",
  "STOREFRONT.md": "docs/STOREFRONT.md",
  "PUBLISHING.md": "docs/PUBLISHING.md",
  "ADMIN.md": "docs/ADMIN.md",
  "CONTRIBUTING.md": "CONTRIBUTING.md",
  "SECURITY.md": "SECURITY.md",
  "CHANGELOG.md": "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
};
for (const [name, path] of Object.entries(documents)) {
  const source = await readFile(new URL(path, root), "utf8");
  const flattened = source.replace(/\]\(([^)\s]+)\)/g, (match, link) => {
    if (/^(?:https?:|mailto:|#)/.test(link)) return match;
    const target = link
      .replace(/^(?:\.\.\/|docs\/)/, "")
      .replace(/^README\.md(?=#|$)/, "INSTALLATION.md");
    return `](${target})`;
  });
  await writeFile(new URL(`dist/eds/${name}`, root), flattened);
}
let projectLicense;
for (const name of ["LICENSE", "LICENSE.md"]) {
  try {
    projectLicense = await readFile(new URL(name, root), "utf8");
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (projectLicense)
  await writeFile(new URL("dist/eds/LICENSE", root), projectLicense);
await writeFile(
  new URL("dist/eds/package.json", root),
  `${JSON.stringify(
    {
      name: "azupay-commerce-eds",
      version: packageJson.version,
      private: true,
      license: packageJson.license,
      description: "Portable EDS installer for Azupay Commerce checkout",
      type: "module",
      engines: { node: ">=22" },
      bin: { "azupay-eds-install": "bin/install.js" },
      files: [
        "bin/install.js",
        "payload/client.js",
        ...Object.keys(documents),
        ...(projectLicense ? ["LICENSE"] : []),
        "ACORN-LICENSE.txt",
      ],
    },
    null,
    2,
  )}\n`,
);
await cp(
  new URL("node_modules/acorn/LICENSE", root),
  new URL("dist/eds/ACORN-LICENSE.txt", root),
);
execFileSync(
  "npm",
  ["pack", "./dist/eds", "--pack-destination", "dist", "--ignore-scripts"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
await cp(new URL("docs/", root), new URL("dist/docs/", root), {
  recursive: true,
});
for (const name of [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md",
])
  await cp(new URL(name, root), new URL(`dist/${name}`, root));
console.log(
  `Built ${Object.keys(actions).length} Runtime actions, V2 admin UI, browser modules and azupay-commerce-eds-${packageJson.version}.tgz. Adobe deploy still requires aio app build/deploy.`,
);
