import { PaymentError } from "./payment.js";

export function azupayClient(profile, fetcher = fetch) {
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetcher(`${profile.baseUrl}${path}`, {
        ...options,
        headers: {
          Authorization: profile.apiKey,
          "Content-Type": "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new PaymentError(
        "AZUPAY_UNAVAILABLE",
        "Azupay could not be reached. Retry the same checkout; do not start another payment.",
        502,
      );
    }
    if (!response.ok) {
      throw new PaymentError(
        "AZUPAY_API_ERROR",
        `Azupay returned HTTP ${response.status}. Contact support if a payment has already been made.`,
        502,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new PaymentError(
        "AZUPAY_INVALID_RESPONSE",
        "Azupay returned an invalid response.",
        502,
      );
    }
  }
  return {
    create: (paymentRequest) =>
      request("/paymentRequest", {
        method: "POST",
        body: JSON.stringify({ PaymentRequest: paymentRequest }),
      }),
    get: (id) => request(`/paymentRequest?id=${encodeURIComponent(id)}`),
  };
}
