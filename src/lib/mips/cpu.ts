// Single-cycle MIPS CPU that executes assembled machine words, explains every
// step in Thai, and can undo steps. Mutable by design: the UI keeps one in a ref
// and the grader runs it with history off.

import type { AsmInstr, Program } from './assembler';
import { GP_INIT, RA_EXIT, RN, SP_INIT, TEXT_BASE, fields, opOf, type RegName } from './isa';

export interface RegChange {
  k: RegName | 'hi' | 'lo';
  o: number;
  n: number;
}
export interface MemChange {
  addr: number;
  size: number;
  o: number;
  n: number;
}
export type Stage = [key: 'IF' | 'ID' | 'EX' | 'MEM' | 'WB', text: string, active: boolean];
export type Kind = 'alu' | 'imm' | 'shift' | 'load' | 'store' | 'branch' | 'jump' | 'jr' | 'muldiv' | 'sys';

export interface StepInfo {
  /** index into prog.text */
  i: number;
  ins: AsmInstr;
  name: string;
  kind: Kind;
  desc: string;
  /** registers the instruction read, with their values before it ran */
  reads: { k: RegName; v: number }[];
  /** immediate / offset / shift amount, when the instruction has one */
  imm?: number;
  /** what a load fetched from memory */
  memRead?: { addr: number; size: number; v: number };
  changes: RegChange[];
  mem: MemChange[];
  pcOld: number;
  pcNew: number;
  jump: boolean;
  stages: Stage[];
  bus: Bus;
}

/** Values on the datapath's main wires while the instruction ran. */
export interface Bus {
  rs: RegName;
  rt: RegName;
  /** register read port 1 (rs) */
  a: number;
  /** register read port 2 (rt), or the 0 a one-operand branch compares with */
  b: number;
  /** immediate after sign / zero extension */
  ext: number;
  /** ALU output: the result, a memory address, or a branch's difference */
  alu?: number;
  /** register write-back */
  wb?: { k: RegName; v: number };
  /** branch / jump destination */
  target?: number;
  hi: number;
  lo: number;
}

export type Halt = null | { kind: 'return' | 'exit'; msg: string } | { kind: 'error'; msg: string };

interface Undo {
  pc: number;
  hi: number;
  lo: number;
  regs: [number, number][];
  mem: [number, number | undefined][];
  outLen: number;
  halt: Halt;
  last: StepInfo | null;
  link: number | null;
}

export interface CpuInit {
  regs?: Partial<Record<RegName, number>>;
  /** extra memory to preload: byte address → byte */
  mem?: Map<number, number>;
  history?: boolean;
  /** label to start at (defaults to `main`, else the first instruction) */
  entry?: string;
}

const sx = (v: number) => v | 0;
const R = (i: number) => '$' + RN[i];

export class Cpu {
  r = new Int32Array(32);
  pc = TEXT_BASE;
  hi = 0;
  lo = 0;
  mem = new Map<number, number>();
  halt: Halt = null;
  out = '';
  steps = 0;
  last: StepInfo | null = null;
  /** address reserved by the last `ll`; `sc` only stores while it still matches */
  link: number | null = null;
  readonly hist: Undo[] = [];
  private readonly keepHist: boolean;
  private undo: Undo | null = null;

  constructor(
    readonly prog: Program,
    init: CpuInit = {},
  ) {
    this.keepHist = init.history ?? true;
    for (const [a, b] of prog.data) this.mem.set(a, b);
    if (init.mem) for (const [a, b] of init.mem) this.mem.set(a, b);
    this.r[28] = GP_INIT;
    this.r[29] = SP_INIT;
    this.r[31] = RA_EXIT;
    if (init.regs) for (const [k, v] of Object.entries(init.regs)) this.r[RN.indexOf(k as RegName)] = v!;
    this.r[0] = 0;
    const start = prog.labels.get(init.entry ?? 'main') ?? prog.labels.get('__start');
    if (start != null && prog.text.some((t) => t.addr === start)) this.pc = start;
    if (!prog.text.length) this.halt = { kind: 'error', msg: 'โปรแกรมไม่มีคำสั่ง' };
  }

  get index() {
    return (this.pc - TEXT_BASE) >> 2;
  }
  get done() {
    return this.halt != null;
  }
  /** the step before `last` (needs history) */
  get prev(): StepInfo | null {
    return this.hist.at(-1)?.last ?? null;
  }

