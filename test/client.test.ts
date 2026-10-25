import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Improj, ImprojError, SDK_VERSION, API_VERSION } from "../src/index.js";
import { isBrowserLike } from "../src/core.js";
import { TOKEN, json, mockFetch } from "./helpers.js";
import pkg from "../package.json" with { type: "json" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("configuration", () => {
  it("uses the production base URL by default", () => {
    const c = new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, { data: {} })) });
    expect(c.baseUrl).toBe("https://improj.com/api/v1");
  });

  it("normalises a trailing slash and keeps the path", () => {
    const c = new Improj({ token: TOKEN, baseUrl: "https://staging.example.com/api/v1///", fetch: mockFetch(() => json(200, {})) });
    expect(c.baseUrl).toBe("https://staging.example.com/api/v1");
  });

  it.each([
    ["ftp://improj.com/api/v1", "https"],
    ["not a url", "valid URL"],
    ["https://user:pass@improj.com/api/v1", "credentials"],
    ["https://improj.com/api/v1?x=1", "query"],
    ["https://improj.com/api/v1#x", "query or fragment"],
  ])("refuses baseUrl %s", (baseUrl, message) => {
    expect(() => new Improj({ token: TOKEN, baseUrl })).toThrow(message);
  });

  it("refuses to send a token over plain http except to loopback", () => {
    expect(() => new Improj({ token: TOKEN, baseUrl: "http://api.example.com/v1" })).toThrow("plain http");
    expect(() => new Improj({ token: TOKEN, baseUrl: "http://127.0.0.1:4010/api/v1", fetch: mockFetch(() => json(200, {})) })).not.toThrow();
    expect(() => new Improj({ token: TOKEN, baseUrl: "http://localhost:4010/api/v1", fetch: mockFetch(() => json(200, {})) })).not.toThrow();
  });

  it("refuses a token with whitespace or control characters", () => {
    expect(() => new Improj({ token: "improj_pat_abc def ghi" })).toThrow(ImprojError);
    expect(() => new Improj({ token: "improj_pat_abc\r\nX-Evil: 1" })).toThrow("single line");
  });

  it("reads IMPROJ_TOKEN from the environment for the default base URL", async () => {
    vi.stubEnv("IMPROJ_TOKEN", TOKEN);
    const f = mockFetch(() => json(200, { data: { id: 1 } }));
    await new Improj({ fetch: f }).me.get();
    expect(f.calls[0]!.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("does not read IMPROJ_TOKEN when baseUrl is set (proxy mode)", async () => {
    vi.stubEnv("IMPROJ_TOKEN", TOKEN);
    const f = mockFetch(() => json(200, { data: { id: 1 } }));
    await new Improj({ baseUrl: "https://app.example.com/api/improj", fetch: f }).me.get();
    expect(f.calls[0]!.headers.has("Authorization")).toBe(false);
  });

  it("fails fast without a token against the official API", async () => {
    const c = new Improj({ fetch: mockFetch(() => json(200, {})) });
    await expect(c.me.get()).rejects.toMatchObject({ code: "CONFIGURATION" });
  });

  it("allows the public OpenAPI document without a token", async () => {
    const f = mockFetch(() => json(200, { openapi: "3.1.0" }));
    await expect(new Improj({ fetch: f }).openapi()).resolves.toEqual({ openapi: "3.1.0" });
  });

  it.each([
    [{ timeoutMs: 0 }, "timeoutMs"],
    [{ timeoutMs: Number.NaN }, "timeoutMs"],
    [{ maxRetries: -1 }, "maxRetries"],
    [{ maxRetries: 1.5 }, "maxRetries"],
    [{ maxRetryAfterMs: -5 }, "maxRetryAfterMs"],
    [{ apiVersion: "latest" }, "apiVersion"],
    [{ headers: { Authorization: "Bearer x" } }, "Authorization"],
    [{ headers: { Cookie: "a=b" } }, "Cookie"],
    [{ headers: { "Bad Header": "x" } }, "invalid header name"],
    [{ headers: { "X-Ok": "a\nb" } }, "control characters"],
  ])("validates options %o", (opts, message) => {
    expect(() => new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, {})), ...opts })).toThrow(message);
  });

  it("requires a fetch implementation", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new Improj({ token: TOKEN })).toThrow("fetch");
  });

  it("uses the global fetch when none is passed", async () => {
    const f = mockFetch(() => json(200, { data: { id: 3 } }));
    vi.stubGlobal("fetch", f);
    await expect(new Improj({ token: TOKEN }).me.get()).resolves.toEqual({ id: 3 });
  });
});

describe("token secrecy", () => {
  it("never shows the token in JSON or inspect output", () => {
    const c = new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, {})) });
    const shown = JSON.stringify(c) + inspect(c, { showHidden: true, depth: 5 }) + String(c);
    expect(shown).not.toContain(TOKEN);
    expect(JSON.stringify(c)).toContain("improj_pat_***");
  });

  it("shows (none) in proxy mode", () => {
    const c = new Improj({ baseUrl: "https://app.example.com/api/improj", fetch: mockFetch(() => json(200, {})) });
    expect(c.toJSON()).toMatchObject({ token: "(none)" });
  });
});

describe("browser safety", () => {
  it("refuses a token in a browser", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    expect(isBrowserLike()).toBe(true);
    expect(() => new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, {})) })).toThrow("must not be used in a browser");
  });

  it("detects React Native and web workers", () => {
    vi.stubGlobal("navigator", { product: "ReactNative" });
    expect(isBrowserLike()).toBe(true);
    vi.unstubAllGlobals();
    vi.stubGlobal("WorkerGlobalScope", function WorkerGlobalScope() {});
    vi.stubGlobal("importScripts", () => undefined);
    expect(isBrowserLike()).toBe(true);
  });

  it("allows a token in a browser only when explicitly accepted, without cookies", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const f = mockFetch(() => json(200, { data: { id: 1 } }));
    const c = new Improj({ token: TOKEN, fetch: f, dangerouslyAllowBrowser: true });
    await c.me.get();
    expect(f.calls[0]!.init.credentials).toBe("omit");
    expect(f.calls[0]!.init.referrerPolicy).toBe("no-referrer");
    expect(f.calls[0]!.headers.has("User-Agent")).toBe(false);
  });

  it("proxy mode in a browser: relative base URL, same-origin cookies, no token", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { origin: "https://app.example.com" });
    const f = mockFetch(() => json(200, { data: [], next_cursor: null }));
    const c = new Improj({ baseUrl: "/api/improj", fetch: f, headers: { "X-CSRF-Token": "abc" } });
    await c.projects.list();
    const call = f.calls[0]!;
    expect(call.url.href).toBe("https://app.example.com/api/improj/projects");
    expect(call.init.credentials).toBe("same-origin");
    expect(call.headers.has("Authorization")).toBe(false);
    expect(call.headers.get("X-CSRF-Token")).toBe("abc");
  });

  it("a relative base URL needs a page origin", () => {
    expect(() => new Improj({ baseUrl: "/api/improj" })).toThrow("relative");
  });
});

describe("versions", () => {
  it("SDK_VERSION matches package.json", () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("pins the API version of this release", () => {
    expect(API_VERSION).toBe("2026-10-24");
  });
});
