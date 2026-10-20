import { errorResponse, publicRequest } from "../../../shared/http.js";
import { runtimeService } from "../../../shared/runtime.js";

export async function main(params) {
  let headers;
  try {
    const request = publicRequest(params);
    headers = request.headers;
    if (request.preflight) return { statusCode: 204, headers };
    const service = await runtimeService(params);
    const body = await service.status(params.receipt);
    return { statusCode: 200, headers, body };
  } catch (error) {
    return errorResponse(error, headers);
  }
}
