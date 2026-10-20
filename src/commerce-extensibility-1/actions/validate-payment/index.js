import {
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import { PaymentError } from "../../../shared/payment.js";
import { logError, runtimeService } from "../../../shared/runtime.js";

export async function main(params) {
  try {
    if (params.payment_method !== "azupay") return ok(successOperation());
    const service = await runtimeService(params);
    await service.validate(params);
    return ok(successOperation());
  } catch (error) {
    logError(error instanceof PaymentError ? error.code : "VALIDATION_FAILED");
    return ok(
      exceptionOperation(
        error instanceof PaymentError
          ? error.message
          : "Azupay verification is unavailable. Retry order placement; do not pay again.",
      ),
    );
  }
}
