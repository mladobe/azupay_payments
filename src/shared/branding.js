import {
  DEFAULT_INSTRUCTIONS,
  DEFAULT_INSTRUCTIONS_LABEL,
  DEFAULT_TERMS_LABEL,
  helpUrl,
} from "./checkout-guidance.js";
import { DEFAULT_CHECKOUT_TITLE } from "./identity.js";
import { requireValue } from "./payment.js";

export { DEFAULT_TITLE } from "./identity.js";
export const DEFAULT_BYLINE = "Pay securely from your bank account.";
const OFFICIAL_LOGOS = {
  payid: {
    url: "https://firebasestorage.googleapis.com/v0/b/standards-site-beta.appspot.com/o/documents%2Fb2wlf9qkqnr%2Fjmu8y36dofl%2FPayID_wordmark-Black.png?alt=media&token=350d4df0-1bfb-4f10-ba59-ac6eccb09003",
    alt: "PayID",
  },
  payto: {
    url: "https://firebasestorage.googleapis.com/v0/b/standards-site-beta.appspot.com/o/documents%2Fb2wlf9qkqnr%2Fsf42xawt4iv%2FPayTo_wordmark-Black-WEB-01.png?alt=media&token=06a1c142-7c0f-48cc-b02b-8fcc334986d8",
    alt: "PayTo",
  },
};

function text(value, fallback, maximum, name) {
  const result = value === undefined ? fallback : value;
  requireValue(
    typeof result === "string" && result.length <= maximum,
    "INVALID_BRANDING",
    `${name} must be text with at most ${maximum} characters.`,
  );
  return result.trim();
}

export function logoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Payment logo must use an absolute HTTPS image URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    value.length > 2048
  )
    throw new Error(
      "Payment logo must use an absolute HTTPS image URL without credentials or a fragment.",
    );
  return url.href;
}

export function brandingSettings(config) {
  const title = text(
    config.checkoutTitle,
    DEFAULT_CHECKOUT_TITLE,
    100,
    "Checkout title",
  );
  requireValue(title.length > 0, "INVALID_BRANDING", "Enter a checkout title.");
  const byline = text(
    config.checkoutByline,
    DEFAULT_BYLINE,
    250,
    "Checkout byline",
  );
  const methods =
    Array.isArray(config.methods) && config.methods.length === 1
      ? config.methods[0]
      : (config.methods ?? "payid");
  requireValue(
    ["payid", "payto", "both"].includes(methods),
    "INVALID_BRANDING",
    "Choose a valid payment method.",
  );
  const enabledMethods = methods === "both" ? ["payid", "payto"] : [methods];
  const selected = config.checkoutLogoMode ?? "official";
  const mode =
    Array.isArray(selected) && selected.length === 1 ? selected[0] : selected;
  requireValue(
    ["official", "custom", "none"].includes(mode),
    "INVALID_BRANDING",
    "Choose one valid checkout logo mode.",
  );
  const logos = [];
  if (mode === "official" && config.officialLogoPermission === true) {
    for (const method of enabledMethods) {
      requireValue(
        method in OFFICIAL_LOGOS,
        "INVALID_BRANDING",
        "Choose a valid payment method before enabling official logos.",
      );
      logos.push(OFFICIAL_LOGOS[method]);
    }
  }
  if (mode === "custom") {
    for (let index = 1; index <= 3; index += 1) {
      const value = text(
        config[`checkoutLogo${index}Url`],
        "",
        2048,
        `Logo ${index} URL`,
      );
      if (!value) continue;
      let url;
      try {
        url = logoUrl(value);
      } catch (error) {
        requireValue(false, "INVALID_BRANDING", error.message);
      }
      const alt = text(
        config[`checkoutLogo${index}Alt`],
        "",
        100,
        `Logo ${index} description`,
      );
      requireValue(
        alt.length > 0,
        "INVALID_BRANDING",
        `Enter an accessible description for logo ${index}.`,
      );
      logos.push({ url, alt });
    }
  }
  const links = [];
  const termsUrl = enabledMethods.includes("payto")
    ? text(config.paytoTermsUrl, "", 2048, "PayTo terms URL")
    : "";
  if (termsUrl) {
    let url;
    try {
      url = helpUrl(termsUrl);
    } catch (error) {
      requireValue(false, "INVALID_BRANDING", error.message);
    }
    const label = text(
      config.paytoTermsLabel,
      DEFAULT_TERMS_LABEL,
      100,
      "PayTo terms link text",
    );
    requireValue(
      label.length > 0,
      "INVALID_BRANDING",
      "Enter link text for the PayTo terms URL.",
    );
    links.push({
      method: "payto",
      label,
      url,
      kind: "terms",
    });
  }
  requireValue(
    config.checkoutGuidanceEnabled === undefined ||
      typeof config.checkoutGuidanceEnabled === "boolean",
    "INVALID_BRANDING",
    "Choose a valid payment instructions setting.",
  );
  const instructions = text(
    config.checkoutInstructions,
    DEFAULT_INSTRUCTIONS,
    4000,
    "Payment instructions",
  );
  const instructionsLabel = text(
    config.checkoutInstructionsLabel,
    DEFAULT_INSTRUCTIONS_LABEL,
    100,
    "Payment instructions label",
  );
  requireValue(
    !instructions || instructionsLabel.length > 0,
    "INVALID_BRANDING",
    "Enter a label for the payment instructions.",
  );
  return {
    title,
    byline,
    logos,
    guidance: {
      methods: enabledMethods,
      showInstructions: config.checkoutGuidanceEnabled ?? true,
      tooltip: { label: instructionsLabel, text: instructions },
      links,
    },
  };
}
