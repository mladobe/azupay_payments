import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";
import {
  deactivatePaymentMethod,
  registerPaymentMethod,
} from "../src/shared/payment-registration.js";

async function setActive(context, active) {
  const client = await getCommerceClient(resolveImsAuthParams(context.params));
  const result = active
    ? await registerPaymentMethod({
        client,
        namespace: process.env.__OW_NAMESPACE,
      })
    : await deactivatePaymentMethod(client);
  context.logger.info(
    `Azupay payment registration active=${result.active}, stores=${result.stores.join(",")}, changed=${result.changed}`,
  );
  return result;
}

export default defineCustomInstallationStep({
  install: (_config, context) => setActive(context, true),
  uninstall: (_config, context) => setActive(context, false),
});
