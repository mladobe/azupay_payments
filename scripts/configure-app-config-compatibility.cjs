const path = require("node:path");

module.exports = function configureAppConfigCompatibility(
  args,
  env = process.env,
) {
  const config = args.config ?? args;
  const action =
    config.manifest?.full?.packages?.["app-management"]?.actions?.[
      "app-config"
    ];
  if (!action || typeof action.function !== "string") {
    throw new Error(
      "App-config compatibility requires the generated app-management/app-config action.",
    );
  }
  const flag = env.AZUPAY_APP_CONFIG_COMPATIBILITY;
  if (flag !== undefined && flag !== "true" && flag !== "false") {
    throw new Error("AZUPAY_APP_CONFIG_COMPATIBILITY must be true or false.");
  }
  const omitWebhooks = env.AZUPAY_APP_CONFIG_OMIT_WEBHOOKS;
  if (
    omitWebhooks !== undefined &&
    omitWebhooks !== "true" &&
    omitWebhooks !== "false"
  ) {
    throw new Error("AZUPAY_APP_CONFIG_OMIT_WEBHOOKS must be true or false.");
  }
  if (flag === "false" && omitWebhooks === "true") {
    throw new Error(
      "Webhook discovery compatibility requires AZUPAY_APP_CONFIG_COMPATIBILITY=true.",
    );
  }
  const generated = path.resolve(
    __dirname,
    "../src/commerce-extensibility-1/.generated/actions/app-management/app-config.js",
  );
  const wrapper = path.resolve(
    __dirname,
    "../src/commerce-extensibility-1/actions/app-config-compatibility/index.js",
  );
  const webhookWrapper = path.resolve(
    __dirname,
    "../src/commerce-extensibility-1/actions/app-config-webhook-compatibility/index.js",
  );
  const current = path.resolve(config.root, action.function);
  if (![generated, wrapper, webhookWrapper].includes(current)) {
    throw new Error(
      "The app-config entrypoint changed; review the compatibility hook before building.",
    );
  }
  action.function =
    flag === "false"
      ? generated
      : omitWebhooks === "true"
        ? webhookWrapper
        : wrapper;
  console.info(
    `App-config webhook discovery: ${omitWebhooks === "true" ? "omitted" : "retained"}; installer configuration unchanged.`,
  );
};
