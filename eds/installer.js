import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "acorn";
import packageJson from "../package.json" with { type: "json" };

const VERSION = packageJson.version;
const MANIFEST = ".azupay-eds-installation.json";
const CHECKOUT = "blocks/commerce-checkout/commerce-checkout.js";
const CONTAINERS = "blocks/commerce-checkout/containers.js";
const CLIENT = "scripts/azupay/client.js";
const INITIALIZER = "scripts/initializers/checkout.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const syntax = (source) =>
  parse(source, { ecmaVersion: "latest", sourceType: "module" });

function nodes(tree, predicate) {
  const found = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) found.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(tree);
  return found;
}

function one(values, description) {
  if (values.length !== 1)
    throw new Error(
      `Unsupported checkout: expected exactly one ${description}. No files were changed.`,
    );
  return values[0];
}

function edit(source, edits) {
  let boundary = source.length + 1;
  for (const { start, end, text } of edits.sort(
    (a, b) => b.start - a.start || b.end - a.end,
  )) {
    if (end > boundary)
      throw new Error("Installer edits overlap. No files were changed.");
    source = source.slice(0, start) + text + source.slice(end);
    boundary = start;
  }
  syntax(source);
  return source;
}

function addImports(source, tree, edits, module, names) {
  const declarations = tree.body.filter(
    (node) => node.type === "ImportDeclaration" && node.source.value === module,
  );
  if (declarations.length > 1)
    throw new Error(`Unsupported duplicate imports from ${module}.`);
  const declaration = declarations[0];
  if (
    declaration?.specifiers.some(
      (specifier) => specifier.type !== "ImportSpecifier",
    )
  )
    throw new Error(`Unsupported import style for ${module}.`);
  const specifiers =
    declaration?.specifiers.map((specifier) =>
      source.slice(specifier.start, specifier.end),
    ) ?? [];
  const text = `import {\n${[...specifiers, ...names].map((name) => `  ${name},`).join("\n")}\n} from '${module}';`;
  const insertion =
    tree.body.filter((node) => node.type === "ImportDeclaration").at(-1)?.end ??
    0;
  edits.push({
    start: declaration?.start ?? insertion,
    end: declaration?.end ?? insertion,
    text: declaration ? text : `\n${text}`,
  });
}

