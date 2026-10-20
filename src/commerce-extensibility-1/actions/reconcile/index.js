import { logError, runtimeService } from "../../../shared/runtime.js";

export async function main(params) {
  try {
    const service = await runtimeService(params);
    const result = await service.reconcile();
    if (result.failures.length) {
      // Failing the activation lets Runtime monitoring alert on partial batch failures.
      return { error: "Azupay reconciliation requires attention.", ...result };
    }
    return result;
  } catch (error) {
    logError(error.code || "RECONCILIATION_FAILED");
    return { error: error.code || "RECONCILIATION_FAILED" };
  }
}
