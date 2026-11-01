// Multicycle MIPS (Patterson & Hennessy): an instruction takes 3–5 clock cycles,
// one state of the control FSM each. Rebuilds those cycles — every control signal
// and the value on each part of the datapath — from a step the single-cycle CPU
// took, so both datapath views follow the same program.

import { hex, type StepInfo } from './cpu';
import { fields, opOf, RN } from './isa';

export const CTRL = [
  'PCWriteCond',
  'PCWrite',
  'IorD',
  'MemRead',
  'MemWrite',
  'MemtoReg',
  'IRWrite',
  'PCSource',
  'ALUOp',
  'ALUSrcB',
  'ALUSrcA',
  'RegWrite',
  'RegDst',
] as const;
export type CtrlKey = (typeof CTRL)[number];
export type Ctrl = Record<CtrlKey, number>;
/** control signals two bits wide; the rest are one bit */
export const WIDE = new Set<CtrlKey>(['PCSource', 'ALUOp', 'ALUSrcB']);

export type StageName = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';
export interface FsmState {
  stage: StageName;
  name: string;
  /** not in the textbook FSM: added so every instruction the simulator runs has a path */
  extra?: true;
}

const ctrl = (on: Partial<Ctrl>): Ctrl => Object.fromEntries(CTRL.map((k) => [k, on[k] ?? 0])) as Ctrl;

export const STATES: Record<number, FsmState & { ctrl: Ctrl }> = {
  0: { stage: 'IF', name: 'Instruction fetch', ctrl: ctrl({ MemRead: 1, IRWrite: 1, ALUSrcB: 1, PCWrite: 1 }) },
  1: { stage: 'ID', name: 'Instruction decode / register fetch', ctrl: ctrl({ ALUSrcB: 3 }) },
  2: { stage: 'EX', name: 'Memory address computation', ctrl: ctrl({ ALUSrcA: 1, ALUSrcB: 2 }) },
  3: { stage: 'MEM', name: 'Memory access (read)', ctrl: ctrl({ MemRead: 1, IorD: 1 }) },
  // this datapath has no memory data register, so memory keeps being read while its value is written back
  4: { stage: 'WB', name: 'Memory read completion', ctrl: ctrl({ MemRead: 1, IorD: 1, MemtoReg: 1, RegWrite: 1 }) },
  5: { stage: 'MEM', name: 'Memory access (write)', ctrl: ctrl({ MemWrite: 1, IorD: 1 }) },
  6: { stage: 'EX', name: 'Execution', ctrl: ctrl({ ALUSrcA: 1, ALUOp: 2 }) },
  7: { stage: 'WB', name: 'R-type completion', ctrl: ctrl({ RegDst: 1, RegWrite: 1 }) },
  8: { stage: 'EX', name: 'Branch completion', ctrl: ctrl({ ALUSrcA: 1, ALUOp: 1, PCWriteCond: 1, PCSource: 1 }) },
  9: { stage: 'EX', name: 'Jump completion', ctrl: ctrl({ PCWrite: 1, PCSource: 2 }) },
  10: { stage: 'EX', name: 'Execution (I-type)', extra: true, ctrl: ctrl({ ALUSrcA: 1, ALUSrcB: 2, ALUOp: 3 }) },
  11: { stage: 'WB', name: 'I-type completion', extra: true, ctrl: ctrl({ RegWrite: 1 }) },
  12: { stage: 'EX', name: 'Jump register', extra: true, ctrl: ctrl({ ALUSrcA: 1, PCWrite: 1 }) },
};

/** FSM transitions, with the opcode class that takes each one */
export const EDGES: [from: number, to: number, when?: string][] = [
  [0, 1],
  [1, 2, 'lw / sw'],
  [1, 6, 'R-type'],
  [1, 10, 'I-type'],
  [1, 8, 'beq'],
  [1, 9, 'j'],
  [1, 12, 'jr'],
  [2, 3, 'lw'],
  [2, 5, 'sw'],
  [3, 4],
  [6, 7],
  [10, 11],
];

/** What the ALU does: Ainvert, Bnegate and the 2-bit Operation of the textbook 1-bit ALU. */
export interface AluFn {
  name: string;
  ainv: number;
  bneg: number;
  op: number;
  /** false: done by hardware the textbook ALU doesn't have (shifter, xor, multiplier…) */
  basic: boolean;
}
const fn = (name: string, ainv: number, bneg: number, op: number): AluFn => ({ name, ainv, bneg, op, basic: true });
export const ALU_FN = {
  and: fn('and', 0, 0, 0),
  or: fn('or', 0, 0, 1),
  add: fn('add', 0, 0, 2),
  sub: fn('sub', 0, 1, 2),
  slt: fn('slt', 0, 1, 3),
  nor: fn('nor', 1, 1, 0),
};