function patchCheckout(source) {
  const tree = syntax(source);
  if (
    source.includes("scripts/azupay/") ||
    source.includes("guardAzupayPlaceOrder")
  )
    throw new Error(
      "An unmanaged Azupay integration already exists. Remove or migrate it before installation.",
    );
  const handler = one(
    nodes(
      tree,
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.length === 1 &&
        node.declarations[0].id.name === "handlePlaceOrder" &&
        node.declarations[0].init?.type === "ArrowFunctionExpression",
    ),
    "handlePlaceOrder arrow-function declaration",
  );
  const identifiers = new Set(
    nodes(tree, (node) => node.type === "Identifier").map((node) => node.name),
  );
  const required = [
    "block",
    "events",
    "isB2BEnabled",
    "b2bIsPoEnabled",
    "b2bPoApi",
    "$login",
    "$shippingForm",
    "$billToShipping",
    "$delivery",
    "$billingForm",
    "$cartSummary",
    "$orderSummary",
    "$giftOptions",
    "$paymentMethods",
  ];
  for (const name of required)
    if (!identifiers.has(name))
      throw new Error(`Unsupported checkout: missing ${name}.`);
  for (const name of [
    "azupayNativePlaceOrder",
    "azupayLockCart",
    "azupayGetHeaders",
    "azupayGetUserTokenCookie",
    "AZUPAY_GRAPHQL",
  ])
    if (identifiers.has(name))
      throw new Error(
        `Reserved Azupay integration name is already used: ${name}.`,
      );
  const id = handler.declarations[0].id;
  const edits = [
    { start: id.start, end: id.end, text: "azupayNativePlaceOrder" },
    {
      start: handler.end,
      end: handler.end,
      text: `

  const azupayLockCart = (locked) => {
    [
      $login, $shippingForm, $billToShipping, $delivery, $billingForm,
      $cartSummary, $orderSummary, $giftOptions, $paymentMethods,
    ].forEach((element) => { element.inert = locked; });
  };
  azupayLockCart(hasPendingPayment());
  const handlePlaceOrder = guardAzupayPlaceOrder(azupayNativePlaceOrder, {
    block,
    graphql: (query, variables) => AZUPAY_GRAPHQL.fetchGraphQl(query, {
      variables, method: 'POST', cache: 'no-store',
    }),
    storeCode: azupayGetHeaders('all').Store || azupayGetHeaders('all').store,
    authorization: () => {
      const token = azupayGetUserTokenCookie();
      return token ? \`Bearer \${token}\` : undefined;
    },
    returnUrl: new URL(window.location.pathname, window.location.origin).href,
    confirmedOrder: () => events.lastPayload('order/placed'),
    purchaseOrder: () => isB2BEnabled && b2bIsPoEnabled && b2bPoApi,
    lockCart: azupayLockCart,
  });`,
    },
  ];
  addImports(source, tree, edits, "../../scripts/azupay/client.js", [
    "guardAzupayPlaceOrder",
    "hasPendingPayment",
  ]);
  addImports(source, tree, edits, "@dropins/tools/lib/aem/configs.js", [
    "getHeaders as azupayGetHeaders",
  ]);
  addImports(source, tree, edits, "../../scripts/initializers/index.js", [
    "getUserTokenCookie as azupayGetUserTokenCookie",
  ]);
  addImports(source, tree, edits, "../../scripts/commerce.js", [
    "CORE_FETCH_GRAPHQL as AZUPAY_GRAPHQL",
  ]);
  return edit(source, edits);
}

const property = (node, name) =>
  node?.properties?.find(
    (entry) =>
      !entry.computed && (entry.key?.name ?? entry.key?.value) === name,
  )?.value;

function renderOptions(tree, name) {
  return one(
    nodes(
      tree,
      (node) =>
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.name === "CheckoutProvider" &&
        node.callee.property.name === "render" &&
        node.arguments[0]?.name === name,
    ),
    `${name} container registration`,
  ).arguments[1];
}

function patchContainers(source) {
  const tree = syntax(source);
  if (source.includes("scripts/azupay/"))
    throw new Error(
      "An unmanaged Azupay container registration already exists.",
    );
  const methods = property(
    property(renderOptions(tree, "PaymentMethods"), "slots"),
    "Methods",
  );
  if (methods?.type !== "ObjectExpression" || property(methods, "azupay"))
    throw new Error("Unsupported or conflicting PaymentMethods.Methods slot.");
  const content = property(
    property(renderOptions(tree, "PlaceOrder"), "slots"),
    "Content",
  );
  if (
    content?.type !== "ArrowFunctionExpression" ||
    content.params[0]?.type !== "Identifier"
  )
    throw new Error("Unsupported PlaceOrder.Content slot.");
  const span = one(
    content.body.body?.filter(
      (node) =>
        node.type === "VariableDeclaration" &&
        node.declarations.length === 1 &&
        node.declarations[0].init?.type === "CallExpression" &&
        node.declarations[0].init.callee.object?.name === "document" &&
        node.declarations[0].init.callee.property?.name === "createElement" &&
        node.declarations[0].init.arguments[0]?.value === "span",
    ) ?? [],
    "PlaceOrder label span",
  );
  const context = content.params[0].name;
  const label = span.declarations[0].id.name;
  const edits = [
    {
      start: methods.start + 1,
      end: methods.start + 1,
      text: "\n        azupay: azupayPaymentSlot,",
    },
    {
      start: span.end,
      end: span.end,
      text: `
        if (${context}.code === 'azupay') {
          ${label}.innerText = azupayButtonLabel(undefined, ${label});
          ${context}.replaceWith(${label});
          return;
        }`,
    },
  ];
  addImports(source, tree, edits, "../../scripts/azupay/client.js", [
    "azupayPaymentSlot",
    "azupayButtonLabel",
  ]);
  return edit(source, edits);
}

