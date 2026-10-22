import { defineConfig } from "@adobe/aio-commerce-lib-app/config";
import packageJson from "./package.json" with { type: "json" };
import { configSchema } from "./src/shared/config-schema.js";
import { APP_ID, DEFAULT_TITLE } from "./src/shared/identity.js";

export default defineConfig({
  metadata: {
    id: APP_ID,
    displayName: DEFAULT_TITLE,
    description: "Hosted PayID and PayTo checkout for Adobe Commerce SaaS.",
    version: packageJson.version,
    upgradeMode: "auto",
  },
  adminUi: {
    menu: {
      id: "Azupay::payments",
      label: DEFAULT_TITLE,
      pageTitle: DEFAULT_TITLE,
      description:
        "Configure Azupay payments and view setup, operations and UAT documentation.",
      parentMenu: "sales",
      aclProtected: true,
      sandboxPermissions: ["allow-popups"],
    },
  },
  businessConfig: { schema: configSchema },
  installation: {
    customInstallationSteps: [
      {
        name: "Register Azupay payment method",
        description:
          "Register the AUD/Australia out-of-process payment method.",
        script: "./scripts/create-payment-methods.js",
      },
    ],
  },
  webhooks: [
    {
      category: "validation",
      env: ["saas"],
      label: "Bind Azupay native cart",
      description:
        "Bind the shopper-owned masked cart to its canonical Commerce quote.",
      requireAdobeAuth: true,
      runtimeAction: "azupay/capture-cart",
      webhook: {
        batch_name: "azupay_context",
        hook_name: "azupay_cart_capture",
        webhook_method: "observer.sales_quote_save_after",
        webhook_type: "after",
        method: "POST",
        required: false,
        timeout: 20000,
        soft_timeout: 0,
        fields: [
          { name: "quote_id", source: "data.quote.id" },
          { name: "quote_entity_id", source: "data.quote.entity_id" },
        ],
      },
    },
    {
      category: "validation",
      env: ["saas"],
      label: "Verify Azupay settlement",
      description:
        "Reject order placement unless the exact quote has been paid.",
      requireAdobeAuth: true,
      runtimeAction: "azupay/validate-payment",
      webhook: {
        batch_name: "azupay_validation",
        hook_name: "azupay_order_place_before",
        webhook_method: "observer.sales_order_place_before",
        webhook_type: "before",
        method: "POST",
        required: true,
        priority: 100,
        timeout: 20000,
        soft_timeout: 0,
        fallback_error_message:
          "Azupay payment could not be verified. Do not pay again; retry placing the order or contact support.",
        fields: [
          { name: "payment_method", source: "data.order.payment.method" },
          {
            name: "payment_additional_information",
            source: "data.order.payment.additional_information",
          },
          { name: "quote_id", source: "data.order.quote_id" },
          { name: "grand_total", source: "data.order.grand_total" },
          { name: "currency", source: "data.order.order_currency_code" },
          { name: "store_id", source: "data.order.store_id" },
        ],
        rules: [
          {
            field: "data.order.payment.method",
            operator: "equal",
            value: "azupay",
          },
        ],
      },
    },
    {
      category: "append",
      env: ["saas"],
      label: "Filter Azupay availability",
      description: "Hide Azupay when disabled or not configured for the cart.",
      requireAdobeAuth: true,
      runtimeAction: "azupay/filter-payment",
      webhook: {
        batch_name: "azupay_filter",
        hook_name: "azupay_payment_filter",
        webhook_method:
          "plugin.out_of_process_payment_methods.api.payment_method_filter.get_list",
        webhook_type: "after",
        method: "POST",
        timeout: 20000,
        soft_timeout: 0,
        fields: [{ name: "payload" }],
      },
    },
  ],
});
