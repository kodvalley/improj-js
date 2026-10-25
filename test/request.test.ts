import { describe, expect, it, vi } from "vitest";
import {
  HttpClient,
  backoffMs,
  buildApiError,
  parseRetryAfter,
  pathId,
  randomKey,
  type ClientOptions,
} from "../src/core.js";
import {
  ImprojAuthenticationError,
  ImprojBadRequestError,
  ImprojConflictError,
  ImprojConnectionError,
  ImprojError,
  ImprojNotFoundError,
  ImprojPermissionError,
  ImprojRateLimitError,
  ImprojServerError,
  ImprojTimeoutError,
  ImprojUnprocessableError,
} from "../src/errors.js";
import { TOKEN, json, mockFetch, networkFailure, problem, type Handler } from "./helpers.js";

function client(handlers: Handler[], opts: ClientOptions = {}) {
  const f = mockFetch(...handlers);
  const http = new HttpClient({ token: TOKEN, fetch: f, ...opts });
  http.random = () => 0; // shortest backoff: 250 ms, 500 ms...
  return { http, f };
}

describe("request basics", () => {
  it("sends the bearer token, version pin, Accept and a User-Agent; never cookies", async () => {
    const { http, f } = client([() => json(200, { data: 1 })]);
    await http.request({ method: "GET", path: "/me" });
    const h = f.calls[0]!.headers;
    expect(h.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(h.get("IMPROJ-API-Version")).toBe("2026-10-24");
    expect(h.get("Accept")).toBe("application/json");
    expect(h.get("User-Agent")).toMatch(/^improj-js\/\d+\.\d+\.\d+ node\//);
    expect(h.has("Cookie")).toBe(false);
    expect(f.calls[0]!.init.redirect).toBe("error");
    expect(f.calls[0]!.init.credentials).toBeUndefined();
  });

  it("can skip the version header", async () => {
    const { http, f } = client([() => json(200, {})], { apiVersion: null });
    await http.request({ method: "GET", path: "/me" });
    expect(f.calls[0]!.headers.has("IMPROJ-API-Version")).toBe(false);
  });

  it("encodes query parameters and drops empty ones", async () => {
    const { http, f } = client([() => json(200, {})]);
    await http.request({ method: "GET", path: "/x", query: { a: "b c&d", n: 5, t: true, u: undefined, z: null, e: "" } });
    expect(f.calls[0]!.url.search).toBe("?a=b+c%26d&n=5&t=true");
  });

  it("refuses unsafe paths", () => {
    const { http } = client([() => json(200, {})]);
    expect(() => http.url("projects")).toThrow("Invalid API path");
    expect(() => http.url("/projects/../admin")).toThrow("Invalid API path");
    expect(() => http.url("//evil.example")).toThrow("Invalid API path");
  });

  it("validates ids used in paths", () => {
    expect(pathId(42, "id")).toBe("42");
    expect(pathId("42", "id")).toBe("42");
    for (const bad of [0, -1, 1.5, Number.NaN, "", "01", "4/2", "../1", "1 ", null, undefined, {}]) {
      expect(() => pathId(bad, "id")).toThrow("positive integer");
    }
  });

  it("sends JSON bodies and parses JSON answers", async () => {
    const { http, f } = client([() => json(201, { data: { id: 7 } })]);
    const out = await http.request({ method: "POST", path: "/x", json: { title: "A" } });
    expect(out).toEqual({ data: { id: 7 } });
    expect(f.calls[0]!.headers.get("Content-Type")).toBe("application/json");
    expect(f.calls[0]!.body).toBe('{"title":"A"}');
  });

  it("returns undefined for 204", async () => {
    const { http } = client([() => new Response(null, { status: 204 })]);
    await expect(http.request({ method: "DELETE", path: "/x" })).resolves.toBeUndefined();
  });

  it("refuses a non-JSON success", async () => {
    const { http } = client([() => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })]);
    await expect(http.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("refuses broken JSON", async () => {
    const { http } = client([() => new Response("{oops", { status: 200, headers: { "Content-Type": "application/json" } })]);
    await expect(http.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("refuses per-request Authorization and Cookie headers", async () => {
    const { http } = client([() => json(200, {})]);
    await expect(http.request({ method: "GET", path: "/x", options: { headers: { authorization: "Bearer other" } } })).rejects.toThrow(/authorization/i);
    await expect(http.request({ method: "GET", path: "/x", options: { headers: { cookie: "a=1" } } })).rejects.toThrow("cookie");
  });

  it("reports every attempt to onResponse without credentials and survives a throwing hook", async () => {
    const seen: unknown[] = [];
    const { http } = client([() => problem(503, "DB_UNAVAILABLE", { "Retry-After": "0" }), () => json(200, {}, { "RateLimit-Limit": "300", "RateLimit-Remaining": "299", "RateLimit-Reset": "60", "RateLimit-Policy": "300;w=60" })], {
      onResponse: (info) => {
        seen.push(info);
        throw new Error("logging failed");
      },
    });
    await http.request({ method: "GET", path: "/x" });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ status: 200, attempt: 2, rateLimit: { limit: 300, remaining: 299, reset: 60, policy: "300;w=60" } });
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
  });
});

describe("idempotency keys", () => {
  it("adds a UUID Idempotency-Key to every POST", async () => {
    const { http, f } = client([() => json(201, {}), () => json(201, {})]);
    await http.request({ method: "POST", path: "/x", json: {} });
    await http.request({ method: "POST", path: "/x", json: {} });
    const [a, b] = f.calls.map((c) => c.headers.get("Idempotency-Key"));
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("uses the caller's key and keeps it across retries", async () => {
    const { http, f } = client([() => problem(503, "DB_UNAVAILABLE", { "Retry-After": "0" }), () => json(201, {}, { "Idempotent-Replayed": "true" })]);
    await http.request({ method: "POST", path: "/x", json: {}, options: { idempotencyKey: "order-123" } });
    expect(f.calls.map((c) => c.headers.get("Idempotency-Key"))).toEqual(["order-123", "order-123"]);
  });

  it("validates the key and refuses it on other methods", async () => {
    const { http } = client([() => json(200, {})]);
    await expect(http.request({ method: "POST", path: "/x", json: {}, options: { idempotencyKey: "has space" } })).rejects.toThrow("visible ASCII");
    await expect(http.request({ method: "POST", path: "/x", json: {}, options: { idempotencyKey: "x".repeat(256) } })).rejects.toThrow("visible ASCII");
    await expect(http.request({ method: "PATCH", path: "/x", json: {}, options: { idempotencyKey: "k" } })).rejects.toThrow("POST requests only");
  });

  it("can be turned off", async () => {
    const { http, f } = client([() => json(201, {})], { autoIdempotencyKeys: false });
    await http.request({ method: "POST", path: "/x", json: {} });
    expect(f.calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  });

  it("generates keys through node:crypto when Web Crypto is missing (Node 18)", async () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(await randomKey()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("errors", () => {
  it.each([
    [400, "INVALID_INPUT", ImprojBadRequestError],
    [401, "API_TOKEN_INVALID", ImprojAuthenticationError],
    [403, "API_SCOPE_MISSING", ImprojPermissionError],
    [404, "NOT_FOUND", ImprojNotFoundError],
    [409, "IDEMPOTENCY_KEY_IN_USE", ImprojConflictError],
    [422, "IDEMPOTENCY_KEY_REUSED", ImprojUnprocessableError],
    [429, "RATE_LIMITED", ImprojRateLimitError],
    [500, "SOMETHING_WENT_WRONG", ImprojServerError],
    [413, "API_PAYLOAD_TOO_LARGE", ImprojError],
  ])("maps %i %s to its class", async (status, code, Cls) => {
    const { http } = client([() => problem(status, code, status === 429 ? { "Retry-After": "120" } : {})], { maxRetries: 0 });
    const err = await http.request({ method: "PATCH", path: "/x", json: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toBeInstanceOf(ImprojError);
    expect(err).toMatchObject({ status, code, requestId: "req_problem_1", method: "PATCH", path: "/x" });
    expect((err as Error).message).toBe(`${code}: Detail for ${code}. (request req_problem_1)`);
  });

  it("keeps field errors, type, title and instance", async () => {
    const { http } = client([() => problem(400, "INVALID_INPUT", {}, { errors: [{ path: "due_date", message: "Use YYYY-MM-DD" }] })]);
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojBadRequestError;
    expect(err.errors).toEqual([{ path: "due_date", message: "Use YYYY-MM-DD" }]);
    expect(err.type).toBe("https://improj.com/developers#error-INVALID_INPUT");
    expect(err.title).toBe("Error");
    expect(err.instance).toBe("/api/v1/test");
    expect(err.toJSON()).toMatchObject({ code: "INVALID_INPUT", status: 400, errors: [{ path: "due_date" }] });
  });

  it("redacts tokens a proxy might echo into an error", async () => {
    const leaked = `improj_pat_${"A1b2".repeat(12)}Z`;
    const { http } = client([() => problem(400, "INVALID_INPUT", {}, { detail: `bad token ${leaked} and whsec_abcdefabcdef` })]);
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojError;
    expect(err.message + err.detail).not.toContain(leaked);
    expect(err.detail).toContain("improj_pat_***");
    expect(err.detail).toContain("whsec_***");
  });

  it("handles errors without a problem body", async () => {
    const { http } = client([() => new Response("Bad gateway", { status: 502, headers: { "Content-Type": "text/plain" } })]);
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojError;
    expect(err).toBeInstanceOf(ImprojServerError);
    expect(err.code).toBe("HTTP_502");
    expect(err.requestId).toBeNull();
  });

  it("ignores an unusable problem body and a malformed code", () => {
    const meta = { requestId: null, rateLimit: null, retryAfter: null, method: "GET" as const, path: "/x" };
    expect(buildApiError(400, "[1,2]", "application/problem+json", meta).code).toBe("HTTP_400");
    expect(buildApiError(400, "{bad", "application/problem+json", meta).code).toBe("HTTP_400");
    expect(buildApiError(400, JSON.stringify({ code: "lower case <script>" }), "application/json", meta).code).toBe("HTTP_400");
    expect(buildApiError(400, JSON.stringify({ code: "X", request_id: "req_from_body" }), "application/json", meta).requestId).toBe("req_from_body");
  });
});

describe("retries", () => {
  it("retries a GET on 503 and honours Retry-After", async () => {
    const { http, f } = client([() => problem(503, "SERVER_BUSY", { "Retry-After": "0" }), () => json(200, { ok: 1 })]);
    await expect(http.request({ method: "GET", path: "/x" })).resolves.toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("retries 429 for every method, including PATCH", async () => {
    const { http, f } = client([() => problem(429, "RATE_LIMITED", { "Retry-After": "0" }), () => json(200, {})]);
    await http.request({ method: "PATCH", path: "/x", json: {} });
    expect(f.calls).toHaveLength(2);
  });

  it("does not retry a PATCH on 503 (it may have been applied)", async () => {
    const { http, f } = client([() => problem(503, "DB_UNAVAILABLE", { "Retry-After": "0" }), () => json(200, {})]);
    await expect(http.request({ method: "PATCH", path: "/x", json: {} })).rejects.toBeInstanceOf(ImprojServerError);
    expect(f.calls).toHaveLength(1);
  });

  it("does not retry a POST without an Idempotency-Key on 503", async () => {
    const { http, f } = client([() => problem(503, "DB_UNAVAILABLE", { "Retry-After": "0" })], { autoIdempotencyKeys: false });
    await expect(http.request({ method: "POST", path: "/x", json: {} })).rejects.toBeInstanceOf(ImprojServerError);
    expect(f.calls).toHaveLength(1);
  });

  it("never retries 500", async () => {
    const { http, f } = client([() => problem(500, "SOMETHING_WENT_WRONG")]);
    await expect(http.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(ImprojServerError);
    expect(f.calls).toHaveLength(1);
  });

  it("gives up after maxRetries and exposes retryAfter", async () => {
    const { http, f } = client([() => problem(429, "RATE_LIMITED", { "Retry-After": "0" })], { maxRetries: 2 });
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojRateLimitError;
    expect(f.calls).toHaveLength(3);
    expect(err).toBeInstanceOf(ImprojRateLimitError);
    expect(err.retryAfter).toBe(0);
  });

  it("does not wait for a Retry-After beyond maxRetryAfterMs", async () => {
    const { http, f } = client([() => problem(429, "RATE_LIMITED", { "Retry-After": "3600" })]);
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojRateLimitError;
    expect(f.calls).toHaveLength(1);
    expect(err.retryAfter).toBe(3600);
  });

  it("per-request maxRetries overrides the client", async () => {
    const { http, f } = client([() => problem(503, "SERVER_BUSY", { "Retry-After": "0" })]);
    await expect(http.request({ method: "GET", path: "/x", options: { maxRetries: 0 } })).rejects.toBeInstanceOf(ImprojServerError);
    expect(f.calls).toHaveLength(1);
  });

  it("backs off with jitter when there is no Retry-After", async () => {
    const { http, f } = client([() => problem(503, "SERVER_BUSY"), () => json(200, {})]);
    const t = Date.now();
    await http.request({ method: "GET", path: "/x" });
    expect(Date.now() - t).toBeGreaterThanOrEqual(240);
    expect(f.calls).toHaveLength(2);
  });

  it("retries a GET after a network error", async () => {
    const { http, f } = client([networkFailure, () => json(200, { ok: true })]);
    await expect(http.request({ method: "GET", path: "/x" })).resolves.toEqual({ ok: true });
    expect(f.calls).toHaveLength(2);
  });

  it("does not retry a PATCH after a network error", async () => {
    const { http, f } = client([networkFailure, () => json(200, {})]);
    const err = await http.request({ method: "PATCH", path: "/x", json: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImprojConnectionError);
    expect(err).toMatchObject({ code: "CONNECTION_ERROR", status: 0 });
    expect(f.calls).toHaveLength(1);
  });

  it("treats a DELETE that 404s after a lost answer as done", async () => {
    const { http, f } = client([networkFailure, () => problem(404, "NOT_FOUND")]);
    await expect(http.request({ method: "DELETE", path: "/x" })).resolves.toBeUndefined();
    expect(f.calls).toHaveLength(2);
  });

  it("a plain DELETE 404 is still an error", async () => {
    const { http } = client([() => problem(404, "NOT_FOUND")]);
    await expect(http.request({ method: "DELETE", path: "/x" })).rejects.toBeInstanceOf(ImprojNotFoundError);
  });

  it("status-only requests retry 503 but not network errors", async () => {
    const a = client([() => problem(503, "SERVER_BUSY", { "Retry-After": "0" }), () => json(201, {})]);
    await a.http.request({ method: "PUT", path: "/uploads/x", retry: "status-only" });
    expect(a.f.calls).toHaveLength(2);
    const b = client([networkFailure, () => json(201, {})]);
    await expect(b.http.request({ method: "PUT", path: "/uploads/x", retry: "status-only" })).rejects.toBeInstanceOf(ImprojConnectionError);
    expect(b.f.calls).toHaveLength(1);
  });

  it("redacts secrets in network error messages", async () => {
    const { http } = client([() => {
      throw new TypeError(`connect failed for Bearer ${TOKEN}`);
    }], { maxRetries: 0 });
    const err = (await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e)) as ImprojError;
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("timeouts and cancellation", () => {
  const hang: Handler = (req) =>
    new Promise((_resolve, reject) => {
      req.init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

  it("times out each attempt and retries safe requests", async () => {
    const { http, f } = client([hang, hang], { timeoutMs: 30, maxRetries: 1 });
    const err = await http.request({ method: "GET", path: "/x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImprojTimeoutError);
    expect(err).toMatchObject({ code: "TIMEOUT" });
    expect(f.calls).toHaveLength(2);
  });

  it("stops at once when the caller aborts", async () => {
    const { http, f } = client([hang]);
    const ac = new AbortController();
    const p = http.request({ method: "GET", path: "/x", options: { signal: ac.signal } });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.calls).toHaveLength(1);
  });

  it("refuses an already aborted signal", async () => {
    const { http, f } = client([() => json(200, {})]);
    const ac = new AbortController();
    ac.abort();
    await expect(http.request({ method: "GET", path: "/x", options: { signal: ac.signal } })).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.calls).toHaveLength(0);
  });

  it("an abort during the backoff wait cancels the retry", async () => {
    const { http, f } = client([() => problem(503, "SERVER_BUSY", { "Retry-After": "5" })]);
    const ac = new AbortController();
    const p = http.request({ method: "GET", path: "/x", options: { signal: ac.signal } });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.calls).toHaveLength(1);
  });

  it("an abort during a network backoff cancels the retry", async () => {
    const { http } = client([networkFailure]);
    const ac = new AbortController();
    const p = http.request({ method: "GET", path: "/x", options: { signal: ac.signal } });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("helpers", () => {
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("12")).toBe(12);
    expect(parseRetryAfter("soon")).toBeNull();
    const now = Date.parse("2026-10-24T10:00:00Z");
    expect(parseRetryAfter("Sat, 24 Oct 2026 10:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Sat, 24 Oct 2026 09:00:00 GMT", now)).toBe(0);
  });

  it("caps exponential backoff at 8 seconds", () => {
    expect(backoffMs(1, () => 1)).toBe(500);
    expect(backoffMs(2, () => 1)).toBe(1000);
    expect(backoffMs(10, () => 1)).toBe(8000);
    expect(backoffMs(1, () => 0)).toBe(250);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(1000);
  });
});
