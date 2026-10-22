# Repository publication and releases

This is a maintainer runbook, not a payment deployment command.
Publishing source, releasing an installer, deploying App Builder and publishing a
merchant storefront are separate operations.

## Current release gates

- The project has no approved licence. `package.json` declares `UNLICENSED` and
  remains private. `npm run release:check` intentionally fails until approval.
- No support SLA, certification or universal bank/browser compatibility is claimed.
- The local application folder need not already be a Git repository. These
  scripts do not initialize one, create a remote or upload anything.
- Account-backed UAT and production gates in [operations](OPERATIONS.md) remain
  mandatory, regardless of CI status.

## What follows the reference pattern

The [Stripe App Builder documentation](https://github.com/stripe/stripe-magento2-releases/tree/master/app-builder/docs)
provides a useful merchant sequence: platform scope, prerequisites, Adobe setup,
private configuration, deployment, Commerce association, configuration and
storefront integration. [Our installation guide](README.md) follows that
sequence using original, implementation-specific instructions.

This repository additionally supplies source-development CI and a draft-release
workflow. These are this project's processes, not a claim about Stripe's private
build system. No Stripe PDF, screenshots, branding, licence or code is copied.
There is no generated PDF in this release; Markdown is the canonical guide.

## 1. Approve ownership, licence and support

Before public disclosure, confirm that the owner/employer permits publication,
that dependencies/brand references are appropriate, and that no account-specific
or confidential material will be shared.

The user selected **leave unlicensed pending approval**. Do not infer Apache-2.0
for this code merely because Adobe dependencies use it. Until approval, retain
the explicit pending notice and do not publish release assets.

After approval:

1. Add the owner's approved licence as `LICENSE` or `LICENSE.md`.
2. Set the corresponding approved licence identifier in `package.json`, updating
   the lockfile with npm. Keep `private: true`; this is not an npm publication.
3. Update the pending notices in the root README, installation guide and
   contribution guide. Preserve third-party notices and required bundled licences.
4. Define supported versions, maintainers and a private vulnerability-reporting
   route. Do not invent a support email address.
5. Obtain human/legal review before removing the distribution block.

## 2. Run local checks before initializing Git

```sh
nvm use
npm ci
npm run verify
```

`verify` runs formatting checks, local documentation-link checks, heuristic
publication checks, unit tests, builds and EDS archive verification. It needs no
`.env`, `.aio`, Adobe login or provider credentials and performs no deployment.

`check:public` enumerates approved source paths, rejects symlinks and private/
generated paths, checks for common credential patterns and machine/tenant-specific
references, and, when Git exists, examines **staged contents**, not just current
working files. Failures identify paths/rules without printing secret values.

**Limits:** this is a heuristic, not a comprehensive secret scanner or security
audit. Without Git it cannot inspect an index. It never scans historical commits.
Review the entire history with your approved secret-scanning process before
making an existing repository public. Revoke exposed credentials even after
removing them from a commit.

Private `.env`, `.aio`, arbitrary workspace exports, onboarding notes, logs,
customer data and payment receipts must never be staged. Build ZIPs/tarballs
belong in approved release attachments, not the source tree.

## 3. Initialize and inspect the source repository

Only if this application directory is not already a repository:

```sh
git init -b main
```

Stage explicit source paths; do not use `git add -f` to bypass ignore rules:

```sh
git add -- \
  .env.example .gitignore .gitattributes .nvmrc .github \
  README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md THIRD_PARTY_NOTICES.md \
  package.json package-lock.json biome.json app.config.yaml \
  app.commerce.config.js install.yaml webpack-config.cjs \
  docs eds scripts src storefront test

# After approval, also stage the approved LICENSE or LICENSE.md.
git check-ignore .env .aio scripts/onboarding/ workspace.json
npm run check:public
git diff --cached --stat
git status --short
```

Inspect the staged changes privately, without posting the diff publicly first.
Never post a failing scanner's input. If an export or secret was ever tracked,
removing it from the current index is insufficient; address history and rotate
the affected credentials.

Commit only after review. The project does not supply a GitHub owner, repository
name, organization policy or permission to publish. Select those deliberately.
Use a private repository first if ownership approval is incomplete.

## 4. Create the intended GitHub repository

The commands below are **manual examples**, not part of the build. Substitute the
authorized owner/repository name and choose visibility only after review:

```sh
git commit -m "Prepare Azupay application source"
gh auth status
# Use --private instead if public disclosure is not approved.
gh repo create OWNER/REPOSITORY --public --source=. --remote=origin --push
```

If a remote already exists, inspect it rather than replacing it. Do not force-push
or switch GitHub identities to work around authorization.

In repository settings:

- Protect the default branch; require human PR review and the Node 22/24
  validation jobs before merge. Select the actual check names after the first run.
- Restrict who can create/update release tags and approve GitHub releases.
- Enable secret scanning/push protection and dependency alerts where available.
- Enable private vulnerability reporting and verify the reporting link.
- Keep Actions permissions read-only by default. Only the draft-release publishing
  job requests repository-content write permission.
- Add ownership rules appropriate to the actual team; no fictitious CODEOWNERS
  or support contacts are preconfigured.
- Do not add Adobe/Azupay deployment secrets to ordinary PR workflows.

The supplied workflows use immutable official GitHub action revisions.
Dependabot proposes dependency/action updates; it does not auto-merge them.

## 5. Prepare a versioned release

1. Review the changelog and all relevant UAT evidence.
2. Update the package version using npm, preserving the lockfile. App Builder
   metadata reads that same version.
3. Review/update the installer's explicit source/target version gate and migration
   tests when changing releases. A version bump alone does not authorize an
   arbitrary storefront migration.
4. Keep configuration defaults conservative: redirect, official-logo permission
   off, production blocked in deployment examples.
5. Ensure source, backend/schema changes and EDS changes are compatible. Advancing
   App Builder metadata can invoke Commerce's upgrade lifecycle; test it in UAT.
6. Commit reviewed changes. Local release packaging requires a clean working
   tree/index, approved licence and a committed source revision.

```sh
npm run release:check
npm run release:package
```

The second command checks the release gates, runs full verification and produces:

| Asset | Contents |
| --- | --- |
| `azupay-commerce-source-<version>.tgz` | Current committed, approved source tree via `git archive`; no Git history or local secrets |
| `azupay-commerce-eds-<version>.tgz` | Self-contained portable storefront installer, browser payload and required docs/notices |
| `SHA256SUMS` | SHA-256 hashes of those exact two versioned assets |

Runtime deployment ZIPs are not published: they can be environment-specific.
Never attach `.env`, `.aio`, a workspace export, private keys, onboarding files,
logs, receipt/cart dumps or the whole local `dist` directory.

## 6. Create a draft GitHub release

After the approved revision is merged, create an immutable version tag matching
`package.json`, for example `v0.1.7`, and push that tag through the authorized
maintainer workflow. Do not overwrite an existing published tag.

The tag-triggered **Prepare release** workflow:

1. Checks out the tag without persisting credentials.
2. Installs dependencies without deployment secrets.
3. Checks licence, clean source/index and exact tag/package version agreement.
4. Runs verification and builds the two allowlisted archives and checksums.
5. Passes only those files to a separate publishing job.
6. Creates a **draft prerelease**, never an automatic public production release.

With the current unlicensed state, it stops before uploading release assets.
Fix approval/gates rather than deleting or bypassing the check.

A human must download and inspect the draft assets, verify hashes and guides,
confirm intended visibility/licensing, and decide when to publish the draft.
Keep prerelease status until the intended audience and acceptance gates are met.
Checksums provide integrity, not proof of certification or a trusted publisher.

## 7. Deploy and publish merchant changes separately

A GitHub release does not deploy Adobe Runtime, associate Commerce or publish a
storefront. Implementers follow [installation](README.md), using their own
workspace, credentials and origins. EDS outputs go through each merchant's
normal review and Code Sync workflow.

Before production, complete [operations acceptance](OPERATIONS.md#production-release),
including actual bank/mobile/PayTo journeys, webhook availability and invoice
monitoring. On rollback, stop new sessions while preserving verification of
existing payments. Do not rotate signing keys or remove profiles casually.
