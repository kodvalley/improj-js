// Contract test: every operation in spec/openapi.json is reachable through the
// SDK with the right method and path, and the SDK calls nothing the spec lacks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Improj } from "../src/index.js";
import { TOKEN, json, mockFetch } from "./helpers.js";

const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { operationId: string }>>;
};

const bytes = new Uint8Array([1, 2, 3]);
const UPLOAD_ID = "upl_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

type Call = (c: Improj) => PromiseLike<unknown>;
const CALLS: Record<string, Call> = {
  getMe: (c) => c.me.get(),
  listProjects: (c) => c.projects.list(),
  getProject: (c) => c.projects.get(1),
  listWorkPackages: (c) => c.projects.workPackages(1),
  listActivities: (c) => c.projects.activities(1, { work_package_id: 2 }),
  listTasks: (c) => c.tasks.list(1, { status: "todo" }),
  createTask: (c) => c.tasks.create(1, { title: "T" }),
  getTask: (c) => c.tasks.get(1, 2),
  updateTask: (c) => c.tasks.update(1, 2, { status: "done" }),
  deleteTask: (c) => c.tasks.delete(1, 2),
  listMilestones: (c) => c.milestones.list(1),
  createMilestone: (c) => c.milestones.create(1, { title: "M" }),
  getMilestone: (c) => c.milestones.get(1, 2),
  updateMilestone: (c) => c.milestones.update(1, 2, { completed: true }),
  deleteMilestone: (c) => c.milestones.delete(1, 2),
  listMembers: (c) => c.members.list(1),
  listFiles: (c) => c.files.list(1, { parent_id: "root" }),
  getFile: (c) => c.files.get(1, 2),
  getFileDownloadLink: (c) => c.files.downloadLink(1, 2),
  createUpload: (c) => c.files.createUpload(1, { name: "a.pdf", size: 3, mime_type: "application/pdf" }),
  sendUpload: (c) => c.files.sendUpload(UPLOAD_ID, bytes),
  listCalendarEvents: (c) => c.calendarEvents.list(1, { from: "2026-01-01", to: "2026-12-31" }),
  createCalendarEvent: (c) => c.calendarEvents.create(1, { title: "E", start_date: "2026-11-02" }),
  getCalendarEvent: (c) => c.calendarEvents.get(1, 2),
  updateCalendarEvent: (c) => c.calendarEvents.update(1, 2, { status: "cancelled" }),
  deleteCalendarEvent: (c) => c.calendarEvents.delete(1, 2),
  listMeetings: (c) => c.meetings.list(1),
  getMeeting: (c) => c.meetings.get(1, 2),
  listWebhooks: (c) => c.webhooks.list(),
  createWebhook: (c) => c.webhooks.create({ url: "https://hooks.example.com/improj", description: "CI", events: ["task.created"] }),
  getWebhook: (c) => c.webhooks.get(3),
  updateWebhook: (c) => c.webhooks.update(3, { enabled: true }),
  deleteWebhook: (c) => c.webhooks.delete(3),
  testWebhook: (c) => c.webhooks.test(3),
  listWebhookDeliveries: (c) => c.webhooks.deliveries(3),
  listMyCalendar: (c) => c.calendar.list({ from: "2026-01-01", to: "2026-01-31" }),
  listAgents: (c) => c.agents.list(),
  listAgentItems: (c) => c.agents.items(4, { limit: 10 }),
  postAgentNote: (c) => c.agents.postNote(4, { kind: "question", text: "Status?" }),
  getOpenApi: (c) => c.openapi(),
};

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
    .map(([method, op]) => ({ path, method: method.toUpperCase(), id: op.operationId })),
);

function answerFor(method: string, path: string) {
  if (method === "DELETE") return new Response(null, { status: 204 });
  if (path.endsWith("/items")) return json(200, { data: [], nextCursor: null });
  return json(method === "POST" || method === "PUT" ? 201 : 200, { data: [], next_cursor: null });
}

