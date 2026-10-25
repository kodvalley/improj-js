// The same scenario for the ESM and the CommonJS build.
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { start, TOKEN } = require("./server.cjs");

async function scenario(sdk, hooks) {
  const api = await start();
  try {
    const improj = new sdk.Improj({ token: TOKEN, baseUrl: api.baseUrl, maxRetries: 0 });

    assert.deepEqual(await improj.me.get(), { id: 1, name: "Smoke" });
    const ids = [];
    for await (const p of improj.projects.list()) ids.push(p.id);
    assert.deepEqual(ids, [1, 2]);

    const task = await improj.tasks.create(1, { title: "From smoke test" });
    assert.equal(task.title, "From smoke test");
    const post = api.seen.find((r) => r.method === "POST" && r.url.endsWith("/tasks"));
    assert.match(post.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
    assert.equal(post.headers["improj-api-version"], "2026-10-24");
    assert.match(post.headers["user-agent"], /^improj-js\//);
    assert.equal(post.headers.cookie, undefined);

    const file = await improj.files.upload(1, { name: "hello.txt", data: Buffer.from("hello"), mimeType: "text/plain" });
    assert.equal(file.id, 50);
    const put = api.seen.find((r) => r.method === "PUT");
    assert.equal(put.url, "/api/v1/uploads/upl_SMOKEsmokeSMOKEsmoke1234");
    assert.equal(put.headers["content-type"], "application/octet-stream");

    await assert.rejects(improj.tasks.get(1, 404), (e) => e instanceof sdk.ImprojNotFoundError && e.code === "NOT_FOUND" && e.requestId === "req_smoke");
    const bad = new sdk.Improj({ token: "improj_pat_WRONG_smoke_token", baseUrl: api.baseUrl, maxRetries: 0 });
    await assert.rejects(bad.me.get(), (e) => e instanceof sdk.ImprojAuthenticationError && !e.message.includes("WRONG"));

    const secret = "whsec_SMOKE_TEST_not_a_real_secret";
    const body = JSON.stringify({ id: "evt_1", type: "task.created", api_version: "2026-10-24", created_at: "2026-10-24T00:00:00Z", delivery_id: 1, data: { object: "task", id: 9, project_id: 1 }, actor_user_id: 1 });
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    assert.equal(hooks.verifySignature(Buffer.from(body), header, secret), true);
    assert.equal(hooks.constructEvent(body, header, secret).data.id, 9);
    assert.equal(hooks.verifySignature(body + " ", header, secret), false);
  } finally {
    await api.close();
  }
}

module.exports = { scenario };
