// Runs a submission against a problem's tests. Used by the server for both
// "ทดสอบ" (public tests only) and "ส่งคำตอบ" (all tests).

import type { MipsTest, Problem, Z80Test } from '../data/problems';
import { compileC } from './cc/compile';
import { assemble, type Program } from './mips/assembler';
import { Cpu, layoutArrays } from './mips/cpu';
import { opOf, fields, RN } from './mips/isa';
import { assembleZ80, boardMemory, hex2, Z80 } from './z80/z80';

export interface TestResult {
  ok: boolean;
  hidden: boolean;
  input: string;
  expected: string;
  got: string;
  msg?: string;
}

export interface GradeResult {
  errors: { line: number; msg: string }[];
  results: TestResult[];
  passed: number;
  total: number;
}

const ARR_BASE = 0x10040000;
const STEP_LIMIT = 500_000;

const fmtArg = (v: number | number[]) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

export function inputText(p: Problem, t: MipsTest) {
  return t.args.map((v, i) => `${p.params[i]?.[1] ?? 'a' + i} = ${fmtArg(v)}`).join(', ') || '(ไม่มี)';
}

/** Registers an instruction writes, for the allowed-register rule. */
function dests(prog: Program): Map<string, number> {
  const out = new Map<string, number>();
  for (const ins of prog.text) {
    const def = opOf(ins.word);
    if (!def) continue;
    const f = fields(ins.word);
    let d: number | null = null;
    if (def.syntax.startsWith('d')) d = f.rd;
    else if (def.syntax.startsWith('t,')) d = def.name.startsWith('s') && def.syntax === 't,o(s)' ? null : f.rt;
    else if (def.name === 'jal') d = 31;
    if (d != null && d !== 0 && d !== 1) out.set('$' + RN[d], ins.line);
  }
  return out;
}