  // ---------- memory ----------
  readByte(a: number) {
    return this.mem.get(a >>> 0) ?? 0;
  }
  read(a: number, size: number): number {
    a >>>= 0;
    if (a % size) throw new RuntimeError(`อ่าน memory ที่ address 0x${hex(a)} ไม่ตรงขอบ ${size} byte`);
    let v = 0;
    for (let i = 0; i < size; i++) v = (v << 8) | this.readByte(a + i);
    return size === 4 ? v | 0 : v;
  }
  readWord(a: number) {
    return this.read(a, 4);
  }
  private write(a: number, v: number, size: number) {
    a >>>= 0;
    if (a % size) throw new RuntimeError(`เขียน memory ที่ address 0x${hex(a)} ไม่ตรงขอบ ${size} byte`);
    for (let i = 0; i < size; i++) {
      const addr = a + i;
      this.undo?.mem.push([addr, this.mem.get(addr)]);
      this.mem.set(addr, (v >>> (8 * (size - 1 - i))) & 0xff);
    }
  }
  private setReg(i: number, v: number) {
    if (i === 0) return;
    this.undo?.regs.push([i, this.r[i]]);
    this.r[i] = v;
  }

  // ---------- execution ----------

  /** Executes one instruction. Returns null if the program has already stopped. */
  step(): StepInfo | null {
    if (this.halt) return null;
    const idx = this.index;
    const ins = this.prog.text[idx];
    if (!ins || this.pc % 4) {
      this.halt = { kind: 'error', msg: `PC = 0x${hex(this.pc)} อยู่นอกโปรแกรม — ลืม jr $ra หรือกระโดดผิดที่?` };
      return null;
    }
    const u: Undo = {
      pc: this.pc,
      hi: this.hi,
      lo: this.lo,
      regs: [],
      mem: [],
      outLen: this.out.length,
      halt: null,
      last: this.last,
      link: this.link,
    };
    this.undo = u;
    const before = Int32Array.from(this.r);
    const hiO = this.hi;
    const loO = this.lo;
    let info: StepInfo;
    try {
      info = this.exec(idx, ins);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      this.restore(u);
      this.halt = { kind: 'error', msg: `บรรทัด ${ins.line}: ${e.message}` };
      this.undo = null;
      return null;
    }
    const changes: RegChange[] = [];
    for (let k = 1; k < 32; k++) if (this.r[k] !== before[k]) changes.push({ k: RN[k], o: before[k], n: this.r[k] });
    if (this.hi !== hiO) changes.push({ k: 'hi', o: hiO, n: this.hi });
    if (this.lo !== loO) changes.push({ k: 'lo', o: loO, n: this.lo });
    info.changes = changes;
    this.steps++;
    this.last = info;
    if (this.keepHist) this.hist.push(u);
    this.undo = null;
    return info;
  }

  back(): boolean {
    const u = this.hist.pop();
    if (!u) return false;
    this.restore(u);
    this.halt = u.halt;
    this.last = u.last;
    this.steps--;
    return true;
  }

  private restore(u: Undo) {
    for (let k = u.regs.length - 1; k >= 0; k--) this.r[u.regs[k][0]] = u.regs[k][1];
    for (let k = u.mem.length - 1; k >= 0; k--) {
      const [a, b] = u.mem[k];
      if (b === undefined) this.mem.delete(a);
      else this.mem.set(a, b);
    }
    this.pc = u.pc;
    this.hi = u.hi;
    this.lo = u.lo;
    this.link = u.link;
    this.out = this.out.slice(0, u.outLen);
  }

  /** Runs until the program stops or `limit` steps have been taken. */
  run(limit = 100_000): Halt {
    for (let k = 0; k < limit && !this.halt; k++) this.step();
    if (!this.halt) this.halt = { kind: 'error', msg: `รันเกิน ${limit.toLocaleString()} คำสั่งแล้วยังไม่จบ — อาจวนไม่รู้จบ` };
    return this.halt;
  }

