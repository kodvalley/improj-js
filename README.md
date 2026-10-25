# @kodvalley/improj

[![CI](https://github.com/kodvalley/improj-js/actions/workflows/ci.yml/badge.svg)](https://github.com/kodvalley/improj-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kodvalley/improj)](https://www.npmjs.com/package/@kodvalley/improj)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kodvalley/improj-js/badge)](https://scorecard.dev/viewer/?uri=github.com/kodvalley/improj-js)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The official TypeScript SDK for the [IMPROJ public API](https://improj.com/developers): a typed client for every endpoint, async-iterator pagination, automatic idempotency keys, safe retries, timeouts, the two-step upload helper and webhook signature verification.

- **Zero runtime dependencies.** Native `fetch`, Web Crypto or `node:crypto`.
- **Node.js 18+**, Deno, Bun, Cloudflare Workers, Vercel Edge and modern browsers (through your own backend; see below).
- **ESM and CommonJS** builds with type declarations. Published with npm provenance.

> [!WARNING]
> **Never ship an IMPROJ token to a browser or a mobile app.** Anyone who can open your page can read it and act as you. Keep the token on your server and let your front end call your own backend. The SDK refuses to use a token in a browser unless you set `dangerouslyAllowBrowser`, which is only acceptable for a dedicated token with **read-only scopes**, a project list, a short expiry and your exact **browser origin** allowed in IMPROJ (Settings > Developers). See [Security](#security).

## Install

```sh
npm install @kodvalley/improj
```

## Quick start

```ts
import { Improj } from "@kodvalley/improj";

const improj = new Improj({ token: process.env.IMPROJ_TOKEN }); // improj_pat_... or improj_org_...

const me = await improj.me.get();

for await (const project of improj.projects.list()) {
  console.log(project.id, project.name);
}

const task = await improj.tasks.create(42, {
  title: "Prepare the kick-off agenda",
  due_date: "2026-11-02",
  priority: "high",
});

await improj.tasks.update(42, task.id, { status: "done" });
```

`token` defaults to the `IMPROJ_TOKEN` environment variable. Request and response fields use the API's own names (`due_date`, `project_id`, ...), exactly as in the [OpenAPI description](https://github.com/kodvalley/improj-openapi).

## Authentication

Create a token in IMPROJ under **Settings > Developers**:

- `improj_pat_...` personal access token: acts as you.
- `improj_org_...` organisation token: acts as the organisation owner or admin who created it, limited to that organisation's projects.

Give each integration its own token with the fewest scopes, a project list, an expiry and, for servers with fixed addresses, an IP allow-list. The SDK sends the token only as `Authorization: Bearer ...`, never in a URL, never with cookies, never over plain `http` (except to `localhost` for local testing), and never follows redirects.

| Option | Default | Meaning |
|---|---|---|
| `token` | `process.env.IMPROJ_TOKEN` | The token. Leave it out in proxy mode. |
| `baseUrl` | `https://improj.com/api/v1` | Or your own proxy, for example `/api/improj` in a browser. |
| `apiVersion` | `"2026-10-24"` | Sent as `IMPROJ-API-Version`; `null` sends none. |
| `timeoutMs` | `30000` | Per attempt. |
| `maxRetries` | `2` | Retries of safe requests (see below). |
| `maxRetryAfterMs` | `60000` | A longer `Retry-After` is not waited for. |
| `autoIdempotencyKeys` | `true` | Random `Idempotency-Key` on every POST. |
| `fetch` | global `fetch` | Your own fetch (for proxies, tests, instrumentation). |
| `headers` | none | Extra headers (for example a CSRF header for your proxy). `Authorization` and `Cookie` are refused. |
| `onResponse` | none | Called after every attempt with status, request id, rate limits and timing; never with credentials. |

Every method takes per-request options as its last argument: `{ idempotencyKey, requestId, apiVersion, timeoutMs, maxRetries, signal, headers }`.

- `requestId` is sent as `X-Request-Id` (8 to 64 characters of `A-Z a-z 0-9 . _ : -`). The API echoes it back and puts it in an error's `requestId`, so you can follow one call through your logs and IMPROJ support.
- `apiVersion` overrides the client's `IMPROJ-API-Version` pin for one request (`null` sends none). An unsupported version answers `400 API_VERSION_UNSUPPORTED`.

## Resources

| Client | Methods |
|---|---|
| `improj.me` | `get()` |
| `improj.projects` | `list()`, `get(projectId)`, `workPackages(projectId)`, `activities(projectId, { work_package_id })` |
| `improj.tasks` | `list(projectId, { status })`, `get`, `create`, `update`, `delete` |
| `improj.milestones` | `list`, `get`, `create`, `update`, `delete` |
| `improj.members` | `list(projectId)` |
| `improj.files` | `list(projectId, { parent_id })`, `get`, `downloadLink`, `upload`, `createUpload`, `sendUpload` |
| `improj.calendarEvents` | `list(projectId, { from, to })`, `get`, `create`, `update`, `delete` |
| `improj.calendar` | `list({ from, to })` (your own calendar across projects) |
| `improj.meetings` | `list(projectId)`, `get` |
| `improj.webhooks` | `list`, `create`, `get`, `update`, `delete`, `test`, `deliveries` |
| `improj.agents` | `list()`, `items(agentId)`, `postNote(agentId, note)` (Enterprise) |
| `improj.openapi()` | The live OpenAPI document |
| `improj.request(method, path, { query, body })` | Any endpoint not wrapped yet, with the same auth, retries and errors |

## Pagination

List methods return a `PagePromise`. Await it for one page, or iterate it to walk every item:

```ts
const page = await improj.tasks.list(42, { status: "todo", limit: 100 });
page.data;           // Task[]
page.nextCursor;     // string | null
if (page.hasNextPage()) await page.getNextPage();

for await (const task of improj.tasks.list(42)) {
  // every task, fetching pages as needed
}

const first500 = await improj.tasks.list(42).toArray({ max: 500 });
for await (const p of improj.files.list(42).pages()) console.log(p.data.length);
```

Nothing is fetched until you await or iterate. Cursors are opaque and signed by the API; pass them back unchanged.

## Errors

Every failure is an `ImprojError` with `status`, `code` (the API's stable code), `requestId`, `detail`, `errors` (field problems of a 400) and `retryAfter`. Subclasses let you branch by kind:

```ts
import { ImprojError, ImprojNotFoundError, ImprojRateLimitError } from "@kodvalley/improj";

try {
  await improj.tasks.get(42, 7);
} catch (e) {
  if (e instanceof ImprojNotFoundError) {
    // missing, or not visible to the token's owner (indistinguishable on purpose)
  } else if (e instanceof ImprojRateLimitError) {
    console.warn(`rate limited; retry in ${e.retryAfter}s`);
  } else if (e instanceof ImprojError) {
    console.error(e.code, e.status, e.requestId); // quote requestId to support
  }
  throw e;
}
```

| Class | Status |
|---|---|
| `ImprojBadRequestError` | 400 (`INVALID_INPUT` with `errors[]`, `API_CURSOR_INVALID`, ...) |
| `ImprojAuthenticationError` | 401 |
| `ImprojPermissionError` | 403 (`API_SCOPE_MISSING`, `VIEWER_READ_ONLY`, ...) |
| `ImprojNotFoundError` | 404 (`NOT_FOUND`, `API_UPLOAD_EXPIRED`) |
| `ImprojMethodNotAllowedError` | 405 (`API_METHOD_NOT_ALLOWED`) |
| `ImprojConflictError` | 409 (`IDEMPOTENCY_KEY_IN_USE`) |
| `ImprojPayloadTooLargeError` | 413 (`API_PAYLOAD_TOO_LARGE`, `FILE_TOO_LARGE_FOR_PLAN`) |
| `ImprojUnsupportedMediaTypeError` | 415 (`API_UNSUPPORTED_MEDIA_TYPE`) |
| `ImprojUnprocessableError` | 422 (`IDEMPOTENCY_KEY_REUSED`) |
| `ImprojRateLimitError` | 429 (`RATE_LIMITED`) |
| `ImprojServerError` | 5xx (`SOMETHING_WENT_WRONG`) |
| `ImprojServiceUnavailableError` | 503 (`DB_UNAVAILABLE`, `SERVER_BUSY`), a subclass of `ImprojServerError` |
| `ImprojConnectionError` | no answer (`CONNECTION_ERROR`, `ABORTED`) |
| `ImprojTimeoutError` | `timeoutMs` elapsed (`TIMEOUT`) |

`error.code` is typed as `ImprojErrorCode`: every code the API documents is listed in `API_ERROR_CODES` (a contract test keeps it in step with openapi.json), and new codes from the API are still accepted.

Error messages and fields pass through `redact()`, so a token or webhook secret never appears in them; `error.toJSON()` is safe for structured logs.

## Retries, idempotency and timeouts

- Every POST carries a random `Idempotency-Key` (or yours: `{ idempotencyKey: "order-123" }`), so a retried POST is never applied twice. The API replays the first answer for 24 hours.
- **Retried automatically** (up to `maxRetries`, exponential backoff with jitter, honouring `Retry-After`): `429` for any request (the API refused it before doing anything); `503` and network errors or timeouts for `GET`, `DELETE` and keyed `POST`.
- **Never retried**: `PATCH` after a `503` or a network error (it may have been applied), any `500`, and the upload `PUT` after a network error (upload ids are single use).
- `timeoutMs` applies per attempt; pass `signal` to cancel a request and any pending retry.

## Uploads

```ts
import { readFile } from "node:fs/promises";

const file = await improj.files.upload(42, {
  name: "report.pdf",
  data: await readFile("report.pdf"),      // Uint8Array, Buffer, ArrayBuffer or Blob/File
  mimeType: "application/pdf",
  parentId: 1234,                          // optional folder
});
```

`upload()` announces the file (`POST /projects/{id}/uploads`), then sends the bytes with an exact `Content-Length` to `<baseUrl>/uploads/<id>`. The SDK builds that address itself and never sends your token to a URL taken from a response. Files are limited to 16 MB and your plan's per-file limit. Use `createUpload()` and `sendUpload()` for the two steps separately.

## Webhooks

Verify every delivery over the **raw** request body before trusting it:

```ts
// Node.js (any framework): synchronous, node:crypto
import { constructEvent } from "@kodvalley/improj/webhooks/node";

// Edge runtimes, Deno, Bun, Node 19+: async, Web Crypto
import { constructEvent } from "@kodvalley/improj/webhooks";
```

Express:

```ts
import express from "express";
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks/node";

const app = express();
app.post("/webhooks/improj", express.raw({ type: "application/json", limit: "256kb" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get("IMPROJ-Signature"), process.env.IMPROJ_WEBHOOK_SECRET!);
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return res.status(400).end();
    throw e;
  }
  // De-duplicate on event.delivery_id / req.get("IMPROJ-Delivery"), then answer fast.
  res.status(204).end();
  queue.push(event); // fetch the object through the API in a worker
});
```

`constructEvent` checks the HMAC-SHA256 signature in constant time against every `v1` value, refuses timestamps more than 300 seconds away (`toleranceSeconds` to change), and only then parses the JSON. `verifySignature` returns a boolean instead. Raw-body recipes for **Next.js (App and Pages Router), Hono, Fastify and Cloudflare Workers** are in [docs/webhooks.md](docs/webhooks.md).

Manage endpoints with the client: `improj.webhooks.create({ url, description, events })` returns the `whsec_` secret once; store it in your secret manager.

## Security

- **Server side by default.** Keep tokens in environment variables or a secret manager, never in source control or client bundles.
- **Browsers and mobile apps: use a backend proxy.** Create the client with `baseUrl: "/api/improj"` and no token; your server adds the token and forwards only the calls your front end needs. [`@kodvalley/improj-react`](https://github.com/kodvalley/improj-react) is built for this and ships a proxy example.
- **The only exception**: a dedicated token with read-only scopes, a project list, a short expiry and your exact origin listed under browser origins, used with `dangerouslyAllowBrowser: true`. The API never allows `*` or credentials in CORS.
- The SDK never logs. Errors are redacted; `JSON.stringify(client)` and `util.inspect(client)` show a masked token.
- Webhook handlers must verify signatures over the raw body and de-duplicate deliveries.
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run lint && npm run typecheck
npm test              # vitest, coverage thresholds enforced
npm run build
npm run test:smoke    # the built package on the current Node.js (CI: 18, 20, 22, 24)
npm run check:package # publint + Are The Types Wrong
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md). Licensed under the [MIT License](LICENSE).
