import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const profileChoices = {
  environment: ["uat", "production"],
  methods: ["payid", "payto", "both"],
};

export class PaymentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.status = status;
  }
}

export function requireValue(condition, code, message, status = 400) {
  if (!condition) throw new PaymentError(code, message, status);
}

export function minorUnits(value) {
  const text = String(value);
  requireValue(
    /^\d+(\.\d{1,2}0*)?$/.test(text),
    "INVALID_AMOUNT",
    "Amount must be a non-negative AUD amount with at most two decimal places.",
  );
  const [whole, decimals = ""] = text.split(".");
  const cents =
    Number(whole) * 100 + Number(decimals.padEnd(2, "0").slice(0, 2));
  requireValue(
    Number.isSafeInteger(cents),
    "INVALID_AMOUNT",
    "Amount exceeds the supported range.",
  );
  return cents;
}

export function normalizePaymentConfig(config) {
  const normalized = { ...config };
  for (const [name, choices] of Object.entries(profileChoices)) {
    const value = normalized[name];
    const selected = Array.isArray(value) ? value : [value];
    requireValue(
      selected.length === 1 &&
        typeof selected[0] === "string" &&
        choices.includes(selected[0]),
      "INVALID_PROFILE",
      `Select exactly one valid ${name} option in Commerce configuration.`,
      503,
    );
    normalized[name] = selected[0];
  }
  return normalized;
}

export function selectProfile(params, environment, methods) {
  requireValue(
    profileChoices.environment.includes(environment) &&
      profileChoices.methods.includes(methods),
    "INVALID_PROFILE",
    "Select a valid Azupay environment and payment experience.",
  );
  requireValue(
    environment !== "production" || params.AZUPAY_ALLOW_PRODUCTION === "true",
    "PRODUCTION_BLOCKED",
    "Production is disabled in this deployment.",
    503,
  );
  const prefix = `AZUPAY_${environment.toUpperCase()}_${methods.toUpperCase()}`;
  const clientId = params[`${prefix}_CLIENT_ID`];
  const apiKey = params[`${prefix}_API_KEY`];
  requireValue(
    typeof clientId === "string" &&
      clientId.trim().length > 0 &&
      typeof apiKey === "string" &&
      apiKey.trim().length > 0,
    "PROFILE_NOT_CONFIGURED",
    "The selected Azupay credential profile is not configured. Contact the store administrator.",
    503,
  );
  return {
    clientId,
    apiKey,
    baseUrl:
      environment === "uat"
        ? "https://api-uat.azupay.com.au/v1"
        : "https://api.azupay.com.au/v1",
  };
}

export function newSessionSettings(config, params) {
  signingKey(params);
  requireValue(config.enabled === true, "DISABLED", "Azupay is disabled.", 503);
  requireValue(
    config.environment !== "production" || config.productionConfirmed === true,
    "PRODUCTION_NOT_CONFIRMED",
    "Complete production approval in Commerce configuration.",
    503,
  );
  const expiry = String(config.expiryMinutes);
  requireValue(
    /^\d+$/.test(expiry) && Number(expiry) >= 5 && Number(expiry) <= 120,
    "INVALID_EXPIRY",
    "Payment expiry must be a whole number between 5 and 120 minutes.",
    503,
  );
  const value = config.checkoutPresentation ?? "redirect";
  const presentation =
    Array.isArray(value) && value.length === 1 ? value[0] : value;
  requireValue(
    ["redirect", "modal"].includes(presentation),
    "INVALID_CHECKOUT_PRESENTATION",
    "Choose exactly one valid checkout experience in Commerce configuration.",
    503,
  );
  return {
    profile: selectProfile(params, config.environment, config.methods),
    expiryMinutes: Number(expiry),
    checkoutPresentation: presentation,
  };
}

function signingKey(params) {
  requireValue(
    typeof params.AZUPAY_SIGNING_SECRET === "string" &&
      /^[a-f0-9]{64,}$/i.test(params.AZUPAY_SIGNING_SECRET),
    "SIGNING_NOT_CONFIGURED",
    "Configure a signing secret containing at least 32 random bytes in hexadecimal.",
    503,
  );
  return params.AZUPAY_SIGNING_SECRET;
}