function patchModalButton(source) {
  const tree = syntax(source);
  const assignment = one(
    nodes(
      tree,
      (node) =>
        node.type === "AssignmentExpression" &&
        node.left.type === "MemberExpression" &&
        node.left.object.type === "Identifier" &&
        node.left.property.name === "innerText" &&
        node.right.type === "CallExpression" &&
        node.right.callee.name === "azupayButtonLabel" &&
        node.right.arguments.length === 0,
    ),
    "installed Azupay order-button label",
  );
  return edit(source, [
    {
      start: assignment.right.start,
      end: assignment.right.end,
      text: `azupayButtonLabel(undefined, ${assignment.left.object.name})`,
    },
  ]);
}

function patchInitializer(source) {
  const tree = syntax(source);
  if (
    source.includes("setupAzupayBranding") ||
    source.includes("../azupay/client.js")
  )
    throw new Error("An unmanaged Azupay branding initializer already exists.");
  const endpoint = one(
    nodes(
      tree,
      (node) =>
        node.type === "ExpressionStatement" &&
        node.expression.type === "CallExpression" &&
        node.expression.callee.name === "setEndpoint" &&
        node.expression.arguments[0]?.name === "CORE_FETCH_GRAPHQL",
    ),
    "checkout setEndpoint(CORE_FETCH_GRAPHQL) call",
  );
  const edits = [
    {
      start: endpoint.start,
      end: endpoint.start,
      text: "setupAzupayBranding(CORE_FETCH_GRAPHQL);\n  ",
    },
  ];
  addImports(source, tree, edits, "../azupay/client.js", [
    "setupAzupayBranding",
  ]);
  return edit(source, edits);
}

async function safePath(root, name) {
  const target = resolve(root, name);
  if (relative(root, target).startsWith("..") || target === root)
    throw new Error(`Unsafe installer path: ${name}.`);
  const segments = relative(root, target).split("/");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Refusing symlinked installer target: ${name}.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}

