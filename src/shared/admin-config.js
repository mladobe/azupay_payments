export function adminConfigHandler({
  authorize,
  configAction,
  scopeAction,
  getCommerceInstance,
  syncScopes,
  registerPaymentStores,
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
      !(path === "/scopes" && method === "get") &&
      !(path === "/scopes/sync" && method === "post")
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
      const auth = await authorize(params);
      if (path === "/scopes/sync") {
        if (!auth) {
          const error = new Error(
            "Signed-in admin authentication is required.",
          );
          error.status = 401;
          throw error;
        }
        const instance = await getCommerceInstance();
        const result = await syncScopes({
          auth,
          config: { baseUrl: instance.baseUrl, flavor: instance.env },
          fetchOptions: { timeout: 20000, retry: 0 },
        });
        if (
          result.error ||
          result.synced !== true ||
          !Array.isArray(result.scopeTree) ||
          !result.scopeTree.length
        )
          throw new Error("Commerce scopes could not be synchronized.");
        const registration = await registerPaymentStores(auth);
        return {
          statusCode: 200,
          headers,
          body: { scopes: result.scopeTree, synced: true, registration },
        };
      }
      const handler = path === "/scopes" ? scopeAction : configAction;
      const response = await handler({ ...params, __ow_path: "/" });
      return { ...response, headers: { ...response.headers, ...headers } };
    } catch (error) {
      const status = error.response?.status ?? error.status;
      const statusCode = [401, 403].includes(status) ? status : 503;
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
                : path === "/scopes/sync"
                  ? "Commerce scope synchronization and payment registration could not both be confirmed. The hierarchy or registration may already have changed. Retry Sync Commerce scopes; scoped settings were not edited."
                  : "Configuration is unavailable. Reload to verify saved values before retrying.",
        },
      };
    }
  };
}
