# Storefront installation

For the full merchant sequence, start with [Installing the Azupay app](README.md).

All authored EDS payment code, installation logic and behavioral tests live in
the Azupay project. A merchant installs generated outputs into their own
storefront repository. **App Builder deployment does not publish changes to
that repository.** This extension does not insert code into Luma themes.

## 1. Prerequisites

- Install and associate the App Builder extension with Commerce first.
- Configure Azupay for UAT; leave real-money production disabled during testing.
- Use Node 22 or newer for the installer.
- Start on a merchant feature branch and preserve/review any existing changes.
- Use synchronous order placement, not B2B purchase-order approval. AsyncOrder
  requires separate validation/adaptation and is not supported by this installer.

Automatic installation supports **Checkout drop-in 3.x and the Commerce
boilerplate 6.x-style source layout**: separate `commerce-checkout.js` and
`containers.js`, the standard order handler, form references and payment/button
slots. The merchant's project name, domain, repository and Runtime namespace are
not assumed. Other/customized layouts require the manual adapter below.
Website agnostic does not mean every checkout can be patched automatically.

## 2. Build or obtain the installer

In the Azupay project:

```sh
npm run build
node dist/eds/bin/install.js --target /absolute/path/to/storefront --dry-run
node dist/eds/bin/install.js --target /absolute/path/to/storefront
```

For another merchant, distribute `dist/azupay-commerce-eds-0.1.12.tgz`.
This archive contains a self-contained Node installer, the browser bundle and
this guide. It contains no Adobe/Azupay credentials and needs no additional
runtime dependencies.

```sh
mkdir azupay-eds-installer
tar -xzf /path/to/azupay-commerce-eds-0.1.12.tgz -C azupay-eds-installer
node azupay-eds-installer/package/bin/install.js \
  --target /absolute/path/to/storefront --dry-run
node azupay-eds-installer/package/bin/install.js \
  --target /absolute/path/to/storefront
```

The installer:

- Adds the generated `scripts/azupay/client.js` browser bundle.
- Wraps the existing native order handler, preserving existing outer merchant
  guards, form validation, other payment slots and order-confirmation events.
- Registers an Azupay payment slot and Continue/Complete order button labels.
- Locks cart-changing controls while a bank payment is outstanding.
- Returns to the current checkout pathname, including a localized/custom path;
  a new CMS return page is not required.
- Reads `action_base_url` and `backend_integration_url` from the current cart's
  OOPE payment configuration through the existing shopper-authenticated GraphQL
  transport. No namespace, storefront host or secret is embedded in the bundle.
- Creates `.azupay-eds-installation.json` with release/content hashes. Repeating
  the same installer is a no-op. Edited installed files, unmanaged Azupay code,
  changed releases, symlinked targets and unsupported layouts fail explicitly.
  The explicit `--upgrade` option supports reviewed releases 0.1.0 through 0.1.11
  to 0.1.12 after verifying every installed file's hash.

Preflight checks all planned edits before writing. Do not run concurrent
installers or edit checkout files during installation. Keep the installation
manifest with the source changes. For an upgrade, review both the merchant's
checkout changes and the new release before replacing an installation.

### Upgrade an unchanged 0.1.0 through 0.1.11 installation

```sh
node dist/eds/bin/install.js --target /absolute/path/to/storefront --upgrade --dry-run
node dist/eds/bin/install.js --target /absolute/path/to/storefront --upgrade
```

This updates the generated browser bundle, wraps the native PaymentMethods
renderer for scoped selector branding, registers the live bank-payment order-button
label in `blocks/commerce-checkout/containers.js`, and updates the installation
manifest (0.1.3 through 0.1.11 already have the button registration). For 0.1.0/0.1.1 it also
adds the documented GraphQL branding hook to `scripts/initializers/checkout.js`;
an existing 0.1.2 through 0.1.11 initializer is preserved. The native
order handler is unchanged. Publish all changed outputs through Code Sync.
If any installed file has been edited since installation, stop and review it;
the installer will not overwrite it or bypass hash verification.

The 0.1.6 admin-menu/name update and 0.1.7 configuration tabs do not change the
0.1.5 browser payload. Existing 0.1.5/0.1.6 storefronts do not need reinstalling
for these admin changes or server-provided default title. An optional reviewed
upgrade updates the installer manifest without changing an otherwise unchanged checkout.

Version 0.1.8 changes the browser payload to fix oversized checkout logos.
Upgrade and publish the installer outputs through your storefront's normal Code
Sync workflow. Deploying App Builder alone cannot apply this browser fix.
Official and custom logos use 100 x 48 CSS-pixel boxes, with `object-fit: contain`
to preserve proportions and a wrapping row on narrow screens. Explicit CSS
dimensions prevent generic storefront rules such as `main img { width: auto;
height: auto; }` from expanding the images to their intrinsic size.

