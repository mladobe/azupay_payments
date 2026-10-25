# Changelog

Changes are grouped by implementation version. These entries describe local
development history, not previously published GitHub releases or certification.
The first public release is pending ownership/licence approval and acceptance.

## 0.1.8

- Constrain official and custom checkout logos to 100 x 48 CSS-pixel boxes with
  preserved image proportions and wrapping, overriding generic storefront image
  sizing that previously expanded the logos to their intrinsic dimensions.
- Reviewed installer upgrades through 0.1.7 to 0.1.8. Existing storefronts must
  install and publish the updated browser bundle; App Builder deployment alone
  does not update EDS.

## 0.1.7

- Explicit Adobe `auto` lifecycle upgrades after versioned deployments, so the
  SDK executes the upgrade rather than leaving an unapplied manual plan.
- Sales menu opens an embedded Configuration tab, retaining Commerce Admin
  navigation; the existing setup/operations content moves into Documentation.
- Reuses Adobe's native configuration and scope handlers/storage behind a
  signed-in-user menu ACL check, with scope inheritance, minimal patch saves,
  explicit errors and retained drafts when switching tabs.
- Reviewed installer upgrades through 0.1.6 to 0.1.7. The storefront browser
  payload is unchanged; no EDS reinstall is required for the admin configuration tabs.

## 0.1.6

- ACL-protected V2 Sales menu with Azupay setup, operations and UAT resources;
  editable settings remain in native scoped App Management configuration.
- App, menu and payment defaults renamed to Azupay Real Time Payments, retaining
  existing app/payment identities and merchant-customized checkout titles.
- Documented PHP-extension feature comparison, including online refund,
  sort-order and debug-toggle gaps without enabling unsupported behavior.
- Reviewed installer upgrades through 0.1.5 to 0.1.6; the 0.1.5 storefront browser
  payload is unchanged, so the new admin menu does not require a storefront update.
- Standardized merchant installation guide, contributor and security policies.
- Public-repository checks, credential-free CI and draft release preparation.
- App Builder metadata uses the same version as the package and EDS installer.
- Project licence explicitly pending approval; public release checks block it.

## 0.1.5

- Optional store-scoped modal checkout, retaining full redirect as the default.
- Same-payment full-page escape, retained sessions on close, server-verified
  status checks and an explicit final native order-confirmation click.
- Accessible dialog/focus restoration and mobile layout; automated tests use
  mocked provider/server boundaries, not a certified real-bank modal journey.
- Reviewed EDS upgrades from 0.1.0 through 0.1.4. Intermediate 0.1.3/0.1.4
  builds were local modal validation iterations.

## 0.1.2

- Store-scoped checkout title, byline and up to three custom hosted images.
- Permission-gated official PayID/PayTo image references.
- GraphQL branding hook and reviewed EDS initializer migration.

## 0.1.1

- Persistent five-minute invoice reconciliation timer and rule.
- Clearer Complete your order messaging for returning payment sessions.
- Reviewed upgrade from the initial EDS installation.

## 0.1.0

- Initial App Builder/ACCS PayID and one-off PayTo integration.
- Trusted Commerce quote binding, provider verification and signed receipts.
- Native configuration, hosted redirect checkout and reusable EDS installer.
- Manual/optional scheduled offline invoicing and operational runbooks.
