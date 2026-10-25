# Receiving IMPROJ webhooks

IMPROJ signs every delivery:

```
IMPROJ-Signature: t=1792839000,v1=5f2c...e91a
```

`v1` is the lowercase hex HMAC-SHA256 of `"<t>." + <raw body>` with your endpoint's `whsec_...` secret. The signature covers the **exact bytes** that were sent, so verify before any JSON parsing: a parsed and re-serialised body has different bytes and never verifies.

Rules for every receiver:

1. Read the raw body (string or bytes) and the `IMPROJ-Signature` header.
2. Verify with `constructEvent` (or `verifySignature`). Answer `400` on failure and do nothing else.
3. De-duplicate on `IMPROJ-Delivery` (or `event.delivery_id`): retries deliver the same event again.
4. Answer `2xx` within a few seconds (the API waits 10 seconds), then do the work in the background. Anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h.
5. The body only has ids. Fetch the object through the API, which also re-applies your current permissions.
6. Keep the secret in an environment variable or a secret manager. Rotate it by creating a new endpoint, switching, then deleting the old one.

Two entry points:

| Import | Runtime | API |
|---|---|---|
| `@kodvalley/improj/webhooks/node` | Node.js 18+ | synchronous, `node:crypto` (`timingSafeEqual`) |
| `@kodvalley/improj/webhooks` | Browsers' workers, Cloudflare Workers, Vercel Edge, Deno, Bun, Node.js 19+ | async, Web Crypto (`crypto.subtle.verify`) |

Both export `constructEvent`, `verifySignature`, `assertValidSignature`, `computeSignature`, `signatureHeader` (for your own tests), `parseSignatureHeader`, `WEBHOOK_HEADERS` and `ImprojSignatureVerificationError` (with a `reason`: `missing_header`, `malformed_header`, `timestamp_outside_tolerance`, `no_matching_signature`, `invalid_payload`).

## Express

Mount `express.raw()` on the webhook route only, before any `express.json()` that would consume the body:

```ts
import express from "express";
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks/node";

const app = express();

app.post("/webhooks/improj", express.raw({ type: "application/json", limit: "256kb" }), (req, res) => {
  try {
    const event = constructEvent(req.body, req.get("IMPROJ-Signature"), process.env.IMPROJ_WEBHOOK_SECRET!);
    res.status(204).end();
    void handle(event);
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return res.status(400).end();
    throw e;
  }
});

app.use(express.json()); // other routes
```

## Next.js App Router (`app/webhooks/improj/route.ts`)

```ts
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks";

export const runtime = "nodejs"; // or "edge": the Web Crypto entry works in both

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const event = await constructEvent(raw, request.headers.get("IMPROJ-Signature"), process.env.IMPROJ_WEBHOOK_SECRET!);
    // enqueue event ...
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return new Response(null, { status: 400 });
    throw e;
  }
}
```

## Next.js Pages Router (`pages/api/webhooks/improj.ts`)

Turn off the built-in body parser and read the stream yourself:

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks/node";

export const config = { api: { bodyParser: false } };

async function readRaw(req: NextApiRequest, limit = 256 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const event = constructEvent(await readRaw(req), req.headers["improj-signature"] as string | undefined, process.env.IMPROJ_WEBHOOK_SECRET!);
    res.status(204).end();
    // enqueue event ...
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return res.status(400).end();
    throw e;
  }
}
```

## Hono (Node.js, Bun, Deno, Cloudflare Workers)

```ts
import { Hono } from "hono";
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks";

const app = new Hono<{ Bindings: { IMPROJ_WEBHOOK_SECRET: string } }>();

app.post("/webhooks/improj", async (c) => {
  const raw = await c.req.text(); // raw body, before any c.req.json()
  try {
    const event = await constructEvent(raw, c.req.header("IMPROJ-Signature"), c.env.IMPROJ_WEBHOOK_SECRET);
    c.executionCtx?.waitUntil?.(handle(event));
    return c.body(null, 204);
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return c.body(null, 400);
    throw e;
  }
});
```

## Fastify

```ts
import Fastify from "fastify";
import { constructEvent, ImprojSignatureVerificationError } from "@kodvalley/improj/webhooks/node";

const app = Fastify({ bodyLimit: 256 * 1024 });

app.register(async (scope) => {
  // In this scope only, keep JSON bodies as raw Buffers.
  scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  scope.post("/webhooks/improj", async (req, reply) => {
    try {
      const event = constructEvent(req.body as Buffer, req.headers["improj-signature"] as string | undefined, process.env.IMPROJ_WEBHOOK_SECRET!);
      reply.code(204).send();
      void handle(event);
    } catch (e) {
      if (e instanceof ImprojSignatureVerificationError) return reply.code(400).send();
      throw e;
    }
  });
});
```

## Testing your receiver

```ts
import { signatureHeader } from "@kodvalley/improj/webhooks/node";

const body = JSON.stringify({ id: "evt_1", type: "task.created", api_version: "2026-10-24", created_at: new Date().toISOString(), delivery_id: 1, data: { object: "task", id: 7, project_id: 42 }, actor_user_id: 3 });
await fetch("http://localhost:3000/webhooks/improj", {
  method: "POST",
  headers: { "Content-Type": "application/json", "IMPROJ-Signature": signatureHeader(process.env.IMPROJ_WEBHOOK_SECRET!, body) },
  body,
});
```

Or send a real signed `ping` from IMPROJ: `await improj.webhooks.test(endpointId)`.
