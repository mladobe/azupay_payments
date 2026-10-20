import { PaymentError, requireValue } from "./payment.js";
import { logError } from "./runtime.js";

export function publicRequest(params) {
  const origin = params.__ow_headers?.origin;
  const allowed = String(params.AZUPAY_STOREFRONT_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  requireValue(
    typeof origin === "string" &&
      allowed.includes(origin) &&
      new URL(origin).protocol === "https:",
    "ORIGIN_DENIED",
    "Use the configured HTTPS storefront to access checkout.",
    403,
  );
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    vary: "Origin",
  };
  const method = params.__ow_method?.toUpperCase();
  requireValue(
    ["POST", "OPTIONS"].includes(method),
    "METHOD_NOT_ALLOWED",
    "Use POST for checkout requests.",
    405,
  );
  return { headers, preflight: method === "OPTIONS", origin };
}

export function validateReturnUrl(value, origin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentError(
      "INVALID_RETURN_URL",
      "Provide a valid HTTPS storefront return URL.",
    );
  }
  requireValue(
    url.origin === origin && !url.username && !url.password,
    "INVALID_RETURN_URL",
    "The return URL must be on this storefront's origin.",
  );
  requireValue(
    !url.search && !url.hash,
    "INVALID_RETURN_URL",
    "Use a return page URL without query parameters or a fragment.",
  );
  return url.href;
}

export function errorResponse(error, headers = {}) {
  const known = error instanceof PaymentError;
  const code = known ? error.code : "INTERNAL_ERROR";
  logError(code);
  return {
    statusCode: known ? error.status : 500,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
    body: {
      error: code,
      message: known
        ? error.message
        : "Payment could not be processed. Contact support if you have paid; do not pay again.",
    },
  };
}
