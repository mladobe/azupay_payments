# Operations, UAT and release

Start with [Installing the Azupay app](README.md). Source publication is covered
separately in [Repository publication and releases](PUBLISHING.md).

## Normal order lifecycle

1. Azupay receives exactly the fixed AUD amount on a single-use PaymentRequest.
2. Only `PaymentRequestStatus.status === "COMPLETE"` is accepted. PayTo agreement
   approval alone is not settlement. `COMPLETED`, `WAITING`, expiry and return
   states never count as paid.
3. The before-order webhook checks the signed receipt, quote ID, store, order
   currency/amount, Azupay client, request, transaction ID, amount received and
   `settledBy` rail.
4. Commerce persists the order as `pending`, with its signed receipt.
5. When automatic invoicing is enabled, the private reconciliation action
   independently rereads Azupay and creates a **single full offline invoice**.
   `capture:false` does not initiate a second bank debit.

Test actual Commerce invoice/payment state and order progression on your tenant.
If autoInvoice is off, use the normal Commerce offline invoice workflow only
after verifying the matching settled transaction in Azupay.

## Set up the reconciliation schedule

The deployment manifest now includes an interval feed and rule:
`reconcile-timer` invokes private `azupay/reconcile` every five minutes
through `reconcile-rule`. The per-store `autoInvoice` setting controls
whether eligible orders are invoiced; it does not invoke the action immediately.
Deploy the full extensibility extension when installing the timer, not only
individual actions. A backend deployment without the timer cannot automatically
invoice orders.

First create a UAT paid order. In Admin, enable Automatically invoice paid orders
for its store scope, then invoke:

```sh
aio runtime action invoke azupay/reconcile --blocking --result
```

Expected result: a positive `invoiced` count and `failures: []`. Verify the order
has exactly one invoice, the right amount, no second bank debit and the expected
Commerce state. Invoke again: no second invoice should be created.

After deployment, verify the declared alarm in the same workspace:

```sh
aio runtime trigger get reconcile-timer
aio runtime rule get reconcile-rule
```

See Adobe's [alarm-feed deployment guide](https://developer.adobe.com/app-builder/docs/resources/cron-jobs/lesson2).
If alarm feeds are unavailable in your organization,
configure your existing authenticated scheduler to invoke the private Runtime
action every five minutes. Do not make reconciliation a public web action.

Verify readiness rather than merely assuming the schedule exists:

```sh
aio runtime trigger get reconcile-timer
aio runtime rule get reconcile-rule
aio runtime activation list --limit 10
```

Inspect its first scheduled activation/result. Configure monitoring for failed
activations, an `error` result, non-empty `failures`, repeated pending Azupay orders
and `RECONCILIATION_BACKLOG`. Do not log/export entire activation input payloads;
Runtime inputs contain secrets.

Disable/delete the schedule before uninstalling or retiring the workspace:

```sh
aio runtime rule disable reconcile-rule
aio runtime rule delete reconcile-rule
aio runtime trigger delete reconcile-timer
```

## Retry behavior and scale

- Azupay documents idempotency for `clientTransactionId`. For a given
  quote/store/amount/environment/experience the extension deterministically uses
  the same value. A lost HTTP response does not justify a new payment.
- Successful invoices leave the `pending` scan. Failed invoices remain available
  for the next run; a partially failed batch returns an action error plus the
  failed order IDs/codes.
- Commerce is the authority for remaining invoice quantities. Concurrent/ambiguous
  invoice responses must be checked against Commerce before manual retry.
- Existing partial payments/invoices are deliberately rejected for manual review.
  This is not a split-invoicing implementation.
- The action collects the pending order scan before it starts changing status,
  so its own updates do not shift pagination. It processes at most 2,000 pending
  orders and has a five-minute execution limit. Busy merchants need a durable,
  per-order queue/event integration with alerting before production.
- Newly created orders or other processes can still change a scan while it is
  running; later scheduled runs recover missed pending orders. Do not rely on the
  scan as a transactionally consistent financial ledger.
- Signed browser receipts last seven days. Trusted persisted orders can be
  reconciled after that; server signatures and all payment/order checks still
  apply. Keep credentials and the signing key available for old orders.

## Payment without an order

This is an explicit risk of Adobe's payment-before-order session pattern.

1. Tell the shopper **do not pay again**.
2. Look up the transaction in Azupay using the request ID or the
   `commerce-<hash>` client transaction ID and match the Commerce quote/amount.
   Transaction descriptions include the internal quote ID.
3. Check Commerce first: the order may exist even when its browser response
   failed. Search using the quote ID with authorized backend tooling.
4. If the original cart is active and unchanged, restore its saved session and
   retry **order placement**, not bank payment. Confirm stock, shipping, tax,
   guest email and customer login.
5. If order recovery is impossible, refund in the Azupay dashboard under your
   authorized operational process. Record the financial reconciliation.
6. Only clear/restart the shopper session once an operator has reconciled funds.

