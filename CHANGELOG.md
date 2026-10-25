# Changelog

All notable changes to `@kodvalley/improj` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-25

### Added

- `Improj` client for the IMPROJ API v1 (API version `2026-10-24`): me, projects, work packages, activities, tasks, milestones, members, files, calendar events, your calendar, meetings, webhook endpoints, AI agents, the OpenAPI document, and `request()` for endpoints not wrapped yet.
- Async-iterator pagination (`PagePromise`, `Page`, `toArray`, `pages()`) with protection against repeated cursors.
- Automatic `Idempotency-Key` on every POST (overridable per request).
- Retries with exponential backoff and jitter, honouring `Retry-After`: `429` for any request; `503`, network errors and timeouts for `GET`, `DELETE` and keyed `POST`.
- Per-attempt timeouts and caller cancellation through `AbortSignal`.
- Typed errors (`ImprojError` and subclasses for 400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 5xx and 503) carrying `code`, `status`, `requestId`, `errors`, `retryAfter` and rate-limit state; messages redact tokens and secrets. `API_ERROR_CODES` lists every documented code.
- Per-request `requestId` (sent as `X-Request-Id`, echoed by the API) and `apiVersion` (`IMPROJ-API-Version`) options.
- Types for `CalendarItem`, `Agent`, `AgentItem` and `AgentNote`; agent items follow the signed `next_cursor` and fall back to the legacy `nextCursor`.
- Two-step upload helper `files.upload()`; the bytes always go to `<baseUrl>/uploads/<id>`.
- Webhook verification for Node.js (`@kodvalley/improj/webhooks/node`) and Web Crypto runtimes (`@kodvalley/improj/webhooks`), with raw-body guidance for Express, Next.js, Hono and Fastify.
- Safety checks: no token in browsers without `dangerouslyAllowBrowser`, no token over plain http, no redirects, no cookies with a token, masked token in `toJSON()` and `util.inspect()`.
- ESM and CommonJS builds with type declarations; Node.js 18+.

[Unreleased]: https://github.com/kodvalley/improj-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kodvalley/improj-js/releases/tag/v0.1.0
