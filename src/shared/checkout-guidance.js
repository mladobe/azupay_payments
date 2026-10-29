export const DEFAULT_TERMS_LABEL = "PayTo terms and conditions";

export const paymentInstructions = {
  payid:
    "PayID: transfer the exact amount to the recipient PayID shown in bank checkout using your banking app or internet banking. Check the business name and payment details before sending. You do not need your own PayID to make this transfer. If your bank delays the transfer, check with your bank and do not send a second payment.",
  payto:
    "PayTo: connect your bank account in bank checkout, then open your banking app or internet banking to review and approve the PayTo agreement. Agreement approval alone does not confirm that payment has been received.",
};

export const DEFAULT_INSTRUCTIONS_LABEL = "How do I pay by bank?";
export const DEFAULT_INSTRUCTIONS =
  "1. Select Pay by Bank and follow the instructions for an available bank payment option.\n2. In your banking app or internet banking, check the business name, exact amount and payment details before confirming.\n3. Return to checkout. After payment is verified, select Complete your order.\n\nIf you use PayTo, approving the agreement alone does not confirm payment. If a payment is delayed, check with your bank and do not pay again.";

export function helpUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    value.length > 2048
  )
    throw new Error(
      "Help links must be absolute HTTPS URLs without credentials, up to 2048 characters.",
    );
  return url.href;
}

export function checkoutGuidanceWarnings(config) {
  const warnings = [];
  const methods = Array.isArray(config.methods)
    ? config.methods[0]
    : config.methods;
  const hasPayTo = methods === "payto" || methods === "both";
  if (
    hasPayTo &&
    !String(config.paytoTermsUrl ?? "").trim() &&
    config.paytoTermsInHostedCheckout !== true
  )
    warnings.push(
      "Before launch, configure your merchant PayTo terms URL or confirm Azupay has added those terms to hosted checkout. A generic education page is not a substitute.",
    );
  const mode = Array.isArray(config.checkoutLogoMode)
    ? config.checkoutLogoMode[0]
    : config.checkoutLogoMode;
  if (
    mode === "none" ||
    (mode === "official" && config.officialLogoPermission !== true)
  )
    warnings.push(
      "Azupay's UX guides require appropriate approved payment marks. Enable permitted official logos or configure suitable approved custom images before launch.",
    );
  return warnings;
}
