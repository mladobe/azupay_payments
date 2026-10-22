export function adminConfigHandler({
  authorize,
  configAction,
  scopeAction,
  logError,
}) {
  return async (params) => {
    const method = String(params.__ow_method ?? "get").toLowerCase();
    const path = params.__ow_path ?? "/";
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    if (
      !(path === "/config" && ["get", "patch"].includes(method)) &&
      !(path === "/scopes" && method === "get")
    ) {
      logError("ADMIN_CONFIG_ROUTE_DENIED");
      return {
        statusCode: 405,
        headers,
        body: {
          error: "METHOD_NOT_ALLOWED",
          message: "This configuration operation is not available.",
        },
      };
    }
    try {
      await authorize(params);
      const handler = path === "/scopes" ? scopeAction : configAction;
      const response = await handler({ ...params, __ow_path: "/" });
      return { ...response, headers: { ...response.headers, ...headers } };
    } catch (error) {
      const statusCode = [401, 403].includes(error.status) ? error.status : 503;
      const code =
        statusCode === 403
          ? "ADMIN_CONFIG_FORBIDDEN"
          : statusCode === 401
            ? "ADMIN_CONFIG_UNAUTHORIZED"
            : "ADMIN_CONFIG_UNAVAILABLE";
      logError(code);
      return {
        statusCode,
        headers,
        body: {
          error: code,
          message:
            statusCode === 403
              ? "Your Commerce role does not have permission to configure Azupay."
              : statusCode === 401
                ? "Sign in to Commerce Admin again before configuring Azupay."
                : "Configuration is unavailable. Reload to verify saved values before retrying.",
        },
      };
    }
  };
}
