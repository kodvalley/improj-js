import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as nodeHooks from "../src/webhooks/node.js";
import * as webHooks from "../src/webhooks/web.js";
import { ImprojSignatureVerificationError } from "../src/errors.js";
import { bytesToHex, hexToBytes, parseSignatureHeader } from "../src/webhooks/shared.js";
import { SECRET } from "./helpers.js";

const NOW = 1_793_000_000;
const BODY = JSON.stringify({
  id: "evt_12",
  type: "task.updated",
  api_version: "2026-10-24",
  created_at: "2026-10-24T09:30:00.000Z",
  delivery_id: 34,
  data: { object: "task", id: 56, project_id: 7 },
  actor_user_id: 8,
});

/** The server's algorithm, written independently: HMAC-SHA256(secret, "<t>.<body>") as hex. */
function serverHeader(secret: string, body: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

type Variant = {
  name: string;
  verify: (p: nodeHooks.RawBody, h: string | null | undefined, s: string, o?: nodeHooks.VerifyOptions) => boolean | Promise<boolean>;
  construct: (p: nodeHooks.RawBody, h: string | null | undefined, s: string, o?: nodeHooks.VerifyOptions) => unknown;
  header: (s: string, p: nodeHooks.RawBody, t?: number) => string | Promise<string>;
};

const variants: Variant[] = [
  { name: "node", verify: nodeHooks.verifySignature, construct: nodeHooks.constructEvent, header: nodeHooks.signatureHeader },
  { name: "web", verify: webHooks.verifySignature, construct: webHooks.constructEvent, header: webHooks.signatureHeader },
];

describe.each(variants)("webhook verification ($name)", (v) => {
  const opts = { now: NOW };

  it("accepts a delivery signed like the server signs it", async () => {
    const header = serverHeader(SECRET, BODY, NOW - 10);
    expect(await v.verify(BODY, header, SECRET, opts)).toBe(true);
    expect(await v.verify(Buffer.from(BODY), header, SECRET, opts)).toBe(true);
    expect(await v.verify(new TextEncoder().encode(BODY).buffer as ArrayBuffer, header, SECRET, opts)).toBe(true);
    await expect(Promise.resolve(v.construct(BODY, header, SECRET, opts))).resolves.toMatchObject({ id: "evt_12", type: "task.updated", data: { id: 56 } });
  });

  it("produces the same header as the server", async () => {
    expect(await v.header(SECRET, BODY, NOW)).toBe(serverHeader(SECRET, BODY, NOW));
  });

  it("refuses a wrong secret, a changed body and a re-serialised body", async () => {
    const header = serverHeader(SECRET, BODY, NOW);
    expect(await v.verify(BODY, header, "whsec_TEST_ONLY_other_secret", opts)).toBe(false);
    expect(await v.verify(BODY.replace("56", "57"), header, SECRET, opts)).toBe(false);
    expect(await v.verify(JSON.stringify(JSON.parse(BODY), null, 2), header, SECRET, opts)).toBe(false);
  });

  it("refuses timestamps outside the 300 second window, both ways", async () => {
    expect(await v.verify(BODY, serverHeader(SECRET, BODY, NOW - 301), SECRET, opts)).toBe(false);
    expect(await v.verify(BODY, serverHeader(SECRET, BODY, NOW + 301), SECRET, opts)).toBe(false);
    expect(await v.verify(BODY, serverHeader(SECRET, BODY, NOW - 300), SECRET, opts)).toBe(true);
    expect(await v.verify(BODY, serverHeader(SECRET, BODY, NOW - 900), SECRET, { now: NOW, toleranceSeconds: 1000 })).toBe(true);
  });

  it("uses the system clock by default", async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await v.verify(BODY, serverHeader(SECRET, BODY, t), SECRET)).toBe(true);
    expect(await v.verify(BODY, await v.header(SECRET, BODY), SECRET)).toBe(true);
  });

  it("accepts any of several v1 signatures (secret rotation)", async () => {
    const good = serverHeader(SECRET, BODY, NOW).split(",")[1];
    const bad = serverHeader("whsec_TEST_ONLY_old_secret", BODY, NOW).split(",")[1];
    expect(await v.verify(BODY, `t=${NOW},${bad},${good}`, SECRET, opts)).toBe(true);
    expect(await v.verify(BODY, `t=${NOW},v0=abc,${good},x`, SECRET, opts)).toBe(true);
  });

  it.each([
    [undefined, "missing_header"],
    [null, "missing_header"],
    ["", "missing_header"],
    ["v1=" + "a".repeat(64), "malformed_header"],
    [`t=${NOW}`, "malformed_header"],
    [`t=${NOW},v1=xyz`, "malformed_header"],
    [`t=abc,v1=${"a".repeat(64)}`, "malformed_header"],
    ["t=1," + "v1=".padEnd(5000, "a"), "malformed_header"],
  ])("reports %s as %s", async (header, reason) => {
    expect(await v.verify(BODY, header, SECRET, opts)).toBe(false);
    const err = await Promise.resolve()
      .then(() => v.construct(BODY, header, SECRET, opts))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImprojSignatureVerificationError);
    expect((err as ImprojSignatureVerificationError).reason).toBe(reason);
  });

  it("explains the raw-body mistake", async () => {
    const header = serverHeader(SECRET, BODY, NOW);
    await expect(Promise.resolve().then(() => v.verify(JSON.parse(BODY) as never, header, SECRET, opts))).rejects.toThrow("raw request body");
  });

  it("refuses a missing secret and a bad tolerance", async () => {
    const header = serverHeader(SECRET, BODY, NOW);
    await expect(Promise.resolve().then(() => v.verify(BODY, header, "", opts))).rejects.toThrow("signing secret");
    await expect(Promise.resolve().then(() => v.verify(BODY, header, SECRET, { now: NOW, toleranceSeconds: 0 }))).rejects.toThrow("toleranceSeconds");
  });

  it("refuses a verified body that is not an event", async () => {
    for (const body of ["not json", JSON.stringify({ hello: 1 })]) {
      const err = await Promise.resolve()
        .then(() => v.construct(body, serverHeader(SECRET, body, NOW), SECRET, opts))
        .catch((e: unknown) => e);
      expect((err as ImprojSignatureVerificationError).reason).toBe("invalid_payload");
    }
  });
});

describe("helpers", () => {
  it("hex round trip", () => {
    expect(bytesToHex(hexToBytes("00ff10ab"))).toBe("00ff10ab");
  });

  it("parses and lower-cases signatures", () => {
    expect(parseSignatureHeader(` t=5 , v1=${"AB".repeat(32)} `)).toEqual({ timestamp: 5, signatures: ["ab".repeat(32)] });
  });

  it("keeps at most 10 signatures", () => {
    const many = Array.from({ length: 20 }, () => `v1=${"a".repeat(64)}`).join(",");
    expect(parseSignatureHeader(`t=1,${many}`).signatures).toHaveLength(10);
  });

  it("the web variant explains a missing Web Crypto", async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      await expect(webHooks.computeSignature(SECRET, NOW, BODY)).rejects.toThrow("webhooks/node");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("node computeSignature equals the server's digest", () => {
    expect(nodeHooks.computeSignature(SECRET, NOW, BODY)).toBe(createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex"));
  });

  it("exposes the header names", () => {
    expect(nodeHooks.WEBHOOK_HEADERS.signature).toBe("IMPROJ-Signature");
    expect(webHooks.DEFAULT_TOLERANCE_SECONDS).toBe(300);
  });
});
