# Setup: from empty folder to UAT checkout

Start with the [merchant installation guide](README.md) for the supported scope
and ordered overview. This page provides the detailed developer/admin reference.

Do these steps in order. A local build cannot complete your Adobe association,
enable Azupay products, or certify the integration without your accounts.

## 1. Obtain access

You need:

- An Adobe organization with **App Builder**, Runtime and an **Adobe Commerce as
  a Cloud Service** tenant. Your Adobe login needs Developer permissions.
- A Commerce administrator role with **Admin UI SDK > App Management** permission.
  Adobe documents Admin UI SDK 3.3.0+ for App Management; ACCS manages its platform
  modules. Do **not** run the Composer commands from the PaaS starter instructions.
- Azupay UAT onboarding: NDA, requested business information, client ID, API
  permissions and an approved PayID domain. Production separately requires a
  commercial agreement, due diligence, UAT and UX approval.
- A headless checkout you can modify, with HTTPS preview and production origins.

**Checkpoint:** you can open both consoles and a Commerce UAT storefront.

## 2. Provision the hosted Azupay experiences

Ask Azupay to enable Pay by Bank hosted checkout and **one-off** PayTo where
needed. In Azupay Dashboard > Apps > Checkout/Pay by Bank, configure each client:

| Commerce choice | UAT environment variable prefix | Hosted client configuration |
| --- | --- | --- |
| PayID | `AZUPAY_UAT_PAYID_` | PayID only |
| PayTo | `AZUPAY_UAT_PAYTO_` | PayTo only, once-off |
| Both | `AZUPAY_UAT_BOTH_` | PayID and PayTo, once-off |

Each prefix has `CLIENT_ID` and `API_KEY`. Production uses
`AZUPAY_PRODUCTION_PAYID_`, `AZUPAY_PRODUCTION_PAYTO_`, and
`AZUPAY_PRODUCTION_BOTH_`.

Only provision/populate choices you intend to offer. Missing selected profiles
fail explicitly rather than silently falling back. Ask Azupay to confirm separate
client provisioning: this project does not create sub-clients automatically.
Branding, default landing product and hosted payment options stay in Azupay's
dashboard; they are not imaginary API flags.

Generate the **SECR** key with the narrowest PaymentRequest create/read access
available for each client. No browser-side DIST key is required. Do not grant
outbound payment permissions unless independently needed by your business.
Record the **exact UAT and production checkout hostnames** supplied by Azupay.
The examples in `.env.example` are starting points, not proof of your account's
checkout hostname.

**Checkpoint:** Azupay confirms the selected client returns a `checkoutUrl` with
the requested PayID/PayTo experience.

## 3. Install local tools

Use Node 24, matching the starter's Runtime target. The installed SDK supports
Node 22-24; the local test/build can also run on Node 22.

```sh
cd /absolute/path/to/azupay-commerce
nvm install 24
nvm use
npm ci
npm install --global @adobe/aio-cli
aio plugins:install @adobe/aio-cli-plugin-app
aio plugins:install @adobe/aio-cli-plugin-runtime
aio login
```

If a plugin is already installed, use its existing supported version. Do not
overwrite another project's global configuration without checking your selected
Adobe organization/workspace.

The official greenfield starter command is:

```sh
aio app init <new-directory> --repo adobe/commerce-checkout-starter-kit/apps/payment-method --github-pat "$GITHUB_PAT"
```

**Do not run that over this folder.** This folder already contains the Azupay
implementation and its starter-pattern manifests.

## 4. Create your App Builder project