/** The ALU control unit: ALUOp from the FSM plus the funct field (or, for the I-type extension, the opcode). */
export function aluControl(aluOp: number, word: number): AluFn {
  if (aluOp === 0) return ALU_FN.add;
  if (aluOp === 1) return ALU_FN.sub;
  const f = fields(word);
  const { add, sub, and, or, nor, slt } = ALU_FN;
  const known: Record<number, AluFn> =
    aluOp === 2 ? { 32: add, 33: add, 34: sub, 35: sub, 36: and, 37: or, 39: nor, 42: slt } : { 8: add, 9: add, 10: slt, 12: and, 13: or };
  return known[aluOp === 2 ? f.funct : f.op] ?? { name: opOf(word)?.name ?? '?', ainv: 0, bneg: 0, op: 0, basic: false };
}

export function aluCalc(f: AluFn, a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined || !f.basic) return undefined;
  switch (f.name) {
    case 'add':
      return (a + b) | 0;
    case 'sub':
      return (a - b) | 0;
    case 'and':
      return a & b;
    case 'or':
      return a | b;
    case 'nor':
      return ~(a | b);
    default:
      return +(a < b);
  }
}

/** Every wire inside one 1-bit ALU of the ripple-carry chain. */
export interface AluBit {
  a: number;
  b: number;
  /** a and b after the Ainvert / Bnegate muxes */
  ai: number;
  bi: number;
  cin: number;
  sum: number;
  cout: number;
  and: number;
  or: number;
  less: number;
  res: number;
}

/** The 32 chained 1-bit ALUs; `set` is the sign of a − b (overflow-corrected) fed back to bit 0's Less. */
export function aluBits(f: AluFn, a: number, b: number): { bits: AluBit[]; set: number; ovf: number } {
  const bits: AluBit[] = [];
  let c = f.bneg;
  for (let i = 0; i < 32; i++) {
    const ab = (a >>> i) & 1;
    const bb = (b >>> i) & 1;
    const ai = ab ^ f.ainv;
    const bi = bb ^ f.bneg;
    const sum = ai ^ bi ^ c;
    const cout = (ai & bi) | (c & (ai ^ bi));
    bits.push({ a: ab, b: bb, ai, bi, cin: c, sum, cout, and: ai & bi, or: ai | bi, less: 0, res: 0 });
    c = cout;
  }
  const ovf = bits[31].cin ^ bits[31].cout;
  const set = bits[31].sum ^ ovf;
  bits[0].less = set;
  for (const x of bits) x.res = [x.and, x.or, x.sum, x.less][f.op];
  return { bits, set, ovf };
}

/** One clock cycle. Register outputs that still hold the previous instruction's value are undefined. */
export interface Cycle {
  state: number;
  ctrl: Ctrl;
  fn: AluFn;
  pc: number;
  ir?: number;
  aluOut?: number;
  memAddr?: number;
  memData?: number;
  rd1?: number;
  rd2?: number;
  /** register number on Write register */
  wr?: number;
  wd?: number;
  ext?: number;
  extSh?: number;
  jump?: number;
  a?: number;
  b?: number;
  alu?: number;
  zero?: number;
  /** what PCWriteCond is ANDed with: Zero for beq, the branch's own condition for the others */
  cond?: number;
  pcNext?: number;
  pcEn: number;
  /** registers / memory written at the clock edge that ends the cycle */
  writes: [what: string, v: number][];
  note?: string;
}

/** FSM states an instruction passes through. */
export function statesFor(s: StepInfo): number[] {
  switch (s.kind) {
    case 'alu':
    case 'shift':
      return [0, 1, 6, 7];
    case 'imm':
      return [0, 1, 10, 11];
    case 'load':
      return [0, 1, 2, 3, 4];
    case 'store':
      return [0, 1, 2, 5];
    case 'branch':
      return [0, 1, 8];
    case 'jump':
      return [0, 1, 9];
    case 'jr':
      return [0, 1, 12];
    case 'muldiv':
      return s.name === 'mfhi' || s.name === 'mflo' ? [0, 1, 6, 7] : [0, 1, 6];
    case 'sys':
      return [0, 1];
  }
}

const regKey = (k: string) => (k === 'hi' || k === 'lo' ? k.toUpperCase() : '$' + k);

