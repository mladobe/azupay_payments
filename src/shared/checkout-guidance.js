export const educationLinks = [
  {
    name: "payidEducation",
    method: "payid",
    label: "About paying with PayID",
    url: "https://9191330.fs1.hubspotusercontent-na1.net/hubfs/9191330/HowTo1.jpg",
  },
  {
    name: "payidInstructions",
    method: "payid",
    label: "PayID step-by-step instructions",
    url: "https://9191330.fs1.hubspotusercontent-na1.net/hubfs/9191330/PayID%20Instructions%20FINAL.jpg",
  },
  {
    name: "payidBenefits",
    method: "payid",
    label: "Benefits of PayID",
    url: "https://9191330.fs1.hubspotusercontent-na1.net/hubfs/9191330/PayID%20Benefits%20FINAL.jpg",
  },
  {
    name: "payidLearnMore",
    method: "payid",
    label: "Learn more about PayID",
    url: "https://9191330.fs1.hubspotusercontent-na1.net/hubfs/9191330/PayID%20Learn%20More%20FINAL.jpg",
  },
  {
    name: "paytoInstructions",
    method: "payto",
    label: "How to approve a PayTo agreement in your bank",
    url: "https://info.azupay.com.au/payto-banking-instructions",
  },
  {
    name: "paytoTerms",
    method: "payto",
    label: "PayTo terms and conditions",
    url: "",
  },
];

export const paymentInstructions = {
  payid:
    "PayID: transfer the exact amount to the recipient PayID shown in Azupay checkout using your banking app or internet banking. Check the business name and payment details before sending. You do not need your own PayID to make this transfer. If your bank delays the transfer, check with your bank and do not send a second payment.",
  payto:
    "PayTo: connect your bank account in Azupay checkout, then open your banking app or internet banking to review and approve the PayTo agreement. Agreement approval alone does not confirm that payment has been received.",
};

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
