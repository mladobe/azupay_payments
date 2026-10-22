import {
  createExtensionApp,
  useCommerce,
  useIms,
} from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";
import "../index.css";
import { useMemo, useRef } from "react";
import { APP_ID } from "../../../shared/identity.js";
import { configClient, runtimeBase } from "./config-client.js";
import { AdminPage } from "./page.jsx";

function ConnectedPage() {
  const ims = useIms();
  const commerce = useCommerce();
  const token = ims.data?.imsToken;
  const org = ims.data?.imsOrgId;
  const credentials = useRef({});
  credentials.current = { imsToken: token, imsOrgId: org };
  const connected = !ims.error && !commerce.error;
  const connection = useMemo(() => {
    if (!connected) return { client: null, error: "" };
    try {
      return {
        client: configClient({
          baseUrl: runtimeBase(
            process.env.AIO_runtime_namespace ?? "",
            globalThis.location.href,
          ),
          credentials: () => credentials.current,
        }),
        error: "",
      };
    } catch (error) {
      return { client: null, error: error.message };
    }
  }, [connected, org]);
  return (
    <AdminPage
      connected={connected}
      client={connection.client}
      connectionError={connection.error}
    />
  );
}

createExtensionApp({
  metadata: { extensionId: APP_ID },
  menu: <ConnectedPage />,
});
