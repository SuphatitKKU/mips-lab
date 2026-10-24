import type { Reg } from '@lab/contracts';
import { REG_NAMES } from '@lab/contracts';
import { type Instruction, type Program } from './assembler';
import { ISA_PROFILE, REGISTER_INDEX } from './isa';

export type MipsErrorCode = 'AdEL' | 'AdES' | 'Ov' | 'Syntax' | 'Timeout';
export class MipsError extends Error {
  constructor(public code: MipsErrorCode, message: string, public line?: number) { super(message); this.name = 'MipsError'; }
}
export interface StepTrace {
  instruction: Instruction;
  pcBefore: number;
  pcAfter: number;
  changed: { reg: Reg; before: number; after: number }[];
  memory: { address: number; before: number; after: number }[];
  stages: { name: string; detail: string }[];
}
interface Snapshot { registers: Int32Array; hi: number; lo: number; pc: number; halted: boolean; reservation?: number; memory: Map<number, number>; steps: number }
const sign16 = (v: number) => (v << 16) >> 16;
const overflow = (n: number, line: number) => { if (n < -2147483648 || n > 2147483647) throw new MipsError('Ov', 'signed arithmetic overflow', line); return n | 0; };

export class Simulator {
  readonly registers = new Int32Array(32);
  readonly memory = new Map<number, number>();
  readonly instructions: Instruction[];
  pc: number = ISA_PROFILE.textBase;
  hi = 0;
  lo = 0;
  halted = false;
  steps = 0;
  private reservation?: number;
  private history: Snapshot[] = [];

