import { describe, it, expect } from "vitest";
import { studentYear, periodStart, validateProblem } from "./domain";
import { PROBLEMS, publicProblem } from "../src/data/problems";
import { hashPassword, checkPassword } from "./password";
describe("classroom rules", () => {
  it("derives cohort year and permits explicit instructor override", () => {
    expect(studentYear("663040123-4", 2569)).toBe(4);
    expect(studentYear("6930401234", 2569)).toBe(1);
    expect(studentYear("admin", 2569)).toBeNull();
    expect(studentYear("703040123-4", 2569)).toBeNull();
    expect(studentYear("663040123-4", 2569, 3)).toBe(3);
  });
  it("uses Monday midnight Bangkok for weekly scores", () => {
    expect(
      new Date(
        periodStart("week", Date.parse("2026-11-01T20:00:00Z")),
      ).toISOString(),
    ).toBe("2026-11-01T17:00:00.000Z");
  });
  it("does not disclose hidden inputs or answer keys", () => {
    const p = publicProblem(PROBLEMS[2]);
    expect(p.tests.every((t) => !t.hidden)).toBe(true);
    expect(p).not.toHaveProperty("answer");
  });
  it("requires the reference answer to pass hidden cases", () => {
    const p = structuredClone(PROBLEMS[2]);
    expect(validateProblem(p).fn).toBe("fact");
    if ("expect" in p.tests[3]) p.tests[3].expect.v0 = -1;
    expect(() => validateProblem(p)).toThrow("เฉลยต้องผ่าน");
  });
  it("rejects malformed and unbounded grading inputs", () => {
    const p = structuredClone(PROBLEMS[2]);
    p.tests = [];
    expect(() => validateProblem(p)).toThrow();
    p.tests = Array(17).fill({ args: [1], expect: { v0: 1 } });
    expect(() => validateProblem(p)).toThrow();
  });
  it("uses salted password hashes rather than plaintext", async () => {
    const a = await hashPassword("test-password-123"),
      b = await hashPassword("test-password-123");
    expect(a).not.toBe(b);
    expect(await checkPassword("test-password-123", a)).toBe(true);
    expect(await checkPassword("wrong-password", a)).toBe(false);
  });
});
