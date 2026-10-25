/**
 * Webhook signature verification for Node.js (synchronous, node:crypto).
 *
 * ```ts
 * import { constructEvent } from "@kodvalley/improj/webhooks/node";
 * app.post("/improj/webhooks", express.raw({ type: "application/json" }), (req, res) => {
 *   const event = constructEvent(req.body, req.get("IMPROJ-Signature"), process.env.IMPROJ_WEBHOOK_SECRET!);
 *   ...
 * });
 * ```
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ImprojSignatureVerificationError } from "../errors.js";
import type { WebhookEvent } from "../types.js";
import {
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

/** HMAC-SHA256 of `"<t>." + body` with the endpoint secret, as lowercase hex. */
export function computeSignature(secret: string, timestamp: number, payload: RawBody): string {
  checkSecret(secret);
  return createHmac("sha256", secret).update(signedContent(timestamp, rawBytes(payload))).digest("hex");
}

/** Builds an `IMPROJ-Signature` header value (useful for testing your receiver). */
export function signatureHeader(secret: string, payload: RawBody, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, payload)}`;
}

/** Verifies a delivery; throws ImprojSignatureVerificationError with a `reason` when it fails. */
export function assertValidSignature(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): void {
  checkSecret(secret);
  const body = rawBytes(payload);
  const { timestamp, signatures } = parseSignatureHeader(header);
  checkTimestamp(timestamp, options);
  const expected = createHmac("sha256", secret).update(signedContent(timestamp, body)).digest();
  let match = false;
  for (const sig of signatures) {
    // Every candidate is compared in constant time; no early exit on a match.
    if (timingSafeEqual(expected, hexToBytes(sig))) match = true;
  }
  if (!match) throw new ImprojSignatureVerificationError("no_matching_signature", "No signature matches the payload and secret.");
}

/** True when the delivery is authentic and fresh. Never throws for a bad signature. */
export function verifySignature(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): boolean {
  try {
    assertValidSignature(payload, header, secret, options);
    return true;
  } catch (e) {
    if (e instanceof ImprojSignatureVerificationError) return false;
    throw e;
  }
}

/** Verifies the delivery, then parses it. Use the event's ids to fetch current data through the API. */
export function constructEvent(payload: RawBody, header: string | null | undefined, secret: string, options?: VerifyOptions): WebhookEvent {
  assertValidSignature(payload, header, secret, options);
  return parseEvent(rawBytes(payload));
}
