// Behaviour added with the completed 2026-10-24 contract: documented error
// codes and classes, X-Request-Id, per-request API version, agent next_cursor.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  Improj,
  ImprojError,
  ImprojMethodNotAllowedError,
  ImprojPayloadTooLargeError,
  ImprojServerError,
  ImprojServiceUnavailableError,
  ImprojUnsupportedMediaTypeError,
} from "../src/index.js";
import { errorClassFor } from "../src/errors.js";
import { TOKEN, json, mockFetch, problem } from "./helpers.js";

const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8")) as {
  components: { responses: Record<string, { description: string; content?: unknown }> };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
};

describe("documented errors", () => {
  it("API_ERROR_CODES lists every code the spec's error responses name", () => {
    const named = new Set<string>();
    for (const r of Object.values(spec.components.responses)) {
      for (const m of r.description.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) named.add(m[0]);
    }
    named.delete("X_REQUEST_ID");
    const known = new Set<string>(API_ERROR_CODES);
    expect([...named].filter((c) => !known.has(c))).toEqual([]);
    expect(named.size).toBeGreaterThan(15);
  });

  it("every status the spec documents maps to a specific class", () => {
    const statuses = new Set<number>();
    for (const item of Object.values(spec.paths)) for (const op of Object.values(item)) for (const s of Object.keys(op.responses ?? {})) if (/^[45]\d\d$/.test(s)) statuses.add(Number(s));
    expect([...statuses].sort()).toEqual([400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 503]);
    for (const s of statuses) expect(errorClassFor(s), String(s)).not.toBe(ImprojError);
  });

  it.each([
    [405, "API_METHOD_NOT_ALLOWED", ImprojMethodNotAllowedError],
    [413, "FILE_TOO_LARGE_FOR_PLAN", ImprojPayloadTooLargeError],
    [415, "API_UNSUPPORTED_MEDIA_TYPE", ImprojUnsupportedMediaTypeError],
    [503, "SERVER_BUSY", ImprojServiceUnavailableError],
  ])("%i %s", async (status, code, Cls) => {
    const f = mockFetch(() => problem(status, code));
    const err = await new Improj({ token: TOKEN, fetch: f, maxRetries: 0 }).tasks.get(1, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toMatchObject({ status, code });
    if (status === 503) expect(err).toBeInstanceOf(ImprojServerError);
  });
});

describe("X-Request-Id and IMPROJ-API-Version per request", () => {
  it("sends your request id; the API's echo lands in errors", async () => {
    const f = mockFetch(() => problem(404, "NOT_FOUND", { "X-Request-Id": "sync-job-42:7" }));
    const err = (await new Improj({ token: TOKEN, fetch: f }).tasks.get(1, 2, { requestId: "sync-job-42:7" }).catch((e: unknown) => e)) as ImprojError;
    expect(f.calls[0]!.headers.get("X-Request-Id")).toBe("sync-job-42:7");
    expect(err.requestId).toBe("sync-job-42:7");
  });

  it("refuses an invalid request id and these headers in options.headers", async () => {
    const c = new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, { data: {} })) });
    await expect(c.me.get({ requestId: "short" })).rejects.toMatchObject({ code: "CONFIGURATION" });
    await expect(c.me.get({ requestId: "has space in it" })).rejects.toMatchObject({ code: "CONFIGURATION" });
    for (const name of ["X-Request-Id", "IMPROJ-API-Version", "Idempotency-Key"]) {
      await expect(c.me.get({ headers: { [name]: "abcdefgh" } })).rejects.toThrow(name);
    }
  });

  it("overrides or drops the version pin for one request", async () => {
    const f = mockFetch(() => json(200, { data: {} }));
    const c = new Improj({ token: TOKEN, fetch: f });
    await c.me.get({ apiVersion: "2026-10-24" });
    await c.me.get({ apiVersion: null });
    expect(f.calls[0]!.headers.get("IMPROJ-API-Version")).toBe("2026-10-24");
    expect(f.calls[1]!.headers.has("IMPROJ-API-Version")).toBe(false);
    await expect(c.me.get({ apiVersion: "next" })).rejects.toMatchObject({ code: "CONFIGURATION" });
  });
});

describe("agent items", () => {
  it("prefers the signed next_cursor over the legacy nextCursor", async () => {
    const f = mockFetch(
      () => json(200, { data: [{ id: 9 }], next_cursor: "eyJ2IjoxfQ.c2ln", nextCursor: 9 }),
      () => json(200, { data: [{ id: 8 }], next_cursor: null, nextCursor: null }),
    );
    const items = await new Improj({ token: TOKEN, fetch: f }).agents.items(4).toArray();
    expect(items).toEqual([{ id: 9 }, { id: 8 }]);
    expect(f.calls[1]!.url.searchParams.get("cursor")).toBe("eyJ2IjoxfQ.c2ln");
  });
});
