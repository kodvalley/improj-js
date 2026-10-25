/**
 * Webhook signature verification with the Web Crypto API: browsers' service
 * workers, Cloudflare Workers, Vercel Edge, Deno, Bun and Node.js 20+.
 * Every function is async. For a synchronous API on Node.js use `@kodvalley/improj/webhooks/node`.
 *
 * ```ts
 * import { constructEvent } from "@kodvalley/improj/webhooks";
 * export async function POST(req: Request) {
 *   const raw = await req.text();
 *   const event = await constructEvent(raw, req.headers.get("IMPROJ-Signature"), env.IMPROJ_WEBHOOK_SECRET);
 *   ...
 * }
 * ```
 */
import { ImprojSignatureVerificationError } from "../errors.js";
import type { WebhookEvent } from "../types.js";
import {
  bytesToHex,
  checkSecret,
  checkTimestamp,
  hexToBytes,
  parseEvent,
  parseSignatureHeader,
  rawBytes,
  signedContent,
  type RawBody,
  type VerifyOptions,
} from "./shared.js";

export {
  DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_HEADERS,
  parseSignatureHeader,
  type ParsedSignatureHeader,
  type RawBody,
  type VerifyOptions,
} from "./shared.js";
export { ImprojSignatureVerificationError, type SignatureFailureReason } from "../errors.js";
export type { WebhookEvent } from "../types.js";

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!s) throw new Error("Web Crypto is not available here; import @kodvalley/improj/webhooks/node instead.");
  return s;
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return subtle().importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** HMAC-SHA256 of `"<t>." + body` with the endpoint secret, as lowercase hex. */
export async function computeSignature(secret: string, timestamp: number, payload: RawBody): Promise<string> {
  checkSecret(secret);
  const key = await hmacKey(secret, "sign");
  const mac = await subtle().sign("HMAC", key, signedContent(timestamp, rawBytes(payload)) as BufferSource);
  return bytesToHex(new Uint8Array(mac));
}

/** Builds an `IMPROJ-Signature` header value (useful for testing your receiver). */
export async function signatureHeader(secret: string, payload: RawBody, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await computeSignature(secret, timestamp, payload)}`;
}

/** Verifies a delivery; rejects with ImprojSignatureVerificationError and a `reason` when it fails. */
export async function assertValidSignature(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): Promise<void> {
  checkSecret(secret);
  const body = rawBytes(payload);
  const { timestamp, signatures } = parseSignatureHeader(header);
  checkTimestamp(timestamp, options);
  const key = await hmacKey(secret, "verify");
  const content = signedContent(timestamp, body) as BufferSource;
  let match = false;
  for (const sig of signatures) {
    // crypto.subtle.verify compares MACs in constant time.
    if (await subtle().verify("HMAC", key, hexToBytes(sig) as BufferSource, content)) match = true;
  }
  if (!match) throw new ImprojSignatureVerificationError("no_matching_signature", "No signature matches the payload and secret.");
}

/** True when the delivery is authentic and fresh. Never rejects for a bad signature. */
export async function verifySignature(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): Promise<boolean> {
  try {
    await assertValidSignature(payload, header, secret, options);
    return true;
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return false;
    throw e;
  }
}

/** Verifies the delivery, then parses it. Use the event's ids to fetch current data through the API. */
export async function constructEvent(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): Promise<WebhookEvent> {
  await assertValidSignature(payload, header, secret, options);
  return parseEvent(rawBytes(payload));
}
