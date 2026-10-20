import {
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import { logError, runtimeDependencies } from "../../../shared/runtime.js";

export async function main(params) {
  try {
    const deps = await runtimeDependencies(params);
    await deps.cartContext.capture(params);
    return ok(successOperation());
  } catch (error) {
    const code = error.code || "CART_CAPTURE_FAILED";
    const status = error.response?.status;
    logError(code, { status });
    return ok(
      exceptionOperation(
        `Azupay could not bind the native cart (${code}${status ? `, HTTP ${status}` : ""}). Retry checkout before paying.`,
      ),
    );
  }
}
