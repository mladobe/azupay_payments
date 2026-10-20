import {
  assertOrderMatches,
  assertPaymentMatches,
  minorUnits,
  newSessionSettings,
  receiptFromInfo,
  requireValue,
  safeCheckoutUrl,
  selectProfile,
  signReceipt,
  transactionId,
  verifyReceipt,
} from "./payment.js";

export function paymentService(deps) {
  const { params, commerce, getConfig, azupay, now = Date.now } = deps;
  return {
    async createSession(input) {
      requireValue(
        typeof input.cartId === "string" &&
          /^[A-Za-z0-9_-]{16,128}$/.test(input.cartId),
        "INVALID_CART",
        "A valid masked Commerce cart ID is required.",
      );
      const quote = await commerce.getQuote(input.cartId, {
        storeCode: input.storeCode,
        authorization: input.authorization,
      });
      requireValue(
        quote.is_active === true &&
          Number.isSafeInteger(Number(quote.id)) &&
          Number(quote.id) > 0 &&
          Number.isSafeInteger(Number(quote.store_id)) &&
          Number(quote.store_id) > 0,
        "INACTIVE_CART",
        "The cart is not active.",
        409,
      );
      requireValue(
        quote.quote_currency_code === "AUD",
        "UNSUPPORTED_CURRENCY",
        "Azupay accepts AUD only.",
      );
      requireValue(
        quote.billing_address?.country_id === "AU" &&
          (quote.is_virtual === true ||
            quote.shipping_address?.country_id === "AU"),
        "UNSUPPORTED_COUNTRY",
        "Set an Australian billing and shipping address before paying.",
      );
      const amount = minorUnits(quote.grand_total);
      requireValue(
        amount > 0,
        "INVALID_AMOUNT",
        "Use another payment method for zero-value carts.",
      );
      const config = await getConfig(Number(quote.store_id));
      const { profile, expiryMinutes, checkoutPresentation } =
        newSessionSettings(config, params);
      const id = transactionId(quote, config.environment, config.methods);
      const result = await azupay(profile).create({
        clientId: profile.clientId,
        clientTransactionId: id,
        paymentAmount: amount / 100,
        paymentDescription: `Commerce checkout ${quote.id}`,
        multiPayment: false,
        paymentExpiryDatetime: new Date(
          now() + expiryMinutes * 60000,
        ).toISOString(),
      });
      const receipt = {
        version: 1,
        quoteId: Number(quote.id),
        storeId: Number(quote.store_id),
        amount,
        transactionId: id,
        environment: config.environment,
        methods: config.methods,
        requestId: result?.PaymentRequestStatus?.paymentRequestId,
        expiresAt: now() + 7 * 24 * 60 * 60 * 1000,
      };
      requireValue(
        typeof receipt.requestId === "string" && receipt.requestId.length > 0,
        "INVALID_PROVIDER_RESPONSE",
        "Azupay did not return a payment request ID.",
        502,
      );
      assertPaymentMatches(receipt, result, profile, false);
      const state = result.PaymentRequestStatus.status;
      requireValue(
        ["WAITING", "COMPLETE"].includes(state),
        "REQUEST_CLOSED",
        "This cart already has a closed payment request. Contact support before paying again.",
        409,
      );
      const checkoutUrl = safeCheckoutUrl(
        result.PaymentRequest.checkoutUrl,
        params,
        input.returnUrl,
      );
      return {
        receipt: signReceipt(receipt, params),
        checkoutUrl,
        amount: amount / 100,
        currency: "AUD",
        methods: config.methods,
        environment: config.environment,
        checkoutPresentation,
      };
    },
    async status(token) {
      const receipt = verifyReceipt(token, params, { now: now() });
      const profile = selectProfile(
        params,
        receipt.environment,
        receipt.methods,
      );
      const result = await azupay(profile).get(receipt.requestId);
      const status = assertPaymentMatches(receipt, result, profile, false);
      if (status.status === "COMPLETE")
        assertPaymentMatches(receipt, result, profile);
      return { status: status.status, paid: status.status === "COMPLETE" };
    },
    async validate(order, { checkExpiry = true } = {}) {
      requireValue(
        order.payment_method === "azupay",
        "WRONG_METHOD",
        "This is not an Azupay order.",
      );
      const receipt = verifyReceipt(
        receiptFromInfo(order.payment_additional_information),
        params,
        {
          now: now(),
          checkExpiry,
        },
      );
      assertOrderMatches(receipt, order);
      const profile = selectProfile(
        params,
        receipt.environment,
        receipt.methods,
      );
      const result = await azupay(profile).get(receipt.requestId);
      assertPaymentMatches(receipt, result, profile);
      return receipt;
    },
    async reconcile() {
      // Collect IDs before invoicing so pagination cannot skip orders as status changes.
      const orders = await commerce.pendingOrders();
      const failures = [];
      let invoiced = 0;
      for (const order of orders) {
        if (order.payment?.method !== "azupay") continue;
        try {
          const config = await getConfig(Number(order.store_id));
          if (config.autoInvoice !== true) continue;
          await this.validate(
            {
              payment_method: order.payment.method,
              payment_additional_information:
                order.payment.additional_information,
              quote_id: order.quote_id,
              store_id: order.store_id,
              grand_total: order.grand_total,
              currency: order.order_currency_code,
            },
            { checkExpiry: false },
          );
          requireValue(
            minorUnits(order.total_paid || 0) === 0 &&
              minorUnits(order.total_invoiced || 0) === 0,
            "MANUAL_RECONCILIATION",
            "Order has a partial payment or invoice; reconcile it manually.",
            409,
          );
          await commerce.invoice(order.entity_id);
          invoiced += 1;
        } catch (error) {
          const code = error.code || "RECONCILIATION_FAILED";
          deps.logError(code, { orderId: order.entity_id });
          failures.push({ orderId: order.entity_id, code });
        }
      }
      return { inspected: orders.length, invoiced, failures };
    },
  };
}
