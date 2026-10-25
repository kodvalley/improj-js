// A tiny fake IMPROJ API on 127.0.0.1 for the smoke tests (no dependencies).
const http = require("node:http");

const TOKEN = "improj_pat_SMOKE_TEST_not_a_real_token";

function start() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, obj, type = "application/json", extra = {}) => {
        res.writeHead(status, { "Content-Type": type, "X-Request-Id": "req_smoke", ...extra });
        res.end(obj === undefined ? undefined : JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return send(401, { type: "t", title: "Unauthorized", status: 401, detail: "bad token", instance: req.url, code: "API_TOKEN_INVALID", request_id: "req_smoke" }, "application/problem+json");
      }
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/api/v1/me") return send(200, { data: { id: 1, name: "Smoke" } });
      if (url.pathname === "/api/v1/projects") {
        const cursor = url.searchParams.get("cursor");
        return send(200, cursor ? { data: [{ id: 2 }], next_cursor: null } : { data: [{ id: 1 }], next_cursor: "page2" });
      }
      if (url.pathname === "/api/v1/projects/1/tasks" && req.method === "POST") return send(201, { data: { id: 9, title: JSON.parse(body).title } });
      if (url.pathname === "/api/v1/projects/1/uploads") {
        return send(201, { data: { id: "upl_SMOKEsmokeSMOKEsmoke1234", upload_url: "https://elsewhere.invalid/x", method: "PUT", max_bytes: 5, expires_at: "2030-01-01T00:00:00Z" } });
      }
      if (url.pathname === "/api/v1/uploads/upl_SMOKEsmokeSMOKEsmoke1234" && req.method === "PUT") {
        if (req.headers["content-length"] !== "5" || body.length !== 5) return send(400, { code: "API_UPLOAD_SIZE_MISMATCH", status: 400, detail: "size" }, "application/problem+json");
        return send(201, { data: { id: 50, name: "hello.txt" } });
      }
      if (url.pathname === "/api/v1/projects/1/tasks/404") return send(404, { type: "t", title: "Not Found", status: 404, detail: "The item could not be found.", instance: req.url, code: "NOT_FOUND", request_id: "req_smoke" }, "application/problem+json");
      return send(404, { code: "NOT_FOUND", status: 404, detail: "no route" }, "application/problem+json");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}/api/v1`, seen, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start, TOKEN };
