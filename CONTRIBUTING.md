# Contributing

## Project and licence status

This is a pre-production ACCS payment integration. The project licence remains
pending approval; no general permission to reuse or redistribute it is granted.
Before accepting external contributions or publishing releases, the owner must
approve the licence, contributor terms and support arrangements.

## Development

Use Node 24 and npm. Node 22 is also tested.

```sh
nvm install
nvm use
npm ci
npm run verify
```

These checks must run without Adobe credentials, Azupay keys, `.env` or `.aio`.
They do not deploy, create orders or move money. Use fixtures for automated tests.
Keep live-account UAT separate and record only redacted acceptance evidence.

## Changes and pull requests

1. Work on a small feature branch from the repository's current default branch.
2. Keep authored backend, storefront and installer logic in this repository.
   Never maintain a merchant-specific payment implementation as the source.
3. Preserve server-side quote binding, signed receipts and exact settlement
   checks. A browser flag, redirect or iframe message is never payment proof.
4. Update the relevant guide, native help and changelog with behavior changes.
5. Add focused tests, then run `npm run verify` once for integrated acceptance.
6. For EDS changes, test a clean/customized checkout, checked upgrade, idempotent
   rerun, conflict rejection and real-browser behavior.
7. Explain supported platforms, compatibility, migration and rollback in the PR.
8. Obtain human review; do not merge merely because automated checks pass.

Avoid committing generated `.generated`, `dist`, dependencies, workspace exports,
private onboarding material, activation logs, cart IDs or payment receipts.
Run `npm run check:public` against the staged tree before pushing.

Formatting follows the existing Biome configuration. Use `npm run check`; apply
Biome formatting only to files in scope. No new framework or dependency is
needed for ordinary documentation edits.

## Versioning

`package.json` and its lockfile define the release version. App Builder metadata
reads the same version. The EDS installer records it in its installation manifest.

An installer upgrade is deliberately version-gated. When changing the version,
review the allowed source/target versions and update migration tests; do not
silently accept arbitrary older releases or overwrite edited merchant files.
Follow [the release process](docs/PUBLISHING.md).

## Issues and support

Use the bug form for reproducible, redacted software problems. Include the
application/EDS version, Node version, ACCS/storefront versions, selected checkout
presentation, expected behavior and safe reproduction steps.

Do not attach `.env`, `.aio`, workspace exports, raw HAR files, tokens, API keys,
receipts, bank details or customer data. Vulnerabilities use the private process
in [SECURITY.md](SECURITY.md), not public issues.
