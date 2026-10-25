import { ImprojSignatureVerificationError } from "../errors.js";
import type { WebhookEvent } from "../types.js";

/** Header names of a webhook delivery (HTTP header names are case-insensitive). */
export const WEBHOOK_HEADERS = {
  signature: "IMPROJ-Signature",
  event: "IMPROJ-Event",
  delivery: "IMPROJ-Delivery",
  webhookId: "IMPROJ-Webhook-Id",
  apiVersion: "IMPROJ-API-Version",
} as const;

/** The replay window the API documents, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

const MAX_HEADER_LENGTH = 4096;
const MAX_SIGNATURES = 10;

export interface VerifyOptions {
  /** Maximum age (and clock skew) of the signature timestamp, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** The current time in Unix seconds (for tests). Default: the system clock. */
  now?: number;
}

/** The raw request body: the exact bytes received, before any JSON parsing. */
export type RawBody = string | Uint8Array | ArrayBuffer;

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * Parses `IMPROJ-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>...]`.
 * Unknown schemes are ignored, so new signature versions do not break receivers.
 */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignatureHeader {
  if (header === null || header === undefined || header === "") {
    throw new ImprojSignatureVerificationError("missing_header", "The IMPROJ-Signature header is missing.");
  }
  if (typeof header !== "string" || header.length > MAX_HEADER_LENGTH) {
    throw new ImprojSignatureVerificationError("malformed_header", "The IMPROJ-Signature header is malformed.");
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-fA-F]{64}$/.test(value) && signatures.length < MAX_SIGNATURES) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) {
    throw new ImprojSignatureVerificationError("malformed_header", "The IMPROJ-Signature header has no timestamp or no v1 signature.");
  }
  return { timestamp, signatures };
}

export function checkTimestamp(timestamp: number, options: VerifyOptions | undefined): void {
  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!(Number.isFinite(tolerance) && tolerance > 0)) throw new TypeError("toleranceSeconds must be a positive number.");
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new ImprojSignatureVerificationError(
      "timestamp_outside_tolerance",
      `The signature timestamp is more than ${tolerance} seconds away from the current time.`,
    );
  }
}

export function checkSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 8) {
    throw new TypeError("Pass the endpoint's signing secret (whsec_...) as a string.");
  }
}

const encoder = new TextEncoder();

/** The raw body as bytes. A parsed object is refused: the signature covers the exact bytes. */
export function rawBytes(payload: RawBody): Uint8Array {
  if (typeof payload === "string") return encoder.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  throw new TypeError(
    "Pass the raw request body (string, Buffer, Uint8Array or ArrayBuffer), not a parsed object. " +
      "With Express use express.raw({ type: 'application/json' }) on the webhook route.",
  );
}

/** `"<t>." + raw body` as bytes: the signed content. */
export function signedContent(timestamp: number, body: Uint8Array): Uint8Array {
  const prefix = encoder.encode(`${timestamp}.`);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Parses the verified body into an event, with a minimal shape check. */
export function parseEvent(body: Uint8Array): WebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ImprojSignatureVerificationError("invalid_payload", "The verified body is not valid JSON.");
  }
  const v = value as Partial<WebhookEvent> | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || typeof v.type !== "string" || !v.data || typeof v.data !== "object") {
    throw new ImprojSignatureVerificationError("invalid_payload", "The verified body is not an IMPROJ webhook event.");
  }
  return v as WebhookEvent;
}

export type { WebhookEvent };
