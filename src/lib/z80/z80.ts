// Z80 assembler + emulator covering the instructions used in the lab:
// 8/16-bit loads (including LD rr,(nn) / LD (nn),rr), PUSH/POP, INC/DEC,
// 8-bit ALU (ADD ADC SUB SBC AND XOR OR CP), ADD HL,rr, DAA, rotates
// (RLCA RRCA RLA RRA + CB-prefixed), BIT/SET/RES, JP/JR/DJNZ/CALL/RET (with
// conditions), RST, IN/OUT, EX DE,HL / EX (SP),HL / EX AF,AF' / EXX,
// CPL/SCF/CCF, NOP/HALT/DI/EI, and the ORG/EQU/DB/DW/DS/END directives.

export interface Z80Error {
  line: number;
  msg: string;
}

export interface Z80Program {
  bytes: Map<number, number>;
  /** address → source line for each instruction */
  lineAt: Map<number, number>;
  labels: Map<string, number>;
  size: number;
  origin: number;
}

export type Z80AsmResult = { ok: true; prog: Z80Program } | { ok: false; errors: Z80Error[] };

class Fail extends Error {}
const fail = (m: string): never => {
  throw new Fail(m);
};

const R8: Record<string, number> = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
const RP: Record<string, number> = { BC: 0, DE: 1, HL: 2, SP: 3 };
const RP2: Record<string, number> = { BC: 0, DE: 1, HL: 2, AF: 3 };
const CC: Record<string, number> = { NZ: 0, Z: 1, NC: 2, C: 3, PO: 4, PE: 5, P: 6, M: 7 };
const ALU: Record<string, number> = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
const ROT: Record<string, number> = { RLC: 0, RRC: 1, RL: 2, RR: 3, SLA: 4, SRA: 5, SLL: 6, SRL: 7 };
const SIMPLE: Record<string, number> = {
  NOP: 0x00, HALT: 0x76, RLCA: 0x07, RRCA: 0x0f, RLA: 0x17, RRA: 0x1f, CPL: 0x2f, SCF: 0x37, CCF: 0x3f,
  DI: 0xf3, EI: 0xfb, EXX: 0xd9, DAA: 0x27,
};

function splitOps(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const c of s) {
    if (c === "'") q = !q;
    if (c === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function stripComment(s: string) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") q = !q;
    if (s[i] === ';' && !q) return s.slice(0, i);
  }
  return s;
}

export const Z80_MNEMONICS = new Set([
  ...Object.keys(SIMPLE), ...Object.keys(ALU), ...Object.keys(ROT),
  'LD', 'PUSH', 'POP', 'INC', 'DEC', 'JP', 'JR', 'DJNZ', 'CALL', 'RET', 'RST', 'OUT', 'IN', 'EX', 'BIT', 'SET', 'RES',
]);
/** real Z80 instructions the lab doesn't run yet — never read as a label, so they get a clear error */
const UNSUPPORTED = new Set([
  'NEG', 'IM', 'RETI', 'RETN', 'RLD', 'RRD', 'LDI', 'LDIR', 'LDD', 'LDDR', 'CPI', 'CPIR', 'CPD', 'CPDR',
  'INI', 'INIR', 'IND', 'INDR', 'OUTI', 'OTIR', 'OUTD', 'OTDR',
]);
/** EX AF,AF' — the quote would otherwise open a character literal */
const AF_ALT = 'AF_ALT';