Version 0.1.9 adds configurable customer education and terms links. Deploy the
App Builder schema/backend and publish the upgraded browser bundle. New bundles
tolerate older branding responses without guidance; older bundles ignore new
guidance until upgraded. Payment validation and final native order confirmation
are unchanged.

Version 0.1.10 replaces the expanded instructions/education list with a combined
plain-text instruction popover. Deploy the new backend/schema and publish the
new browser bundle for configured textarea content. An older branding backend
still works: its enabled-rail instructions appear inside the popover. PayTo terms
stay outside the popover and are not hidden by the instructions toggle. No
changes to Azupay's hosted checkout are made.

Version 0.1.11 removes the five legacy education/approval URL and label pairs
from the configuration schema and public branding. It keeps the combined tooltip
and merchant PayTo terms URL/label. Deploy the backend and configuration/admin
assets for this cleanup. The 0.1.10 browser payload is unchanged and does not
require reinstalling; an optional installer upgrade updates its manifest.
Older 0.1.9 clients no longer receive external education links.

Version 0.1.12 white-labels shopper copy and the modal heading, adds an optional
32-character badge, and shows approved logos/byline/badge in the bank method's
native selector. The renderer wrapper is installed in `containers.js`; it uses
the current cart cache ID, observes only that container and decorates the
existing radio's label without replacing native input, title or selection
handlers. Native method ordering is unchanged. The observer and branding
subscription are cleaned up on removal or failed rendering. Revalidate the
drop-in's native radio/label contract on future Adobe upgrades. Details-slot
branding remains available when the wrapper is not installed. Deploy the new
schema/backend and publish all upgraded storefront files, not just the bundle.

## 3. Review, build and publish the merchant storefront

Run in the **merchant storefront repository**:

```sh
npm run install:dropins
npm run lint:js
git diff
git status --short
```

Review these installation outputs:

- `blocks/commerce-checkout/commerce-checkout.js`
- `blocks/commerce-checkout/containers.js`
- `scripts/azupay/client.js`
- `scripts/initializers/checkout.js` (registers the GraphQL branding hook)
- `.eslintignore` (the generated bundle is excluded, not the authored checkout)
- `.azupay-eds-installation.json`

Publish only the intended changes through the merchant's normal feature-branch,
review and AEM Code Sync process. Do not commit unrelated merchant work,
credentials or the installer archive into the served storefront.

