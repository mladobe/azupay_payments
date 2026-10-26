# Azupay Real Time Payments administration

## V2 menu and access

The application declares **Sales > Azupay Real Time Payments** through
`adminUi.menu` in the root Commerce app configuration. It uses the
`commerce/backend-ui/2` extension point and the
`@adobe/aio-commerce-lib-admin-ui/web` SDK to mount its page and receive Adobe
IMS context. It does not use V1 `ExtensionRegistration` or a separate menu
registration Runtime action.

The menu opens **Configuration** by default, with **Documentation** as a second
tab. This V2 page stays in the Commerce Admin iframe so its left navigation
remains available. The Documentation tab contains:

- Instructions for editing the shared, store-scoped App Management settings.
- Azupay UAT/production dashboard links, clearly separated.
- The PayID Test Bank, current PayTo test-account guide and UAT walkthrough.
- Payment completion, invoicing, paid-cart recovery and refund guidance.

The Configuration tab reads and edits the same native configuration storage;
there is no second settings database. It is **not a live payment dashboard or
health check**, and does not fetch API keys, payment records or scheduler state.
IMS tokens are not displayed, persisted or attached to external links. Links open in a new tab
without a referrer or opener. The menu requests only `allow-popups` for those
links. Save validates the form and calls the authenticated API directly, without
depending on native form submission inside the iframe. No unsupported
`allow-forms` override or top-navigation permission is requested.

`aclProtected: true` gives the menu a dedicated per-app Commerce ACL resource.
After installation/upgrade, a Commerce administrator must grant the Azupay menu
permission to the intended roles in **System > Permissions > User Roles**.
The menu permission now grants access to **read and edit Azupay settings through
this page**. Assign it only to roles that should configure payments. The backend
checks that permission with the signed-in admin's forwarded IMS token on every
read/save; it never uses the deployment technical account to authorize the user.
Native App Management access, order access, Azupay dashboard access and refund
privileges remain separate permissions.

If the page is opened outside the authenticated host, it shows an authentication
warning rather than implying an authenticated account connection.

## Configuration inside Commerce Admin

1. Open **Sales > Azupay Real Time Payments**. The Configuration tab is selected.
2. Select the intended global, website, store or store-view scope from the
   existing scope tree. Noneditable scopes are displayed read-only.
3. Clear **Use inherited / default value** for each explicit override you need.
   All fields retain the schema's labels, options and help descriptions.
4. Select **Save configuration**. Only changed fields are patched; checking
   inheritance sends `null` to remove the override rather than copying a parent
   value into the selected scope.
5. A confirmed reload shows the saved values. Refresh storefront checkout to
   load presentation changes.

Switching to Documentation and back retains the current scope and unsaved
draft. Save or discard before changing scope or reloading. After a failed or
ambiguous save, editing is blocked until configuration is reloaded so that a
possibly successful write is not mistaken for a failed one.

The authenticated `azupay/admin-config` adapter reuses Adobe's
`configRuntimeAction` and `scopeTreeRuntimeAction` handlers. It accepts only
configuration GET/PATCH and scope-tree GET, preserves native storage/encryption
and does not expose custom-scope creation, sync or deletion. Use native App
Management to sync/manage the scope tree when needed.

The older **Apps > App Management > Configure** route opens Experience Cloud,
not the Commerce Admin iframe. Its missing Commerce sidebar is a host difference,
not a CSS defect in Azupay. This extension does not inject a fake Commerce sidebar
or embed that separate page in a nested iframe.

## Install or upgrade the admin extension

