import { useRef, useState } from "react";
import { DEFAULT_TITLE } from "../../../shared/identity.js";
import { Configuration } from "./configuration.jsx";

const guide = "https://github.com/mladobe/azupay_payments/blob/main/docs/";

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <span className="new-tab">(opens in a new tab)</span>
    </a>
  );
}

export function AdminPage({ connected, client = null, connectionError = "" }) {
  const [tab, setTab] = useState("configuration");
  const tabs = useRef({});
  function keyboardTab(event) {
    const next =
      event.key === "Home"
        ? "configuration"
        : event.key === "End"
          ? "documentation"
          : ["ArrowLeft", "ArrowRight"].includes(event.key)
            ? tab === "configuration"
              ? "documentation"
              : "configuration"
            : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabs.current[next].focus();
  }
  return (
    <main className="azupay-admin">
      <header>
        <p className="eyebrow">PayID and one-off PayTo for Adobe Commerce</p>
        <h1>{DEFAULT_TITLE}</h1>
        <p>
          Set up, test and operate your account-to-account payment integration.
        </p>
      </header>
      {!connected && (
        <p role="alert" className="notice">
          Adobe Admin authentication is unavailable. Open this page through the
          Azupay menu in Commerce Admin. No account settings or payment status
          have been loaded.
        </p>
      )}
      {connectionError && (
        <p role="alert" className="notice">
          {connectionError}
        </p>
      )}
      <div
        role="tablist"
        aria-label="Azupay administration"
        className="admin-tabs"
      >
        {["configuration", "documentation"].map((name) => (
          <button
            key={name}
            ref={(element) => {
              tabs.current[name] = element;
            }}
            id={`${name}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${name}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onKeyDown={keyboardTab}
            onClick={() => setTab(name)}
          >
            {name === "configuration" ? "Configuration" : "Documentation"}
          </button>
        ))}
      </div>
      <div
        id="configuration-panel"
        role="tabpanel"
        aria-labelledby="configuration-tab"
        hidden={tab !== "configuration"}
      >
        <Configuration client={client} />
      </div>
      <div
        id="documentation-panel"
        role="tabpanel"
        aria-labelledby="documentation-tab"
        hidden={tab !== "documentation"}
      >
        <section aria-labelledby="configure-heading">
          <h2 id="configure-heading">Configure the payment app</h2>
          <p>
            Use the <strong>Configuration</strong> tab to edit settings without
            leaving Commerce Admin. Choose the intended store scope, clear
            <strong> Use inherited / default value</strong> where an override is
            needed, then save.
          </p>
          <ul>
            <li>Enable Azupay and select Staging / UAT or Production.</li>
            <li>
              Select your provisioned PayID, PayTo or both credential profile.
            </li>
            <li>Choose full redirect or modal checkout and payment expiry.</li>
            <li>
              Set your checkout title, byline and permitted hosted logo images.
            </li>
            <li>
              Customize education link URLs and text for each payment rail.
              Clear a URL to hide that link. Provide your merchant PayTo terms
              URL or confirm those terms are configured in hosted checkout.
            </li>
            <li>
              Enable automatic invoicing only after verifying the reconciliation
              timer.
            </li>
          </ul>
          <p>
            Settings remain in Adobe's scoped configuration, shared with
            <strong>
              {" "}
              Apps &gt; App Management &gt; {DEFAULT_TITLE} &gt; Configure
            </strong>
            . That separate Experience Cloud page does not include the Commerce
            navigation. API keys belong in private App Builder deployment
            configuration, never in this page or storefront code.
          </p>
          <ExternalLink href={`${guide}README.md`}>
            Installation and configuration guide
          </ExternalLink>
          <p>
            Follow the{" "}
            <ExternalLink href="https://helpcentre.azupay.com.au/docs/payid-ux-guide">
              PayID UX guide
            </ExternalLink>{" "}
            and{" "}
            <ExternalLink href="https://helpcentre.azupay.com.au/docs/payto-ux-guide">
              PayTo UX guide
            </ExternalLink>
            . The storefront preserves Commerce's payment-method order. This
            Cloud Service integration does not currently expose native numeric
            Azupay priority.
          </p>
        </section>
        <section aria-labelledby="test-heading">
          <h2 id="test-heading">Run a demo or UAT payment</h2>
          <p>
            Use Staging / UAT credentials and simulated money only. For PayID,
            copy the recipient PayID and exact amount displayed in hosted
            checkout into the Test Bank. For PayTo, enter Azupay's current
            fictitious payer account in hosted checkout; do not send a separate
            Test Bank transfer.
          </p>
          <ul>
            <li>
              <ExternalLink href="https://staging-testbank.nonprod.azupay.au/">
                Azupay Test Bank
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href="https://developer.azupay.com.au/docs/test-accounts-1-click-checkout">
                Azupay testing accounts and exception scenarios
              </ExternalLink>
            </li>
            <li>
              <ExternalLink
                href={`${guide}OPERATIONS.md#demo-and-uat-with-the-azupay-test-bank`}
              >
                Step-by-step PayID and PayTo demo
              </ExternalLink>
            </li>
          </ul>
          <p>
            After server verification, select{" "}
            <strong>Complete your order</strong> in Commerce. PayTo agreement
            approval alone is not settlement.
          </p>
        </section>
        <section aria-labelledby="operations-heading">
          <h2 id="operations-heading">Manage payments and invoices</h2>
          <p>
            Inspect orders and offline invoices in{" "}
            <strong>Sales &gt; Orders</strong>. Automatic invoicing runs every
            five minutes when enabled; it records an already-verified payment
            and never collects a second bank debit.
          </p>
          <ul>
            <li>
              <ExternalLink href="https://dashboard-uat.azupay.com.au">
                Azupay UAT dashboard
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href="https://dashboard.azupay.com.au">
                Azupay production dashboard (real money)
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href={`${guide}OPERATIONS.md`}>
                Payment recovery, invoices and refund runbook
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href={`${guide}ADMIN.md#php-extension-comparison`}>
                PHP extension feature comparison
              </ExternalLink>
            </li>
          </ul>
          <p className="notice">
            This is a guidance page, not a live payment dashboard. No
            connection, payment or scheduler health is implied. Do not pay again
            if a payment completed without an order. Online Commerce refunds are
            not supported: use an authorized Azupay dashboard refund and
            matching offline credit memo.
          </p>
        </section>
      </div>
    </main>
  );
}
