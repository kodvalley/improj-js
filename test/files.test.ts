import { describe, expect, it } from "vitest";
import { Improj, ImprojConnectionError } from "../src/index.js";
import { TOKEN, json, mockFetch, networkFailure, problem } from "./helpers.js";

const UPLOAD = {
  id: "upl_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
  upload_url: "https://evil.example.com/steal",
  method: "PUT",
  max_bytes: 3,
  expires_at: "2026-10-24T10:15:00.000Z",
};
const FILE = { id: 77, project_id: 1, name: "a.pdf" };

describe("upload helper", () => {
  it("announces, then sends the bytes to <baseUrl>/uploads/<id>, never to upload_url", async () => {
    const f = mockFetch(() => json(201, { data: UPLOAD }), () => json(201, { data: FILE }));
    const c = new Improj({ token: TOKEN, fetch: f });
    const file = await c.files.upload(1, { name: "a.pdf", data: new Uint8Array([1, 2, 3]), mimeType: "application/pdf", parentId: 5 });
    expect(file).toEqual(FILE);

    const [announce, send] = f.calls;
    expect(announce!.method).toBe("POST");
    expect(JSON.parse(String(announce!.body))).toEqual({ name: "a.pdf", size: 3, mime_type: "application/pdf", parent_id: 5 });
    expect(announce!.headers.get("Idempotency-Key")).toBeTruthy();

    expect(send!.method).toBe("PUT");
    expect(send!.url.href).toBe(`https://improj.com/api/v1/uploads/${UPLOAD.id}`);
    expect(send!.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(send!.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(send!.headers.has("Idempotency-Key")).toBe(false);
    expect(send!.body).toBeInstanceOf(Uint8Array);
  });

  it("takes the MIME type from a Blob and accepts ArrayBuffer", async () => {
    const f = mockFetch(() => json(201, { data: { ...UPLOAD, max_bytes: 5 } }), () => json(201, { data: FILE }));
    const c = new Improj({ token: TOKEN, fetch: f });
    await c.files.upload(1, { name: "n.txt", data: new Blob(["hello"], { type: "text/plain" }) });
    expect(JSON.parse(String(f.calls[0]!.body))).toMatchObject({ size: 5, mime_type: "text/plain" });

    const g = mockFetch(() => json(201, { data: { ...UPLOAD, max_bytes: 2 } }), () => json(201, { data: FILE }));
    await new Improj({ token: TOKEN, fetch: g }).files.upload(1, { name: "b.bin", data: new ArrayBuffer(2) });
    expect(JSON.parse(String(g.calls[0]!.body))).toMatchObject({ size: 2, mime_type: "application/octet-stream" });
  });

  it("refuses empty, oversized and streaming bodies before any request", async () => {
    const f = mockFetch(() => json(201, { data: UPLOAD }));
    const c = new Improj({ token: TOKEN, fetch: f });
    await expect(c.files.upload(1, { name: "e", data: new Uint8Array(0) })).rejects.toThrow("empty");
    await expect(c.files.upload(1, { name: "big", data: new Uint8Array(16 * 1024 * 1024 + 1) })).rejects.toThrow("16 MB");
    await expect(c.files.upload(1, { name: "s", data: new ReadableStream() as never })).rejects.toThrow("streams are not supported");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses more bytes than were announced", async () => {
    const f = mockFetch(() => json(201, { data: FILE }));
    await expect(new Improj({ token: TOKEN, fetch: f }).files.sendUpload(UPLOAD as never, new Uint8Array(4))).rejects.toThrow("at most 3");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses an invalid upload id", async () => {
    const c = new Improj({ token: TOKEN, fetch: mockFetch(() => json(201, {})) });
    await expect(c.files.sendUpload("upl_../../me", new Uint8Array(1))).rejects.toThrow("upload id");
    await expect(c.files.sendUpload({ ...UPLOAD, id: "x" } as never, new Uint8Array(1))).rejects.toThrow("upload id");
  });

  it("retries the PUT on 503 but not after a network error (single-use ids)", async () => {
    const ok = mockFetch(() => problem(503, "SERVER_BUSY", { "Retry-After": "0" }), () => json(201, { data: FILE }));
    await expect(new Improj({ token: TOKEN, fetch: ok }).files.sendUpload(UPLOAD.id, new Uint8Array(3))).resolves.toEqual(FILE);
    expect(ok.calls).toHaveLength(2);

    const lost = mockFetch(networkFailure, () => json(201, { data: FILE }));
    await expect(new Improj({ token: TOKEN, fetch: lost }).files.sendUpload(UPLOAD.id, new Uint8Array(3))).rejects.toBeInstanceOf(ImprojConnectionError);
    expect(lost.calls).toHaveLength(1);
  });

  it("works in proxy mode: the PUT goes to the proxy", async () => {
    const f = mockFetch(() => json(201, { data: UPLOAD }), () => json(201, { data: FILE }));
    const c = new Improj({ baseUrl: "https://app.example.com/api/improj", fetch: f });
    await c.files.upload(1, { name: "a", data: new Uint8Array(3) });
    expect(f.calls[1]!.url.href).toBe(`https://app.example.com/api/improj/uploads/${UPLOAD.id}`);
    expect(f.calls[1]!.headers.has("Authorization")).toBe(false);
  });
});