describe("every operation of the spec", () => {
  it("is implemented, and nothing else is", () => {
    expect(Object.keys(CALLS).sort()).toEqual(operations.map((o) => o.id).sort());
  });

  it.each(operations)("$id: $method $path", async ({ id, method, path }) => {
    const f = mockFetch((req) => answerFor(req.method, req.url.pathname));
    await CALLS[id]!(new Improj({ token: TOKEN, fetch: f }));
    const call = f.calls[0]!;
    expect(call.method).toBe(method);
    const pattern = new RegExp(`^/api/v1${path.replace(/\{[a-z_]+\}/g, "[^/]+")}$`);
    expect(call.url.pathname).toMatch(pattern);
    if (method === "POST") expect(call.headers.get("Idempotency-Key")).toBeTruthy();
  });
});

describe("resource details", () => {
  it("passes filters as the API's query parameters", async () => {
    const f = mockFetch(() => json(200, { data: [], next_cursor: null }));
    const c = new Improj({ token: TOKEN, fetch: f });
    await c.tasks.list(1, { status: "stuck", limit: 50 });
    await c.files.list(1, { parent_id: 9 });
    await c.projects.activities(1);
    await c.calendarEvents.list(1, { from: "2026-01-01" });
    expect(f.calls.map((x) => x.url.search)).toEqual(["?status=stuck&limit=50", "?parent_id=9", "", "?from=2026-01-01"]);
  });

  it("unwraps { data } for single objects", async () => {
    const f = mockFetch(() => json(200, { data: { id: 2, title: "T" } }));
    await expect(new Improj({ token: TOKEN, fetch: f }).tasks.get(1, 2)).resolves.toEqual({ id: 2, title: "T" });
  });

  it("refuses an answer without data", async () => {
    const f = mockFetch(() => json(200, { id: 2 }));
    await expect(new Improj({ token: TOKEN, fetch: f }).tasks.get(1, 2)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("a test ping posts without a body", async () => {
    const f = mockFetch(() => json(200, { data: { status: "delivered", response_code: 200, error: null } }));
    await new Improj({ token: TOKEN, fetch: f }).webhooks.test(3);
    expect(f.calls[0]!.body).toBeUndefined();
  });

  it("agent items: numeric nextCursor becomes the next page cursor", async () => {
    const f = mockFetch(
      () => json(200, { data: [{ id: 9 }], nextCursor: 9 }),
      () => json(200, { data: [{ id: 8 }], nextCursor: null }),
    );
    const items = await new Improj({ token: TOKEN, fetch: f }).agents.items(4).toArray();
    expect(items).toEqual([{ id: 9 }, { id: 8 }]);
    expect(f.calls[1]!.url.searchParams.get("cursor")).toBe("9");
  });

  it("agent items also accept next_cursor", async () => {
    const f = mockFetch(() => json(200, { data: [], next_cursor: null }));
    await expect(new Improj({ token: TOKEN, fetch: f }).agents.items(4, { cursor: "12" })).resolves.toMatchObject({ data: [] });
    expect(f.calls[0]!.url.searchParams.get("cursor")).toBe("12");
  });

  it("request() reaches endpoints the SDK does not wrap yet", async () => {
    const f = mockFetch(() => json(200, { data: { ok: true } }));
    const out = await new Improj({ token: TOKEN, fetch: f }).request("POST", "/projects/1/new-thing", { body: { a: 1 }, query: { dry_run: true } });
    expect(out).toEqual({ data: { ok: true } });
    expect(f.calls[0]!.url.href).toBe("https://improj.com/api/v1/projects/1/new-thing?dry_run=true");
  });

  it("refuses ids that could change the path", async () => {
    const c = new Improj({ token: TOKEN, fetch: mockFetch(() => json(200, {})) });
    expect(() => c.tasks.get("1/../../admin", 2)).toThrow("positive integer");
    expect(() => c.files.list(1, { parent_id: "../x" as never })).toThrow("positive integer");
    expect(() => c.projects.activities(1, { work_package_id: "a" })).toThrow("positive integer");
  });
});
