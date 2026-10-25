// Runs the built CommonJS package on the current Node.js version (18+).
const { test } = require("node:test");
const sdk = require("@kodvalley/improj");
const hooks = require("@kodvalley/improj/webhooks/node");
const { scenario } = require("./scenario.cjs");

test("CJS build: client, pagination, uploads, errors, webhooks", async () => {
  await scenario(sdk, hooks);
});
