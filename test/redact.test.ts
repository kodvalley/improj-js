import { describe, expect, it } from "vitest";
import { maskToken, redact } from "../src/redact.js";
import { ImprojError, ImprojServerError } from "../src/errors.js";

const fakePat = () => ["improj", "pat", "Zz9".repeat(16) + "X"].join("_");
const fakeOrg = () => ["improj", "org", "Qq1".repeat(16) + "Y"].join("_");

describe("redact", () => {
  it("masks tokens, secrets and bearer credentials", () => {
    const text = `a ${fakePat()} b ${fakeOrg()} c whsec_abc-DEF_123 d imp_${"a1".repeat(20)} e Authorization: Bearer xyz.123`;
    const out = redact(text);
    expect(out).toBe("a improj_pat_*** b improj_org_*** c whsec_*** d imp_*** e Authorization: Bearer ***");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("Task 12 was updated")).toBe("Task 12 was updated");
  });

  it("masks a token for display", () => {
    expect(maskToken(undefined)).toBe("(none)");
    expect(maskToken(fakePat())).toBe("improj_pat_***Zz9X".replace("Zz9X", fakePat().slice(-4)));
    expect(maskToken("short")).toBe("***");
  });
});

describe("ImprojError", () => {
  it("redacts its message and carries no cause when none is given", () => {
    const e = new ImprojServerError({ status: 500, code: "X", message: `failed with ${fakePat()}` });
    expect(e.message).toBe("failed with improj_pat_***");
    expect(e.name).toBe("ImprojServerError");
    expect(e.cause).toBeUndefined();
    expect(e.errors).toEqual([]);
    expect(new ImprojError({ status: 0, code: "Y", message: "m", path: `/x?t=${fakePat()}` }).path).toBe("/x?t=improj_pat_***");
  });
});
