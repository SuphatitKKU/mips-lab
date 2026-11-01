// The friend's src/data directory was omitted by the original data/ ignore rule.
// Reconstructed teaching bank; original main-branch exercises retain attribution.
import { BASIC_PROBLEMS } from "./basicProblems";
export type Level = "ง่าย" | "กลาง" | "ยาก";
export interface MipsTest {
  args: (number | number[])[];
  expect: Record<string, number>;
  expectArr?: number[];
  hidden?: boolean;
}
export interface Z80Test {
  note: string;
  outs: number[];
  minGap?: number;
  hidden?: boolean;
}
export interface Answer {
  code: { lang: "c" | "mips" | "z80"; lines: string[] }[];
}
export interface Problem {
  id: number;
  title: string;
  sub: string;
  level: Level;
  topic: string;
  kind: "c" | "mips" | "z80";
  statement: string;
  fn: string;
  params: [string, string, string][];
  returns: [string, string][];
  starter: string;
  tests: (MipsTest | Z80Test)[];
  answer: Answer;
  hints: string[];
  example: string;
  given?: string[];
  rules?: string;
  allowedRegs?: string[];
  mustUse?: [RegExp, string][];
  customPoints?: number;
  port?: number;
}
export type PublicProblem = Omit<Problem, "answer" | "mustUse"> & {
  mustUse: string[];
};
export const POINTS: Record<Level, number> = { ง่าย: 10, กลาง: 20, ยาก: 40 };
export const FIRST_TRY_BONUS = 5;
export function publicProblem(p: Problem): PublicProblem {
  const { answer: _answer, mustUse, ...rest } = p;
  return {
    ...rest,
    tests: p.tests.filter((t) => !t.hidden),
    mustUse: (mustUse ?? []).map(([, msg]) => msg),
  };
}
const make = (
  id: number,
  title: string,
  fn: string,
  source: string,
  tests: MipsTest[],
  kind: "mips" | "c" = "c",
): Problem => ({
  id,
  title,
  fn,
  sub:
    kind === "c"
      ? "เขียน C แล้วตรวจด้วย MIPS CPU"
      : "เขียน MIPS และคืนค่าทาง $v0",
  level: "กลาง",
  topic: "ฟังก์ชันและลูป",
  kind,
  statement: title + " ตามข้อมูลรับเข้าและผลลัพธ์ที่กำหนด",
  params: Array.from({ length: tests[0].args.length }, (_, i) => [
    "a" + i,
    i === 0 ? "n" : "m",
    "ค่ารับเข้า",
  ]),
  returns: [["v0", "ผลลัพธ์"]],
  starter:
    kind === "c"
      ? `int ${fn}(int n) { return 0; }`
      : `${fn}:\n li $v0, 0\n jr $ra`,
  tests,
  answer: { code: [{ lang: kind, lines: source.split("\n") }] },
  hints: ["ตรวจกรณีขอบและคืนค่าตาม calling convention"],
  example: "",
});
const sum = make(
  1,
  "ผลรวม 1 ถึง n",
  "sum",
  "sum:\n li $v0, 0\nloop: beq $a0, $zero, done\n addu $v0, $v0, $a0\n addi $a0, $a0, -1\n j loop\ndone: jr $ra",
  [1, 5, 10, 0].map((n) => ({ args: [n], expect: { v0: (n * (n + 1)) / 2 } })),
  "mips",
);
const max = make(
  2,
  "ค่าสูงสุดในอาร์เรย์",
  "max",
  "max:\n lw   $v0, 0($a0)\n addi $t0, $zero, 1\nloop: beq $t0, $a1, done\n sll $t1, $t0, 2\n addu $t1, $a0, $t1\n lw $t2, 0($t1)\n slt $t3, $v0, $t2\n beq $t3, $zero, skip\n move $v0, $t2\nskip: addi $t0, $t0, 1\n j loop\ndone: jr $ra",
  [[1, 2, 3], [9], [0, 2], [-9, -2, -4], [5, 1], [0], [2, 9, 2], [7, 7]].map(
    (a) => ({ args: [a, a.length], expect: { v0: Math.max(...a) } }),
  ),
  "mips",
);
max.params = [
  ["a0", "arr", "อาร์เรย์จำนวนเต็ม"],
  ["a1", "n", "จำนวนสมาชิก มากกว่า 0"],
];
max.allowedRegs = ["$v0", "$t0", "$t1", "$t2", "$t3"];
max.answer.code.unshift({
  lang: "c",
  lines: [
    "int max(int *a, int n) { int m = a[0]; for (int i = 1; i < n; i++) if (a[i] > m) m = a[i]; return m; }",
  ],
});
const fact = make(
  3,
  "แฟกทอเรียลด้วย recursion",
  "fact",
  "int fact(int n) { if(n <= 1) return 1; return n * fact(n-1); }",
  [0, 1, 4, 7].map((n) => ({
    args: [n],
    expect: { v0: [1, 1, 2, 6, 24, 120, 720, 5040][n] },
    hidden: n === 7,
  })),
);
const arrSum = make(
  4,
  "รวมสมาชิกอาร์เรย์",
  "sumArray",
  "int sumArray(int *a, int n) { int s=0; for(int i=0;i<n;i++) s+=a[i]; return s; }",
  [[1, 2, 3], [-3, 5], []].map((a) => ({
    args: [a, a.length],
    expect: { v0: a.reduce((s, v) => s + v, 0) },
  })),
);
arrSum.params = [
  ["a0", "arr", "อาร์เรย์"],
  ["a1", "n", "จำนวนสมาชิก"],
];
arrSum.starter = "int sumArray(int *a, int n) { return 0; }";
const gcd = make(
  5,
  "หา ห.ร.ม.",
  "gcd",
  "int gcd(int n,int m) { while(m) { int t=n%m; n=m; m=t; } return n; }",
  [
    { args: [24, 18], expect: { v0: 6 } },
    { args: [17, 5], expect: { v0: 1 }, hidden: true },
  ],
);
gcd.starter = "int gcd(int n,int m) { return 0; }";
const bits = make(
  6,
  "นับบิตที่เป็น 1",
  "bits",
  "int bits(unsigned int n) { int s=0; while(n) { s += n & 1; n >>= 1; } return s; }",
  [0, 7, 255].map((n, i) => ({
    args: [n],
    expect: { v0: i === 0 ? 0 : i === 1 ? 3 : 8 },
    hidden: i === 2,
  })),
);
const z80: Problem = {
  id: 7,
  title: "ไฟวิ่ง Z80",
  sub: "หมุนบิตแล้วส่งออกพอร์ต 01h",
  kind: "z80",
  level: "กลาง",
  topic: "Z80",
  statement:
    "ส่ง 01h, 02h, 04h, 08h ตามลำดับไปยังพอร์ต 01h และหน่วงระหว่างค่าอย่างน้อย 1000 T-states ในเคสสุดท้าย",
  fn: "START",
  params: [],
  returns: [],
  port: 1,
  starter: "START: HALT",
  tests: [
    { note: "เริ่มด้วย 01h", outs: [1] },
    { note: "ลำดับไฟ", outs: [1, 2, 4, 8] },
    { note: "ตรวจหน่วงเวลา", outs: [1, 2, 4, 8], minGap: 1000, hidden: true },
  ],
  answer: {
    code: [
      {
        lang: "z80",
        lines: [
          "START: LD A, 1",
          "L: OUT (01h), A",
          "LD B, 255",
          "D: DJNZ D",
          "RLCA",
          "JR L",
        ],
      },
    ],
  },
  hints: ["ใช้ RLCA เพื่อหมุนบิต และ DJNZ เพื่อหน่วงเวลา"],
  example: "",
};
const extra = [
  make(
    8,
    "ค่าสัมบูรณ์ด้วย C",
    "absValue",
    "int absValue(int n) { return n < 0 ? -n : n; }",
    [
      { args: [-7], expect: { v0: 7 } },
      { args: [4], expect: { v0: 4 } },
    ],
  ),
  make(9, "ยกกำลังสองด้วย C", "square", "int square(int n) { return n*n; }", [
    { args: [-5], expect: { v0: 25 } },
    { args: [3], expect: { v0: 9 } },
  ]),
  make(
    10,
    "ลำดับ Fibonacci",
    "fib",
    "int fib(int n) { int a=0,b=1; for(int i=0;i<n;i++) { int t=a+b; a=b; b=t; } return a; }",
    [
      { args: [5], expect: { v0: 5 } },
      { args: [10], expect: { v0: 55 }, hidden: true },
    ],
  ),
  make(
    11,
    "จำกัดค่า 0 ถึง 10 ด้วย C",
    "clamp",
    "int clamp(int n) { if(n<0)return 0; if(n>10)return 10; return n; }",
    [
      { args: [-3], expect: { v0: 0 } },
      { args: [20], expect: { v0: 10 } },
      { args: [7], expect: { v0: 7 } },
    ],
  ),
  make(
    12,
    "ตรวจเลขคู่",
    "isEven",
    "int isEven(int n) { return (n & 1) == 0; }",
    [
      { args: [4], expect: { v0: 1 } },
      { args: [-3], expect: { v0: 0 } },
    ],
  ),
  make(13, "2 ยกกำลัง n ด้วย C", "pow2", "int pow2(int n) { return 1 << n; }", [
    { args: [3], expect: { v0: 8 } },
    { args: [10], expect: { v0: 1024 } },
  ]),
];
export const PROBLEMS: Problem[] = [
  sum,
  max,
  fact,
  arrSum,
  gcd,
  bits,
  z80,
  ...extra,
  ...BASIC_PROBLEMS,
];
export const TOPICS = ["ทั้งหมด", ...new Set(PROBLEMS.map((p) => p.topic))];
export const problemById = (id: number) => PROBLEMS.find((p) => p.id === id);
