# Contributing to IMPROJ JavaScript SDK

Thank you for helping. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security first

- Found a vulnerability? Do not open an issue; follow [SECURITY.md](SECURITY.md).
- Never paste a real API token (`improj_pat_...`, `improj_org_...`), webhook secret (`whsec_...`) or personal data into an issue, a pull request, a test or a log. Tests use obviously fake values.
- Every pull request is scanned for secrets (gitleaks), reviewed for new dependencies (dependency review) and analysed (CodeQL or static analysis). Keep dependencies to the minimum; a new runtime dependency needs a reason in the pull request.

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test             # vitest with coverage (thresholds enforced)
npm run build        # ESM + CJS + types into dist/
npm run test:smoke   # node:test against dist/ (runs on Node 18+)
```

## Pull requests

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Branch from `main`, keep the change focused, and add or update tests.
3. Add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
4. Make sure CI is green. Maintainers review every change; at least one approval from a code owner is required.
5. Commits are squashed on merge. Use a clear, imperative title ("Add milestones pagination helper").

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

## Versioning and releases

This project follows [Semantic Versioning](https://semver.org/). Maintainers release by pushing a signed tag `vX.Y.Z`; the release workflow runs in the protected `release` environment.
