import { DEFAULT_TITLE } from "../../../shared/identity.js";

const guide = "https://github.com/mladobe/azupay_payments/blob/main/docs/";

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <span className="new-tab">(opens in a new tab)</span>
    </a>
  );
}

export function AdminPage({ connected }) {
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
      <section aria-labelledby="configure-heading">
        <h2 id="configure-heading">Configure the payment app</h2>
        <p>
          Open{" "}
          <strong>
            Apps &gt; App Management &gt; {DEFAULT_TITLE} &gt; Configure
          </strong>{" "}
          in Commerce Admin. Choose the intended store scope, unlock inherited
          <strong> From Default</strong> fields where needed, then save.
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
            Enable automatic invoicing only after verifying the reconciliation
            timer.
          </li>
        </ul>
        <p>
          Settings remain in Adobe's scoped configuration; this page does not
          read or edit them. API keys belong in private App Builder deployment
          configuration, never in this page or storefront code.
        </p>
        <ExternalLink href={`${guide}README.md`}>
          Installation and configuration guide
        </ExternalLink>
      </section>
      <section aria-labelledby="test-heading">
        <h2 id="test-heading">Run a demo or UAT payment</h2>
        <p>
          Use Staging / UAT credentials and simulated money only. For PayID,
          copy the recipient PayID and exact amount displayed in hosted checkout
          into the Test Bank. For PayTo, enter Azupay's current fictitious payer
          account in hosted checkout; do not send a separate Test Bank transfer.
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
          After server verification, select <strong>Complete your order</strong>{" "}
          in Commerce. PayTo agreement approval alone is not settlement.
        </p>
      </section>
      <section aria-labelledby="operations-heading">
        <h2 id="operations-heading">Manage payments and invoices</h2>
        <p>
          Inspect orders and offline invoices in{" "}
          <strong>Sales &gt; Orders</strong>. Automatic invoicing runs every
          five minutes when enabled; it records an already-verified payment and
          never collects a second bank debit.
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
          This is a guidance page, not a live payment dashboard. No connection,
          payment or scheduler health is implied. Do not pay again if a payment
          completed without an order. Online Commerce refunds are not supported:
          use an authorized Azupay dashboard refund and matching offline credit
          memo.
        </p>
      </section>
    </main>
  );
}
