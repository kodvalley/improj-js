import { vi } from "vitest";

/** Obviously fake credentials: they never match a real token pattern. */
export const TOKEN = "improj_pat_TEST_ONLY_not_a_real_token";
export const SECRET = "whsec_TEST_ONLY_not_a_real_secret";

export interface Recorded {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
  init: RequestInit;
}

export type Handler = (req: Recorded) => Response | Promise<Response>;

/** A fetch mock that answers with the handlers in order (the last one repeats). */
export function mockFetch(...handlers: Handler[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const req: Recorded = {
      url: new URL(String(input)),
      method: String(init.method ?? "GET"),
      headers: new Headers(init.headers),
      body: init.body,
      init,
    };
    calls.push(req);
    const handler = handlers[Math.min(i, handlers.length - 1)]!;
    i += 1;
    return handler(req);
  });
  return Object.assign(fn as unknown as typeof fetch, { calls, spy: fn });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req_test_1", ...headers },
  });
}

export function problem(status: number, code: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      type: `https://improj.com/developers#error-${code}`,
      title: "Error",
      status,
      detail: `Detail for ${code}.`,
      instance: "/api/v1/test",
      code,
      request_id: "req_problem_1",
      ...extra,
    }),
    { status, headers: { "Content-Type": "application/problem+json", "X-Request-Id": "req_problem_1", ...headers } },
  );
}

/** Throws like fetch does when the network fails. */
export const networkFailure: Handler = () => {
  throw new TypeError("fetch failed");
};