This implements Adobe's
[EDS integration guide](https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/eds)
and [payment-method tutorial](https://experienceleague.adobe.com/en/tools/commerce-storefront/how-tos/add-payment-method).
Rather than altering `CHECKOUT_DATA_FRAGMENT` and `CartModel`, the adapter
explicitly queries the same documented OOPE fields just before using them:

```graphql
query AzupayPaymentConfiguration($cartId: String!) {
  cart(cart_id: $cartId) {
    available_payment_methods {
      code
      oope_payment_method_config {
        backend_integration_url
        custom_config {
          ... on CustomConfigKeyValue { key value }
        }
      }
    }
  }
}
```

This avoids overwriting existing merchant model transformations or editing
generated drop-ins. If the merchant already uses API Mesh, its existing shopper
GraphQL transport remains in use. Do not expose server credentials through Mesh.

## Configure the checkout title, byline and logos

In **Sales > Azupay Real Time Payments > Configuration** (or the native
**Apps > App Management > Azupay Real Time Payments > Configure** page), choose the
appropriate store scope. Unlock inherited fields before editing, then save:

| Setting | Usage |
| --- | --- |
| Checkout payment title | Plain-text payment-selector label, up to 100 characters; default: Pay by Bank (existing custom titles are preserved) |
| Checkout payment byline | Explanation in the selected payment detail panel, up to 250 characters; blank hides it |
| Checkout logos | Official PayID/PayTo, Custom hosted images, or No images |
| Permission to use official PayID / PayTo logos | Confirm only when your AP+ or payment-provider agreement grants usage rights |
| Custom checkout image 1/2/3 URL | Public HTTPS image URLs from your existing media library |
| Custom checkout image 1/2/3 description | Required accessible text for each configured custom image |
| Show payment instructions tooltip | Show one combined instruction popover; does not hide terms |
| Payment instructions tooltip label | Trigger/heading, up to 100 characters; default: How do I pay by bank? |
| Payment instructions | Plain-text textarea, up to 4,000 characters; preserves line breaks; blank hides the popover |
| PayTo terms and conditions URL / link text | Your own merchant terms, not a generic help article |
| Merchant PayTo terms are available in hosted checkout | Confirm only when Azupay has configured your terms there |

See [customer education, UX responsibilities and native payment ordering](ADMIN.md#customer-education-and-payto-terms).
For numbered screenshots of the actual controls, use the
[illustrated configuration walkthrough](ADMIN.md#illustrated-configuration-walkthrough).
The browser integration preserves Commerce's method order. It does not add a
frontend priority override or claim numeric Azupay sort-order support.

Upload custom images to your storefront CMS/media library, not App Management;
the native configuration UI has no file-upload control. Paste the resulting
direct image URLs, select **Custom hosted images**, save and refresh checkout.
PNG, WebP or approved SVG image assets served with the correct image content type
are suitable; do not paste HTML, a portal page URL, credentials or expiring links.
Add each image host to your storefront's `img-src` CSP. Images preserve aspect
ratio and have accessible descriptions. Failed images show a visible notice.

Official mode automatically chooses PayID, PayTo or both to match the configured
payment methods. Official wordmark URLs are sourced from the
[PayID portal](https://brandportalpayid.auspayplus.com.au/) and
[PayTo portal](https://brandportalpayto.auspayplus.com.au/), not recreated or
copied into the installer. Both portals require permission to use AP+ intellectual
property; download access alone is not permission. Therefore the confirmation
defaults to off and no official images are requested until enabled. Follow the
brand guidelines and allow `https://firebasestorage.googleapis.com` in `img-src`
if using the supplied portal-hosted defaults. External URLs may change; for
long-term control, host your approved assets yourself and select custom images.

The public `checkout-branding` action returns the effective title, byline,
logo URLs/descriptions, instruction tooltip and scoped guidance/terms links
for the requested Commerce store-view code. It never
returns credentials, admin configuration or customer data and never proxies
remote image requests. Commerce resolves store codes server-side. Exact-origin
CORS and no-store responses apply.

The installed initializer registers `CORE_FETCH_GRAPHQL.addAfterHook` before
checkout initializes. It reads OOPE deployment metadata through the existing
shopper transport, fetches store-scoped branding and updates only Azupay's
available/selected titles before native drop-in transformation. It preserves
other methods, auth headers, model transformations and other hooks. The detail
slot provides a compatible byline/image/badge display for manual integrations.
The installed selector enhancement adds these to the native bank label instead
and hides duplicate selected-detail branding only after finding that label.
Settings are cached for the page lifecycle; reload checkout after saving.
Cosmetic configuration failures retain the original Commerce title, log
`CHECKOUT_BRANDING_UNAVAILABLE` and show a visible warning when Azupay is selected,
rather than breaking unrelated payment methods or hiding the failure.

## 4. Allow the merchant origins and Runtime connection

Add each exact HTTPS storefront origin to server-side
`AZUPAY_STOREFRONT_ORIGINS` in the private Azupay deployment configuration and
redeploy Runtime. Preview, live and custom domains are different origins; allow
each required one explicitly, never a wildcard. Keep `.env` private.

Preserve CSP `connect-src` access to the actual Runtime action host. Full-page
Azupay redirects do not require loading an iframe or bank SDK in the storefront.
The registered payment method supplies the public URL; never copy IMS or Azupay
keys into a frontend config. Do not expose the private `reconcile` action.

## 5. UAT checkout behavior

1. Use an eligible Australian AUD cart and complete email, addresses, shipping,
   discounts, taxes and required consent/terms.
2. Select the configured bank method (recommended title **Pay by Bank**) and
   click **Pay by Bank**.
3. The server verifies trusted quote totals and creates/reuses a hosted session.
   The browser stores only the signed receipt/session in same-tab storage.
4. Pay through Azupay UAT and return to the existing checkout, or finish payment
   in the optional modal and wait for server verification to close it.
5. Review checkout, accept required terms and click **Complete your order**.
   Returning alone does not place the order.
6. Only verified `COMPLETE` status attaches the signed receipt and calls the
   merchant's existing native order handler. The required Commerce webhook
   independently rereads the provider and rejects unpaid/mismatched orders.
7. A payment not yet confirmed is checked without another provider request.
   Redirect sessions do not loop back to Azupay; modal sessions can reopen the
   same payment window.
   Failures/unconfirmed orders retain the receipt and show a do-not-pay-again
   warning. Other payment methods cannot place this cart while it is outstanding.

Test guest and signed-in carts, different store views, decline/expiry/pending,
refresh/return, terms validation and other payment methods. Only session creation
sends the current customer token to Runtime; that token is not stored in browser
payment-session records. Never substitute Adobe IMS or Azupay credentials.

Do not enable production until the [operations/UAT gates](OPERATIONS.md) pass.
The current sandbox's cart-capture hook persists as Required despite requesting
otherwise; see [setup limitations](SETUP.md) before a production rollout.

The return message does not assume a stored session means payment succeeded.
It explains that completing the order verifies the existing payment without
creating a second payment. Order placement still requires the customer's final click
so the host's current form/consent validation and merchant guards execute.

## Embedded/modal checkout

In native App Management configuration, select **Checkout experience**:

- **Full redirect** (default): open Azupay in the current tab, then return to
  checkout. Existing installations and older saved sessions keep this behavior.
- **Modal window**: keep the merchant checkout behind a native modal dialog.
  Azupay [documents iframe checkout and status messages](https://developer.azupay.com.au/docs/configurations).
  The adapter adds `type=iframe` and removes return/cancel navigation from the
  iframe URL. It never embeds the merchant checkout inside itself.

Select the appropriate store scope, unlock the inherited field, save, and start
a new payment session. Saved sessions retain their original experience so
configuration changes do not interrupt an outstanding payment.

**CSP:** permit your actual Azupay checkout origins in `frame-src`, in addition
to Runtime in `connect-src`. Use the exact HTTPS hosts in
`AZUPAY_CHECKOUT_HOSTS`, not a wildcard. Current UAT profiles use
`https://pay.uat.apps.azupay.com.au` and/or `https://pay-stg.azupay.com.au`;
production hosts must be taken from your approved provider configuration.
This is merchant/CDN CSP configuration; the installer does not loosen policies.

The modal has a labelled iframe, native focus containment, Escape/close, focus
restoration and scroll locking. **Close payment window** stays visible;
**Need help with your payment?** contains **Check payment status** and
**Open payment in full page**, using the same payment and original return URL.
Checking only verifies status; it never creates another payment. The disclosure
opens automatically on embedding/verification failure, polling pause or
unsupported dialogs.
Closing is not cancellation and does not remove the saved receipt or unlock cart
changes. Select **Complete your order** to check/reopen the same saved session.

Provider messages are accepted only from the exact iframe origin and window,
and only trigger server verification; browser message status is never payment
proof. Five-second automatic checks pause after 60 checks or a verification
failure; the explicit check button remains available. Server-confirmed payment
closes the modal and asks the shopper to select **Complete your order**, allowing
the host's current terms, forms and merchant guards to run before placement.

Test guest/signed-in flows, close/Escape/reopen, refresh, pending/expired/failed
verification and the full-page escape. Test actual PayID bank handoffs and PayTo
bank approval/passkeys on your supported mobile and desktop browsers before
enabling modal for customers. Cross-origin iframe/passkey policy and bank-app
handoffs depend on the provider/browser. A full-page escape is always available
in the help disclosure;
embedding failures are not silently treated as success. Azupay hides its PayID
QR below 600px iframe width, so narrow phones use the provider's mobile layout.
Keep full redirect if your supported bank/browser journey cannot run embedded.

## Other headless checkout layouts

`npm run build` also emits:

- `dist/storefront/client.js`: self-contained EDS adapter.
- `dist/storefront/flow.js`: framework-independent hosted-session controller.
- `dist/storefront/commerce.js`: receipt-attachment and standalone order helper.
- `dist/storefront/azupay.js`: generic DOM/button adapter.

For a different native checkout, import `guardAzupayPlaceOrder`,
`hasPendingPayment`, `azupayPaymentSlot` and `azupayButtonLabel` from `client.js`.
Supply the wrapper with the same options as the generated installation:
`block`, authenticated `graphql(query, variables)` returning `{data, errors}`,
`storeCode`, `authorization()`, same-origin `returnUrl`, `confirmedOrder()`,
`purchaseOrder()` and `lockCart(locked)`. Keep the host's validation and custom
guards outside the wrapped native handler. Do not replace its checkout wholesale.

For a non-native standalone button, use `mountAzupay` from `azupay.js` and
`checkoutCompletion` from `commerce.js`. Validate readiness and freeze cart
controls **before starting payment**. Use a distinct same-origin HTTPS return
path without query/hash (for example `/azupay-return`) and restore the original
cart/customer context there. This generic adapter can auto-complete on return;
do not run a competing native order handler. Its completion helper requires a
confirmed synchronous `orderV2.number`.

All completion paths must attach:

```json
{
  "code": "azupay",
  "additional_data": [
    {"key": "azupay_receipt", "value": "SERVER_SIGNED_RECEIPT"}
  ]
}
```

Use `setPaymentMethodOnCart` for the same masked cart, then native placement.
Never accept a browser `paid` flag, redirect alone or manually set order status.

## Recovery limitations

Same-tab storage survives the hosted redirect, not every tab/browser closure.
The unchanged cart uses deterministic Azupay `clientTransactionId` values to
recover a lost create response. Never change the amount, environment, client or
experience to bypass a failure. A lost confirmation must be recovered through
Commerce order history/support, not another debit.

Payment before order placement can leave a paid cart without an order after
stock loss, cart/login expiry or a checkout failure. Follow the operations
runbook. This release does not automatically cancel, refund or manufacture an
order in that situation.