export function signReceipt(data, params) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", signingKey(params))
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyReceipt(
  token,
  params,
  { now = Date.now(), checkExpiry = true } = {},
) {
  requireValue(
    typeof token === "string" && token.length < 6000,
    "INVALID_RECEIPT",
    "The payment receipt is missing or invalid.",
  );
  const [payload, supplied, extra] = token.split(".");
  requireValue(
    payload && supplied && !extra && /^[A-Za-z0-9_-]+$/.test(supplied),
    "INVALID_RECEIPT",
    "The payment receipt is invalid.",
  );
  const expected = createHmac("sha256", signingKey(params))
    .update(payload)
    .digest();
  const received = Buffer.from(supplied, "base64url");
  requireValue(
    expected.length === received.length && timingSafeEqual(expected, received),
    "INVALID_RECEIPT",
    "The payment receipt signature is invalid.",
  );
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new PaymentError(
      "INVALID_RECEIPT",
      "The payment receipt is malformed.",
    );
  }
  requireValue(
    data?.version === 1 &&
      Number.isSafeInteger(data.quoteId) &&
      data.quoteId > 0 &&
      Number.isSafeInteger(data.storeId) &&
      data.storeId > 0 &&
      Number.isSafeInteger(data.amount) &&
      data.amount > 0 &&
      typeof data.transactionId === "string" &&
      typeof data.requestId === "string" &&
      Number.isSafeInteger(data.expiresAt),
    "INVALID_RECEIPT",
    "The payment receipt has invalid fields.",
  );
  requireValue(
    !checkExpiry || data.expiresAt > now,
    "RECEIPT_EXPIRED",
    "The receipt has expired. Contact support to reconcile your payment; do not pay again.",
    409,
  );
  return data;
}

export function transactionId(quote, environment, methods) {
  return `commerce-${createHash("sha256")
    .update(
      JSON.stringify([
        Number(quote.id),
        Number(quote.store_id),
        minorUnits(quote.grand_total),
        environment,
        methods,
      ]),
    )
    .digest("hex")}`;
}

export function receiptFromInfo(info) {
  requireValue(
    info && typeof info === "object",
    "MISSING_PAYMENT_INFO",
    "Azupay payment information is missing.",
  );
  if (!Array.isArray(info)) return info.azupay_receipt;
  const entries = info
    .map((item) =>
      typeof item === "string"
        ? item
        : item?.key === "azupay_receipt"
          ? item.value
          : undefined,
    )
    .filter(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value),
    );
  requireValue(
    entries.length === 1,
    "INVALID_RECEIPT",
    "Exactly one signed Azupay receipt is required.",
  );
  return entries[0];
}

export function assertOrderMatches(receipt, order) {
  requireValue(
    Number(order.quote_id) === receipt.quoteId &&
      Number(order.store_id) === receipt.storeId &&
      order.currency === "AUD" &&
      minorUnits(order.grand_total) === receipt.amount,
    "ORDER_MISMATCH",
    "The cart or order does not match this payment. Contact support; do not pay again.",
    409,
  );
}

export function assertPaymentMatches(
  receipt,
  result,
  profile,
  requirePaid = true,
) {
  const request = result?.PaymentRequest;
  const status = result?.PaymentRequestStatus;
  requireValue(
    request?.clientId === profile.clientId &&
      request?.clientTransactionId === receipt.transactionId &&
      status?.paymentRequestId === receipt.requestId &&
      request?.multiPayment !== true &&
      minorUnits(request?.paymentAmount) === receipt.amount,
    "PAYMENT_MISMATCH",
    "Azupay returned a payment that does not match this checkout.",
    409,
  );
  if (!requirePaid) return status;
  requireValue(
    status.status === "COMPLETE",
    "PAYMENT_NOT_COMPLETE",
    "Payment is not settled. Complete the bank payment or contact support; do not pay again.",
    409,
  );
  requireValue(
    minorUnits(status.amountReceived) === receipt.amount &&
      (receipt.methods === "both"
        ? ["PayID", "PayTo"].includes(status.settledBy)
        : status.settledBy ===
          (receipt.methods === "payid" ? "PayID" : "PayTo")),
    "SETTLEMENT_MISMATCH",
    "The received amount or payment method does not match. Contact support for reconciliation.",
    409,
  );
  return status;
}

export function safeCheckoutUrl(value, params, returnUrl) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentError(
      "INVALID_CHECKOUT_URL",
      "Azupay did not return a valid checkout URL.",
      502,
    );
  }
  const hosts = String(params.AZUPAY_CHECKOUT_HOSTS || "")
    .split(",")
    .map((host) => host.trim());
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname),
    "INVALID_CHECKOUT_URL",
    "The hosted checkout URL is not on the configured Azupay allowlist.",
    502,
  );
  if (returnUrl) url.searchParams.set("redirectURL", returnUrl);
  return url.href;
}
