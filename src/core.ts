import {
  ImprojConnectionError,
  ImprojError,
  ImprojTimeoutError,
  errorClassFor,
  type Problem,
  type RateLimitInfo,
} from "./errors.js";
import { maskToken, redact } from "./redact.js";
import { API_VERSION, DEFAULT_BASE_URL, SDK_VERSION } from "./version.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Binary bodies the upload helper accepts. Streams are not accepted: the API needs an exact Content-Length. */
export type BinaryBody = Uint8Array | ArrayBuffer | Blob;

/** Per-request options; every method of the client accepts them as its last argument. */
export interface RequestOptions {
  /**
   * Idempotency-Key for POST requests. By default the SDK sends a random UUID,
   * so a retried POST is never applied twice. Pass your own key to make a POST
   * safe to repeat across processes (for example, derived from your own record id).
   */
  idempotencyKey?: string;
  /** Milliseconds per attempt before the request is aborted. */
  timeoutMs?: number;
  /** Retries for this request (overrides the client option). */
  maxRetries?: number;
  /** Abort the request (and any pending retry). */
  signal?: AbortSignal;
  /** Extra headers for this request. Authorization and Cookie cannot be set here. */
  headers?: Record<string, string>;
}

/** What the client reports to `onResponse` after every attempt. Never contains credentials. */
export interface ResponseInfo {
  method: HttpMethod;
  path: string;
  status: number;
  requestId: string | null;
  rateLimit: RateLimitInfo;
  replayed: boolean;
  attempt: number;
  durationMs: number;
}

export interface ClientOptions {
  /**
   * A personal (`improj_pat_...`) or organisation (`improj_org_...`) token.
   * Defaults to the `IMPROJ_TOKEN` environment variable on servers. Leave it
   * out when `baseUrl` points at your own backend proxy that adds the token.
   */
  token?: string;
  /** Default `https://improj.com/api/v1`. A path such as `/api/improj` resolves against the page origin in browsers. */
  baseUrl?: string;
  /** Sent as `IMPROJ-API-Version` to pin the contract. Default: the version this SDK was built for. `null` sends none. */
  apiVersion?: string | null;
  /** Milliseconds per attempt. Default 30000. */
  timeoutMs?: number;
  /** Retries of safe requests on 429, 503 and network errors. Default 2. */
  maxRetries?: number;
  /** A Retry-After longer than this (milliseconds) is not waited for; the error is thrown. Default 60000. */
  maxRetryAfterMs?: number;
  /** Send an automatic Idempotency-Key on POST. Default true. */
  autoIdempotencyKeys?: boolean;
  /** A fetch implementation. Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Headers added to every request (for example a CSRF header for your own proxy). */
  headers?: Record<string, string>;
  /** Cookie policy. Default `"omit"` with a token, `"same-origin"` without one (proxy mode). */
  credentials?: RequestCredentials;
  /**
   * The SDK refuses to run with a token in a browser, because anyone who can
   * open the page can read the token. Set this only for a dedicated token with
   * read-only scopes, a project list and your exact browser origin.
   */
  dangerouslyAllowBrowser?: boolean;
  /** Called after every attempt, for logging and metrics. */
  onResponse?: (info: ResponseInfo) => void;
}

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  binary?: { body: BinaryBody; contentType: string };
  options?: RequestOptions | undefined;
  /** "status-only": retry on 429/503 but never after a network error (single-use upload ids). */
  retry?: "default" | "status-only";
}

const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;
const TOKEN_SHAPE = /^[\x21-\x7e]{8,512}$/;
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "host", "content-length"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A configuration problem detected before any request is sent. */
export function configError(message: string): ImprojError {
  return new ImprojError({ status: 0, code: "CONFIGURATION", message });
}