Follow [installation](README.md) for workspace selection and private credentials.
The Adobe project must support **Commerce Admin UI SDK V2**, and the Commerce
tenant must expose the V2 host. Adobe's current
[V2 menu sample](https://github.com/adobe/adobe-commerce-samples/tree/main/admin-ui-sdk/v2/menu/custom-menu)
lists Admin UI SDK 4.2.0+ for V2; confirm availability with your ACCS tenant
administrator. Do not install PHP modules or use V1 as a silent fallback on ACCS.

1. Run `npm ci` and `npm run verify`. Local verification includes a credential-free
   admin browser bundle; it does not prove the Commerce host integration.
2. Check the intended Adobe project/workspace has the V2 extension enabled. The
   source manifest includes `commerce/backend-ui/2` alongside the existing
   extensibility and configuration extensions.
3. Build and deploy all extensions using your private workspace configuration:

   ```sh
   aio app build --force-build
   aio app deploy --no-build --force-deploy
   ```

   Before upgrading an existing installation, follow
   the [versioned release process](PUBLISHING.md#5-prepare-a-versioned-release).
   Reusing an installed metadata version is not a reliable way to trigger an
   lifecycle upgrade. This app explicitly uses `metadata.upgradeMode: "auto"`;
   the post-deploy hook plans and starts upgrades for an existing installation.

4. Complete the Adobe publication/approval flow if prompted. For a first
   installation, use **Install** in Commerce **Apps > App Management**. For an
   existing SDK installation, let the post-deploy automatic lifecycle upgrade
   finish and verify its result; do not assume there is an **Upgrade** button.
   Grant the new menu ACL to the intended roles. Do not uninstall a payment app
   with unsettled or unreconciled payments just to refresh its menu.
5. Sign out/in or reload the Admin if its menu cache needs refreshing. Open
   **Sales > Azupay Real Time Payments** and verify it renders within Commerce.
6. Test both an allowed and a denied admin role, Configuration/Documentation tabs,
   scoped inheritance, saves and external links. If the menu is missing, check V2
   availability, deployed web assets, approval/association state and ACLs.

For an already-published Adobe Production workspace, `--force-deploy` can update
Runtime/CDN assets while reporting **skipping publish phase**. That does not
register a newly added V2 extension point. Coordinate the supported Adobe
Exchange retraction/republication and approval process with the application owner
before expecting the menu to appear. Publication changes can affect availability;
drain and reconcile payments first. Do not delete the Commerce installation as a
substitute.

### No Upgrade button / manual plan does not execute

An **Associated** card with **Install** does not prove the SDK has no installation
baseline. App Management card state and SDK lifecycle state must be checked
separately. SDK 2.0.0 defaults an omitted `metadata.upgradeMode` to `"manual"`:
the deploy hook creates a plan but does not execute it. Its CLI does not expose an
`upgrade apply` command, and this Admin view need not provide an **Upgrade**
control. Repeatedly clicking Install does not override the manual policy.

This app explicitly sets `"auto"` so supported versioned deployments plan and
execute the existing installation's upgrade through Adobe's post-deploy hook.
This policy also applies to future versioned deployments; review plans and UAT
evidence before deploying. Verify lifecycle completion rather than treating a
successful CDN upload as a successful upgrade. If execution fails or times out,
inspect its state before retrying the normal hook. Do not edit SDK state,
invoke internal execution routes, or unassociate to force an upgrade.

See Adobe's [Admin UI SDK overview](https://developer.adobe.com/commerce/extensibility/admin-ui-sdk/)
and [V2 extension contracts](https://developer.adobe.com/commerce/extensibility/admin-ui-sdk/extension-points/v2/).
Live installation, host handshake, menu cache and ACL behavior must be checked
in the target tenant; a standalone browser preview is not that acceptance test.

## App and checkout names

The app display name and admin menu remain **Azupay Real Time Payments**.
From 0.1.9, the shopper-facing default and newly registered OOPE payment title
are **Pay by Bank**, following Azupay's UX naming recommendation. The existing app ID
`azupay-pay-by-bank`, payment code `azupay`, Runtime action names, receipt/session
contracts and storefront installer identity remain unchanged.

Merchant-defined checkout titles are preserved. Existing saved/inherited values
may still contain the old label after an upgrade: open **Apps > App Management >
Azupay Real Time Payments > Configure**, select each applicable scope and set
**Checkout payment title** explicitly to the new name, or retain your custom
name. Reload storefront checkout after saving.

The registration script supplies the new OOPE title when it is run by the
installation lifecycle; changing source alone does not rewrite an existing
Commerce method record. Do not assume a redeploy reruns installation. The
storefront branding hook applies the effective scoped title on supported EDS
checkouts. No manual edits to the merchant's generated browser bundle are needed.

## Customer education and PayTo terms

Configuration includes rail-specific education URLs and link text, inherited
through the same store scopes as other settings:

- PayID information, step-by-step instructions, benefits and further reading.
- PayTo bank approval instructions.
- Your merchant-specific PayTo terms URL and link text.

Defaults point to customer education resources linked by Azupay's
[PayID UX guide](https://helpcentre.azupay.com.au/docs/payid-ux-guide) and
[PayTo UX guide](https://helpcentre.azupay.com.au/docs/payto-ux-guide).
Replace a URL/label with your own accessible help content. Clear a URL to hide
that link. URLs must be absolute HTTPS without credentials (anchors are allowed);
labels must be nonempty plain text up to 100 characters. Links open in a new tab
without an opener or referrer. Only links for enabled methods are returned.
Changes apply after refreshing checkout; API credentials never enter the links.

**Show PayID / PayTo payment instructions** controls the explanatory paragraphs
independently of the links. PayID wording distinguishes a transfer to the
recipient PayID from the customer's own PayID. PayTo wording refers to a
**PayTo agreement**, bank-app/internet-banking approval and the separate need to
verify settlement. Both appear when both methods are enabled.

Before launch, supply your merchant PayTo terms URL, or arrange with Azupay to
host those terms and confirm **Merchant PayTo terms are available in hosted
checkout**. The embedded editor warns when neither is configured. Generic help
or marketing content is not a replacement for your legal terms. The extension
does not invent terms, claim consent was recorded, or add a local checkbox that
could conflict with the hosted payment flow. Review the actual hosted acceptance
and authorisation experience with Azupay.

The combined payment option and existing logo permission gate remain. The editor
also warns when logos are disabled or official logo permission is absent.
Configure approved marks before launch; do not enable permission without usage
rights. Hosted checkout remains responsible for displaying amount, merchant
identity, recipient PayID, payment description/copy controls, PayTo account input,
terms acceptance, approval progress and expiry. Verify all of these in real UAT.
These changes implement the storefront education portions of the guides, not
certification or every optional recommendation (such as incentives/cashback).

## Payment priority and native Commerce ordering

The integration preserves the exact `available_payment_methods` order returned
by Commerce and does not select/reorder other methods. Continue configuring
other methods' native **Sort Order** in Commerce Admin.

The current ACCS OOPE REST schema has no top-level `sort_order` property. A
read-only check of the tenant's `system/config` API returned native sort orders
for standard methods but did not expose `payment/azupay/sort_order`. The
system-config update API accepts only allowed/visible/ACL-authorized paths.
There is therefore no supported numeric Azupay priority control in this version;
the app does not offer a nonfunctional field, guess another method's priority,
or force Azupay to the top. A custom storefront that reorders methods independently
must be reviewed separately.

See Adobe's [OOPE payment API](https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/payment-reference)
and [ACCS REST reference](https://developer.adobe.com/commerce/webapi/reference/rest/saas/).

## PHP extension comparison

Reviewed against Azupay's Marketplace
[Real Time Payments listing](https://commercemarketplace.adobe.com/azupay-payments.html)
and [PHP extension v2.0.0 user manual](https://commercemarketplace.adobe.com/media/catalog/product/azupay-payments-2-0-0-ece/user_guides.pdf),
particularly sections 3-7. This is a feature comparison, not a claim of feature
parity or certification; the PHP module targets a different deployment model.

| PHP setting or feature | This ACCS/App Builder implementation |
| --- | --- |
| Enable/disable and customer-facing title | Supported in native scoped configuration; title, byline and logos are configurable |
| Test/production selection and API key | UAT/production selection supported; keys deliberately remain in private deployment profiles, not browser/admin form fields |
| Checkout App enablement, payment options, company logo/accent | Configure Azupay's hosted Checkout App in its merchant dashboard; Commerce-side branding does not replace hosted appearance settings |
| Payment method sort order | Native Commerce order is preserved; current ACCS OOPE API does not expose an editable numeric Azupay sort order |
| Debug switch and local Magento log files | No merchant-facing debug toggle or PHP log files; use restricted App Builder activations and error codes without exposing payment payloads or tokens |
| Automatic invoice after payment | Supported through independent server verification and scheduled reconciliation, normally within the next five-minute run rather than an immediate provider callback |
| Full and partial online refunds through credit memos | Not implemented; `can_refund` remains false. Use an authorized dashboard refund and matching offline Commerce credit memo |
| Payment information and transaction search | Commerce orders/invoices plus Azupay dashboard; no embedded transaction search or reporting screen yet |
| Cart restoration after cancellation | Existing cart/session retained; modal close is not bank cancellation. A closed/expired payment needs reconciliation before a fresh attempt |
| PayID and PayTo UAT | Documented Test Bank and current fictitious accounts; test both presentation modes |

The PHP manual's invoice-ID transaction search does **not** apply here:
this app uses a deterministic `commerce-<hash>` client transaction ID bound to
the quote/store/amount/profile, with the quote ID in the description. Use the
request ID or that transaction ID for authorized dashboard investigation.
Likewise, only API status `COMPLETE` is accepted; do not substitute UI wording
such as `COMPLETED`, or treat PayTo agreement `ACTIVE` as payment completion.

For current test hosts/accounts, prefer Azupay's
[online testing guide](https://developer.azupay.com.au/docs/test-accounts-1-click-checkout)
over older examples in the PHP PDF. Use the
[demo/UAT walkthrough](OPERATIONS.md#demo-and-uat-with-the-azupay-test-bank)
and [refund runbook](OPERATIONS.md#refunds-and-credit-memos).