export function cyclesOf(s: StepInfo): Cycle[] {
  const w = s.ins.word | 0;
  const f = fields(w);
  const states = statesFor(s);
  let aluOut: number | undefined;
  return states.map((state, n) => {
    const c = STATES[state].ctrl;
    // ALUOut has no write enable: it holds whatever the ALU produced last cycle
    const held = aluOut;
    const last = n === states.length - 1;
    const pc = n === 0 ? s.pcOld : s.pcOld + 4;
    const decoded = n > 0;
    const ir = decoded ? w : undefined;
    const rd1 = decoded ? s.bus.a : undefined;
    const rd2 = decoded ? s.bus.b : undefined;
    const ext = decoded ? s.bus.ext : undefined;
    const extSh = ext === undefined ? undefined : (ext << 2) | 0;
    const jump = decoded ? ((pc & 0xf0000000) | (f.target << 2)) >>> 0 : undefined;
    const memAddr = c.IorD ? held : pc;
    const memData = c.MemRead ? (n === 0 ? w : s.memRead?.v) : undefined;
    const a = c.ALUSrcA ? rd1 : pc;
    const b = [rd2, 4, ext, extSh][c.ALUSrcB];
    // in IF the IR still holds the previous instruction, but ALUOp 00 means add whatever the funct field says
    const alufn = aluControl(c.ALUOp, w);
    let alu = aluCalc(alufn, a, b);
    // shifts, xor, lui, mfhi… come out of extra hardware: take the CPU's result
    if (!alufn.basic) alu = s.bus.alu ?? (s.name === 'mfhi' || s.name === 'mflo' ? s.bus.wb?.v : undefined);
    const zero = alu === undefined ? undefined : alu === 0 ? 1 : 0;
    const cond = s.kind === 'branch' ? +s.jump : zero;
    const wr = decoded ? (c.RegDst ? f.rd : f.rt) : undefined;
    const wd = c.MemtoReg ? memData : held;
    const pcNext = [alu, held, jump][c.PCSource];
    const pcEn = c.PCWrite || (c.PCWriteCond && cond) ? 1 : 0;

    const writes: [string, number][] = [];
    if (c.IRWrite) writes.push(['IR', w]);
    if (pcEn && pcNext !== undefined) writes.push(['PC', pcNext >>> 0]);
    if (c.RegWrite && wr && wd !== undefined) writes.push(['$' + RN[wr], wd]);
    if (c.MemWrite) for (const m of s.mem) writes.push([`M[0x${hex(m.addr)}]`, m.n]);
    if ((state === 1 || state === 2 || state === 6 || state === 10) && alu !== undefined) writes.push(['ALUOut', alu]);
    // what the instruction changes beyond this datapath (jal's $ra, HI / LO, sc's flag)
    if (last) for (const ch of s.changes) if (!writes.some(([k]) => k === regKey(ch.k))) writes.push([regKey(ch.k), ch.n]);

    let note: string | undefined;
    if (state === 4) note = 'datapath นี้ไม่มี MDR (Memory data register) จึงต้องอ่าน memory ค้างไว้อีก cycle เพื่อส่งค่าไปเขียนลง register';
    else if (state === 6 && s.kind === 'muldiv') note = 'คูณ / หาร / HI / LO ทำในหน่วยแยกจาก ALU ซึ่งไม่ได้วาดไว้ในรูปนี้';
    else if (!alufn.basic && (state === 6 || state === 10)) note = `${alufn.name} ใช้วงจรเพิ่มเติม (เช่น ตัวเลื่อนบิต) นอกจาก ALU แบบในหนังสือ`;
    else if (state === 8 && s.name !== 'beq') note = `${s.name} ใช้เงื่อนไขของตัวเองแทนสัญญาณ Zero ในการตัดสินว่าจะกระโดดหรือไม่`;
    else if (state === 9 && s.name === 'jal') note = 'jal ต้องเขียน $ra = PC + 4 ด้วย — รูปนี้ไม่มีสายนั้น (ต้องเพิ่มอินพุตให้ mux RegDst และ MemtoReg)';
    else if (state === 12 && s.name === 'jalr') note = 'jalr ต้องเขียนที่อยู่กลับลง register ด้วย — รูปนี้ไม่มีสายนั้น';
    else if (STATES[state].extra) note = 'state นี้เพิ่มเข้ามาให้ทำคำสั่งนี้ได้ — FSM ในหนังสือมีแค่ state 0–9';
    else if (last && s.kind === 'sys') note = 'syscall ถอดคำสั่งแล้วส่งต่อให้ระบบปฏิบัติการ';
    if (s.ins.word === 0 && state === 6) note = 'nop คือ sll $zero, $zero, 0 — ผ่านทุกขั้นแต่ไม่มีอะไรเปลี่ยน';

    aluOut = alu;
    return {
      state,
      ctrl: c,
      fn: alufn,
      pc,
      ir,
      aluOut: held,
      memAddr,
      memData,
      rd1,
      rd2,
      wr,
      wd,
      ext,
      extSh,
      jump,
      a,
      b,
      alu,
      zero,
      cond,
      pcNext,
      pcEn,
      writes,
      note,
    };
  });
}
