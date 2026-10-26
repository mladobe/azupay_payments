import { useEffect, useRef, useState } from "react";
import {
  checkoutGuidanceWarnings,
  helpUrl,
} from "../../../shared/checkout-guidance.js";
import {
  configurationModel,
  configurationPatch,
  flattenScopes,
} from "./config-client.js";

const limits = {
  checkoutTitle: 100,
  checkoutByline: 250,
  checkoutInstructionsLabel: 100,
  checkoutInstructions: 4000,
  paytoTermsUrl: 2048,
  paytoTermsLabel: 100,
  ...Object.fromEntries(
    [1, 2, 3].flatMap((index) => [
      [`checkoutLogo${index}Url`, 2048],
      [`checkoutLogo${index}Alt`, 100],
    ]),
  ),
};

function ConfigurationField({ field, draft, disabled, update }) {
  const changed = Object.hasOwn(draft, field.name);
  const inherited = changed ? draft[field.name] === null : field.inherited;
  const value = changed
    ? (draft[field.name] ?? field.parentValue)
    : field.value;
  const id = `setting-${field.name}`;
  const common = {
    id,
    disabled: disabled || inherited,
    "aria-describedby": `${id}-help`,
  };
  return (
    <div className="configuration-field">
      <label htmlFor={id}>{field.label}</label>
      {field.type === "boolean" ? (
        <input
          {...common}
          type="checkbox"
          checked={value}
          onChange={(event) => update(field.name, event.target.checked)}
        />
      ) : field.type === "list" ? (
        <select
          {...common}
          value={value}
          onChange={(event) => update(field.name, event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.name === "checkoutInstructions" ? (
        <textarea
          {...common}
          rows={9}
          maxLength={limits.checkoutInstructions}
          value={value}
          onChange={(event) => update(field.name, event.target.value)}
        />
      ) : (
        <input
          {...common}
          type={
            field.name === "expiryMinutes"
              ? "number"
              : field.name.endsWith("Url")
                ? "url"
                : "text"
          }
          pattern={field.name.endsWith("Url") ? "https://.*" : undefined}
          required={field.name === "expiryMinutes"}
          min={field.name === "expiryMinutes" ? 5 : undefined}
          max={field.name === "expiryMinutes" ? 120 : undefined}
          step={field.name === "expiryMinutes" ? 1 : undefined}
          maxLength={limits[field.name]}
          value={value}
          onChange={(event) => update(field.name, event.target.value)}
        />
      )}
      <p id={`${id}-help`} className="field-help">
        {field.description}
      </p>
      <label className="inheritance-control">
        <input
          type="checkbox"
          checked={inherited}
          disabled={disabled}
          onChange={(event) =>
            update(field.name, event.target.checked ? null : value)
          }
        />
        Use inherited / default value
      </label>
      {inherited && (
        <small>
          Inherited from{" "}
          {changed
            ? "parent scope or schema default"
            : `${field.origin.level}: ${field.origin.code}`}
        </small>
      )}
    </div>
  );
}

export function Configuration({ client }) {
  const [scopes, setScopes] = useState([]);
  const [scopeId, setScopeId] = useState("");
  const [fields, setFields] = useState(null);
  const [draft, setDraft] = useState({});
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [scopeReload, setScopeReload] = useState(0);
  const [needsReload, setNeedsReload] = useState(false);
  const activeSave = useRef(null);
  const scope = scopes.find((item) => item.id === scopeId);
  const effective = Object.fromEntries(
    (fields ?? []).map((field) => [
      field.name,
      Object.hasOwn(draft, field.name)
        ? (draft[field.name] ?? field.parentValue)
        : field.value,
    ]),
  );
  const guidanceWarnings = fields ? checkoutGuidanceWarnings(effective) : [];
  const patch = fields ? configurationPatch(fields, draft) : [];
  const dirty = patch.length > 0;
  const busy = phase === "loading" || phase === "saving";

  useEffect(() => () => activeSave.current?.abort(), [client, scopeId]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setScopes([]);
    setScopeId("");
    setFields(null);
    setDraft({});
    setPhase("loading");
    setError("");
    async function loadScopes() {
      try {
        const result = await client.scopes(controller.signal);
        const options = flattenScopes(result.scopes);
        if (
          !options.length ||
          new Set(options.map((item) => item.id)).size !== options.length
        )
          throw new Error(
            "The app has no valid configuration scopes. Sync Commerce scopes in App Management.",
          );
        if (controller.signal.aborted) return;
        setScopes(options);
        setScopeId(
          options.find((item) => item.level === "global")?.id ?? options[0].id,
        );
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure.message);
        setPhase("error");
      }
    }
    loadScopes();
    return () => controller.abort();
  }, [client, scopeReload]);

  async function readFields(selected, signal) {
    const [document, parent] = await Promise.all([
      client.read(selected.id, signal),
      selected.parentId
        ? client.read(selected.parentId, signal)
        : Promise.resolve(null),
    ]);
    return configurationModel(document, parent, selected);
  }

  useEffect(() => {
    if (!client || !scope) return;
    const controller = new AbortController();
    setFields(null);
    setDraft({});
    setPhase("loading");
    setError("");
    setNotice("");
    readFields(scope, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setFields(result);
        setNeedsReload(false);
        setPhase("ready");
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setError(failure.message);
        setPhase("error");
      });
    return () => controller.abort();
  }, [client, scope, reload]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.closest("form").reportValidity()) return;
    try {
      if (
        String(effective.checkoutInstructions ?? "").trim() &&
        !String(effective.checkoutInstructionsLabel ?? "").trim()
      )
        throw new Error("Enter a label for the payment instructions.");
      const value = String(effective.paytoTermsUrl ?? "").trim();
      if (value) {
        helpUrl(value);
        if (!String(effective.paytoTermsLabel ?? "").trim())
          throw new Error("Enter link text for the PayTo terms URL.");
      }
    } catch (failure) {
      setError(failure.message);
      return;
    }
    void save();
  }

  async function save() {
    if (!scope?.is_editable || !dirty || busy || needsReload) return;
    setPhase("saving");
    setError("");
    setNotice("");
    let accepted = false;
    const controller = new AbortController();
    activeSave.current = controller;
    try {
      await client.save(scope.id, patch, controller.signal);
      accepted = true;
      const result = await readFields(scope, controller.signal);
      if (controller.signal.aborted) return;
      setFields(result);
      setDraft({});
      setNotice(
        "Configuration saved. Refresh storefront checkout to load any updated presentation settings.",
      );
      setPhase("ready");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setNeedsReload(true);
      if (accepted) {
        setError(
          "The save request succeeded, but confirmation could not be loaded. Reload configuration before making another change.",
        );
      } else {
        setError(failure.message);
      }
      setPhase("error");
    } finally {
      if (activeSave.current === controller) activeSave.current = null;
    }
  }

  if (!client)
    return (
      <p>Configuration requires an authenticated Commerce Admin connection.</p>
    );
  return (
    <section aria-labelledby="configuration-heading" aria-busy={busy}>
      <h2 id="configuration-heading">Configuration</h2>
      <p>
        These are the same scoped settings used by App Management and payment
        processing. No API keys are stored in this form.
      </p>
      <p className="notice">
        Payment order is supplied by Commerce. This app does not reorder other
        payment methods. The current ACCS OOPE API does not expose a native
        Azupay numeric sort-order setting.
      </p>
      {guidanceWarnings.map((warning) => (
        <p key={warning} role="status" className="notice">
          {warning}
        </p>
      ))}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="configuration-toolbar">
        <label htmlFor="configuration-scope">Active scope</label>
        <select
          id="configuration-scope"
          value={scopeId}
          disabled={busy || dirty || needsReload}
          onChange={(event) => setScopeId(event.target.value)}
        >
          {scopes.map((item) => (
            <option
              key={item.id}
              value={item.id}
            >{`${" / ".repeat(item.depth)}${item.label} (${item.level})`}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || (dirty && !needsReload)}
          onClick={() => {
            if (!scope) {
              setScopeReload((value) => value + 1);
              return;
            }
            setReload((value) => value + 1);
          }}
        >
          Reload configuration
        </button>
      </div>
      {busy && (
        <p role="status">
          {phase === "saving"
            ? "Saving and verifying configuration..."
            : "Loading configuration..."}
        </p>
      )}
      {scope && !scope.is_editable && (
        <p className="notice">
          This scope is read-only. Select an editable scope to make changes.
        </p>
      )}
      {needsReload && (
        <p className="notice">
          The last save could not be confirmed. Reload configuration to check
          the server's values before editing again; this will replace the local
          draft.
        </p>
      )}
      {fields && (
        <form
          onSubmit={submit}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              event.target.tagName === "INPUT" &&
              !event.nativeEvent.isComposing
            )
              submit(event);
          }}
        >
          <div className="configuration-grid">
            {fields.map((field) => (
              <ConfigurationField
                key={field.name}
                field={field}
                draft={draft}
                disabled={busy || !scope.is_editable || needsReload}
                update={(name, value) => {
                  setDraft((previous) => ({ ...previous, [name]: value }));
                  setNotice("");
                }}
              />
            ))}
          </div>
          <div className="configuration-toolbar">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !dirty || !scope.is_editable || needsReload}
            >
              Save configuration
            </button>
            <button
              type="button"
              disabled={busy || !dirty || needsReload}
              onClick={() => {
                setDraft({});
                setError("");
                setNotice("");
              }}
            >
              Discard changes
            </button>
            {dirty && (
              <p role="status">
                Unsaved changes. Save or discard before changing scope or
                reloading. Switching tabs keeps your edits.
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
