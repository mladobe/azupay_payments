# Azupay Real Time Payments for Adobe Commerce as a Cloud Service

An Adobe App Builder payment extension for one-off Australian AUD payments using
Azupay's hosted PayID and PayTo checkout.

**Status:** pre-production implementation with account-backed UAT history.
Automated checks do not certify the integration or replace a merchant's bank,
mobile, PayTo and production acceptance tests. No Adobe, Azupay or AP+ endorsement
is implied.

**Licence pending approval:** this project's package is marked `UNLICENSED` and
private. No open-source licence or permission to redistribute the project is
granted. Third-party components retain their own licences. Public release
automation is blocked until an approved project licence is supplied.

## Merchant installation

Start with **[Installing the Azupay app](docs/README.md)**. It covers access,
Adobe project creation, private credentials, deployment, Commerce association,
configuration, storefront installation, testing and troubleshooting.

| Supported | Not implemented or certified |
| --- | --- |
| Adobe Commerce as a Cloud Service and Adobe App Builder | PaaS/on-premises and Luma |
| PayID, one-off PayTo, or both, using provisioned Azupay profiles | Recurring agreements, subscriptions and saved bank accounts |
| UAT and separately gated production configuration | Production credentials or commercial approval supplied by this repository |
| Full-page redirect or optional embedded modal | Every bank, mobile browser or passkey journey without merchant UAT |
| Configurable title, byline, optional badge and permitted hosted selector logos | Native image uploads |
| One scoped instructions tooltip and a separate PayTo terms link | Customizing Azupay's hosted payment page through these fields |
| ACL-protected V2 admin configuration and documentation tabs | Embedded transaction reporting |
| Verified payment before synchronous order placement | B2B purchase-order approval and AsyncOrder |
| Scheduled full offline invoicing of verified paid orders | Automated refunds, partial invoicing and disputes |
| Portable EDS installer for supported checkout source layouts | Automatic publishing of a merchant's storefront |

PayID/PayTo choices select server-side credentials for preconfigured hosted
clients. They do not enable products on an Azupay account. Ask Azupay to provision
and approve the intended experiences.

### Configure the checkout display

Open **Sales > Azupay Real Time Payments > Configuration**, choose the store
scope and unlock inherited fields before editing. Set one **Payment instructions**
textarea and its **Payment instructions tooltip label**; line breaks are
preserved and blank text hides the tooltip. The separate **PayTo terms and
conditions URL** remains available. The legacy education and bank-approval
URL/text fields were removed in 0.1.11.

Use **Pay by Bank** with **Fast and secure** for a white-label presentation.
An optional **Checkout payment badge** accepts up to 32 plain-text characters;
blank hides it. Approved logos, byline and badge appear in the native payment
selector with the 0.1.12 storefront adapter. Saved custom text is not overwritten.

Follow the [illustrated admin walkthrough](docs/ADMIN.md#illustrated-configuration-walkthrough)
for annotated screenshots, inheritance, logos and saving, and the
[white-label setup](docs/ADMIN.md#white-label-checkout-and-hosted-branding) for
hosted merchant branding. Version 0.1.12 requires deploying the app and upgrading
and publishing the storefront outputs; App Builder deployment alone does not
update the selector or modal.

## Documentation

| Guide | Audience |
| --- | --- |
| [Installation](docs/README.md) | Merchants and implementation teams; start here |
| [Detailed setup](docs/SETUP.md) | App Builder developers and Commerce administrators |
| [Storefront integration](docs/STOREFRONT.md) | EDS/headless developers; branding, instructions tooltip and modal configuration |
| [Operations and UAT](docs/OPERATIONS.md) | Payment operators; invoices, recovery, refunds and launch gates |
| [Illustrated admin guide and PHP comparison](docs/ADMIN.md) | Administrators; annotated settings screenshots, V2 menu, permissions and feature gaps |
| [Architecture](docs/ARCHITECTURE.md) | Developers; trust boundaries and API contracts |
| [Repository and release process](docs/PUBLISHING.md) | Maintainers preparing a GitHub repository or release |
| [Contributing](CONTRIBUTING.md) | Contributors and reviewers |
| [Security reporting](SECURITY.md) | Private reporting and safe diagnostics |
| [Changelog](CHANGELOG.md) | Version history and upgrade notes |

## Developer quick start

Use Node 24; Node 22 is also covered by CI.

```sh
nvm install
nvm use
npm ci
npm run verify
```

Local verification needs no Adobe or Azupay credentials and does not deploy or
create a payment. It checks formatting, documentation links, publication
hygiene, unit tests, builds and the isolated EDS archive.

Only when deploying to your own Adobe workspace:

```sh
cp .env.example .env
chmod 600 .env
```

Follow the installation guide to fill the private values. Never commit `.env`,
`.aio`, workspace exports, onboarding notes, customer receipts or activation logs.

`npm run build` emits the eight custom Runtime actions, the V2 admin UI, browser modules,
documentation and a versioned `dist/azupay-commerce-eds-<version>.tgz`. It is not an
authenticated Adobe deployment. The generated EDS installer is website-agnostic;
the merchant publishes its outputs through its own Code Sync process.

## Publishing this repository

Follow [the publication checklist](docs/PUBLISHING.md) **before the first push**.
The repository includes credential-free CI, issue/PR templates, a changelog,
source/index hygiene checks and a draft-only release workflow.

No Git repository, remote, deployment, release or public upload is created by
these checks. Licence approval, repository ownership, support arrangements and
live payment acceptance remain maintainer decisions.

## Scope and attribution

Payment amounts, quote identity and settlement are verified server-side.
Browser messages and redirects are not payment proof. A paid cart without a
confirmed order requires operator recovery; never start another payment blindly.
The invoice scanner is limited to 2,000 pending orders per run.

See [third-party notices](THIRD_PARTY_NOTICES.md). The merchant-guide structure
was informed by Stripe's public
[App Builder installation guide](https://github.com/stripe/stripe-magento2-releases/tree/master/app-builder/docs);
the prose and processes here are specific to this implementation. Stripe code,
documentation text, screenshots and branding are not redistributed.
