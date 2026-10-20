#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { installEds } from "../installer.js";

try {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      upgrade: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "azupay-eds-install --target /absolute/path/to/storefront [--dry-run] [--upgrade]",
    );
  } else {
    if (!values.target)
      throw new Error("--target is required. Use --help for usage.");
    const result = await installEds({
      target: values.target,
      dryRun: values["dry-run"],
      upgrade: values.upgrade,
      asset: fileURLToPath(new URL("../payload/client.js", import.meta.url)),
    });
    console.log(`Azupay EDS: ${result.status}\n${result.files.join("\n")}`);
    console.log(
      "Next: rebuild drop-ins, lint, review and publish through your storefront's Code Sync workflow. App Builder does not publish these source changes.",
    );
  }
} catch (error) {
  console.error(`Azupay EDS installation failed: ${error.message}`);
  process.exitCode = 1;
}
