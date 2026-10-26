import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import { resolveImsAuthParams } from "@adobe/aio-commerce-sdk/auth";
import { DEFAULT_CHECKOUT_TITLE } from "../src/shared/identity.js";
import { requireValue } from "../src/shared/payment.js";

async function setActive(context, active) {
  const namespace = process.env.__OW_NAMESPACE;
  requireValue(
    namespace,
    "MISSING_NAMESPACE",
    "Runtime namespace is required to register Azupay.",
    503,
  );
  const actionBaseUrl = `https://${namespace}.adobeioruntime.net/api/v1/web/azupay`;
  const client = await getCommerceClient(resolveImsAuthParams(context.params));
  await client
    .post("oope_payment_method/", {
      json: {
        payment_method: {
          code: "azupay",
          title: DEFAULT_CHECKOUT_TITLE,
          active,
          backend_integration_url: `${actionBaseUrl}/create-session`,
          order_status: "pending",
          countries: ["AU"],
          currencies: ["AUD"],
          stores: ["default"],
          custom_config: [
            { key: "action_base_url", value: actionBaseUrl },
            { key: "can_refund", value: false },
            { key: "can_authorize", value: false },
            { key: "can_capture", value: false },
          ],
        },
      },
    })
    .json();
  context.logger.info(`Azupay payment method active=${active}`);
  return { paymentMethod: "azupay", active };
}

export default defineCustomInstallationStep({
  install: (_config, context) => setActive(context, true),
  uninstall: (_config, context) => setActive(context, false),
});
