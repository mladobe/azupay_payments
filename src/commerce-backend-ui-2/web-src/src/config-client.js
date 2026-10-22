export function runtimeBase(namespace, location) {
  const host = new URL(location).hostname;
  const resolved =
    namespace || /^([a-z0-9-]+)\.adobeio-static\.net$/i.exec(host)?.[1];
  if (!resolved || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(resolved))
    throw new Error(
      "The app Runtime namespace is unavailable. Open the deployed Azupay menu in Commerce Admin.",
    );
  return `https://${resolved}.adobeioruntime.net/api/v1/web/azupay/admin-config`;
}

export function configClient({
  baseUrl,
  credentials,
  fetch: request = globalThis.fetch,
}) {
  async function call(path, { signal, ...options } = {}) {
    const { imsToken, imsOrgId } = credentials();
    if (!imsToken || !imsOrgId)
      throw new Error("Authenticated Commerce Admin context is required.");
    let response;
    try {
      response = await request(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${imsToken}`,
          "x-gw-ims-org-id": imsOrgId,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("Azupay configuration request failed.", {
        code: "ADMIN_CONFIG_NETWORK",
      });
      throw new Error(
        "Configuration could not be reached. Reload saved values before retrying a save.",
      );
    }
    if (!response.ok) {
      console.warn("Azupay configuration request failed.", {
        code: "ADMIN_CONFIG_HTTP",
        status: response.status,
      });
      throw new Error(
        response.status === 401
          ? "Your admin session has expired. Sign in again and reload this page."
          : response.status === 403
            ? "Your Commerce role does not have permission to configure Azupay."
            : `Configuration request failed (HTTP ${response.status}). Reload saved values before retrying a save.`,
      );
    }
    try {
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Expected a configuration response object.");
      return data;
    } catch {
      throw new Error(
        "Configuration returned an invalid response. Reload saved values before making changes.",
      );
    }
  }
  return {
    scopes: (signal) => call("/scopes", { signal }),
    read: (scopeId, signal) =>
      call(`/config?scopeId=${encodeURIComponent(scopeId)}&commerceEnv=saas`, {
        signal,
      }),
    save: (scopeId, config, signal) =>
      call("/config", {
        method: "PATCH",
        body: JSON.stringify({ scopeId, config }),
        signal,
      }),
  };
}

export function flattenScopes(nodes, parent = null, depth = 0) {
  if (!Array.isArray(nodes))
    throw new Error("The configuration scope tree is invalid.");
  return nodes.flatMap((node) => {
    if (
      !node ||
      typeof node.id !== "string" ||
      typeof node.code !== "string" ||
      typeof node.level !== "string" ||
      typeof node.label !== "string" ||
      typeof node.is_editable !== "boolean"
    )
      throw new Error("A configuration scope is invalid.");
    return [
      { ...node, parentId: parent?.id ?? null, depth },
      ...flattenScopes(node.children ?? [], node, depth + 1),
    ];
  });
}

function normalizeValue(field, value) {
  if (field.type === "list" && Array.isArray(value) && value.length === 1)
    return value[0];
  return value;
}

export function configurationModel(document, parent, scope) {
  if (
    !Array.isArray(document?.schema) ||
    !document.schema.length ||
    !Array.isArray(document?.values?.config) ||
    document.values.scope?.id !== scope.id
  )
    throw new Error(
      "The loaded configuration does not match the selected scope.",
    );
  if (
    scope.parentId &&
    (!Array.isArray(parent?.values?.config) ||
      parent.values.scope?.id !== scope.parentId)
  )
    throw new Error(
      "The parent configuration does not match the selected scope.",
    );
  const values = new Map(
    document.values.config.map((entry) => [entry.name, entry]),
  );
  const inherited = new Map(
    parent?.values?.config?.map((entry) => [entry.name, entry.value]) ?? [],
  );
  if (
    values.size !== document.values.config.length ||
    (scope.parentId && inherited.size !== parent.values.config.length) ||
    new Set(document.schema.map((field) => field.name)).size !==
      document.schema.length
  )
    throw new Error("The configuration contains duplicate fields.");
  return document.schema.map((field) => {
    const entry = values.get(field.name);
    if (
      !["boolean", "text", "list"].includes(field.type) ||
      typeof field.name !== "string" ||
      typeof field.label !== "string" ||
      !entry?.origin ||
      typeof entry.origin.code !== "string" ||
      typeof entry.origin.level !== "string" ||
      (field.type === "list" &&
        (field.selectionMode !== "single" ||
          !Array.isArray(field.options) ||
          !field.options.length ||
          field.options.some(
            (option) =>
              typeof option.value !== "string" ||
              typeof option.label !== "string",
          )))
    )
      throw new Error(
        "This configuration schema is not supported by the editor. Reload or contact your app administrator.",
      );
    const value = normalizeValue(field, entry.value);
    if (scope.parentId && !inherited.has(field.name))
      throw new Error(
        "The parent configuration is missing a field. Reload configuration before editing.",
      );
    const parentValue = normalizeValue(
      field,
      inherited.has(field.name) ? inherited.get(field.name) : field.default,
    );
    const valid = (candidate) =>
      field.type === "boolean"
        ? typeof candidate === "boolean"
        : typeof candidate === "string" &&
          (field.type !== "list" ||
            field.options.some((option) => option.value === candidate));
    if (!valid(value) || !valid(parentValue))
      throw new Error(
        "A configuration value is invalid. Use App Management to review the stored settings.",
      );
    return {
      ...field,
      value,
      parentValue,
      inherited:
        entry.origin.code !== scope.code || entry.origin.level !== scope.level,
      origin: entry.origin,
    };
  });
}

export function configurationPatch(fields, draft) {
  return fields.flatMap((field) => {
    if (!Object.hasOwn(draft, field.name)) return [];
    const value = draft[field.name];
    if (
      (value === null && field.inherited) ||
      (value === field.value && !field.inherited)
    )
      return [];
    return [{ name: field.name, value }];
  });
}