export function grade(p: Problem, code: string, all: boolean): GradeResult {
  const tests = p.tests.filter((t) => all || !t.hidden);
  if (p.kind === 'z80') return gradeZ80(p, code, tests as Z80Test[]);

  let asmSrc = code;
  if (p.kind === 'c') {
    const c = compileC(code);
    if (!c.ok) return { errors: c.errors, results: [], passed: 0, total: tests.length };
    if (!c.funcs.some((f) => f.name === p.fn)) return fail(`ไม่พบฟังก์ชัน ${p.fn}`, tests.length);
    asmSrc = c.asm;
  }
  const a = assemble(asmSrc);
  if (!a.ok) return { errors: a.errors, results: [], passed: 0, total: tests.length };
  const prog = a.prog;
  if (!prog.labels.has(p.fn)) return fail(`ไม่พบ label "${p.fn}:" — ฟังก์ชันต้องเริ่มที่ label นี้`, tests.length);

  if (p.kind === 'mips') {
    const errors: { line: number; msg: string }[] = [];
    if (p.allowedRegs) {
      for (const [r, line] of dests(prog)) if (!p.allowedRegs.includes(r)) errors.push({ line, msg: `ข้อนี้ห้ามเขียนค่าลง ${r}` });
    }
    const stripped = code.replace(/#.*$/gm, '');
    for (const [re, msg] of p.mustUse ?? []) if (!re.test(stripped)) errors.push({ line: 1, msg });
    if (errors.length) return { errors, results: [], passed: 0, total: tests.length };
  }

  const results = (tests as MipsTest[]).map((t) => runMips(p, prog, t));
  return { errors: [], results, passed: results.filter((r) => r.ok).length, total: results.length };
}

function fail(msg: string, total: number): GradeResult {
  return { errors: [{ line: 1, msg }], results: [], passed: 0, total };
}

function runMips(p: Problem, prog: Program, t: MipsTest): TestResult {
  const arrays = t.args.filter(Array.isArray) as number[][];
  const { mem, addrs } = layoutArrays(arrays, ARR_BASE);
  const regs: Record<string, number> = {};
  let k = 0;
  t.args.forEach((v, i) => (regs['a' + i] = Array.isArray(v) ? addrs[k++] : v));
  const cpu = new Cpu(prog, { regs, mem, history: false, entry: p.fn });
  const s0 = Array.from(cpu.r.slice(16, 24));
  const sp0 = cpu.r[29];
  const halt = cpu.run(STEP_LIMIT);

  const expectedParts = Object.entries(t.expect).map(([r, v]) => `$${r} = ${v}`);
  if (t.expectArr) expectedParts.push(`${p.params[0][1]} = [${t.expectArr.join(', ')}]`);
  const base = { hidden: !!t.hidden, input: inputText(p, t), expected: expectedParts.join(', ') };

  if (halt?.kind !== 'return') return { ...base, ok: false, got: '—', msg: halt?.msg ?? 'โปรแกรมไม่จบ' };

  const gotParts = Object.keys(t.expect).map((r) => `$${r} = ${cpu.r[RN.indexOf(r as never)]}`);
  let ok = Object.entries(t.expect).every(([r, v]) => cpu.r[RN.indexOf(r as never)] === v);
  if (t.expectArr) {
    const arr = t.expectArr.map((_, i) => cpu.readWord(addrs[0] + 4 * i));
    gotParts.push(`${p.params[0][1]} = [${arr.join(', ')}]`);
    ok &&= arr.every((v, i) => v === t.expectArr![i]);
  }
  let msg: string | undefined;
  if (cpu.r[29] !== sp0) {
    ok = false;
    msg = `$sp ไม่กลับเป็นค่าเดิม (ต่างไป ${cpu.r[29] - sp0} byte) — จองแล้วต้องคืน stack`;
  } else {
    const bad = s0.findIndex((v, i) => cpu.r[16 + i] !== v);
    if (bad >= 0) {
      ok = false;
      msg = `$s${bad} ถูกเปลี่ยนค่าแต่ไม่ได้คืนค่าเดิม — ต้องบันทึกลง stack ก่อนใช้`;
    }
  }
  return { ...base, ok, got: gotParts.join(', '), msg };
}

function gradeZ80(p: Problem, code: string, tests: Z80Test[]): GradeResult {
  const a = assembleZ80(code);
  if (!a.ok) return { errors: a.errors, results: [], passed: 0, total: tests.length };
  const results = tests.map((t): TestResult => {
    const outs: { v: number; at: number }[] = [];
    const cpu = new Z80(a.prog, { ...boardMemory(a.prog), out: (port, v, at) => port === p.port && outs.push({ v, at }) });
    const need = t.outs.length;
    for (let k = 0; k < 400 && outs.length < need && !cpu.halted; k++) cpu.runFor(50_000);
    const got = outs.slice(0, need).map((o) => o.v);
    const base = {
      hidden: !!t.hidden,
      input: t.note,
      expected: t.outs.map(hex2).join(' '),
      got: got.length ? got.map(hex2).join(' ') : 'ไม่มีการ OUT',
    };
    if (cpu.error) return { ...base, ok: false, msg: cpu.error };
    let ok = got.length === need && got.every((v, i) => v === t.outs[i]);
    let msg: string | undefined;
    if (!ok && cpu.halted && got.length < need) msg = 'โปรแกรมหยุด (HALT) ก่อนส่งค่าครบ';
    if (ok && t.minGap) {
      const gaps = outs.slice(1, need).map((o, i) => o.at - outs[i].at);
      const min = Math.min(...gaps);
      if (min < t.minGap) {
        ok = false;
        msg = `หน่วงเวลาแค่ ${min} T-states ต้องอย่างน้อย ${t.minGap}`;
      }
    }
    return { ...base, ok, msg };
  });
  return { errors: [], results, passed: results.filter((r) => r.ok).length, total: results.length };
}

// ---------- running once with the student's own input ----------

export interface CustomRun {
  errors: { line: number; msg: string }[];
  /** what the code produced: register / array / port, and its value */
  outputs: [label: string, value: string][];
  /** text printed through syscall */
  printed: string;
  ok: boolean;
  /** why it stopped, or a warning about the calling convention */
  msg?: string;
  /** "123 คำสั่ง" or "4,560 T-states" */
  cost: string;
}

type Runnable = Pick<Problem, 'kind' | 'fn' | 'params' | 'returns' | 'port'>;

const OUT_LIMIT = 16;
const fmtWord = (v: number) => (v < -0xffff || v > 0xffff ? `${v} (0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')})` : String(v));

/** Runs the code once on `args`, with no expected values: for trying things out, not grading. */
export function runOnce(p: Runnable, code: string, args: (number | number[])[]): CustomRun {
  const none = { outputs: [], printed: '', ok: false, cost: '' };
  if (p.kind === 'z80') {
    const a = assembleZ80(code);
    if (!a.ok) return { ...none, errors: a.errors };
    const outs: number[] = [];
    const cpu = new Z80(a.prog, { ...boardMemory(a.prog), out: (port, v) => port === p.port && outs.push(v) });
    for (let k = 0; k < 400 && outs.length < OUT_LIMIT && !cpu.halted; k++) cpu.runFor(50_000);
    return {
      errors: [],
      outputs: outs.length
        ? outs.map((v, i): [string, string] => [`OUT ครั้งที่ ${i + 1}`, `${hex2(v)} · ${v.toString(2).padStart(8, '0')}b`])
        : [[`พอร์ต ${hex2(p.port ?? 0)}`, 'ไม่มีการ OUT']],
      printed: '',
      ok: !cpu.error,
      msg: cpu.error ?? (cpu.halted ? 'หยุดที่ HALT' : outs.length >= OUT_LIMIT ? `แสดง ${OUT_LIMIT} ค่าแรก` : undefined),
      cost: `${cpu.cycles.toLocaleString()} T-states`,
    };
  }

  let asmSrc = code;
  if (p.kind === 'c') {
    const c = compileC(code);
    if (!c.ok) return { ...none, errors: c.errors };
    if (!c.funcs.some((f) => f.name === p.fn)) return { ...none, errors: [{ line: 1, msg: `ไม่พบฟังก์ชัน ${p.fn}` }] };
    asmSrc = c.asm;
  }
  const a = assemble(asmSrc);
  if (!a.ok) return { ...none, errors: a.errors };
  if (!a.prog.labels.has(p.fn)) return { ...none, errors: [{ line: 1, msg: `ไม่พบ label "${p.fn}:" — ฟังก์ชันต้องเริ่มที่ label นี้` }] };

  const arrays = args.filter(Array.isArray) as number[][];
  const { mem, addrs } = layoutArrays(arrays, ARR_BASE);
  const regs: Record<string, number> = {};
  let k = 0;
  args.forEach((v, i) => (regs['a' + i] = Array.isArray(v) ? addrs[k++] : v));
  const cpu = new Cpu(a.prog, { regs, mem, history: false, entry: p.fn });
  const s0 = Array.from(cpu.r.slice(16, 24));
  const sp0 = cpu.r[29];
  const halt = cpu.run(STEP_LIMIT);

  const outputs: [string, string][] = p.returns.map(([r]) => [r, fmtWord(cpu.r[RN.indexOf(r.slice(1) as never)])]);
  // arrays the function was handed, as they are after the call
  k = 0;
  args.forEach((v, i) => {
    if (!Array.isArray(v)) return;
    const at = addrs[k++];
    outputs.push([p.params[i]?.[1] ?? `a${i}`, `[${v.map((_, j) => cpu.readWord(at + 4 * j)).join(', ')}]`]);
  });
  const ended = halt?.kind === 'return' || halt?.kind === 'exit';
  let msg = ended ? undefined : (halt?.msg ?? 'โปรแกรมไม่จบ');
  if (ended && cpu.r[29] !== sp0) msg = `$sp ไม่กลับเป็นค่าเดิม (ต่างไป ${cpu.r[29] - sp0} byte) — ตอนส่งจะไม่ผ่าน`;
  else if (ended) {
    const bad = s0.findIndex((v, i) => cpu.r[16 + i] !== v);
    if (bad >= 0) msg = `$s${bad} ถูกเปลี่ยนแต่ไม่ได้คืนค่าเดิม — ตอนส่งจะไม่ผ่าน`;
  }
  return { errors: [], outputs, printed: cpu.out, ok: ended, msg, cost: `${cpu.steps.toLocaleString()} คำสั่ง` };
}
