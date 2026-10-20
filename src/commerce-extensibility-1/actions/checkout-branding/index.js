import { brandingSettings } from "../../../shared/branding.js";
import { errorResponse, publicRequest } from "../../../shared/http.js";
import { requireValue } from "../../../shared/payment.js";
import { runtimeDependencies } from "../../../shared/runtime.js";

export async function main(params) {
  let headers = {};
  try {
    const request = publicRequest(params);
    headers = request.headers;
    if (request.preflight) return { statusCode: 204, headers };
    const storeCode = params.storeCode ?? "default";
    requireValue(
      typeof storeCode === "string" && /^[A-Za-z0-9_]{1,64}$/.test(storeCode),
      "INVALID_STORE",
      "Provide a valid Commerce store-view code.",
    );
    const deps = await runtimeDependencies(params);
    const storeId = await deps.commerce.storeIdByCode(storeCode);
    const config = await deps.getConfig(storeId);
    return { statusCode: 200, headers, body: brandingSettings(config) };
  } catch (error) {
    return errorResponse(error, headers);
  }
}
