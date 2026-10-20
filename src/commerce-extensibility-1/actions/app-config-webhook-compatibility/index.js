import { wrapAppConfig } from "../../../shared/app-config-compatibility.js";
import { main as sdkMain } from "../../.generated/actions/app-management/app-config.js";

export const main = wrapAppConfig(sdkMain, true, true);