  private exec(i: number, ins: AsmInstr): StepInfo {
    const def = opOf(ins.word);
    if (!def) throw new RuntimeError('ไม่รู้จักคำสั่งนี้');
    const f = fields(ins.word);
    const name = def.name;
    const r = this.r;
    const A = r[f.rs];
    const Bv = r[f.rt];
    const pcOld = this.pc;
    let npc = pcOld + 4;
    let kind: Kind = 'alu';
    let desc = '';
    let id = `อ่าน ${R(f.rs)} = ${A}, ${R(f.rt)} = ${Bv}`;
    let ex = '';
    let mem = 'ข้าม';
    let wb = 'ข้าม';
    let memOn = false;
    let wbOn = false;
    const memW: MemChange[] = [];
    let memR: StepInfo['memRead'];
    let alu: number | undefined;
    let wbv: Bus['wb'];
    let target: number | undefined;
    let busB = Bv;
    // source registers, by operand pattern (stores read rt as data; syscall reads $v0)
    const syn = def.syntax;
    const store = syn === 't,o(s)' && name.startsWith('s');
    const src: number[] =
      syn === 'd,s,t' || syn === 's,t' || syn === 's,t,L'
        ? [f.rs, f.rt]
        : syn === 'd,t,s'
          ? [f.rt, f.rs]
          : syn === 'd,t,h'
            ? [f.rt]
            : syn === 't,o(s)'
              ? store
                ? [f.rt, f.rs]
                : [f.rs]
              : syn === 's' || syn === 'd,s' || syn === 't,s,i' || syn === 's,L'
                ? [f.rs]
                : syn === ''
                  ? [2]
                  : [];
    const reads = [...new Set(src)].map((n) => ({ k: RN[n], v: r[n] }));
    const imm = syn.includes('i') || syn.includes('o') ? f.imm : syn === 'd,t,h' ? f.shamt : undefined;
    const writeback = (dst: number, v: number, what: string) => {
      this.setReg(dst, v);
      wbv = { k: RN[dst], v };
      wb = `เขียน ${v} ลง ${R(dst)}`;
      wbOn = dst !== 0;
      desc = `${what} แล้วเก็บผล **${v}** ลงใน \`${R(dst)}\``;
      if (dst === 0) desc += ' (แต่ `$zero` เป็น 0 เสมอ จึงไม่เปลี่ยน)';
    };
    const ovf = (a: number, b: number, v: number, op: string) => {
      if (!Number.isSafeInteger(v) || v > 2147483647 || v < -2147483648)
        throw new RuntimeError(`${op} ${a} กับ ${b} ล้น 32 บิต (overflow) — ถ้าไม่ต้องการตรวจ overflow ให้ใช้ ${name}u`);
    };

    switch (name) {
      case 'add':
      case 'addu': {
        const v = A + Bv;
        if (name === 'add') ovf(A, Bv, v, 'บวก');
        ex = `ALU คำนวณ ${A} + ${Bv}`;
        writeback(f.rd, sx(v), `บวก \`${R(f.rs)}\` (${A}) กับ \`${R(f.rt)}\` (${Bv})`);
        break;
      }
      case 'sub':
      case 'subu': {
        const v = A - Bv;
        if (name === 'sub') ovf(A, Bv, v, 'ลบ');
        ex = `ALU คำนวณ ${A} − ${Bv}`;
        writeback(f.rd, sx(v), `ลบ \`${R(f.rs)}\` (${A}) ด้วย \`${R(f.rt)}\` (${Bv})`);
        break;
      }
      case 'and':
      case 'or':
      case 'xor':
      case 'nor': {
        const v = name === 'and' ? A & Bv : name === 'or' ? A | Bv : name === 'xor' ? A ^ Bv : ~(A | Bv);
        ex = `ALU ทำ ${name.toUpperCase()} ทีละบิต`;
        writeback(f.rd, v, `นำ \`${R(f.rs)}\` (${A}) ${name.toUpperCase()} \`${R(f.rt)}\` (${Bv}) ทีละบิต`);
        break;
      }
      case 'slt':
      case 'sltu': {
        const v = name === 'slt' ? +(A < Bv) : +(A >>> 0 < Bv >>> 0);
        ex = `ALU เทียบ ${A} < ${Bv}${name === 'sltu' ? ' (ไม่คิดเครื่องหมาย)' : ''}`;
        writeback(f.rd, v, `เทียบ \`${R(f.rs)}\` (${A}) < \`${R(f.rt)}\` (${Bv}) ได้ ${v ? 'จริง' : 'เท็จ'}`);
        break;
      }
      case 'sll':
      case 'srl':
      case 'sra':
      case 'sllv':
      case 'srlv':
      case 'srav': {
        kind = 'shift';
        const sh = name.endsWith('v') ? A & 31 : f.shamt;
        const v = name.startsWith('sll') ? Bv << sh : name.startsWith('srl') ? Bv >>> sh : Bv >> sh;
        if (ins.word === 0) {
          desc = 'ไม่ทำอะไร (nop)';
          ex = 'ไม่ใช้ ALU';
          break;
        }
        id = `อ่าน ${R(f.rt)} = ${Bv}`;
        ex = `ตัวเลื่อนบิตเลื่อน${name.startsWith('sll') ? 'ซ้าย' : 'ขวา'} ${sh} บิต`;
        const extra = name.startsWith('sll') && sh < 31 ? ` (เท่ากับคูณ ${2 ** sh})` : '';
        writeback(f.rd, sx(v), `เลื่อนบิต \`${R(f.rt)}\` (${Bv}) ไป${name.startsWith('sll') ? 'ซ้าย' : 'ขวา'} ${sh} บิต${extra}`);
        break;
      }
      case 'addi':
      case 'addiu': {
        kind = 'imm';
        const v = A + f.imm;
        if (name === 'addi') ovf(A, f.imm, v, 'บวก');
        id = `อ่าน ${R(f.rs)} = ${A}, ค่าคงที่ ${f.imm}`;
        ex = `ALU คำนวณ ${A} + ${f.imm}`;
        writeback(f.rt, sx(v), `บวก \`${R(f.rs)}\` (${A}) กับ ${f.imm}`);
        break;
      }
      case 'slti':
      case 'sltiu': {
        kind = 'imm';
        const v = name === 'slti' ? +(A < f.imm) : +(A >>> 0 < f.imm >>> 0);
        id = `อ่าน ${R(f.rs)} = ${A}, ค่าคงที่ ${f.imm}`;
        ex = `ALU เทียบ ${A} < ${f.imm}`;
        writeback(f.rt, v, `เทียบ \`${R(f.rs)}\` (${A}) < ${f.imm} ได้ ${v ? 'จริง' : 'เท็จ'}`);
        break;
      }
      case 'andi':
      case 'ori':
      case 'xori': {
        kind = 'imm';
        const v = name === 'andi' ? A & f.uimm : name === 'ori' ? A | f.uimm : A ^ f.uimm;
        id = `อ่าน ${R(f.rs)} = ${A}, ค่าคงที่ ${f.uimm}`;
        ex = `ALU ทำ ${name.slice(0, -1).toUpperCase()} ทีละบิต`;
        writeback(f.rt, v, `นำ \`${R(f.rs)}\` (${A}) ${name.slice(0, -1).toUpperCase()} ${f.uimm} ทีละบิต`);
        break;
      }
      case 'lui': {
        kind = 'imm';
        const v = f.uimm << 16;
        id = `ค่าคงที่ 0x${f.uimm.toString(16).toUpperCase()}`;
        ex = 'เลื่อนค่าคงที่ไปไว้ 16 บิตบน';
        writeback(f.rt, v, `วาง 0x${f.uimm.toString(16).toUpperCase()} ไว้ที่ 16 บิตบน (0x${hex(v)})`);
        break;
      }
      case 'lw':
      case 'lh':
      case 'lhu':
      case 'lb':
      case 'lbu': {
        kind = 'load';
        const size = name === 'lw' ? 4 : name.startsWith('lh') ? 2 : 1;
        const a = (A + f.imm) >>> 0;
        alu = a;
        let v = this.read(a, size);
        if (size < 4 && !name.endsWith('u')) v = (v << (32 - 8 * size)) >> (32 - 8 * size);
        id = `อ่าน ${R(f.rs)} = ${A}, offset ${f.imm}`;
        ex = `ALU คำนวณ address ${A} + ${f.imm} = 0x${hex(a)}`;
        mem = `อ่าน ${size === 4 ? 'word' : size === 2 ? 'half' : 'byte'} ที่ 0x${hex(a)} ได้ ${v}`;
        memR = { addr: a, size, v };
        memOn = true;
        writeback(f.rt, v, `อ่าน memory ที่ address \`${R(f.rs)}\` + ${f.imm} = 0x${hex(a)} ได้ ${v}`);
        break;
      }
      case 'll': {
        kind = 'load';
        const a = (A + f.imm) >>> 0;
        alu = a;
        const v = this.read(a, 4);
        this.link = a;
        id = `อ่าน ${R(f.rs)} = ${A}, offset ${f.imm}`;
        ex = `ALU คำนวณ address ${A} + ${f.imm} = 0x${hex(a)}`;
        mem = `อ่าน word ที่ 0x${hex(a)} ได้ ${v} และจอง address นี้ไว้`;
        memR = { addr: a, size: 4, v };
        memOn = true;
        writeback(f.rt, v, `อ่าน memory ที่ 0x${hex(a)} ได้ ${v} แล้ว**จอง** address นี้ไว้ให้ \`sc\``);
        break;
      }
      case 'sc': {
        kind = 'store';
        const a = (A + f.imm) >>> 0;
        alu = a;
        const ok = this.link === a;
        this.link = null;
        id = `อ่าน ${R(f.rs)} = ${A}, ${R(f.rt)} = ${Bv}`;
        ex = `ALU คำนวณ address ${A} + ${f.imm} = 0x${hex(a)}`;
        if (ok) {
          const o = this.read(a, 4);
          this.write(a, Bv, 4);
          memW.push({ addr: a, size: 4, o, n: Bv });
          mem = `เขียน ${Bv} ลงที่ 0x${hex(a)} (ยังจองอยู่ → สำเร็จ)`;
          memOn = true;
        } else mem = `ไม่เขียน — 0x${hex(a)} ไม่ได้ถูกจองด้วย ll`;
        writeback(
          f.rt,
          ok ? 1 : 0,
          ok
            ? `address 0x${hex(a)} ยังถูกจองโดย \`ll\` จึงเขียน **${Bv}** ลงได้ และตั้ง \`${R(f.rt)}\` = 1 (สำเร็จ)`
            : `address 0x${hex(a)} ไม่ได้ถูกจองด้วย \`ll\` จึง**ไม่เขียน** และตั้ง \`${R(f.rt)}\` = 0 (ล้มเหลว)`,
        );
        break;
      }
      case 'sw':
      case 'sh':
      case 'sb': {
        kind = 'store';
        const size = name === 'sw' ? 4 : name === 'sh' ? 2 : 1;
        const a = (A + f.imm) >>> 0;
        alu = a;
        const o = this.read(a, size);
        const v = size === 4 ? Bv : Bv & (size === 2 ? 0xffff : 0xff);
        this.write(a, v, size);
        memW.push({ addr: a, size, o, n: v });
        id = `อ่าน ${R(f.rs)} = ${A}, ${R(f.rt)} = ${Bv}`;
        ex = `ALU คำนวณ address ${A} + ${f.imm} = 0x${hex(a)}`;
        mem = `เขียน ${v} ลงที่ 0x${hex(a)}`;
        memOn = true;
        desc = `เขียนค่า \`${R(f.rt)}\` (**${v}**) ลง memory ที่ address \`${R(f.rs)}\` + ${f.imm} = 0x${hex(a)}`;
        break;
      }
      case 'beq':
      case 'bne':
      case 'blez':
      case 'bgtz':
      case 'bltz':
      case 'bgez': {
        kind = 'branch';
        const two = name === 'beq' || name === 'bne';
        const cond: Record<string, [boolean, string]> = {
          beq: [A === Bv, '='],
          bne: [A !== Bv, '≠'],
          blez: [A <= 0, '≤'],
          bgtz: [A > 0, '>'],
          bltz: [A < 0, '<'],
          bgez: [A >= 0, '≥'],
        };
        const [taken, sym] = cond[name];
        const dest = (pcOld + 4 + f.imm * 4) >>> 0;
        if (taken) npc = dest;
        if (!two) busB = 0;
        alu = sx(A - busB);
        target = dest;
        const rhs = two ? `\`${R(f.rt)}\` (${Bv})` : '0';
        const lbl = labelAt(this.prog, dest);
        if (!two) id = `อ่าน ${R(f.rs)} = ${A}`;
        ex = `ALU เทียบ ${A} ${sym} ${two ? Bv : 0}`;
        desc = taken
          ? `\`${R(f.rs)}\` (${A}) ${sym} ${rhs} เป็นจริง จึง**กระโดดไป ${lbl}**`
          : `\`${R(f.rs)}\` (${A}) ${sym} ${rhs} เป็นเท็จ จึง**ไม่กระโดด** ทำคำสั่งถัดไป`;
        break;
      }
      case 'j':
      case 'jal': {
        kind = 'jump';
        const dest = ((pcOld + 4) & 0xf0000000) | (f.target << 2);
        npc = dest;
        target = dest;
        const lbl = labelAt(this.prog, dest);
        id = 'ถอด address ปลายทาง';
        ex = 'ไม่ใช้ ALU';
        if (name === 'jal') {
          this.setReg(31, pcOld + 4);
          wbv = { k: 'ra', v: pcOld + 4 };
          wb = `เขียน 0x${hex(pcOld + 4)} ลง $ra`;
          wbOn = true;
          desc = `เรียกฟังก์ชัน **${lbl}** — จำที่อยู่กลับ 0x${hex(pcOld + 4)} ไว้ใน \`$ra\` แล้วกระโดดไป`;
        } else desc = `กระโดดไปที่ **${lbl}**`;
        break;
      }
      case 'jr':
      case 'jalr': {
        kind = 'jr';
        npc = A >>> 0;
        target = npc;
        id = `อ่าน ${R(f.rs)} = 0x${hex(A)}`;
        ex = 'ไม่ใช้ ALU';
        if (name === 'jalr') {
          this.setReg(f.rd, pcOld + 4);
          wbv = { k: RN[f.rd], v: pcOld + 4 };
          wb = `เขียน 0x${hex(pcOld + 4)} ลง ${R(f.rd)}`;
          wbOn = true;
          desc = `เรียกฟังก์ชันที่ address ใน \`${R(f.rs)}\` และจำที่อยู่กลับไว้ใน \`${R(f.rd)}\``;
        } else if (npc === RA_EXIT) {
          desc = `กระโดดไปที่ \`${R(f.rs)}\` — กลับไปหาผู้เรียก ผลลัพธ์ \`$v0\` = **${r[2]}**`;
          this.halt = { kind: 'return', msg: `ฟังก์ชันคืนค่า $v0 = ${r[2]}` };
        } else desc = `กระโดดไปที่ address ใน \`${R(f.rs)}\` (0x${hex(npc)})${f.rs === 31 ? ' — กลับไปหาผู้เรียก' : ''}`;
        break;
      }
      case 'mult':
      case 'multu': {
        kind = 'muldiv';
        const p = name === 'mult' ? BigInt(A) * BigInt(Bv) : BigInt(A >>> 0) * BigInt(Bv >>> 0);
        const lo = Number(BigInt.asIntN(32, p));
        const hi = Number(BigInt.asIntN(32, p >> 32n));
        this.hi = hi;
        this.lo = lo;
        ex = `ตัวคูณคำนวณ ${A} × ${Bv} = ${p}`;
        wb = `เขียน HI = ${hi}, LO = ${lo}`;
        wbOn = true;
        desc = `คูณ \`${R(f.rs)}\` (${A}) × \`${R(f.rt)}\` (${Bv}) = **${p}** ผล 64 บิตแยกเก็บ: 32 บิตบนใน HI (${hi}) และ 32 บิตล่างใน LO (${lo})`;
        break;
      }
      case 'div':
      case 'divu': {
        kind = 'muldiv';
        if (Bv === 0) {
          ex = 'หารด้วย 0';
          desc = `หารด้วย \`${R(f.rt)}\` = 0 — ผลไม่กำหนด HI/LO จึงไม่เปลี่ยน`;
          break;
        }
        const a = name === 'div' ? A : A >>> 0;
        const b = name === 'div' ? Bv : Bv >>> 0;
        const q = Math.trunc(a / b) | 0;
        const m = (a % b) | 0;
        this.lo = q;
        this.hi = m;
        ex = `ตัวหารคำนวณ ${a} ÷ ${b}`;
        wb = `เขียน LO = ${q}, HI = ${m}`;
        wbOn = true;
        desc = `หาร \`${R(f.rs)}\` (${a}) ÷ \`${R(f.rt)}\` (${b}) ได้ผลหาร **${q}** ใน LO และเศษ **${m}** ใน HI`;
        break;
      }
      case 'mfhi':
      case 'mflo': {
        kind = 'muldiv';
        const v = name === 'mfhi' ? this.hi : this.lo;
        id = `อ่าน ${name === 'mfhi' ? 'HI' : 'LO'} = ${v}`;
        ex = 'ไม่ใช้ ALU';
        writeback(f.rd, v, `คัดลอกค่าจาก ${name === 'mfhi' ? 'HI' : 'LO'} (${v})`);
        break;
      }
      case 'mthi':
      case 'mtlo': {
        kind = 'muldiv';
        if (name === 'mthi') this.hi = A;
        else this.lo = A;
        id = `อ่าน ${R(f.rs)} = ${A}`;
        ex = 'ไม่ใช้ ALU';
        wb = `เขียน ${A} ลง ${name === 'mthi' ? 'HI' : 'LO'}`;
        wbOn = true;
        desc = `คัดลอก \`${R(f.rs)}\` (${A}) ไปไว้ใน ${name === 'mthi' ? 'HI' : 'LO'}`;
        break;
      }
      case 'syscall': {
        kind = 'sys';
        const code = r[2];
        id = `อ่าน $v0 = ${code}`;
        ex = 'ส่งต่อให้ระบบปฏิบัติการ';
        if (code === 1) {
          this.out += String(r[4]);
          desc = `พิมพ์จำนวนเต็ม \`$a0\` = **${r[4]}**`;
        } else if (code === 11) {
          this.out += String.fromCharCode(r[4] & 0xff);
          desc = `พิมพ์ตัวอักษร '${String.fromCharCode(r[4] & 0xff)}'`;
        } else if (code === 4) {
          let s = '';
          for (let a = r[4] >>> 0, k = 0; k < 10_000; a++, k++) {
            const c = this.readByte(a);
            if (!c) break;
            s += String.fromCharCode(c);
          }
          this.out += s;
          desc = `พิมพ์ข้อความที่ address 0x${hex(r[4])}: "${s}"`;
        } else if (code === 10 || code === 17) {
          this.halt = { kind: 'exit', msg: 'โปรแกรมจบด้วย syscall exit' };
          desc = 'จบโปรแกรม (exit)';
        } else throw new RuntimeError(`ไม่รองรับ syscall หมายเลข ${code}`);
        break;
      }
      case 'break':
        throw new RuntimeError('เจอคำสั่ง break');
      default:
        throw new RuntimeError(`ยังไม่รองรับคำสั่ง ${name}`);
    }

    if (ins.pseudo && ins.pseudo !== name) desc += ` · คำสั่งเทียม \`${ins.pseudo}\` แปลงเป็น \`${name}\``;
    this.pc = npc >>> 0;
    if (kind === 'alu' || kind === 'imm' || kind === 'shift') alu = wbv?.v;
    const bus: Bus = {
      rs: RN[f.rs],
      rt: RN[f.rt],
      a: A,
      b: busB,
      ext: name === 'andi' || name === 'ori' || name === 'xori' || name === 'lui' ? f.uimm : f.imm,
      alu,
      wb: wbv,
      target,
      hi: this.hi,
      lo: this.lo,
    };
    return {
      i,
      ins,
      name,
      kind,
      desc,
      reads,
      imm,
      memRead: memR,
      changes: [],
      mem: memW,
      pcOld,
      pcNew: this.pc,
      jump: this.pc !== pcOld + 4,
      stages: [
        ['IF', 'ดึงคำสั่งจากหน่วยความจำ', true],
        ['ID', id, true],
        ['EX', ex, ex !== 'ไม่ใช้ ALU'],
        ['MEM', mem, memOn],
        ['WB', wb, wbOn],
      ],
      bus,
    };
  }
}

export class RuntimeError extends Error {}

export const hex = (v: number) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

export function labelAt(prog: Program, addr: number): string {
  for (const [k, v] of prog.labels) if (v === addr) return k;
  return '0x' + hex(addr);
}

// ---------- array helpers used by problems and the simulator ----------

/** Lays out int arrays as words starting at `base`; returns the bytes and each array's address. */
export function layoutArrays(arrays: number[][], base: number) {
  const mem = new Map<number, number>();
  const addrs: number[] = [];
  let a = base;
  for (const arr of arrays) {
    addrs.push(a);
    for (const v of arr) {
      for (let i = 0; i < 4; i++) mem.set(a + i, (v >>> (8 * (3 - i))) & 0xff);
      a += 4;
    }
    a += 16; // gap so overruns show up as wrong values rather than the next array
  }
  return { mem, addrs };
}
