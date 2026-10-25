import { describe, expect, it, vi } from "vitest";
import { Improj, Page, PagePromise } from "../src/index.js";
import { TOKEN, json, mockFetch } from "./helpers.js";

function pages(...lists: Array<{ data: number[]; next_cursor: string | null }>) {
  return mockFetch(...lists.map((l) => () => json(200, l)));
}

describe("pagination", () => {
  it("await gives the first page; for await walks every item", async () => {
    const f = pages({ data: [1, 2], next_cursor: "c1" }, { data: [1, 2], next_cursor: "c1" }, { data: [3], next_cursor: "c2" }, { data: [4], next_cursor: null });
    const c = new Improj({ token: TOKEN, fetch: f });
    const first = await c.projects.list({ limit: 2 });
    expect(first.data).toEqual([1, 2]);
    expect(first.hasNextPage()).toBe(true);

    const all: unknown[] = [];
    for await (const p of c.projects.list({ limit: 2 })) all.push(p);
    expect(all).toEqual([1, 2, 3, 4]);
    const urls = f.calls.slice(1).map((r) => r.url.search);
    expect(urls).toEqual(["?limit=2", "?limit=2&cursor=c1", "?limit=2&cursor=c2"]);
  });

  it("nothing is fetched until awaited or iterated", () => {
    const f = pages({ data: [], next_cursor: null });
    new Improj({ token: TOKEN, fetch: f }).projects.list();
    expect(f.calls).toHaveLength(0);
  });

  it("the first page is fetched once even when awaited twice", async () => {
    const f = pages({ data: [1], next_cursor: null });
    const p = new Improj({ token: TOKEN, fetch: f }).projects.list();
    await p;
    await p;
    expect(f.calls).toHaveLength(1);
  });

  it("starts from a caller-supplied cursor", async () => {
    const f = pages({ data: [5], next_cursor: null });
    await new Improj({ token: TOKEN, fetch: f }).projects.list({ cursor: "abc.def" });
    expect(f.calls[0]!.url.searchParams.get("cursor")).toBe("abc.def");
  });

  it("getNextPage and pages()", async () => {
    const f = pages({ data: [1], next_cursor: "n" }, { data: [2], next_cursor: null });
    const c = new Improj({ token: TOKEN, fetch: f });
    const p1 = await c.projects.list();
    const p2 = await p1.getNextPage();
    expect(p2.data).toEqual([2]);
    expect(p2.nextCursor).toBeNull();
    await expect(p2.getNextPage()).rejects.toMatchObject({ code: "NO_MORE_PAGES" });
  });

  it("toArray stops at max", async () => {
    const f = pages({ data: [1, 2], next_cursor: "a" }, { data: [3, 4], next_cursor: "b" }, { data: [5], next_cursor: null });
    const c = new Improj({ token: TOKEN, fetch: f });
    expect(await c.projects.list().toArray({ max: 3 })).toEqual([1, 2, 3]);
    expect(await c.projects.list().toArray({ max: 0 })).toEqual([]);
    await expect(c.projects.list().toArray({ max: -1 })).rejects.toMatchObject({ code: "CONFIGURATION" });
  });

  it("stops on a repeated cursor instead of looping forever", async () => {
    const f = pages({ data: [1], next_cursor: "same" }, { data: [2], next_cursor: "same" });
    const c = new Improj({ token: TOKEN, fetch: f });
    await expect(c.projects.list().toArray()).rejects.toMatchObject({ code: "PAGINATION_LOOP" });
  });

  it("refuses a list answer without data", async () => {
    const f = mockFetch(() => json(200, { items: [] }));
    await expect(new Improj({ token: TOKEN, fetch: f }).projects.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("treats an empty cursor as the end", () => {
    const page = new Page({ data: [1], next_cursor: "" }, vi.fn());
    expect(page.hasNextPage()).toBe(false);
  });

  it("supports catch and finally like a promise", async () => {
    const failing = new PagePromise<number>(() => Promise.reject(new Error("boom")));
    await expect(failing.catch((e: unknown) => (e as Error).message)).resolves.toBe("boom");
    const done = vi.fn();
    await new PagePromise<number>(async () => ({ data: [1], next_cursor: null })).finally(done);
    expect(done).toHaveBeenCalledOnce();
  });
});
