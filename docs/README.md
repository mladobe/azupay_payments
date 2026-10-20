# Installing the Azupay app for Adobe Commerce

## Overview

This guide takes a merchant from account access to a tested Azupay checkout on
Adobe Commerce as a Cloud Service (ACCS). The payment backend runs in Adobe
App Builder; its storefront adapter is installed separately into the merchant's
EDS/headless project.

> **Before distribution:** the project licence is pending approval. Obtain the
> owner's permission before publishing or redistributing it. This is not a
> certified or production-approved payment product.

## Contents

1. [Supported platforms and payment flows](#supported-platforms-and-payment-flows)
2. [Before you begin](#before-you-begin)
3. [Obtain the application](#obtain-the-application)
4. [Create the Adobe project](#create-the-adobe-project)
5. [Configure private credentials](#configure-private-credentials)
6. [Build and deploy](#build-and-deploy)
7. [Associate and install in Commerce](#associate-and-install-in-commerce)
8. [Configure payment settings](#configure-payment-settings)
9. [Install and publish the storefront integration](#install-and-publish-the-storefront-integration)
10. [Verify payments and invoicing](#verify-payments-and-invoicing)
11. [Upgrade or roll back](#upgrade-or-roll-back)
12. [Troubleshooting and support](#troubleshooting-and-support)

## Supported platforms and payment flows

| Area | Support |
| --- | --- |
| Commerce | ACCS; no Composer or Luma installation |
| Currency and country | AUD with Australian billing/shipping; virtual products need no shipping address |
| Payment | One-off PayID, one-off PayTo, or both |
| Environments | Azupay Staging/UAT and separately provisioned production |
| Checkout presentation | Full redirect by default; optional modal with same-payment full-page escape |
| Order placement | Synchronous, after verified completed payment and final shopper confirmation |
| Invoicing | Optional full offline invoice on the next five-minute reconciliation run |
| EDS installer | Checkout drop-in 3.x with the Commerce boilerplate 6.x-style split layout |
| Other headless layouts | Manual integration using the same documented adapter |

Subscriptions, saved bank accounts, automatic refunds, partial invoices,
multi-currency, B2B purchase-order approval and AsyncOrder are not implemented.
Separate Azupay client profiles may be needed for each payment-method choice.

## Before you begin

Have the following ready:

- An ACCS tenant and an Adobe organization entitled to App Builder/Runtime.
- Adobe Developer access and Commerce Admin permission to manage applications.
- A merchant-owned storefront repository and an authorized publication process.
- Azupay UAT onboarding, a client ID, a least-privilege SECR API key with
  PaymentRequest create/read access, hosted checkout enabled, and confirmed
  checkout hostnames.
- One-off PayTo approval if offering PayTo. Selecting PayTo in Commerce does
  not provision it with Azupay.
- Node 24, npm and Git. The project also tests Node 22.
- Permission to use any logos, plus an operational owner for paid-cart recovery.

Production additionally requires Azupay commercial, due-diligence, UX and UAT
approval, separate credentials and the [production checklist](OPERATIONS.md#production-release).
Do not send real funds to UAT or guess test bank credentials.

**Checkpoint:** you can access the Adobe and Azupay consoles, Commerce Admin and
the merchant's UAT storefront.

## Obtain the application

Use a reviewed source revision or, once the maintainer has approved distribution,
a source archive attached to a GitHub release. Download release assets only from
the repository owner you trust. Verify `SHA256SUMS` before extracting them.

```sh
# After downloading the source archive and SHA256SUMS to a separate directory:
shasum -a 256 -c SHA256SUMS
mkdir azupay-commerce
tar -xzf azupay-commerce-source-<version>.tgz -C azupay-commerce
cd azupay-commerce
nvm install
nvm use
npm ci
npm run verify
```

The checksum file covers both source and EDS assets; download both before running
the command. Hashes detect corruption, not a compromised publisher. Do not install
another application's workspace exports or credentials.

The repository is already an implemented App Builder application. Do not run
`aio app init` over it.

## Create the Adobe project

1. In [Adobe Developer Console](https://developer.adobe.com/console/), select the
   correct organization and create an App Builder project.
2. Use a dedicated UAT workspace. Keep production in a separate workspace with
   separate secrets where possible.
3. Add I/O Management API and Adobe Commerce as a Cloud Service with an OAuth
   Server-to-Server credential authorized for the intended Commerce tenant.
4. Install Adobe's CLI and required plugins, authenticate, and select/import the
   intended workspace:

   ```sh
   npm install --global @adobe/aio-cli
   aio plugins:install @adobe/aio-cli-plugin-app
   aio plugins:install @adobe/aio-cli-plugin-runtime
   aio login
   aio app use /absolute/secure/path/to/workspace.json
   ```

5. Keep the workspace export outside the repository. Protect `.aio`, which can
   contain Runtime credentials.

Use the [detailed setup guide](SETUP.md#4-create-your-app-builder-project) for
entitlements, service selection and SDK credential formats. Enabling API Mesh
does not deploy a mesh; this backend does not require one.

**Checkpoint:** the selected workspace has Runtime access and a Commerce OAuth
credential in the same organization.

## Configure private credentials

```sh
cp .env.example .env
chmod 600 .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the generated value as `AZUPAY_SIGNING_SECRET`; keep it stable across
normal deployments. Never paste it into issues or commit it.

| Setting | What to supply |
| --- | --- |
| `AIO_runtime_*` and `AIO_COMMERCE_AUTH_IMS_*` | Values from the selected Adobe workspace/OAuth credential |
| `AZUPAY_UAT_PAYID_*`, `AZUPAY_UAT_PAYTO_*` or `AZUPAY_UAT_BOTH_*` | Provisioned client ID and SECR key for the desired hosted experience |
| `AZUPAY_STOREFRONT_ORIGINS` | Exact HTTPS UAT/preview origins; no wildcard, path or trailing slash |
| `AZUPAY_CHECKOUT_HOSTS` | Exact provider checkout hostnames confirmed by Azupay |
| `AZUPAY_ALLOW_PRODUCTION` | Keep `false` during UAT |

Unused profiles should remain empty. No private key belongs in Commerce
business configuration, EDS JavaScript, API Mesh shopper responses or screenshots.
See [private configuration](SETUP.md#5-populate-the-ignored-secrets-file).

**Checkpoint:** the selected profile is populated, production is blocked and
private files are ignored.

## Build and deploy

From the application directory:

```sh
npm run verify
aio app build --force-build
aio app deploy --no-build --force-deploy
```

The npm checks/build need no credentials. The `aio` commands require the selected
workspace and private deployment values. Confirm actual deployed action URLs;
some CLI flows can report success while skipping an already-published workspace.
Do not treat exit status alone as evidence of an update.

A full deployment also provisions the private reconciliation action, five-minute
timer and rule. An action-only deployment will not create a missing schedule.
Never deploy the repository's GitHub CI job directly into a production tenant.

**Checkpoint:** actions were actually deployed in the intended namespace.

## Associate and install in Commerce

1. Open **Apps > App Management** in the matching Commerce organization.
   Some Admin navigation places **Apps** under **System**.
2. Associate the deployed Azupay application with the intended Commerce instance.
3. Install it and complete its payment-method and webhook registration steps.
4. Confirm **Installed**, not **Partially Installed**.
5. Sync Commerce scopes if needed and inspect the effective storefront store view.
6. Verify all three installed webhook subscriptions and Adobe authentication.
   Settlement validation must remain required; forged receipts must fail.

The OOPE method registers `default` initially. For additional store codes, review
the registration's `stores` list before installation/upgrade; configuration
inheritance alone does not register them.

**Known limitation:** some sandbox tenants persist the cart-capture subscription
as required even though the declaration requests otherwise. An unavailable
capture action can then affect other cart saves. Verify the actual subscription
and resolve or explicitly accept this availability dependency before production.
See [webhook details](SETUP.md#6-build-deploy-and-install).

**Checkpoint:** association and installation are complete, the method exists and
all three subscriptions have the intended live settings.

## Configure payment settings

Open the app's native configuration, select the intended scope, unlock inherited
**From Default** values where needed, and save.

| Setting | Initial UAT value or action |
| --- | --- |
| Enable Azupay | Enable when the storefront adapter and profile are ready |
| Azupay environment | Staging / UAT |
| Payment methods | The provisioned PayID, PayTo or both profile |
| Production approval completed | Off |
| Payment request expiry | A whole number from 5 to 120 minutes |
| Automatically invoice paid orders | Enable only after verifying reconciliation |
| Checkout experience | Full redirect initially; opt into modal after bank/browser UAT |
| Checkout payment title / byline | Merchant text; blank byline hides it |
| Checkout logos | Official marks with permission, custom hosted images, or none |
| Official logo permission | Confirm only when your agreement grants permission |
| Custom image URLs / descriptions | Up to three public HTTPS images with accessible descriptions |

Images are uploaded to your existing media library, not App Management. Allow
their hosts in `img-src`. Modal mode needs the actual Azupay checkout origins
allowed in `frame-src`; it always offers a same-payment full-page escape.
Reload checkout after saving branding. Presentation changes apply only to new
payment sessions.

See [branding](STOREFRONT.md#configure-the-checkout-title-byline-and-logos) and
[modal configuration](STOREFRONT.md#embeddedmodal-checkout).

## Install and publish the storefront integration

Follow Adobe's [EDS integration guide](https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/eds)
and this project's [storefront instructions](STOREFRONT.md).

From the built application:

```sh
node dist/eds/bin/install.js --target /absolute/path/to/merchant-storefront --dry-run
node dist/eds/bin/install.js --target /absolute/path/to/merchant-storefront
```

An approved EDS release archive also contains a self-contained installer; it does
not need the App Builder application's npm dependencies. Existing installations
must use the reviewed `--upgrade` path, not overwrite managed files manually.

Run the merchant's lint/tests, review only the installer outputs and publish
through its feature-branch/review/Code Sync process. Keep the installation
manifest with the changes. The adapter discovers Runtime URLs from the cart's
OOPE configuration; do not embed a merchant namespace in storefront code.

**App Builder deployment does not publish the merchant's storefront.** The normal
EDS installation returns to the same checkout path; no new CMS return page is
required. A manually integrated standalone checkout has different return-page
requirements, described in the storefront guide.

## Verify payments and invoicing

1. Use an eligible UAT cart and complete addresses, shipping and required terms.
2. Select Azupay and continue through the chosen presentation.
3. Pay using Azupay's current documented UAT process.
4. Return to checkout or wait for server verification to close the modal.
5. Review the checkout and select **Complete your order**.
6. Confirm the order, payment totals and required settlement checks.
7. With autoInvoice enabled, wait for the next five-minute reconciliation run.
   Verify one full offline invoice and monitor failures; never collect a second
   bank debit to invoice an already-paid order.

Closing a modal does not cancel payment. A saved session is not proof of payment.
Pending, expired, failed and mismatched payments must not place an order or create
an invoice. If money has left the bank but no order is confirmed, follow the
[paid-cart recovery runbook](OPERATIONS.md#payment-without-an-order).

Complete the full [UAT matrix](OPERATIONS.md#uat-acceptance-checklist), including
guest, signed-in, store scope, mobile bank handoff, PayTo, modal close/reopen,
full-page escape and verification failures. Automated stubs are not a substitute.

## Upgrade or roll back

Read the [changelog](../CHANGELOG.md), confirm the installed EDS version and review
the supported migration before deploying. Back up private configuration securely
and record Runtime, schema and storefront versions without copying secrets into
Git. An app metadata version change can invoke Commerce's upgrade lifecycle.

Disable new sessions and drain/reconcile outstanding payments before changing
profiles, signing keys, association or environments. Keep receipt verification
and existing credential profiles available during a rollback. Do not unassociate
a configured production app as a generic troubleshooting step.

The backend, Commerce installation and merchant storefront are separate release
surfaces. Restore only a compatible, previously verified revision. See
[maintainer release steps](PUBLISHING.md) and
[operations](OPERATIONS.md#keys-and-environment-changes).

## Troubleshooting and support

| Symptom | First check |
| --- | --- |
| Admin fields are disabled | Unlock inherited From Default values at an editable scope |
| Association returns HTTP 500 | Follow the narrow discovery compatibility instructions; never bypass Adobe authentication |
| Checkout initialization fails | Inspect authenticated availability/capture webhook responses and Commerce Webhook Logs |
| Method is absent | Enabled/profile settings, AUD/AU eligibility and OOPE store registration |
| Clicking Place Order skips bank checkout | Publish the EDS adapter; backend deployment alone cannot wire the shopper UI |
| A paid order remains pending | Effective autoInvoice scope, actual five-minute timer/rule, reconciliation failures and existing invoices |
| Modal is blank or a bank handoff fails | CSP/browser/provider restrictions; use Continue in full page for the same payment |
| Branding has not changed | Save an explicit override and reload checkout; verify the new storefront bundle was published |
| Payment is complete but no order exists | Stop; do not pay again. Use the paid-cart recovery runbook |

Use public issues only for redacted software defects. Send account provisioning
questions to Azupay and Adobe service/entitlement issues through your authorized
support channels. Vulnerability reports belong in a private channel, not a public
issue. See [security reporting](../SECURITY.md) and
[contribution guidelines](../CONTRIBUTING.md).
