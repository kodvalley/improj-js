// Runs the built ES module package on the current Node.js version (18+).
import { test } from "node:test";
import { createRequire } from "node:module";
import * as sdk from "@kodvalley/improj";
import * as hooks from "@kodvalley/improj/webhooks/node";

const { scenario } = createRequire(import.meta.url)("./scenario.cjs");

test("ESM build: client, pagination, uploads, errors, webhooks", async () => {
  await scenario(sdk, hooks);
});

test("ESM build: the Web Crypto webhook entry loads", async () => {
  const web = await import("@kodvalley/improj/webhooks");
  if (typeof web.verifySignature !== "function") throw new Error("missing verifySignature");
});
