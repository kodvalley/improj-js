import { redact } from "./redact.js";

/** One invalid field of a 400 INVALID_INPUT answer. */
export interface ProblemFieldError {
  path: string;
  message: string;
}

/** The RFC 9457 problem details body of every API error. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: ProblemFieldError[];
}

/** Rate limit state reported by the API (IETF RateLimit header fields). */
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the window resets. */
  reset: number | null;
  policy: string | null;
}

export interface ImprojErrorInit {
  status: number;
  code: string;
  message: string;
  requestId?: string | null;
  problem?: Partial<Problem> | null;
  retryAfter?: number | null;
  rateLimit?: RateLimitInfo | null;
  method?: string;
  path?: string;
  cause?: unknown;
}

/**
 * Base class of every error the SDK throws.
 *
 * - `status`: the HTTP status, or 0 when no answer arrived (network, timeout).
 * - `code`: the API's stable error code (for example `NOT_FOUND`), or an SDK
 *   code (`CONNECTION_ERROR`, `TIMEOUT`, `INVALID_RESPONSE`, `CONFIGURATION`).
 * - `requestId`: the API's `X-Request-Id`; quote it when you contact support.
 *
 * Messages are passed through `redact()`, so a token never appears in them.
 */
export class ImprojError extends Error {
  override readonly name: string = "ImprojError";
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly type: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  readonly instance: string | null;
  readonly errors: ProblemFieldError[];
  /** Seconds to wait before retrying, from Retry-After (429, 503). */
  readonly retryAfter: number | null;
  readonly rateLimit: RateLimitInfo | null;
  readonly method: string | null;
  readonly path: string | null;

  constructor(init: ImprojErrorInit) {
    super(redact(init.message), init.cause === undefined ? undefined : { cause: init.cause });
    const p = init.problem ?? null;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? (p?.request_id ? String(p.request_id) : null);
    this.type = p?.type ? String(p.type) : null;
    this.title = p?.title ? String(p.title) : null;
    this.detail = p?.detail ? redact(String(p.detail)) : null;
    this.instance = p?.instance ? redact(String(p.instance)) : null;
    this.errors = Array.isArray(p?.errors)
      ? p.errors.slice(0, 50).map((e) => ({ path: String(e?.path ?? ""), message: redact(String(e?.message ?? "")) }))
      : [];
    this.retryAfter = init.retryAfter ?? null;
    this.rateLimit = init.rateLimit ?? null;
    this.method = init.method ?? null;
    this.path = init.path ? redact(init.path) : null;
  }

  /** A plain object for structured logs (no headers, no credentials). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      requestId: this.requestId,
      method: this.method,
      path: this.path,
      errors: this.errors,
      retryAfter: this.retryAfter,
    };
  }
}

/** 400: invalid input (see `errors`), unsupported API version, invalid cursor... */
export class ImprojBadRequestError extends ImprojError {
  override readonly name = "ImprojBadRequestError";
}
/** 401: the token is missing, invalid, expired or revoked. */
export class ImprojAuthenticationError extends ImprojError {
  override readonly name = "ImprojAuthenticationError";
}
/** 403: missing scope, IP or origin not allowed, plan, or the app refuses the action. */
export class ImprojPermissionError extends ImprojError {
  override readonly name = "ImprojPermissionError";
}
/** 404: not found, or not visible to the token's owner (indistinguishable on purpose). */
export class ImprojNotFoundError extends ImprojError {
  override readonly name = "ImprojNotFoundError";
}
/** 409: conflict, for example IDEMPOTENCY_KEY_IN_USE. */
export class ImprojConflictError extends ImprojError {
  override readonly name = "ImprojConflictError";
}
/** 422: for example IDEMPOTENCY_KEY_REUSED (same key, different request). */
export class ImprojUnprocessableError extends ImprojError {
  override readonly name = "ImprojUnprocessableError";
}
/** 429: rate limited; `retryAfter` says how long to wait. */
export class ImprojRateLimitError extends ImprojError {
  override readonly name = "ImprojRateLimitError";
}
/** 5xx: a server-side failure; safe requests are retried before this is thrown. */
export class ImprojServerError extends ImprojError {
  override readonly name = "ImprojServerError";
}
/** No answer: DNS, TLS, connection reset, or the request was aborted by the caller. */
export class ImprojConnectionError extends ImprojError {
  override readonly name = "ImprojConnectionError";
}
/** The request took longer than `timeoutMs`. */
export class ImprojTimeoutError extends ImprojError {
  override readonly name = "ImprojTimeoutError";
}
/** A webhook delivery failed signature verification. `reason` says why. */
export class ImprojSignatureVerificationError extends Error {
  override readonly name = "ImprojSignatureVerificationError";
  readonly reason: SignatureFailureReason;
  constructor(reason: SignatureFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type SignatureFailureReason =
  | "missing_header"
  | "malformed_header"
  | "timestamp_outside_tolerance"
  | "no_matching_signature"
  | "invalid_payload";

/** Picks the error class for an HTTP status. */
export function errorClassFor(status: number): typeof ImprojError {
  switch (status) {
    case 400:
      return ImprojBadRequestError;
    case 401:
      return ImprojAuthenticationError;
    case 403:
      return ImprojPermissionError;
    case 404:
      return ImprojNotFoundError;
    case 409:
      return ImprojConflictError;
    case 422:
      return ImprojUnprocessableError;
    case 429:
      return ImprojRateLimitError;
    default:
      return status >= 500 ? ImprojServerError : ImprojError;
  }
}
