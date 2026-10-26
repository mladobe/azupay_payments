import { educationLinks } from "./checkout-guidance.js";
import { DEFAULT_CHECKOUT_TITLE } from "./identity.js";

export const configSchema = [
  {
    name: "enabled",
    label: "Enable Azupay",
    type: "boolean",
    default: false,
    description:
      "Turn on only after UAT succeeds. Off hides Azupay and prevents new sessions; already-paid sessions can still be verified.",
  },
  {
    name: "environment",
    label: "Azupay environment",
    type: "list",
    selectionMode: "single",
    default: "uat",
    options: [
      { label: "Staging / UAT (test money)", value: "uat" },
      { label: "Production (real money)", value: "production" },
    ],
    description:
      "Use UAT while building and testing. Production uses different credentials and requires AZUPAY_ALLOW_PRODUCTION=true in the deployed .env.",
  },
  {
    name: "methods",
    label: "Payment methods",
    type: "list",
    selectionMode: "single",
    default: "payid",
    options: [
      { label: "PayID only", value: "payid" },
      { label: "PayTo only", value: "payto" },
      { label: "PayID and PayTo", value: "both" },
    ],
    description:
      "Selects the matching secure credential profile, for example AZUPAY_UAT_PAYTO_*. Ask Azupay to provision that client and configure its hosted checkout to show exactly these options. Selecting PayTo does not enable PayTo on your Azupay account.",
  },
  {
    name: "productionConfirmed",
    label: "Production approval completed",
    type: "boolean",
    default: false,
    description:
      "For real payments, confirm Azupay has approved production, PayTo is enabled where needed, and the selected profile has passed your UAT checklist. Also enable the deployment-level production gate.",
  },
  {
    name: "expiryMinutes",
    label: "Payment request expiry (minutes)",
    type: "text",
    default: "30",
    description:
      "Enter a whole number from 5 to 120. Customers must pay before this expires. Do not change their cart while paying. Expired requests are not automatically replaced or charged again.",
  },
  {
    name: "autoInvoice",
    label: "Automatically invoice paid orders",
    type: "boolean",
    default: false,
    description:
      "Invoices verified paid orders on the next scheduled reconciliation (every 5 minutes), not immediately when the bank payment finishes. The deployed reconciliation timer must be active. No second bank debit is collected. Leave off for manual invoicing.",
  },
  {
    name: "checkoutPresentation",
    label: "Checkout experience",
    type: "list",
    selectionMode: "single",
    default: "redirect",
    options: [
      { label: "Full redirect (recommended default)", value: "redirect" },
      { label: "Modal window (embedded Azupay checkout)", value: "modal" },
    ],
    description:
      "Full redirect opens Azupay in the current tab and returns to checkout. Modal keeps checkout behind an embedded payment window, with a full-page option if needed. Allow the Azupay checkout host in storefront frame-src CSP and test your enabled banks, mobile browsers and PayTo/passkeys first. Closing a modal does not cancel a bank payment. Applies to new payment sessions; saved sessions keep their original experience.",
  },
  {
    name: "checkoutTitle",
    label: "Checkout payment title",
    type: "text",
    default: DEFAULT_CHECKOUT_TITLE,
    description:
      "Name shown for this payment method in the checkout selector. Pay by Bank is recommended by Azupay's UX guides. Enter plain text, up to 100 characters. Existing custom titles are preserved. Refresh checkout after saving.",
  },
  {
    name: "checkoutGuidanceEnabled",
    label: "Show PayID / PayTo payment instructions",
    type: "boolean",
    default: true,
    description:
      "Shows instructions only for your enabled methods. PayID uses the recipient PayID displayed in hosted checkout. PayTo requires approval of a PayTo agreement in the customer's bank. Education and terms links below are separate from the instructions.",
  },
  {
    name: "paytoTermsInHostedCheckout",
    label: "Merchant PayTo terms are available in hosted checkout",
    type: "boolean",
    default: false,
    description:
      "Confirm only after Azupay has added your merchant-specific PayTo terms to its hosted checkout. Otherwise set the PayTo terms URL below before launch. A generic help article is not a substitute for your terms. Acceptance and bank authorisation remain in the hosted flow.",
  },
  ...educationLinks.flatMap((link) => [
    {
      name: `${link.name}Url`,
      label: `${link.label} URL`,
      type: "text",
      default: link.url,
      description:
        link.name === "paytoTerms"
          ? "Public HTTPS URL for your own merchant PayTo terms. Required before launch unless confirmed in hosted checkout. Leave blank only while preparing UAT; configure per store scope. No API keys or HTML."
          : "Customer-facing HTTPS education link. Replace with your own help page if preferred, or clear to hide this link. Only shown when its payment method is enabled. No API keys or HTML. Refresh checkout after saving.",
    },
    {
      name: `${link.name}Label`,
      label: `${link.label} link text`,
      type: "text",
      default: link.label,
      description:
        "Accessible plain-text link label, up to 100 characters. Required when its URL is set. Links open in a new tab so the customer's checkout stays available.",
    },
  ]),
  {
    name: "checkoutByline",
    label: "Checkout payment byline",
    type: "text",
    default: "Pay securely from your bank account.",
    description:
      "Short explanation shown beneath the selected payment method, up to 250 characters. Leave blank to hide it. HTML is not supported.",
  },
  {
    name: "checkoutLogoMode",
    label: "Checkout logos",
    type: "list",
    selectionMode: "single",
    default: "official",
    options: [
      {
        label: "Official PayID / PayTo logos (permission required)",
        value: "official",
      },
      { label: "Custom hosted images", value: "custom" },
      { label: "No images", value: "none" },
    ],
    description:
      "Official mode shows only the logos matching your selected payment methods after permission is confirmed. Choose custom to display up to three images uploaded to your own media library.",
  },
  {
    name: "officialLogoPermission",
    label: "Permission to use official PayID / PayTo logos",
    type: "boolean",
    default: false,
    description:
      "Enable only when your AP+ or payment-provider agreement permits use of these marks. Official logos are not loaded until confirmed. Follow the brand portal guidelines; public download access is not permission.",
  },
  ...[1, 2, 3].flatMap((index) => [
    {
      name: `checkoutLogo${index}Url`,
      label: `Custom checkout image ${index} URL`,
      type: "text",
      default: "",
      description:
        "Optional. Upload your approved logo to your website's media library, then paste its public HTTPS image URL here. Select Custom hosted images above. No direct file upload or HTML; allow its host in storefront img-src CSP.",
    },
    {
      name: `checkoutLogo${index}Alt`,
      label: `Custom checkout image ${index} description`,
      type: "text",
      default: "",
      description:
        "Required when this image URL is set. Enter accessible text such as PayID, PayTo or your business name, up to 100 characters. Do not use decorative HTML.",
    },
  ]),
];
