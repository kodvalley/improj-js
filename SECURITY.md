# Security policy

## Reporting a vulnerability

Please do **not** open a public issue, pull request or discussion for a security problem.

Report it privately, by either:

- GitHub: **Security > Report a vulnerability** on [kodvalley/improj-js](https://github.com/kodvalley/improj-js/security/advisories/new) (private vulnerability reporting), or
- email: **info@kodvalley.com**

Include what you found, the affected version or commit, steps to reproduce, and the impact you expect. If you send a proof of concept, use your own test account and data. **Never include a real API token, webhook secret or personal data**; if one was exposed, revoke it in IMPROJ (Settings > Developers) first.

This policy covers the code in this repository. Vulnerabilities in the IMPROJ service itself (https://improj.com) are welcome at the same address.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| First assessment (severity, affected versions) | within 10 business days |
| Fix for critical and high severity issues | within 30 days |
| Fix for medium and low severity issues | within 90 days |
| Public disclosure (GitHub Security Advisory, CVE where applicable) | after a fix is released, coordinated with you; at the latest 90 days after the report unless we agree otherwise |

We credit reporters in the advisory unless you ask us not to. We do not take legal action against good-faith research that respects this policy: no access to other people's data, no service disruption, no social engineering, and reasonable time for us to fix before disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 0.x (latest minor) | Yes |
| Older | No |

Security fixes are released as a new patch version of the latest minor line. Upgrade to receive them.

## Hardening in this repository

- Dependencies are locked, audited in CI (`npm audit` / `composer audit`), reviewed on every pull request (dependency review) and updated by Dependabot with a cool-down period.
- GitHub Actions are pinned to full commit SHAs and run with `contents: read` unless a job needs more.
- Every push is scanned for secrets with a pinned, checksum-verified gitleaks release.
- Releases are built in CI from a protected environment and published to npm with provenance.
