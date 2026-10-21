import {
  createExtensionApp,
  useIms,
} from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";
import "../index.css";
import { APP_ID } from "../../../shared/identity.js";
import { AdminPage } from "./page.jsx";

function ConnectedPage() {
  const { error } = useIms();
  return <AdminPage connected={!error} />;
}

createExtensionApp({
  metadata: { extensionId: APP_ID },
  menu: <ConnectedPage />,
});