No background worker can automatically place the shopper's cart because this
app intentionally does not persist shopper login tokens or invent consent.

## Expired, incorrect or returned payments

- A closed PaymentRequest is not silently replaced. Contact support and inspect
  Azupay before starting a fresh cart.
- Underpayment/overpayment behavior is managed by the fixed-amount Azupay product.
  The extension still requires exact `amountReceived`.
- A PayTo-only profile settled by PayID (or vice versa) is rejected. This indicates
  the profile/dashboard settings do not match; do not work around the check.
- A return detected before order placement/invoicing blocks that operation.
- Returns after an order leaves pending, and bank disputes after fulfillment,
  need a separate operational process. This release does not synchronize
  post-invoice returns, disputes or cancellations.

## Refunds and credit memos

Automated refunds are **not implemented** and the method does not advertise
`can_refund`. Do not use a Commerce online refund expecting a bank transfer.

Use the Azupay dashboard to perform an authorized refund, then create the matching
offline Commerce credit memo and update your accounting ledger. Confirm final
refund status; creating a credit memo is not proof the bank refund completed.
Do not refund twice from Commerce and Azupay.

## Keys and environment changes

- Disable new sessions, drain payments and reconcile orders before changing the
  selected environment, methods, signing key, credentials or app association.
- Keep the signing key stable across normal deploys. Rotation invalidates old
  receipts; inventory and reconcile them first. A dual-key migration is not
  implemented.
- Disablement hides/prevents new sessions but does not prevent valid already-paid
  receipts being checked with their original profile.
- The deployment production gate also applies to receipt verification. Do not
  turn it off while production orders still require reconciliation unless you are
  intentionally stopping all production processing.
- Use separate workspaces and secret sets; keep production profiles absent in a
  UAT workspace where possible.
- Add gateway rate limits/abuse monitoring for public create/status endpoints.
  CORS is not authentication. A masked cart ID and signed receipt are bearer
  capabilities; never leak them to analytics, URLs or logs.
- Runtime code logs only error codes and, for reconciliation, numeric order IDs.
  Restrict Adobe operator access to action parameters and activation metadata.

## Demo and UAT with the Azupay test bank

