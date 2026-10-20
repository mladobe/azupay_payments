# Security reporting and supported use

## Project status

This project is not certified by Adobe, Azupay or Australian Payments Plus.
There is no published support SLA or production support commitment. Maintainers
must define supported release versions before inviting production adoption.
Security fixes should target the current reviewed release; old versions are not
automatically maintained.

## Report privately

Do not disclose an exploitable issue or customer/payment information in a public
issue, pull request or discussion.

Once the repository is created, the owner should enable GitHub private
vulnerability reporting under **Settings > Code security** and verify that the
repository's **Security > Advisories > Report a vulnerability** flow is available.
Use that private flow when enabled. If it is unavailable, contact the repository
owner through an already-established private channel and request a secure
reporting route. No unverified support email address is supplied here.

Include the affected version, a minimal redacted reproduction, impact and any
suggested mitigation. Use dummy data. Never include live credentials, bank
account details, signed receipts, customer tokens or full activation payloads.

For an active incident, restrict new payment sessions using the operational
runbook while preserving access to existing payment verification and recovery.
If a secret was exposed, revoke/rotate it with its issuer and assess outstanding
payments before changing a signing key. Removing a file from the latest commit
does not remove it from Git history.

## Maintainer responsibilities

- Confirm the private reporting route and ownership before making a repository public.
- Enable secret scanning/push protection and dependency alerts where available.
- Restrict GitHub Actions token permissions and use reviewed immutable action revisions.
- Keep deployment credentials out of pull-request workflows and build artifacts.
- Review the entire Git history before first publication; the local pattern
  checker is a heuristic, not a full secret scanner or vulnerability audit.
- Keep provider/API access least-privilege and monitor authenticated webhooks,
  public endpoint abuse and reconciliation failures.
- Follow [operations](docs/OPERATIONS.md) for money movement, paid-cart recovery
  and production readiness.
