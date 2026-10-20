export function wrapAppConfig(handler, enabled = true, omitWebhooks = false) {
  if (
    typeof handler !== "function" ||
    typeof enabled !== "boolean" ||
    typeof omitWebhooks !== "boolean"
  ) {
    throw new TypeError(
      "App-config compatibility requires a handler and boolean flags.",
    );
  }
  return async (params) => {
    const response = await handler(params);
    const method = params?.__ow_method ?? "get";
    const path = params?.__ow_path ?? "/";
    if (
      enabled &&
      typeof method === "string" &&
      method.toUpperCase() === "GET" &&
      ["", "/"].includes(path) &&
      response?.statusCode === 200 &&
      response.body !== null &&
      typeof response.body === "object" &&
      !Array.isArray(response.body) &&
      (Object.hasOwn(response.body, "openApiSpecUrl") ||
        (omitWebhooks && Object.hasOwn(response.body, "webhooks")))
    ) {
      const body = { ...response.body };
      const omitted = [];
      for (const key of [
        "openApiSpecUrl",
        ...(omitWebhooks ? ["webhooks"] : []),
      ]) {
        if (Object.hasOwn(body, key)) {
          delete body[key];
          omitted.push(key);
        }
      }
      console.info(`App-config compatibility: omitted ${omitted.join(", ")}.`);
      return { ...response, body };
    }
    return response;
  };
}
