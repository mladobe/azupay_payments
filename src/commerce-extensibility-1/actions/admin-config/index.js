import {
  AdminUiPermissionDeniedError,
  getAdminUiPermissionClient,
} from "@adobe/aio-commerce-lib-admin-ui/api";
import { getMenuAclResourceId } from "@adobe/aio-commerce-lib-admin-ui/menu";
import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { configRuntimeAction } from "@adobe/aio-commerce-lib-app/actions/config";
import { scopeTreeRuntimeAction } from "@adobe/aio-commerce-lib-app/actions/scope-tree";
import { getForwardedImsAuthProvider } from "@adobe/aio-commerce-sdk/auth";
import { adminConfigHandler } from "../../../shared/admin-config.js";
import { configSchema } from "../../../shared/config-schema.js";
import { APP_ID } from "../../../shared/identity.js";
import { logError } from "../../../shared/runtime.js";

export const main = adminConfigHandler({
  configAction: configRuntimeAction({ configSchema }),
  scopeAction: scopeTreeRuntimeAction,
  logError,
  authorize: async (params) => {
    if (!/^Bearer \S+$/i.test(params.__ow_headers?.authorization ?? "")) {
      const error = new Error("Admin authentication is required.");
      error.status = 401;
      throw error;
    }
    const auth = getForwardedImsAuthProvider({
      from: "headers",
      headers: params.__ow_headers,
    });
    const client = await getCommerceClient(auth);
    try {
      await getAdminUiPermissionClient({
        httpClient: client,
        cacheTtlMs: 0,
        denyOnError: false,
      }).require(getMenuAclResourceId(APP_ID, "Azupay::payments"));
    } catch (error) {
      if (error instanceof AdminUiPermissionDeniedError) error.status = 403;
      else if (
        error.response?.status === 401 ||
        error.cause?.response?.status === 401
      )
        error.status = 401;
      throw error;
    }
  },
});