export function assembleZ80(src: string): Z80AsmResult {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const labels = new Map<string, number>();
  const errors: Z80Error[] = [];

  const num = (tok: string, pass2: boolean): number => {
    const t = tok.trim();
    // simple + / - expressions
    const parts = t.split(/(?=[+-])/).filter(Boolean);
    if (parts.length > 1 && !/^'/.test(t)) return parts.reduce((s, p) => s + num(p, pass2), 0);
    const neg = t.startsWith('-');
    const s = t.replace(/^[+-]/, '').trim();
    let v: number | null = null;
    if (/^[0-9][0-9A-F]*H$/i.test(s)) v = parseInt(s.slice(0, -1), 16);
    else if (/^0x[0-9A-F]+$/i.test(s)) v = parseInt(s.slice(2), 16);
    else if (/^\$[0-9A-F]+$/i.test(s)) v = parseInt(s.slice(1), 16);
    else if (/^[01]+B$/i.test(s)) v = parseInt(s.slice(0, -1), 2);
    else if (/^%[01]+$/.test(s)) v = parseInt(s.slice(1), 2);
    else if (/^\d+$/.test(s)) v = parseInt(s, 10);
    else if (/^'.'$/.test(s)) v = s.charCodeAt(1);
    else if (s === '$') v = pc;
    else if (/^[A-Z_]\w*$/i.test(s)) {
      const l = labels.get(s.toUpperCase());
      if (l == null) {
        if (pass2) fail(`ไม่พบ label "${s}"`);
        v = 0;
      } else v = l;
    }
    if (v == null) fail(`"${tok}" ไม่ใช่ตัวเลขหรือ label`);
    return neg ? -v! : v!;
  };
  const byte = (v: number) => {
    if (v < -128 || v > 255) fail(`ค่า ${v} ใหญ่เกิน 8 บิต`);
    return v & 0xff;
  };
  const word = (v: number) => [v & 0xff, (v >> 8) & 0xff];

  let pc = 0;
  let origin = -1;
  let bytes = new Map<number, number>();
  let lineAt = new Map<number, number>();

  const encode = (mn: string, ops: string[], pass2: boolean): number[] => {
    const U = ops.map((o) => o.toUpperCase().replace(/\s+/g, ''));
    const n = (i: number) => num(ops[i].replace(/^\(|\)$/g, ''), pass2);
    const ind = (i: number) => /^\(.*\)$/.test(U[i] ?? '');
    const want = (k: number) => {
      if (ops.length !== k) fail(`${mn} ต้องมี ${k} operand แต่เขียนมา ${ops.length}`);
    };
    if (mn in SIMPLE) {
      want(0);
      return [SIMPLE[mn]];
    }
    switch (mn) {
      case 'LD': {
        want(2);
        const [d, s] = U;
        if (d in R8 && s in R8) {
          if (d === '(HL)' && s === '(HL)') fail('LD (HL),(HL) ไม่มีในชุดคำสั่ง');
          return [0x40 | (R8[d] << 3) | R8[s]];
        }
        if (d === 'A' && s === '(BC)') return [0x0a];
        if (d === 'A' && s === '(DE)') return [0x1a];
        if (d === '(BC)' && s === 'A') return [0x02];
        if (d === '(DE)' && s === 'A') return [0x12];
        if (d === 'SP' && s === 'HL') return [0xf9];
        if (d === 'A' && ind(1)) return [0x3a, ...word(n(1))];
        if (ind(0) && s === 'A') return [0x32, ...word(n(0))];
        if (d === 'HL' && ind(1)) return [0x2a, ...word(n(1))];
        if (ind(0) && s === 'HL') return [0x22, ...word(n(0))];
        if (d in RP && ind(1)) return [0xed, 0x4b | (RP[d] << 4), ...word(n(1))];
        if (ind(0) && s in RP) return [0xed, 0x43 | (RP[s] << 4), ...word(n(0))];
        if (d in R8 && ind(1)) fail(`LD ${ops[0]}, (address) ใช้ได้กับ A เท่านั้น — ใช้ LD A, ${ops[1]} แล้ว LD ${ops[0]}, A`);
        if (d in R8) return [0x06 | (R8[d] << 3), byte(n(1))];
        if (d in RP) return [0x01 | (RP[d] << 4), ...word(n(1))];
        return fail(`LD ${ops.join(', ')} ไม่มีในชุดคำสั่งที่รองรับ`);
      }
      case 'PUSH':
      case 'POP':
        want(1);
        if (!(U[0] in RP2)) fail(`${mn} ใช้ได้กับ BC, DE, HL, AF`);
        return [(mn === 'PUSH' ? 0xc5 : 0xc1) | (RP2[U[0]] << 4)];
      case 'INC':
      case 'DEC':
        want(1);
        if (U[0] in R8) return [(mn === 'INC' ? 0x04 : 0x05) | (R8[U[0]] << 3)];
        if (U[0] in RP) return [(mn === 'INC' ? 0x03 : 0x0b) | (RP[U[0]] << 4)];
        return fail(`${mn} ${ops[0]} ไม่มีในชุดคำสั่ง`);
      case 'EX':
        if (U.join(',') === 'DE,HL') return [0xeb];
        if (U.join(',') === '(SP),HL') return [0xe3];
        if (U.join(',') === `AF,${AF_ALT}`) return [0x08];
        return fail(`EX ${ops.join(', ')} ไม่รองรับ`);
      case 'JP':
        if (ops.length === 1 && U[0] === '(HL)') return [0xe9];
        if (ops.length === 2) {
          if (!(U[0] in CC)) fail(`เงื่อนไข "${ops[0]}" ไม่ถูกต้อง`);
          return [0xc2 | (CC[U[0]] << 3), ...word(n(1))];
        }
        want(1);
        return [0xc3, ...word(n(0))];
      case 'CALL':
        if (ops.length === 2) {
          if (!(U[0] in CC)) fail(`เงื่อนไข "${ops[0]}" ไม่ถูกต้อง`);
          return [0xc4 | (CC[U[0]] << 3), ...word(n(1))];
        }
        want(1);
        return [0xcd, ...word(n(0))];
      case 'RET':
        if (ops.length === 1) {
          if (!(U[0] in CC)) fail(`เงื่อนไข "${ops[0]}" ไม่ถูกต้อง`);
          return [0xc0 | (CC[U[0]] << 3)];
        }
        want(0);
        return [0xc9];
      case 'JR':
      case 'DJNZ': {
        const jrCC: Record<string, number> = { NZ: 0x20, Z: 0x28, NC: 0x30, C: 0x38 };
        let op = mn === 'DJNZ' ? 0x10 : 0x18;
        let ti = 0;
        if (mn === 'JR' && ops.length === 2) {
          if (!(U[0] in jrCC)) fail(`JR ใช้ได้กับเงื่อนไข NZ, Z, NC, C เท่านั้น`);
          op = jrCC[U[0]];
          ti = 1;
        } else want(1);
        const t = n(ti);
        const off = t - (pc + 2);
        if (pass2 && (off < -128 || off > 127)) fail(`${mn} กระโดดไกลเกิน 127 byte — ใช้ JP แทน`);
        return [op, off & 0xff];
      }
      case 'RST': {
        want(1);
        const p = n(0);
        if (p & ~0x38) fail('RST ใช้ได้กับ 00h, 08h, … 38h');
        return [0xc7 | p];
      }
      case 'OUT':
        want(2);
        if (!ind(0) || U[1] !== 'A') fail('รองรับรูปแบบ OUT (n), A');
        return [0xd3, byte(n(0))];
      case 'IN':
        want(2);
        if (U[0] !== 'A' || !ind(1)) fail('รองรับรูปแบบ IN A, (n)');
        return [0xdb, byte(n(1))];
      case 'BIT':
      case 'SET':
      case 'RES': {
        want(2);
        const b = n(0);
        if (b < 0 || b > 7) fail('เลขบิตต้องเป็น 0–7');
        if (!(U[1] in R8)) fail(`"${ops[1]}" ไม่ใช่ register 8 บิต`);
        const base = { BIT: 0x40, RES: 0x80, SET: 0xc0 }[mn];
        return [0xcb, base | (b << 3) | R8[U[1]]];
      }
    }
    if (mn in ROT) {
      want(1);
      if (!(U[0] in R8)) fail(`"${ops[0]}" ไม่ใช่ register 8 บิต`);
      return [0xcb, (ROT[mn] << 3) | R8[U[0]]];
    }
    if (mn in ALU) {
      // ADD HL, rr
      if (mn === 'ADD' && U[0] === 'HL') {
        want(2);
        if (!(U[1] in RP)) fail('ADD HL ใช้ได้กับ BC, DE, HL, SP');
        return [0x09 | (RP[U[1]] << 4)];
      }
      if ((mn === 'ADC' || mn === 'SBC') && U[0] === 'HL') fail(`ยังไม่รองรับ ${mn} HL, rr — ใช้ ADD HL, rr หรือคำนวณทีละ 8 บิต`);
      // accept both "ADD A, x" and "SUB x"
      const src = ops.length === 2 && U[0] === 'A' ? 1 : 0;
      if (ops.length - src !== 1) fail(`${mn} ต้องมี operand เดียว (หรือ A, operand)`);
      const s = U[src];
      if (s in R8) return [0x80 | (ALU[mn] << 3) | R8[s]];
      return [0xc6 | (ALU[mn] << 3), byte(num(ops[src], pass2))];
    }
    if (UNSUPPORTED.has(mn)) fail(`ยังไม่รองรับคำสั่ง ${mn} ในแล็บนี้`);
    return fail(`ไม่รู้จักคำสั่ง "${mn}"`);
  };

  for (const pass2 of [false, true]) {
    pc = 0;
    origin = -1;
    bytes = new Map();
    lineAt = new Map();
    lines.forEach((raw, i) => {
      const line = i + 1;
      try {
        let s = stripComment(raw.replace(/(\bEX\s+AF\s*,\s*)AF'/i, `$1${AF_ALT}`));
        const lm = /^([A-Za-z_]\w*)\s*:?/.exec(s);
        let label: string | null = null;
        // a label is either "NAME:" anywhere at the start, or a word in column 0
        const colon = /^\s*([A-Za-z_]\w*)\s*:/.exec(s);
        if (colon) {
          label = colon[1].toUpperCase();
          s = s.slice(colon[0].length);
        } else if (lm && /^[A-Za-z_]/.test(raw) && !Z80_MNEMONICS.has(lm[1].toUpperCase()) && !UNSUPPORTED.has(lm[1].toUpperCase()) && !/^(ORG|EQU|DB|DW|DS|DEFB|DEFW|DEFS|END)$/i.test(lm[1])) {
          label = lm[1].toUpperCase();
          s = s.slice(lm[0].length);
        }
        s = s.trim();
        const sp = s.search(/\s/);
        const mn = (sp < 0 ? s : s.slice(0, sp)).toUpperCase();
        const ops = splitOps(sp < 0 ? '' : s.slice(sp + 1));
        if (mn === 'EQU') {
          if (!label) fail('EQU ต้องมีชื่อ label ด้านหน้า');
          labels.set(label!, num(ops[0] ?? '', pass2));
          return;
        }
        if (label) {
          if (!pass2 && labels.has(label)) fail(`label "${label}" ประกาศซ้ำ`);
          labels.set(label, pc);
        }
        if (!mn) return;
        if (mn === 'ORG') {
          pc = num(ops[0] ?? '', pass2) & 0xffff;
          if (origin < 0) origin = pc;
          return;
        }
        if (mn === 'END') return;
        if (origin < 0) origin = pc;
        let out: number[];
        if (mn === 'DB' || mn === 'DEFB') {
          out = [];
          for (const o of ops) {
            const str = /^'(.*)'$/.exec(o);
            if (str && str[1].length > 1) for (const ch of str[1]) out.push(ch.charCodeAt(0));
            else out.push(byte(num(o, pass2)));
          }
        } else if (mn === 'DW' || mn === 'DEFW') out = ops.flatMap((o) => word(num(o, pass2)));
        else if (mn === 'DS' || mn === 'DEFS') out = Array(num(ops[0] ?? '0', pass2)).fill(0);
        else {
          out = encode(mn, ops, pass2);
          lineAt.set(pc, line);
        }
        out.forEach((b, k) => bytes.set((pc + k) & 0xffff, b));
        pc += out.length;
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
        if (pass2) errors.push({ line, msg: e.message });
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  const size = bytes.size;
  return { ok: true, prog: { bytes, lineAt, labels, size, origin: Math.max(origin, 0) } };
}

// ---------- emulator ----------

const F_C = 1;
const F_N = 2;
const F_PV = 4;
const F_H = 16;
const F_Z = 64;
const F_S = 128;

const parity = (v: number) => {
  let p = 0;
  for (let i = 0; i < 8; i++) p ^= (v >> i) & 1;
  return p ? 0 : F_PV;
};
const sz = (v: number) => (v & 0x80 ? F_S : 0) | (v & 0xff ? 0 : F_Z);

export interface Z80Regs {
  A: number;
  F: number;
  B: number;
  C: number;
  D: number;
  E: number;
  H: number;
  L: number;
  SP: number;
  PC: number;
}

export class Z80 {
  mem = new Uint8Array(65536);
  r: Z80Regs = { A: 0, F: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0, SP: 0xffff, PC: 0 };
  /** the alternate set AF' BC' DE' HL', swapped in by EX AF,AF' and EXX */
  alt = { A: 0, F: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0 };
  halted = false;
  cycles = 0;
  /** last value written to each port */
  ports = new Uint8Array(256);
  error: string | null = null;

  constructor(
    prog?: Z80Program,
    private io: {
      out?: (port: number, v: number, cycles: number) => void;
      in?: (port: number) => number;
      /** memory as the board's wiring sees it; without these, a flat 64 KB RAM holds the program */
      read?: (addr: number) => number;
      write?: (addr: number, v: number) => void;
    } = {},
  ) {
    if (prog) {
      for (const [a, b] of prog.bytes) this.mem[a] = b;
      this.r.PC = prog.origin;
    }
  }

  private rd(a: number) {
    return this.io.read ? this.io.read(a & 0xffff) & 0xff : this.mem[a & 0xffff];
  }
  private wr(a: number, v: number) {
    if (this.io.write) this.io.write(a & 0xffff, v & 0xff);
    else this.mem[a & 0xffff] = v & 0xff;
  }
  private fetch() {
    const v = this.rd(this.r.PC);
    this.r.PC = (this.r.PC + 1) & 0xffff;
    return v;
  }
  private fetch16() {
    const lo = this.fetch();
    return lo | (this.fetch() << 8);
  }
  get HL() {
    return (this.r.H << 8) | this.r.L;
  }
  private getRP(i: number, af = false): number {
    const r = this.r;
    return [(r.B << 8) | r.C, (r.D << 8) | r.E, (r.H << 8) | r.L, af ? (r.A << 8) | r.F : r.SP][i];
  }
  private setRP(i: number, v: number, af = false) {
    const r = this.r;
    v &= 0xffff;
    if (i === 0) [r.B, r.C] = [v >> 8, v & 0xff];
    else if (i === 1) [r.D, r.E] = [v >> 8, v & 0xff];
    else if (i === 2) [r.H, r.L] = [v >> 8, v & 0xff];
    else if (af) [r.A, r.F] = [v >> 8, v & 0xff];
    else r.SP = v;
  }
  private get8(i: number): number {
    const r = this.r;
    return [r.B, r.C, r.D, r.E, r.H, r.L, this.rd(this.HL), r.A][i];
  }
  private set8(i: number, v: number) {
    v &= 0xff;
    const r = this.r;
    if (i === 6) this.wr(this.HL, v);
    else (r as unknown as Record<string, number>)['BCDEHL_A'[i]] = v;
  }
  private push(v: number) {
    this.r.SP = (this.r.SP - 1) & 0xffff;
    this.wr(this.r.SP, v >> 8);
    this.r.SP = (this.r.SP - 1) & 0xffff;
    this.wr(this.r.SP, v & 0xff);
  }
  private pop() {
    const lo = this.rd(this.r.SP);
    this.r.SP = (this.r.SP + 1) & 0xffff;
    const hi = this.rd(this.r.SP);
    this.r.SP = (this.r.SP + 1) & 0xffff;
    return (hi << 8) | lo;
  }
  private cond(c: number) {
    const f = this.r.F;
    return [!(f & F_Z), !!(f & F_Z), !(f & F_C), !!(f & F_C), !(f & F_PV), !!(f & F_PV), !(f & F_S), !!(f & F_S)][c];
  }
  private alu(op: number, v: number) {
    const r = this.r;
    const a = r.A;
    const c = r.F & F_C ? 1 : 0;
    let res: number;
    switch (op) {
      case 0:
      case 1: {
        res = a + v + (op === 1 ? c : 0);
        const ov = (~(a ^ v) & (a ^ res) & 0x80) ? F_PV : 0;
        r.F = sz(res) | ((a ^ v ^ res) & F_H) | ov | (res > 0xff ? F_C : 0);
        r.A = res & 0xff;
        return;
      }
      case 2:
      case 3:
      case 7: {
        res = a - v - (op === 3 ? c : 0);
        const ov = ((a ^ v) & (a ^ res) & 0x80) ? F_PV : 0;
        r.F = sz(res) | ((a ^ v ^ res) & F_H) | ov | F_N | (res < 0 ? F_C : 0);
        if (op !== 7) r.A = res & 0xff;
        return;
      }
      case 4:
        r.A = a & v;
        r.F = sz(r.A) | F_H | parity(r.A);
        return;
      case 5:
        r.A = (a ^ v) & 0xff;
        r.F = sz(r.A) | parity(r.A);
        return;
      case 6:
        r.A = (a | v) & 0xff;
        r.F = sz(r.A) | parity(r.A);
        return;
    }
  }

  /** Executes one instruction and returns its T-states. */
  step(): number {
    if (this.halted) return 4;
    const r = this.r;
    const pc0 = r.PC;
    const op = this.fetch();
    let t = 4;
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    if (op === 0x76) {
      this.halted = true;
      r.PC = pc0;
    } else if (x === 1) {
      this.set8(y, this.get8(z));
      t = y === 6 || z === 6 ? 7 : 4;
    } else if (x === 2) {
      this.alu(y, this.get8(z));
      t = z === 6 ? 7 : 4;
    } else {
      switch (op) {
        case 0x00:
        case 0xf3:
        case 0xfb:
          break;
        case 0x07: {
          const c = r.A >> 7;
          r.A = ((r.A << 1) | c) & 0xff;
          r.F = (r.F & (F_S | F_Z | F_PV)) | c;
          break;
        }
        case 0x0f: {
          const c = r.A & 1;
          r.A = (r.A >> 1) | (c << 7);
          r.F = (r.F & (F_S | F_Z | F_PV)) | c;
          break;
        }
        case 0x17: {
          const c = r.A >> 7;
          r.A = ((r.A << 1) | (r.F & F_C)) & 0xff;
          r.F = (r.F & (F_S | F_Z | F_PV)) | c;
          break;
        }
        case 0x1f: {
          const c = r.A & 1;
          r.A = (r.A >> 1) | ((r.F & F_C) << 7);
          r.F = (r.F & (F_S | F_Z | F_PV)) | c;
          break;
        }
        case 0x2f:
          r.A ^= 0xff;
          r.F |= F_H | F_N;
          break;
        case 0x37:
          r.F = (r.F & ~(F_H | F_N)) | F_C;
          break;
        case 0x3f:
          r.F = (r.F & ~F_N) ^ F_C;
          break;
        case 0x27: {
          // decimal adjust after a BCD ADD / SUB: fix each nibble that went past 9
          const a = r.A;
          const sub = r.F & F_N;
          let fix = 0;
          let c = r.F & F_C;
          if (r.F & F_H || (a & 0x0f) > 9) fix |= 0x06;
          if (c || a > 0x99) {
            fix |= 0x60;
            c = F_C;
          }
          const v = (sub ? a - fix : a + fix) & 0xff;
          const h = sub ? (r.F & F_H && (a & 0x0f) < 6 ? F_H : 0) : (a & 0x0f) > 9 ? F_H : 0;
          r.A = v;
          r.F = sz(v) | parity(v) | h | sub | c;
          break;
        }
        case 0x08:
          [r.A, r.F, this.alt.A, this.alt.F] = [this.alt.A, this.alt.F, r.A, r.F];
          break;
        case 0xd9: {
          const a = this.alt;
          [r.B, r.C, r.D, r.E, r.H, r.L, a.B, a.C, a.D, a.E, a.H, a.L] = [a.B, a.C, a.D, a.E, a.H, a.L, r.B, r.C, r.D, r.E, r.H, r.L];
          break;
        }
        case 0xed: {
          // only LD (nn),rr / LD rr,(nn) from the ED page
          const op2 = this.fetch();
          const rp = (op2 >> 4) & 3;
          if ((op2 & 0xcf) === 0x43) {
            const a = this.fetch16();
            const v = this.getRP(rp);
            this.wr(a, v & 0xff);
            this.wr(a + 1, v >> 8);
            t = 20;
          } else if ((op2 & 0xcf) === 0x4b) {
            const a = this.fetch16();
            this.setRP(rp, this.rd(a) | (this.rd(a + 1) << 8));
            t = 20;
          } else {
            this.error = `เจอ opcode EDh ${op2.toString(16).toUpperCase().padStart(2, '0')}h ที่ไม่รองรับ ที่ address ${pc0.toString(16).toUpperCase().padStart(4, '0')}h`;
            this.halted = true;
            r.PC = pc0;
          }
          break;
        }
        case 0x0a:
          r.A = this.rd(this.getRP(0));
          t = 7;
          break;
        case 0x1a:
          r.A = this.rd(this.getRP(1));
          t = 7;
          break;
        case 0x02:
          this.wr(this.getRP(0), r.A);
          t = 7;
          break;
        case 0x12:
          this.wr(this.getRP(1), r.A);
          t = 7;
          break;
        case 0x3a:
          r.A = this.rd(this.fetch16());
          t = 13;
          break;
        case 0x32:
          this.wr(this.fetch16(), r.A);
          t = 13;
          break;
        case 0x2a: {
          const a = this.fetch16();
          r.L = this.rd(a);
          r.H = this.rd(a + 1);
          t = 16;
          break;
        }
        case 0x22: {
          const a = this.fetch16();
          this.wr(a, r.L);
          this.wr(a + 1, r.H);
          t = 16;
          break;
        }
        case 0xf9:
          r.SP = this.HL;
          t = 6;
          break;
        case 0xeb:
          [r.D, r.E, r.H, r.L] = [r.H, r.L, r.D, r.E];
          break;
        case 0xe3: {
          const lo = this.rd(r.SP);
          const hi = this.rd(r.SP + 1);
          this.wr(r.SP, r.L);
          this.wr(r.SP + 1, r.H);
          r.L = lo;
          r.H = hi;
          t = 19;
          break;
        }
        case 0xe9:
          r.PC = this.HL;
          break;
        case 0xc3:
          r.PC = this.fetch16();
          t = 10;
          break;
        case 0xcd: {
          const a = this.fetch16();
          this.push(r.PC);
          r.PC = a;
          t = 17;
          break;
        }
        case 0xc9:
          r.PC = this.pop();
          t = 10;
          break;
        case 0x18: {
          const e = (this.fetch() << 24) >> 24;
          r.PC = (r.PC + e) & 0xffff;
          t = 12;
          break;
        }
        case 0x10: {
          const e = (this.fetch() << 24) >> 24;
          r.B = (r.B - 1) & 0xff;
          if (r.B) {
            r.PC = (r.PC + e) & 0xffff;
            t = 13;
          } else t = 8;
          break;
        }
        case 0x20:
        case 0x28:
        case 0x30:
        case 0x38: {
          const e = (this.fetch() << 24) >> 24;
          if (this.cond((op - 0x20) >> 3)) {
            r.PC = (r.PC + e) & 0xffff;
            t = 12;
          } else t = 7;
          break;
        }
        case 0xd3: {
          const port = this.fetch();
          this.ports[port] = r.A;
          t = 11;
          this.io.out?.(port, r.A, this.cycles + t);
          break;
        }
        case 0xdb: {
          const port = this.fetch();
          r.A = (this.io.in?.(port) ?? 0xff) & 0xff;
          t = 11;
          break;
        }
        case 0xcb: {
          const op2 = this.fetch();
          const k = op2 >> 6;
          const b = (op2 >> 3) & 7;
          const i = op2 & 7;
          let v = this.get8(i);
          t = i === 6 ? 15 : 8;
          if (k === 0) {
            let c: number;
            switch (b) {
              case 0:
                c = v >> 7;
                v = (v << 1) | c;
                break;
              case 1:
                c = v & 1;
                v = (v >> 1) | (c << 7);
                break;
              case 2:
                c = v >> 7;
                v = (v << 1) | (r.F & F_C);
                break;
              case 3:
                c = v & 1;
                v = (v >> 1) | ((r.F & F_C) << 7);
                break;
              case 4:
                c = v >> 7;
                v <<= 1;
                break;
              case 5:
                c = v & 1;
                v = (v >> 1) | (v & 0x80);
                break;
              case 6:
                c = v >> 7;
                v = (v << 1) | 1;
                break;
              default:
                c = v & 1;
                v >>= 1;
            }
            v &= 0xff;
            this.set8(i, v);
            r.F = sz(v) | parity(v) | c;
          } else if (k === 1) {
            r.F = (r.F & F_C) | F_H | (v & (1 << b) ? 0 : F_Z | F_PV) | (b === 7 && v & 0x80 ? F_S : 0);
            t = i === 6 ? 12 : 8;
          } else this.set8(i, k === 2 ? v & ~(1 << b) : v | (1 << b));
          break;
        }
        default:
          if (x === 0 && z === 6) {
            this.set8(y, this.fetch());
            t = y === 6 ? 10 : 7;
          } else if (x === 0 && z === 1 && !(y & 1)) {
            this.setRP(y >> 1, this.fetch16());
            t = 10;
          } else if (x === 0 && z === 1) {
            const hl = this.HL;
            const v = hl + this.getRP(y >> 1);
            r.F = (r.F & (F_S | F_Z | F_PV)) | (v > 0xffff ? F_C : 0) | (((hl ^ this.getRP(y >> 1) ^ v) >> 8) & F_H);
            this.setRP(2, v);
            t = 11;
          } else if (x === 0 && z === 3) {
            const i = y >> 1;
            this.setRP(i, this.getRP(i) + (y & 1 ? -1 : 1));
            t = 6;
          } else if (x === 0 && (z === 4 || z === 5)) {
            const o = this.get8(y);
            const v = (o + (z === 4 ? 1 : -1)) & 0xff;
            this.set8(y, v);
            const ov = z === 4 ? o === 0x7f : o === 0x80;
            r.F = (r.F & F_C) | sz(v) | (ov ? F_PV : 0) | (z === 5 ? F_N : 0) | ((o ^ v) & F_H);
            t = y === 6 ? 11 : 4;
          } else if (x === 3 && z === 6) {
            this.alu(y, this.fetch());
            t = 7;
          } else if (x === 3 && z === 5 && !(y & 1)) {
            this.push(this.getRP(y >> 1, true));
            t = 11;
          } else if (x === 3 && z === 1 && !(y & 1)) {
            this.setRP(y >> 1, this.pop(), true);
            t = 10;
          } else if (x === 3 && z === 2) {
            const a = this.fetch16();
            if (this.cond(y)) r.PC = a;
            t = 10;
          } else if (x === 3 && z === 4) {
            const a = this.fetch16();
            if (this.cond(y)) {
              this.push(r.PC);
              r.PC = a;
              t = 17;
            } else t = 10;
          } else if (x === 3 && z === 0) {
            if (this.cond(y)) {
              r.PC = this.pop();
              t = 11;
            } else t = 5;
          } else if (x === 3 && z === 7) {
            this.push(r.PC);
            r.PC = y * 8;
            t = 11;
          } else {
            this.error = `เจอ opcode ${op.toString(16).toUpperCase().padStart(2, '0')}h ที่ไม่รองรับ ที่ address ${pc0.toString(16).toUpperCase().padStart(4, '0')}h`;
            this.halted = true;
            r.PC = pc0;
          }
      }
    }
    this.cycles += t;
    return t;
  }

  /** Runs until at least `tStates` T-states have elapsed or the CPU halts. */
  runFor(tStates: number, maxSteps = 5_000_000): number {
    let used = 0;
    for (let k = 0; used < tStates && !this.halted && k < maxSteps; k++) used += this.step();
    return used;
  }
}

/**
 * Memory as the lab board decodes it: the 8 KB 2764 EPROM answers at 0000h–7FFFh (read only, mirrored),
 * the 8 KB 6264 RAM at 8000h–FFFFh (mirrored). Program bytes past the EPROM's 8 KB are lost, as on the board.
 */
export function boardMemory(prog: Z80Program): { read: (a: number) => number; write: (a: number, v: number) => void } {
  const rom = new Uint8Array(0x2000).fill(0xff);
  for (const [a, b] of prog.bytes) if (a < 0x2000) rom[a] = b;
  const ram = new Uint8Array(0x2000);
  return {
    read: (a) => (a & 0x8000 ? ram[a & 0x1fff] : rom[a & 0x1fff]),
    write: (a, v) => {
      if (a & 0x8000) ram[a & 0x1fff] = v;
    },
  };
}

export const hex2 = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0') + 'h';
export const hex4 = (v: number) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0') + 'h';