  constructor(program: Program, input: Partial<Record<Reg, number>> = {}) {
    this.instructions = program.instructions;
    for (const item of program.data) this.memory.set(item.address, item.value);
    this.registers[28] = ISA_PROFILE.gp;
    this.registers[29] = ISA_PROFILE.sp;
    for (const [name, value] of Object.entries(input)) {
      if (name === 'hi') this.hi = value | 0;
      else if (name === 'lo') this.lo = value | 0;
      else if (REGISTER_INDEX[name] !== undefined && REGISTER_INDEX[name] !== 0) this.registers[REGISTER_INDEX[name]] = value | 0;
    }
  }
  get current() { return this.instructions[(this.pc - ISA_PROFILE.textBase) / 4]; }
  get canUndo() { return this.history.length > 0; }
  getRegister(reg: Reg): number { return reg === 'hi' ? this.hi : reg === 'lo' ? this.lo : this.registers[REGISTER_INDEX[reg]]; }
  private save(): Snapshot { return { registers: this.registers.slice(), hi: this.hi, lo: this.lo, pc: this.pc, halted: this.halted, reservation: this.reservation, memory: new Map(this.memory), steps: this.steps }; }
  back(): boolean {
    const prev = this.history.pop(); if (!prev) return false;
    this.registers.set(prev.registers); this.hi = prev.hi; this.lo = prev.lo; this.pc = prev.pc;
    this.halted = prev.halted; this.reservation = prev.reservation; this.steps = prev.steps;
    this.memory.clear(); for (const [a, b] of prev.memory) this.memory.set(a, b);
    return true;
  }
  private load(addr: number, bytes: 1 | 2 | 4, signed: boolean, line: number): number {
    if (addr % bytes) throw new MipsError('AdEL', `unaligned ${bytes}-byte load at 0x${(addr >>> 0).toString(16)}`, line);
    let n = 0;
    for (let i = 0; i < bytes; i++) n |= (this.memory.get((addr + i) >>> 0) ?? 0) << (8 * (ISA_PROFILE.endian === 'little' ? i : bytes - 1 - i));
    if (!signed) return bytes === 4 ? n | 0 : n >>> 0;
    return bytes === 1 ? (n << 24) >> 24 : bytes === 2 ? (n << 16) >> 16 : n | 0;
  }
  private store(addr: number, bytes: 1 | 2 | 4, value: number, line: number, changes: StepTrace['memory']) {
    if (addr % bytes) throw new MipsError('AdES', `unaligned ${bytes}-byte store at 0x${(addr >>> 0).toString(16)}`, line);
    for (let i = 0; i < bytes; i++) {
      const a = (addr + i) >>> 0;
      const before = this.memory.get(a) ?? 0;
      const after = (value >>> (8 * (ISA_PROFILE.endian === 'little' ? i : bytes - 1 - i))) & 255;
      this.memory.set(a, after); if (before !== after) changes.push({ address: a, before, after });
    }
    this.reservation = undefined;
  }
  step(): StepTrace | null {
    if (this.halted || !this.current) { this.halted = true; return null; }
    const inst = this.current, before = this.save(), w = inst.word;
    const op = w >>> 26, rs = (w >>> 21) & 31, rt = (w >>> 16) & 31, rd = (w >>> 11) & 31;
    const sh = (w >>> 6) & 31, fn = w & 63, imm = w & 0xffff;
    const r = this.registers, src = r[rs], target = r[rt];
    const mem: StepTrace['memory'] = [];
    let nextPc = (this.pc + 4) >>> 0;
    const put = (i: number, v: number) => { if (i !== 0) r[i] = v | 0; };
    try {
      if (op === 0) {
        switch (fn) {
          case 0x20: put(rd, overflow(src + target, inst.line)); break;
          case 0x21: put(rd, src + target); break;
          case 0x22: put(rd, overflow(src - target, inst.line)); break;
          case 0x23: put(rd, src - target); break;
          case 0x24: put(rd, src & target); break;
          case 0x25: put(rd, src | target); break;
          case 0x26: put(rd, src ^ target); break;
          case 0x27: put(rd, ~(src | target)); break;
          case 0x2a: put(rd, src < target ? 1 : 0); break;
          case 0x2b: put(rd, (src >>> 0) < (target >>> 0) ? 1 : 0); break;
          case 0x00: put(rd, target << sh); break;
          case 0x02: put(rd, target >>> sh); break;
          case 0x03: put(rd, target >> sh); break;
          case 0x04: put(rd, target << (src & 31)); break;
          case 0x06: put(rd, target >>> (src & 31)); break;
          case 0x07: put(rd, target >> (src & 31)); break;
          case 0x08: nextPc = src >>> 0; break;
          case 0x09: put(rd, ISA_PROFILE.delaySlot ? this.pc + 8 : nextPc); nextPc = src >>> 0; break;
          case 0x0c: if (r[2] === 10) this.halted = true; else throw new MipsError('Syntax', `syscall ${r[2]} is not supported`, inst.line); break;
          case 0x10: put(rd, this.hi); break;
          case 0x12: put(rd, this.lo); break;
          case 0x18: case 0x19: {
            const product = fn === 0x18 ? BigInt(src) * BigInt(target) : BigInt(src >>> 0) * BigInt(target >>> 0);
            this.lo = Number(BigInt.asIntN(32, product)); this.hi = Number(BigInt.asIntN(32, product >> 32n)); break;
          }
          case 0x1a: case 0x1b: {
            if (target === 0) throw new MipsError('Syntax', 'division by zero', inst.line);
            const a = fn === 0x1a ? BigInt(src) : BigInt(src >>> 0), b = fn === 0x1a ? BigInt(target) : BigInt(target >>> 0);
            this.lo = Number(BigInt.asIntN(32, a / b)); this.hi = Number(BigInt.asIntN(32, a % b)); break;
          }
          default: throw new MipsError('Syntax', `unsupported function 0x${fn.toString(16)}`, inst.line);
        }
      } else if (op === 2 || op === 3) {
        if (op === 3) put(31, ISA_PROFILE.delaySlot ? this.pc + 8 : nextPc);
        nextPc = ((nextPc & 0xf0000000) | ((w & 0x3ffffff) << 2)) >>> 0;
      } else {
        const si = sign16(imm), addr = (src + si) >>> 0;
        switch (op) {
          case 0x08: put(rt, overflow(src + si, inst.line)); break;
          case 0x09: put(rt, src + si); break;
          case 0x0c: put(rt, src & imm); break;
          case 0x0d: put(rt, src | imm); break;
          case 0x0e: put(rt, src ^ imm); break;
          case 0x0a: put(rt, src < si ? 1 : 0); break;
          case 0x0b: put(rt, (src >>> 0) < (si >>> 0) ? 1 : 0); break;
          case 0x0f: put(rt, imm << 16); break;
          case 0x04: if (src === target) nextPc = (nextPc + (si << 2)) >>> 0; break;
          case 0x05: if (src !== target) nextPc = (nextPc + (si << 2)) >>> 0; break;
          case 0x06: if (src <= 0) nextPc = (nextPc + (si << 2)) >>> 0; break;
          case 0x07: if (src > 0) nextPc = (nextPc + (si << 2)) >>> 0; break;
          case 0x20: put(rt, this.load(addr, 1, true, inst.line)); break;
          case 0x21: put(rt, this.load(addr, 2, true, inst.line)); break;
          case 0x23: put(rt, this.load(addr, 4, true, inst.line)); break;
          case 0x24: put(rt, this.load(addr, 1, false, inst.line)); break;
          case 0x25: put(rt, this.load(addr, 2, false, inst.line)); break;
          case 0x28: this.store(addr, 1, target, inst.line, mem); break;
          case 0x29: this.store(addr, 2, target, inst.line, mem); break;
          case 0x2b: this.store(addr, 4, target, inst.line, mem); break;
          case 0x30: put(rt, this.load(addr, 4, true, inst.line)); this.reservation = addr; break;
          case 0x38: {
            const success = this.reservation === addr;
            if (success) this.store(addr, 4, target, inst.line, mem);
            put(rt, success ? 1 : 0); this.reservation = undefined; break;
          }
          case 0x10: if (rs !== 0) throw new MipsError('Syntax', 'only mfc0 is supported', inst.line); put(rt, 0); break;
          default: throw new MipsError('Syntax', `unsupported opcode 0x${op.toString(16)}`, inst.line);
        }
      }
    } catch (e) {
      this.registers.set(before.registers); this.hi = before.hi; this.lo = before.lo; this.memory.clear(); for (const [a, b] of before.memory) this.memory.set(a, b); this.reservation = before.reservation;
      throw e;
    }
    this.pc = nextPc; this.steps++;
    if (!this.current) this.halted = true;
    this.history.push(before);
    const changed: StepTrace['changed'] = [];
    for (let i = 0; i < 32; i++) if (before.registers[i] !== r[i]) changed.push({ reg: REG_NAMES[i], before: before.registers[i], after: r[i] });
    if (before.hi !== this.hi) changed.push({ reg: 'hi', before: before.hi, after: this.hi });
    if (before.lo !== this.lo) changed.push({ reg: 'lo', before: before.lo, after: this.lo });
    return { instruction: inst, pcBefore: before.pc, pcAfter: this.pc, changed, memory: mem,
      stages: [
        { name: 'IF', detail: `Fetch 0x${w.toString(16).padStart(8, '0')} at PC 0x${before.pc.toString(16)}` },
        { name: 'ID', detail: `Decode ${inst.op} ${inst.args.join(', ')}` },
        { name: 'EX', detail: `Execute ${inst.op}; next PC 0x${nextPc.toString(16)}` },
        { name: 'MEM', detail: mem.length ? `${mem.length} byte(s) changed` : 'No memory write' },
        { name: 'WB', detail: changed.length ? changed.map(c => `${c.reg} = ${c.after}`).join(', ') : 'No register write' },
      ] };
  }
  run(maxSteps = 10000): StepTrace[] {
    const traces: StepTrace[] = [];
    while (!this.halted) {
      if (this.steps >= maxSteps) throw new MipsError('Timeout', `execution exceeded ${maxSteps} steps`, this.current?.line);
      const trace = this.step(); if (trace) traces.push(trace);
    }
    return traces;
  }
}
