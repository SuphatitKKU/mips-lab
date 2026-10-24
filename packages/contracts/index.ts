export const REG_NAMES = [
  '$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
  '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
  '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
  '$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra',
] as const;
export type Reg = (typeof REG_NAMES)[number] | 'hi' | 'lo';
export interface TestCase {
  input: Partial<Record<Reg, number>>;
  expected: Partial<Record<Reg, number>>;
}
export interface JudgeResult {
  passed: number;
  total: number;
  failures: { case: number; reg: Reg; expected: number; got: number }[];
  error?: { code: 'AdEL' | 'AdES' | 'Ov' | 'Syntax' | 'Timeout'; message: string; line?: number };
}
export type JudgeFn = (asmSource: string, tests: TestCase[]) => JudgeResult;
export interface Problem {
  id: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  tests: TestCase[];
  solution: { c: string; asm: string };
}