/** True in a browser page or web worker (where a token would be visible to the user). */
export function isBrowserLike(): boolean {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.window === "object" && g.window !== null && typeof g.document === "object") return true;
  if (typeof g.WorkerGlobalScope === "function" && typeof g.importScripts === "function") return true;
  const nav = g.navigator as { product?: string } | undefined;
  return nav?.product === "ReactNative";
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = proc?.env?.[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function resolveBaseUrl(raw: string): URL {
  let url: URL;
  try {
    if (raw.startsWith("/")) {
      const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
      if (!origin) throw configError(`baseUrl "${raw}" is relative; pass an absolute URL outside a browser.`);
      url = new URL(raw, origin);
    } else {
      url = new URL(raw);
    }
  } catch (e) {
    if (e instanceof ImprojError) throw e;
    throw configError(`baseUrl is not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw configError("baseUrl must use https.");
  if (url.username || url.password) throw configError("baseUrl must not contain credentials.");
  if (url.search || url.hash) throw configError("baseUrl must not contain a query or fragment.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function checkHeaders(headers: Record<string, string> | undefined, where: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name)) throw configError(`${where}: invalid header name.`);
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw configError(`${where}: the ${name} header cannot be set here.`);
    const v = String(value);
    if (!HEADER_VALUE.test(v)) throw configError(`${where}: header ${name} contains control characters.`);
    out[name] = v;
  }
  return out;
}

/** Parses Retry-After (seconds or an HTTP date) into seconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value == null || value.trim() === "") return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

function intHeader(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  return v != null && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
}

export function rateLimitOf(headers: Headers): RateLimitInfo {
  return {
    limit: intHeader(headers, "RateLimit-Limit"),
    remaining: intHeader(headers, "RateLimit-Remaining"),
    reset: intHeader(headers, "RateLimit-Reset"),
    policy: headers.get("RateLimit-Policy"),
  };
}

/** A path segment from an id: positive integers only, so nothing can escape the path. */
export function pathId(value: unknown, name: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)) return value;
  throw configError(`${name} must be a positive integer id.`);
}

/** Random UUID v4 for Idempotency-Key, from Web Crypto or, on Node 18, node:crypto. */
export async function randomKey(): Promise<string> {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const mod = "node:crypto";
  const nodeCrypto = (await import(/* @vite-ignore */ /* webpackIgnore: true */ mod)) as { randomUUID: () => string };
  return nodeCrypto.randomUUID();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with jitter: 0.5 s, 1 s, 2 s... capped at 8 s, each scaled by 0.5 to 1. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random() / 2));
}

/** The transport shared by all resources. Holds the token in a private field. */
export class HttpClient {
  readonly #token: string | undefined;
  readonly baseUrl: string;
  readonly #base: URL;
  readonly #apiVersion: string | null;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxRetryAfterMs: number;
  readonly #autoIdempotency: boolean;
  readonly #fetch: typeof fetch;
  readonly #headers: Record<string, string>;
  readonly #credentials: RequestCredentials;
  readonly #onResponse: ((info: ResponseInfo) => void) | undefined;
  readonly #userAgent: string | null;
  readonly #browser: boolean;
  readonly #official: boolean;
  /** Test hook: randomness for backoff jitter. */
  random: () => number = Math.random;

  constructor(options: ClientOptions = {}) {
    const token = options.token ?? (options.baseUrl ? undefined : readEnv("IMPROJ_TOKEN"));
    if (token !== undefined && !TOKEN_SHAPE.test(token)) {
      throw configError("token must be a single line of visible characters (improj_pat_..., improj_org_...).");
    }
    this.#base = resolveBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.baseUrl = this.#base.href;
    if (token && this.#base.protocol === "http:" && !LOOPBACK.has(this.#base.hostname)) {
      throw configError("Refusing to send a token over plain http; use an https baseUrl.");
    }
    if (token && isBrowserLike() && !options.dangerouslyAllowBrowser) {
      throw configError(
        "An IMPROJ token must not be used in a browser: anyone who can open the page can read it. " +
          "Call your own backend instead (see @kodvalley/improj-react), or read SECURITY.md before setting dangerouslyAllowBrowser.",
      );
    }
    this.#token = token;
    this.#apiVersion = options.apiVersion === undefined ? API_VERSION : options.apiVersion;
    if (this.#apiVersion !== null && !/^\d{4}-\d{2}-\d{2}$/.test(this.#apiVersion)) {
      throw configError("apiVersion must look like 2026-10-24.");
    }
    this.#timeoutMs = positive(options.timeoutMs, 30_000, "timeoutMs");
    this.#maxRetries = nonNegative(options.maxRetries, 2, "maxRetries");
    this.#maxRetryAfterMs = nonNegative(options.maxRetryAfterMs, 60_000, "maxRetryAfterMs");
    this.#autoIdempotency = options.autoIdempotencyKeys ?? true;
    const f = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof f !== "function") throw configError("No fetch implementation found; pass options.fetch (Node 18+ has one built in).");
    this.#fetch = options.fetch ? f : f.bind(globalThis);
    this.#headers = checkHeaders(options.headers, "headers");
    this.#credentials = options.credentials ?? (token ? "omit" : "same-origin");
    this.#onResponse = options.onResponse;
    this.#browser = isBrowserLike();
    this.#official = this.#base.origin === new URL(DEFAULT_BASE_URL).origin;
    this.#userAgent = this.#browser ? null : `improj-js/${SDK_VERSION}${nodeVersion()}`;
  }

  /** Whether this client sends a token itself (false in proxy mode). */
  get hasToken(): boolean {
    return this.#token !== undefined;
  }

  /** The absolute URL for an API path. */
  url(path: string, query?: ApiRequest["query"]): URL {
    if (!path.startsWith("/") || path.includes("..") || path.includes("//")) throw configError("Invalid API path.");
    const url = new URL(this.#base.href);
    url.pathname = `${this.#base.pathname}${path}`;
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
    return url;
  }

  /** Sends a request with retries; resolves with the parsed JSON body (undefined for 204). */
  async request<T>(req: ApiRequest): Promise<T> {
    const opts = req.options ?? {};
    const method = req.method;
    if (!this.#token && this.#official && req.path !== "/openapi.json") {
      throw configError("No token: pass options.token or set IMPROJ_TOKEN. In a browser, point baseUrl at your own backend proxy instead.");
    }
    const url = this.url(req.path, req.query);
    const maxRetries = nonNegative(opts.maxRetries, this.#maxRetries, "maxRetries");
    const timeoutMs = positive(opts.timeoutMs, this.#timeoutMs, "timeoutMs");

    const headers: Record<string, string> = { Accept: "application/json", ...this.#headers, ...checkHeaders(opts.headers, "options.headers") };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    if (this.#apiVersion) headers["IMPROJ-API-Version"] = this.#apiVersion;
    if (this.#userAgent) headers["User-Agent"] = this.#userAgent;

    let idempotencyKey: string | undefined;
    if (method === "POST") {
      if (opts.idempotencyKey !== undefined) {
        if (!IDEMPOTENCY_KEY.test(opts.idempotencyKey)) throw configError("idempotencyKey must be 1 to 255 visible ASCII characters.");
        idempotencyKey = opts.idempotencyKey;
      } else if (this.#autoIdempotency) {
        idempotencyKey = await randomKey();
      }
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    } else if (opts.idempotencyKey !== undefined) {
      throw configError("idempotencyKey applies to POST requests only.");
    }

    let body: string | BinaryBody | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.binary) {
      headers["Content-Type"] = req.binary.contentType;
      body = req.binary.body;
    }

    // Which failures may be retried without risking a second effect.
    const replaySafe = method === "GET" || method === "DELETE" || (method === "POST" && idempotencyKey !== undefined);
    const statusOnly = req.retry === "status-only";
    const mayRetryStatus = (status: number) => status === 429 || (status === 503 && (replaySafe || statusOnly));
    const mayRetryNetwork = replaySafe && !statusOnly;

    let attempt = 0;
    let previousHadNoAnswer = false;
    for (;;) {
      attempt += 1;
      const started = Date.now();
      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.#send(url, method, headers, body, timeoutMs, opts.signal));
      } catch (e) {
        const err = this.#networkError(e, method, req.path);
        if (err.code !== "ABORTED" && mayRetryNetwork && attempt <= maxRetries) {
          previousHadNoAnswer = true;
          await sleep(backoffMs(attempt, this.random), opts.signal).catch((r) => {
            throw this.#networkError(r, method, req.path);
          });
          continue;
        }
        throw err;
      }

      const requestId = res.headers.get("X-Request-Id");
      const rateLimit = rateLimitOf(res.headers);
      this.#report({
        method,
        path: req.path,
        status: res.status,
        requestId,
        rateLimit,
        replayed: res.headers.get("Idempotent-Replayed") === "true",
        attempt,
        durationMs: Date.now() - started,
      });

      if (res.ok) return parseSuccess<T>(res, text, method, req.path, requestId);

      // A DELETE whose earlier attempt got no answer may already have succeeded.
      if (method === "DELETE" && res.status === 404 && previousHadNoAnswer) return undefined as T;

      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      const error = buildApiError(res.status, text, res.headers.get("Content-Type"), { requestId, rateLimit, retryAfter, method, path: req.path });
      if (mayRetryStatus(res.status) && attempt <= maxRetries) {
        const wait = retryAfter != null ? retryAfter * 1000 : backoffMs(attempt, this.random);
        if (wait <= this.#maxRetryAfterMs) {
          previousHadNoAnswer = false;
          await sleep(wait, opts.signal).catch((r) => {
            throw this.#networkError(r, method, req.path);
          });
          continue;
        }
      }
      throw error;
    }
  }

  async #send(
    url: URL,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | BinaryBody | undefined,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<{ res: Response; text: string }> {
    if (signal?.aborted) throw new AbortedByCaller(signal.reason);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const init: RequestInit = { method, headers, body: body as BodyInit | undefined, signal: controller.signal, redirect: "error" };
      // Cookie and referrer policy only mean something in browsers; some server runtimes reject these fields.
      if (this.#browser) {
        init.credentials = this.#credentials;
        init.referrerPolicy = "no-referrer";
      }
      const res = await this.#fetch(url.href, init);
      // The body is read inside the timeout too.
      const text = res.status === 204 ? "" : await res.text();
      return { res, text };
    } catch (e) {
      if (timedOut) throw new TimedOut();
      if (signal?.aborted) throw new AbortedByCaller(signal.reason);
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  #networkError(e: unknown, method: HttpMethod, path: string): ImprojError {
    if (e instanceof ImprojError) return e;
    if (e instanceof TimedOut) {
      return new ImprojTimeoutError({ status: 0, code: "TIMEOUT", message: `${method} ${path} timed out.`, method, path });
    }
    if (e instanceof AbortedByCaller || (e as { name?: string })?.name === "AbortError") {
      return new ImprojConnectionError({ status: 0, code: "ABORTED", message: `${method} ${path} was aborted.`, method, path, cause: e });
    }
    const reason = e instanceof Error ? e.message : String(e);
    return new ImprojConnectionError({
      status: 0,
      code: "CONNECTION_ERROR",
      message: `${method} ${path} failed before an answer arrived: ${redact(reason)}`,
      method,
      path,
      cause: e,
    });
  }

  #report(info: ResponseInfo): void {
    if (!this.#onResponse) return;
    try {
      this.#onResponse(info);
    } catch {
      // A logging hook must never break a request.
    }
  }

  /** What console.log and util.inspect show: never the token. */
  toJSON(): Record<string, unknown> {
    return { baseUrl: this.baseUrl, token: maskToken(this.#token), apiVersion: this.#apiVersion };
  }
}

class TimedOut extends Error {}
class AbortedByCaller extends Error {
  constructor(reason: unknown) {
    super("aborted", { cause: reason });
  }
}

function positive(v: number | undefined, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  if (!Number.isFinite(v) || v <= 0) throw configError(`${name} must be a positive number.`);
  return v;
}

function nonNegative(v: number | undefined, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v < 0) throw configError(`${name} must be a non-negative integer.`);
  return v;
}

function nodeVersion(): string {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return proc?.versions?.node ? ` node/${proc.versions.node}` : "";
}

function parseSuccess<T>(res: Response, text: string, method: HttpMethod, path: string, requestId: string | null): T {
  if (res.status === 204 || text === "") return undefined as T;
  const type = res.headers.get("Content-Type") ?? "";
  if (!/\bjson\b/i.test(type)) {
    throw new ImprojError({ status: res.status, code: "INVALID_RESPONSE", message: `${method} ${path}: expected JSON, got ${type || "no content type"}.`, requestId, method, path });
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ImprojError({ status: res.status, code: "INVALID_RESPONSE", message: `${method} ${path}: the answer is not valid JSON.`, requestId, method, path, cause: e });
  }
}

/** Builds the typed error for a non-2xx answer from its problem+json body. */
export function buildApiError(
  status: number,
  text: string,
  contentType: string | null,
  meta: { requestId: string | null; rateLimit: RateLimitInfo | null; retryAfter: number | null; method: HttpMethod; path: string },
): ImprojError {
  let problem: Partial<Problem> | null = null;
  if (/\bjson\b/i.test(contentType ?? "") && text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) problem = parsed as Partial<Problem>;
    } catch {
      problem = null;
    }
  }
  const code = typeof problem?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(problem.code) ? problem.code : `HTTP_${status}`;
  const detail = typeof problem?.detail === "string" ? problem.detail : `HTTP ${status}`;
  const requestId = meta.requestId ?? (typeof problem?.request_id === "string" ? problem.request_id : null);
  const Cls = errorClassFor(status);
  return new Cls({
    status,
    code,
    message: `${code}: ${detail}${requestId ? ` (request ${requestId})` : ""}`,
    requestId,
    problem,
    retryAfter: meta.retryAfter,
    rateLimit: meta.rateLimit,
    method: meta.method,
    path: meta.path,
  });
}
