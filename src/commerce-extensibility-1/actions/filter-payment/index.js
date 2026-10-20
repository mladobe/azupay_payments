import {
  addOperation,
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import { newSessionSettings, requireValue } from "../../../shared/payment.js";
import { logError, runtimeDependencies } from "../../../shared/runtime.js";

export async function main(params) {
  try {
    const storeId = Number(params.payload?.cart?.store_id);
    requireValue(
      Number.isSafeInteger(storeId) && storeId > 0,
      "MISSING_FILTER_STORE",
      "The Azupay availability webhook needs payload.cart.store_id.",
    );
    const deps = await runtimeDependencies(params);
    const config = await deps.getConfig(storeId);
    if (config.enabled !== true)
      return ok(addOperation("result", { code: "azupay" }));
    newSessionSettings(config, params);
    return ok(successOperation());
  } catch (error) {
    logError(error.code || "FILTER_FAILED");
    // Do not return a success-shaped availability result when configuration is broken.
    return ok(
      exceptionOperation(
        "Azupay availability could not be checked. Contact the store administrator.",
      ),
    );
  }
}
