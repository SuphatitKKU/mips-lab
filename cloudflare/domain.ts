import type { Problem } from "../src/data/problems";
import { POINTS } from "../src/data/problems";
import { grade } from "../src/lib/grader";
export const DAY = 86400000;
export const academicYearNow = () => {
  const d = new Date(Date.now() + 7 * 3600000);
  return d.getUTCFullYear() + 543 - (d.getUTCMonth() < 5 ? 1 : 0);
};
export function studentYear(
  id: string,
  academicYear: number,
  override: number | null = null,
) {
  if (override != null) return override;
  const m = /^(\d{2})\d{7,10}(?:-\d)?$/.exec(id);
  if (!m) return null;
  const year = academicYear - (2500 + Number(m[1])) + 1;
  return year >= 1 && year <= 20 ? year : null;
}
export function periodStart(period: string, time = Date.now()) {
  if (period === "all") return 0;
  const d = new Date(time + 7 * 3600000);
  d.setUTCHours(0, 0, 0, 0);
  if (period === "month") d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime() - 7 * 3600000;
}
export const pointsFor = (p: Problem) => p.customPoints ?? POINTS[p.level];
const word = (n: unknown): n is number =>
  Number.isInteger(n) && Number(n) >= -2147483648 && Number(n) <= 2147483647;
export function validateProblem(input: unknown): Problem {
  if (!input || typeof input !== "object")
    throw new Error("ข้อมูลโจทย์ไม่ถูกต้อง");
  const p = input as Problem;
  if (!["mips", "c", "z80"].includes(p.kind))
    throw new Error("เลือกภาษา C, MIPS หรือ Z80");
  for (const [key, max] of [
    ["title", 160],
    ["statement", 16000],
    ["starter", 16000],
    ["fn", 64],
  ] as const)
    if (typeof p[key] !== "string" || !p[key].trim() || p[key].length > max)
      throw new Error(`กรอก ${key} ให้ครบและไม่เกิน ${max} ตัวอักษร`);
  if (!/^[A-Za-z_]\w*$/.test(p.fn))
    throw new Error("ชื่อฟังก์ชันหรือ label ไม่ถูกต้อง");
  if (!["ง่าย", "กลาง", "ยาก"].includes(p.level))
    throw new Error("ระดับความยากไม่ถูกต้อง");
  if (
    p.customPoints !== undefined &&
    (!Number.isInteger(p.customPoints) ||
      p.customPoints < 1 ||
      p.customPoints > 1000)
  )
    throw new Error("คะแนนต้องเป็นจำนวนเต็ม 1–1000");
  if (
    !Array.isArray(p.params) ||
    p.params.length > 4 ||
    !p.params.every(
      (x, i) =>
        Array.isArray(x) &&
        x.length === 3 &&
        x.every((v) => typeof v === "string" && v.length <= 200) &&
        x[0] === "a" + i,
    )
  )
    throw new Error("พารามิเตอร์ต้องเรียง a0 ถึง a3 ไม่เกิน 4 ตัว");
  if (
    !Array.isArray(p.returns) ||
    p.returns.length > 4 ||
    !p.returns.every(
      (x) =>
        Array.isArray(x) &&
        x.length === 2 &&
        ["v0", "v1"].includes(x[0]) &&
        typeof x[1] === "string",
    )
  )
    throw new Error("กำหนดผลลัพธ์ผ่าน v0 หรือ v1");
  if (
    !Array.isArray(p.tests) ||
    !p.tests.length ||
    p.tests.length > 16 ||
    !p.tests.every((t) => t && typeof t === "object") ||
    !p.tests.some((t) => !t.hidden)
  )
    throw new Error("ต้องมี 1–16 เคส และอย่างน้อย 1 เคสที่แสดงให้นักศึกษา");
  for (const t of p.tests) {
    if (typeof t.hidden !== "undefined" && typeof t.hidden !== "boolean")
      throw new Error("ค่า hidden ต้องเป็น boolean");
    if (p.kind === "z80") {
      if (
        !("outs" in t) ||
        !Array.isArray(t.outs) ||
        !t.outs.length ||
        t.outs.length > 16 ||
        !t.outs.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ||
        typeof t.note !== "string" ||
        (t.minGap !== undefined &&
          (!Number.isInteger(t.minGap) || t.minGap < 0 || t.minGap > 1000000))
      )
        throw new Error("เคส Z80 ไม่ถูกต้อง");
    } else {
      if (
        !("args" in t) ||
        !Array.isArray(t.args) ||
        t.args.length !== p.params.length ||
        !t.args.every(
          (a) =>
            word(a) || (Array.isArray(a) && a.length <= 64 && a.every(word)),
        ) ||
        !t.expect ||
        typeof t.expect !== "object" ||
        !Object.keys(t.expect).length ||
        !Object.entries(t.expect).every(
          ([k, v]) => ["v0", "v1"].includes(k) && word(v),
        ) ||
        (t.expectArr !== undefined &&
          (!Array.isArray(t.args[0]) ||
            !Array.isArray(t.expectArr) ||
            t.expectArr.length !== t.args[0].length ||
            !t.expectArr.every(word)))
      )
        throw new Error(
          "เคส MIPS/C ไม่ถูกต้อง: args, expect และ expectArr ต้องตรงรูปแบบ",
        );
    }
  }
  if (
    p.kind === "z80" &&
    (!Number.isInteger(p.port) || p.port! < 0 || p.port! > 255)
  )
    throw new Error("พอร์ต Z80 ต้องอยู่ระหว่าง 0–255");
  const answer = Array.isArray(p.answer?.code)
    ? p.answer.code.find((c) => c && c.lang === p.kind)
    : undefined;
  if (
    !answer ||
    !Array.isArray(answer.lines) ||
    !answer.lines.every((l) => typeof l === "string") ||
    answer.lines.join("\n").length > 16000
  )
    throw new Error("กรอกเฉลยในภาษาของโจทย์");
  if (
    p.allowedRegs &&
    (!Array.isArray(p.allowedRegs) ||
      !p.allowedRegs.every((r) =>
        /^\$(v[01]|a[0-3]|t[0-9]|s[0-7]|sp|ra|zero)$/.test(r),
      ))
  )
    throw new Error("allowedRegs ไม่ถูกต้อง");
  const clean: Problem = {
    id: 0,
    title: p.title.trim(),
    sub: typeof p.sub === "string" ? p.sub.slice(0, 200) : "",
    statement: p.statement,
    starter: p.starter,
    kind: p.kind,
    level: p.level,
    fn: p.fn,
    params: p.params,
    returns: p.returns,
    tests: p.tests,
    answer: { code: [answer] },
    hints: Array.isArray(p.hints)
      ? p.hints.filter((h) => typeof h === "string").slice(0, 8)
      : [],
    example: typeof p.example === "string" ? p.example.slice(0, 1000) : "",
    topic: typeof p.topic === "string" ? p.topic.slice(0, 80) : "โจทย์อาจารย์",
    customPoints: p.customPoints,
    port: p.port,
    allowedRegs: p.allowedRegs,
  };
  const result = grade(clean, answer.lines.join("\n"), true);
  if (result.errors.length || result.passed !== result.total)
    throw new Error(
      "เฉลยต้องผ่านทุกเคสก่อนบันทึก: " +
        (result.errors[0]?.msg ??
          result.results.find((r) => !r.ok)?.msg ??
          `${result.passed}/${result.total}`),
    );
  return clean;
}