async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function installEds({
  target,
  asset,
  dryRun = false,
  upgrade = false,
}) {
  const root = await realpath(target);
  const manifestPath = await safePath(root, MANIFEST);
  const client = await readFile(asset, "utf8");
  const previous = await optionalFile(manifestPath);
  if (previous) {
    const manifest = JSON.parse(previous);
    const changed =
      manifest.version !== VERSION || manifest.assetSha256 !== hash(client);
    if (changed && !upgrade)
      throw new Error(
        "A different Azupay release is installed. Review an upgrade before changing files.",
      );
    const oldRelease = ["0.1.0", "0.1.1"].includes(manifest.version);
    const expectedFiles = [
      CHECKOUT,
      CONTAINERS,
      CLIENT,
      ".eslintignore",
      ...(oldRelease ? [] : [INITIALIZER]),
    ].sort();
    if (
      !manifest.files ||
      JSON.stringify(Object.keys(manifest.files).sort()) !==
        JSON.stringify(expectedFiles) ||
      manifest.files[CLIENT] !== manifest.assetSha256
    )
      throw new Error("The Azupay installation manifest is incomplete.");
    for (const [name, digest] of Object.entries(manifest.files)) {
      const content = await readFile(await safePath(root, name), "utf8");
      if (hash(content) !== digest)
        throw new Error(
          `Installed Azupay file was modified: ${name}. Review before reinstalling.`,
        );
    }
    if (!changed)
      return { status: "unchanged", files: Object.keys(manifest.files) };
    if (
      VERSION !== "0.1.6" ||
      !["0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.4", "0.1.5"].includes(
        manifest.version,
      )
    )
      throw new Error(
        "Only the reviewed 0.1.0 through 0.1.5 to 0.1.6 upgrade is supported.",
      );
    const initializerPath = await safePath(root, INITIALIZER);
    const oldInitializer = await readFile(initializerPath, "utf8");
    const initializer = oldRelease
      ? patchInitializer(oldInitializer)
      : oldInitializer;
    const containersPath = await safePath(root, CONTAINERS);
    const oldContainers = await readFile(containersPath, "utf8");
    const containers = ["0.1.3", "0.1.4", "0.1.5"].includes(manifest.version)
      ? oldContainers
      : patchModalButton(oldContainers);
    const files = [
      CLIENT,
      ...(containers !== oldContainers ? [CONTAINERS] : []),
      ...(oldRelease ? [INITIALIZER] : []),
      MANIFEST,
    ];
    if (dryRun) return { status: "dry-run", files };
    const clientPath = await safePath(root, CLIENT);
    const oldClient = await readFile(clientPath, "utf8");
    manifest.version = VERSION;
    manifest.assetSha256 = hash(client);
    manifest.files[CLIENT] = hash(client);
    manifest.files[INITIALIZER] = hash(initializer);
    manifest.files[CONTAINERS] = hash(containers);
    try {
      await writeFile(clientPath, client);
      await writeFile(initializerPath, initializer);
      await writeFile(containersPath, containers);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
      await writeFile(clientPath, oldClient);
      await writeFile(initializerPath, oldInitializer);
      await writeFile(containersPath, oldContainers);
      await writeFile(manifestPath, previous);
      throw error;
    }
    return { status: "upgraded", files };
  }
  const packageJson = JSON.parse(
    await readFile(await safePath(root, "package.json"), "utf8"),
  );
  const checkoutVersion =
    packageJson.dependencies?.["@dropins/storefront-checkout"];
  if (!/^[~^]?3\./.test(checkoutVersion ?? ""))
    throw new Error(
      "Automatic installation supports Checkout drop-in 3.x with the Commerce boilerplate 6.x source layout. Use the documented manual adapter for other storefronts.",
    );
  const before = new Map();
  for (const name of [
    CHECKOUT,
    CONTAINERS,
    CLIENT,
    ".eslintignore",
    INITIALIZER,
  ]) {
    before.set(name, await optionalFile(await safePath(root, name)));
  }
  if (before.get(CLIENT) !== null)
    throw new Error(
      "An unmanaged scripts/azupay/client.js already exists. Review it before installing.",
    );
  if (
    !before.get(CHECKOUT) ||
    !before.get(CONTAINERS) ||
    !before.get(INITIALIZER)
  )
    throw new Error(
      "The supported checkout block and containers files are required.",
    );
  const planned = new Map([
    [CHECKOUT, patchCheckout(before.get(CHECKOUT))],
    [CONTAINERS, patchContainers(before.get(CONTAINERS))],
    [INITIALIZER, patchInitializer(before.get(INITIALIZER))],
    [CLIENT, client],
    [
      ".eslintignore",
      `${before.get(".eslintignore") ?? ""}\n# Azupay generated browser bundle\n${CLIENT}\n`,
    ],
  ]);
  const manifest = {
    version: VERSION,
    assetSha256: hash(client),
    files: Object.fromEntries(
      [...planned].map(([name, content]) => [name, hash(content)]),
    ),
  };
  if (dryRun)
    return { status: "dry-run", files: [...planned.keys(), MANIFEST] };
  for (const [name, content] of before)
    if ((await optionalFile(await safePath(root, name))) !== content)
      throw new Error(
        `Storefront changed during preflight: ${name}. Retry after review.`,
      );
  const written = [];
  try {
    for (const [name, content] of planned) {
      const path = await safePath(root, name);
      await mkdir(dirname(path), { recursive: true });
      written.push(name);
      await writeFile(path, content);
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    for (const name of written.reverse()) {
      const path = await safePath(root, name);
      if (before.get(name) === null) {
        try {
          await unlink(path);
        } catch (rollbackError) {
          if (rollbackError.code !== "ENOENT") throw rollbackError;
        }
      } else await writeFile(path, before.get(name));
    }
    throw error;
  }
  return { status: "installed", files: [...planned.keys(), MANIFEST] };
}
