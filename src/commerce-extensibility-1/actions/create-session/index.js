import {
  errorResponse,
  publicRequest,
  validateReturnUrl,
} from "../../../shared/http.js";
import { runtimeService } from "../../../shared/runtime.js";

export async function main(params) {
  let headers;
  try {
    const request = publicRequest(params);
    headers = request.headers;
    if (request.preflight) return { statusCode: 204, headers };
    const returnUrl = validateReturnUrl(params.returnUrl, request.origin);
    const service = await runtimeService(params);
    const body = await service.createSession({
      cartId: params.cartId,
      returnUrl,
      storeCode: params.storeCode,
      authorization: params.__ow_headers?.authorization,
    });
    return { statusCode: 200, headers, body };
  } catch (error) {
    return errorResponse(error, headers);
  }
}