Use Azupay's [Testing the Pay by Bank App guide](https://developer.azupay.com.au/docs/test-accounts-1-click-checkout)
as the authority for current test accounts and expected outcomes. The
[Azupay Test Bank](https://staging-testbank.nonprod.azupay.au/) simulates the
customer's bank payment for the PayID flow. PayTo uses the fictitious accounts
below inside hosted checkout; the documented happy-path agreements are approved
automatically, without a separate Test Bank transfer.

### Prepare the demo

1. Use an isolated UAT storefront/cart and UAT Azupay credentials. In Commerce,
   select **Staging / UAT** and a provisioned PayID, PayTo or both profile. Keep
   production approval off; never send real money or use real bank credentials.
2. Complete the AUD cart, addresses, shipping and required terms. Select Azupay
   and continue into full-page or modal checkout.
3. Use a fresh cart for each independent scenario. Once a payment has completed,
   finish or reconcile its order before starting another test; do not pay twice
   or clear a paid session to repeat a demo.

### PayID: simulate the bank transfer

1. Choose **PayID** in Azupay hosted checkout, if the profile offers both methods.
2. Copy the **payment's displayed recipient PayID and exact AUD amount**. This is
   the PayID generated for this payment, not one of the PayTo customer test PayIDs
   below.
3. Open the [Test Bank](https://staging-testbank.nonprod.azupay.au/) in a separate
   tab. Follow its payment form to simulate a transfer to that recipient PayID
   for the exact amount, using any reference/instructions shown by the checkout
   and requested by the form. Submit the simulated payment once.
4. Return to the original Azupay checkout and wait for payment confirmation.
   In modal mode, wait for server verification to close the dialog; use its
   manual status check if needed. In redirect mode, follow the return to the
   original Commerce checkout.
5. Select **Complete your order** in Commerce. Confirm the order and, if enabled,
   its single offline invoice after the next reconciliation run.

### PayTo: use a simulated payer account

1. Choose **PayTo** in Azupay hosted checkout.
2. Enter a documented fictitious payer PayID: `0400123123` or `0400123456`.
   If checkout offers BSB/account entry, use BSB `939300` and account `123456`.
3. Follow the hosted agreement/authorization prompts. For these happy-path
   accounts, Azupay automatically approves the agreement to `ACTIVE`. If
   passkeys are enabled, follow the additional passkey flow presented.
4. Wait for the **payment** to complete. Agreement approval alone is not proof
   of settlement, and a PayTo happy-path test does not require sending a separate
   PayID transfer from the Test Bank.
5. Return to Commerce (or wait for the verified modal to close), select
   **Complete your order**, and check the order and optional offline invoice.

For a successful PayTo demo, avoid an $88.88 cart when using `0400123123`:
Azupay reserves that combination for a payment-processing failure.

### PayTo exception scenarios

Use the following cases from Azupay's guide. Amounts refer to the final
PaymentRequest total, including shipping, tax and discounts.

| Payer PayID | Payment amount | Documented outcome |
| --- | --- | --- |
| `0444222333` | Any | PayID is not registered |
| `0454444555` | Any | PayID does not support PayTo |
| `0400123123` | $88.88 | Payment cannot be processed |
| `0472345678` | Any | Agreement remains `CREATED`; authorization expires |
| `0400111222` | Any | Payment initiation fails with insufficient funds |

Verify the provider displays the expected failure and Commerce creates neither
an order nor an invoice for that failed/unsettled attempt. Do not bypass the
server's `COMPLETE`, amount or settlement-rail checks to make a demo succeed.
If Azupay changes its simulator, follow the linked current guide or confirm the
scenario with Azupay rather than guessing credentials.

Record the scenario, presentation mode, final amount, provider outcome and
Commerce order/invoice result in restricted UAT evidence. Do not publish
credentials, signed receipts or customer/cart payloads. These simulations do not
replace real supported-bank, mobile handoff and passkey acceptance testing.

## UAT acceptance checklist

Run the [Test Bank and PayTo demo scenarios](#demo-and-uat-with-the-azupay-test-bank)
first, using Azupay's current linked instructions for your client. Do not guess
test bank credentials or send real funds to UAT.

| Test | Expected result |
| --- | --- |
| All provisioned UAT profiles | PayID-only, PayTo-only and both show exactly the configured hosted choices |
| Missing selected profile | Visible configuration error; no fallback or new payment |
| Disabled extension | Hidden in payment methods; create-session rejects; existing paid receipt remains verifiable |
| AUD/Australia guest cart | Correct amount, shipping/tax/discounts and quote binding |
| Signed-in and virtual carts | Correct authorization/scope; virtual cart needs no shipping address |
| USD or non-AU cart, zero total | Rejected before creating a request |
| Repeated/simultaneous create, lost create response | Same clientTransactionId and PaymentRequest; no duplicate request |
| Provider host differs | Explicit allowlist error; verify hostname with Azupay before allowing it |
| Wrong origin/return URL | Rejected |
| PayTo approved but unpaid | Cannot place order |
| WAITING, expired and returned states | Cannot place order or invoice |
| Exact completed PayID and PayTo | Place order succeeds with server settlement checks |
| Forged/edited/missing receipt | Required webhook rejects order |
| Another quote/store/amount/currency | Required webhook rejects replay |
| Reprice cart after payment | No order acceptance for a mismatched amount; recovery/refund required |
| Customer closes tab / login expires / stock disappears | No automatic second payment; operator recovery works |
| Lost placeOrder response | Find existing order; no duplicate debit |
| Required webhook timeout/API failure | Fail closed with useful message |
| AutoInvoice off/on | Off does not invoice; on creates one full offline invoice |
| Repeat/concurrent reconciliation | No duplicate invoice; inspect ambiguous failures |
| Refund | Dashboard refund plus matching offline credit memo |
| Alarm first and subsequent runs | Visible successful activations and failure alerts |
| Multi-store configuration | Correct store scope and explicit OOPE store registration |
| Doc/tooltips | Admin can follow profile, UAT and production guidance |
| Modal close/Escape/reopen and full-page escape | Same payment/receipt retained; closing is not cancellation; no duplicate request |
| Modal PayTo/mobile bank/passkeys | Supported browsers complete the bank journey or use the explicit same-payment full-page escape |
| Forged iframe COMPLETE or wrong message origin/source | Never proof of payment; native placement still requires server verification |

Also verify the real API response includes `PaymentRequest.checkoutUrl`,
`PaymentRequestStatus.paymentRequestId`, `status`, `amountReceived` and `settledBy`,
and that webhook fields and Commerce REST quote/invoice shapes match the
documented contracts. Resolve discrepancies with Adobe/Azupay; do not weaken the
checks.

## Production release

- [ ] Azupay commercial/due-diligence/UX/UAT approvals complete.
- [ ] Separate production clients configured for selected hosted experiences.
- [ ] Production secrets and confirmed checkout hostnames in a production workspace.
- [ ] All applicable UAT cases above passed and evidence retained.
- [ ] Storefront integration tested in a real browser and on mobile bank handoff.
- [ ] Payment-before-order abandonment/refund runbook staffed.
- [ ] Native help descriptions inspected in your tenant's Admin UI.
- [ ] Required Commerce webhook authenticated and impossible to bypass.
- [ ] Invoice scheduler tested, monitored and within volume/time limits.
- [ ] No secrets in Git, storefront assets, error output, URLs or analytics.
- [ ] `AZUPAY_ALLOW_PRODUCTION=true` deployed, Admin environment set to Production,
  and Production approval completed checked.
- [ ] Controlled low-value real transaction and, where appropriate, refund verified.
- [ ] Rollback plan: disable new sessions, preserve existing profiles, drain/reconcile.

The local suite uses stubs at external boundaries. It does not replace any of
these live-account acceptance tests.
