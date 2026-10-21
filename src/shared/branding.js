import { DEFAULT_TITLE } from "./identity.js";
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
    DEFAULT_TITLE,
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
    for (const method of config.methods === "both"
      ? ["payid", "payto"]
      : [config.methods]) {
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
  return { title, byline, logos };
}