1. Open [Adobe Developer Console](https://developer.adobe.com/console/), select the
   correct IMS organization, choose **Create new project > Project from template
   > App Builder**. Names/entitlements may vary by organization.
2. Name it, for example, `Azupay Commerce Payments`.
3. Use a dedicated development workspace for UAT. Create/use a separate workspace
   for production, preferably with production-only secrets.
4. Add **I/O Management API** and **Adobe Commerce as a Cloud Service**, with an
   **OAuth Server-to-Server** credential/product profile authorized for this
   Commerce tenant. This implementation does not require I/O Events services.
5. Download the selected **workspace configuration** JSON to a secure location.
6. From this project folder, connect the CLI to that workspace:

```sh
aio app use /absolute/secure/path/to/workspace.json
```

Select/merge the workspace configuration as prompted. Alternatively use the
interactive `aio app use` flow supported by your installed CLI. Confirm the
workspace is the intended UAT workspace before continuing. `aio app add service`
is available if you prefer adding services from the CLI.

The workspace export, `.aio`, Runtime auth and IMS client secrets are secrets.
Keep exports outside the repository, or use the ignored `workspace.json` filename.
Do not invent Runtime credentials or use credentials from another application.

**Checkpoint:** the CLI has a real Runtime namespace/auth and the Commerce
server-to-server credential for the same organization.

## 5. Populate the ignored secrets file

```sh
cp .env.example .env
chmod 600 .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `AZUPAY_SIGNING_SECRET`. Do not paste it into chat.
Fill the selected Azupay UAT `CLIENT_ID` and `API_KEY`. Keep
`AZUPAY_ALLOW_PRODUCTION=false`.

Set:

- `AZUPAY_STOREFRONT_ORIGINS`: exact HTTPS origins, comma-separated, such as
  `https://uat-shop.example.com`. No paths, trailing slash, wildcard or HTTP.
- `AZUPAY_CHECKOUT_HOSTS`: exact hosted-payment hostnames confirmed by Azupay.
  No schemes/paths/wildcards. UAT may use a different host from production.
- All `AIO_COMMERCE_AUTH_IMS_*` entries using the OAuth credential exported by
  `aio app use`/Developer Console. Preserve the CLI's format for
  `AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS` and scopes rather than guessing it.
  In particular, SDK credentials may use a JSON array of client secrets.

Runtime namespace/auth come from the selected workspace. The associated Commerce
API base URL comes from App Management association; the code does not accept a
shopper-provided backend URL.

No secrets go into the configuration schema, storefront, `custom_config`, docs,
or HTML. `.env.example` deliberately contains no working credentials.

Before publishing source, follow the [repository publication checklist](PUBLISHING.md).
If you initialize Git in a new application folder:

```sh
git init
git check-ignore .env .aio workspace.json
git status --short
```

Check that `.env` and exports are ignored before your first commit. Gitignore
does not protect a secret already tracked: remove it from tracking and rotate it
if that ever happens. Store deployment secrets in your CI secret manager.

**Checkpoint:** the selected profile is filled, production remains blocked,
and secret files cannot accidentally enter a normal `git add`.

## 6. Build, deploy and install

```sh
npm run verify
aio app build --force-build
aio app deploy --force-deploy --no-build
```

The first command checks code, tests logic, generates the two Adobe extension
points and produces portable bundles/docs. The `aio` commands perform the actual
authenticated Adobe packaging/deployment. Do not edit `.generated` files.
Keep `--force-deploy` when updating a published Production workspace: without
it, the CLI can exit successfully while reporting that deployment was skipped.
Check for actual deployed actions in the output, not just a zero exit code.

Full deployment also installs `reconcile-timer` and `reconcile-rule`, which call
private `azupay/reconcile` every five minutes. Verify both resources and the first
successful timer-driven activation before relying on automatic invoicing.
Action-selective deployment alone does not install a missing timer. See
[reconciliation operations](OPERATIONS.md) for verification and monitoring.

In Commerce Admin:

1. Go to **Apps > App Management** in the same organization.
2. Find **Azupay Pay by Bank**, associate it with your UAT Commerce instance.
3. **Install** the app and complete its custom registration/webhook steps.
4. Verify it is **Installed**, not Partially Installed.
5. Open configuration and **Sync commerce scopes** if needed.
6. Configure at global scope or the intended store-view scope. The payment service
   resolves settings by the quote/order's numeric `store_id`, using inheritance.

Installation registers the `azupay` OOPE method for AUD/Australia, initial order
status `pending`, and the default store. For other store codes, edit the `stores`
list in `scripts/create-payment-methods.js` before installation/upgrade. Confirm
the registration in Commerce; configuration inheritance alone does not register
additional stores.

The required validation webhook must map:

| Action field | Commerce source |
| --- | --- |
| `payment_method` | `data.order.payment.method` |
| `payment_additional_information` | `data.order.payment.additional_information` |
| `quote_id` | `data.order.quote_id` |
| `grand_total` | `data.order.grand_total` |
| `currency` | `data.order.order_currency_code` |
| `store_id` | `data.order.store_id` |

Its rule must be `data.order.payment.method equal azupay`, with required=true,
Adobe authentication enabled and a 20-second timeout. The availability webhook
passes `payload`, including `payload.cart.store_id`.
When Azupay is enabled and its configuration is valid, this webhook returns
the explicit `{"op":"success"}` operation to leave payment methods unchanged.
An empty operation array is not accepted by Commerce and causes
`cart.available_payment_methods` to fail with an internal server error.
When disabled, the webhook returns an `add` operation filtering out Azupay.
Configuration failures remain explicit exception operations. To investigate
delivery or response errors, open **System > Webhook Logs** in Commerce Admin.
These declarations are in `app.commerce.config.js`; do not create duplicate
subscriptions manually if installation already registered them.

The third subscription, `observer.sales_quote_save_after` (after), calls
`azupay/capture-cart` with `quote_id` sourced from `data.quote.id` and
`quote_entity_id` sourced from `data.quote.entity_id`. Both mappings are needed:
this SaaS tenant supplies the native identifier through `entity_id`. If both
identifiers are present they must agree. Adobe authentication is required.
The declaration requests `required: false`, so unrelated payment methods need
not depend on cart-mapping availability; Azupay session creation still fails
explicitly if its authenticated binding cannot be verified.

**Sandbox limitation:** a tested Adobe sandbox persisted this subscription as
`required: true` even when the API request specifies `false`, including after
recreation. Its corrected cart mapping has passed the isolated empty-cart test,
but an unavailable capture action can consequently block other cart saves.
Inspect the actual installed subscription rather than assuming the declaration
was honored. Resolve or explicitly accept this checkout-wide availability
dependency before production rollout; never disable settlement validation as a
workaround.
Existing installations need this new subscription as well as the two original
hooks. Do not skip it or replace the numeric quote binding with a browser value.

**Checkpoint:** all three webhooks are installed/authenticated and the method exists.
Try a fabricated receipt: order placement must fail.

## 7. Set the admin configuration

Each field has plain-language native help text supplied through `description`.

### Unlock inherited fields before editing

Fields marked **From Default** or with a parent-scope label are inherited and
their inputs are disabled until you choose an override. This also applies at
**Global** scope: it initially inherits the defaults from the app's schema.
Changing scopes alone does not unlock inherited fields.

1. Select an editable scope, such as Global, Website or Store View. Commerce and
   store-group nodes can intentionally be read-only.
2. Click the lock / **From Default** label beside the field.
3. Choose the override option, then edit the now-enabled input.
4. Repeat for each field you want to change and click **Save**.

The native UI may skip a write when the value has not changed, even after you
select an override. To verify saving, change a harmless setting, save and reload.
For example, temporarily change expiry from `30` to `31`, save and reload to
verify an explicit override. You can then change it back to `30` if desired.
Leave a field inherited if you want it to follow future parent/default changes;
use the inheritance control to remove an override when needed.

The native UI can store single-choice list values as one-element arrays (for
example `["both"]`) rather than strings. The payment actions normalize both
representations when reading configuration, before selecting credentials or
creating signed receipts. Empty selections, multiple selections and unknown
options remain explicit configuration errors; there is no fallback to another
payment profile.

For the first test:

| Field | Value |
| --- | --- |
| Enable Azupay | On |
| Environment | Staging / UAT |
| Payment methods | The provisioned test experience |
| Production approval completed | Off |
| Payment request expiry | `30` |
| Automatically invoice paid orders | Off until manual reconciliation test |
| Checkout experience | Full redirect until modal bank/browser UAT passes |

Save, then confirm inheritance at the actual storefront store view.
Keep unused profiles empty; selecting one produces a visible configuration error.
Never switch environments or reconfigure a hosted client while customers have
payments in flight. Disable **new** sessions first, drain/reconcile outstanding
payments, then change settings.

## 8. Wire your storefront

Follow [Storefront integration](STOREFRONT.md). App Builder deployment does not
modify an Edge Delivery Services/headless repository automatically.

Use the portable installer for a supported EDS layout, review its generated
outputs and publish them through the merchant's Code Sync process. The normal
EDS flow returns to the current checkout pathname; no new CMS return page is
needed. Other headless/standalone layouts must preserve shopper/cart context and
follow their documented return/completion adapter requirements.

For a repeatable demo, follow the
[PayID Test Bank and PayTo test-account walkthrough](OPERATIONS.md#demo-and-uat-with-the-azupay-test-bank),
based on Azupay's
[Testing the Pay by Bank App guide](https://developer.azupay.com.au/docs/test-accounts-1-click-checkout).
Use simulated payments only; never send real funds to UAT.

**Checkpoint:** a UAT shopper can create a session, pay on Azupay, return, and
place an order only after the server verifies `COMPLETE`.

## 9. Enable invoice reconciliation

Follow [Operations](OPERATIONS.md): full deployment provisions the five-minute
timer and rule. Verify their actual state and a successful timer-driven run.
Test a single offline invoice before enabling autoInvoice in the intended scope.
An offline invoice records an already-verified bank payment; it does not collect
another bank debit.

## 10. Promote to production

Complete every item in the [release checklist](OPERATIONS.md#production-release).
Use the production workspace and **production** client profiles, not UAT keys.
Set the deployment gate `AZUPAY_ALLOW_PRODUCTION=true`, deploy, select Production
and confirm approval in Admin. A dropdown alone cannot bypass the server gate.

Stop if any live contract check fails. Never remove payment validation to make a
checkout test pass.

## API Mesh (optional)

Enabling the API Mesh service in Developer Console provides access to that
service; it does not supply a deployed mesh endpoint or configure its sources.
The workspace export's API Mesh API key is not the Commerce OAuth
server-to-server credential.

This extension's payment creation, settlement verification and administrative
Commerce REST calls remain server-to-server in App Builder. No Mesh deployment
is required for them, and Azupay SECR keys must not become storefront credentials.
If your storefront already uses a deployed, correctly authenticated Mesh with a
Commerce GraphQL source, pass that existing transport to the storefront
`checkoutCompletion` helper. Preserve its shopper authentication, store headers
and payment/order mutations. Do not replace the trusted administrative REST
client with a public GraphQL endpoint.

Before wiring a new Mesh, obtain its actual endpoint and confirm the Commerce
source URL and authentication design. A workspace export alone does not
establish these settings.

Local onboarding exports and credential notes under `scripts/onboarding/` are
ignored by Git and excluded from Biome. Restrict those files, `.env` and `.aio`
to their owner (`chmod 600`). Do not commit or publish the onboarding directory.

## Association HTTP 500: discovery compatibility

Some Commerce registries reject discovery metadata during association. Azupay
provides a narrow compatibility guard that removes only `openApiSpecUrl` from a
successful root GET response.
App metadata, business configuration, webhooks, the OpenAPI route and Adobe
authentication remain unchanged. This is not a change from `/v2/extensions` to
`/v1/extensions` and does not bypass association.

The `build-actions` hook selects a non-generated wrapper after Adobe regenerates
its actions. Do not edit `.generated` sources or disable Adobe authentication.
Compatibility is on by default; set the build-time environment variable
`AZUPAY_APP_CONFIG_COMPATIBILITY=false`, then rebuild and deploy, to restore
unmodified SDK discovery for a deliberate future retest.

After deploying the guard, close the association dialog, hard-refresh Commerce
Admin, reselect the project/workspace, then retry association. Confirm successful
association in both Commerce and Runtime before proceeding to installation.
If the 500 persists, capture the failed request's status, response and request ID
without authentication headers/cookies; the workaround is not proof that every
App Management 500 has the same cause.

### Legacy sandbox registry: webhook discovery

In one sandbox, omitting OpenAPI discovery alone was insufficient; tests isolated
webhook discovery as the registration failure. This does not prove the same
cause for every HTTP 500. If your authorized diagnostics establish that case,
set these values in the ignored `.env` and rebuild/deploy:

```dotenv
AZUPAY_APP_CONFIG_COMPATIBILITY=true
AZUPAY_APP_CONFIG_OMIT_WEBHOOKS=true
```

The second flag defaults to **false** in `.env.example`. The build hook selects a
dedicated wrapper entrypoint for the authenticated, final app-config action.
The choice is compiled into the bundle, not passed as a request parameter.
When enabled, it
omits `webhooks` from successful root discovery responses only. The original
configuration still contains all three webhook declarations; the SDK installation
action imports that full configuration directly, not the filtered discovery
response. Installation, metadata, native Business Configuration, other routes,
errors and Adobe authentication remain intact. The registry may omit the
**Webhooks** capability badge; this is a deliberate compatibility limitation,
not permission to skip webhook installation.

Do not install an ad-hoc diagnostic record created by editing a registry request.
A registry 201 alone does not establish that the normal association callback or
scope sync completed. Use the normal App Management association flow.
Unassociation clears configuration: do not unassociate an existing configured
application as a generic troubleshooting step.

Before accepting the app, confirm the normal UI association and Runtime
association callback succeeded. During installation, verify that all webhook
steps remain present and complete. Then check the actual Commerce subscriptions:
the settlement hook must remain required and authenticated, and a fabricated
receipt must fail order placement. Keep production payments blocked until all
UAT checks pass.

To restore webhook discovery after the service is fixed, set
`AZUPAY_APP_CONFIG_OMIT_WEBHOOKS=false`, rebuild and deploy. Set the main
compatibility flag to false only after disabling this opt-in too.

Keep diagnostics in an access-controlled location outside the repository.
Do not execute copied shell text or publish headers, cookies, raw HAR exports
or full activation payloads. Record only redacted statuses/error codes for
support and remove temporary exports promptly.
