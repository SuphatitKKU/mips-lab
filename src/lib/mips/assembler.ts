// Two-pass MIPS assembler: source text → machine words + data segment.
// Supports the MIPS32 integer instructions in isa.ts, common pseudo-instructions
// (li, la, move, mul, blt/bgt/ble/bge, beqz/bnez, b, neg, not, nop, subi) and the
// .text/.data/.word/.half/.byte/.space/.ascii/.asciiz/.align directives.

import { DATA_BASE, OP_BY_NAME, RN, TEXT_BASE, hx, opOf, fields, type OpDef } from './isa';

export interface AsmInstr {
  addr: number;
  word: number;
  /** 1-based source line */
  line: number;
  /** basic (real) instruction, e.g. `addu $v0, $t3, $zero` */
  basic: string;
  /** pseudo-instruction this came from, if any */
  pseudo?: string;
}

export interface Program {
  text: AsmInstr[];
  /** initial data segment, byte address → byte */
  data: Map<number, number>;
  labels: Map<string, number>;
  /** source lines (1-based index - 1) */
  source: string[];
}

export interface AsmError {
  line: number;
  msg: string;
}

export type AsmResult = { ok: true; prog: Program } | { ok: false; errors: AsmError[] };

class Fail extends Error {}
const fail = (msg: string): never => {
  throw new Fail(msg);
};

const REG_IDX = new Map<string, number>(RN.map((n, i) => [n, i]));
REG_IDX.set('s8', 30);

export function parseReg(tok: string): number {
  const t = tok.trim();
  if (!t.startsWith('$')) fail(`"${t}" ต้องเป็น register เช่น $t0`);
  const name = t.slice(1);
  if (/^\d+$/.test(name)) {
    const n = +name;
    if (n > 31) fail(`ไม่มี register "${t}" (มีแค่ $0–$31)`);
    return n;
  }
  const i = REG_IDX.get(name);
  if (i == null) fail(`"${t}" ไม่ใช่ชื่อ register`);
  return i!;
}

function parseNum(tok: string): number | null {
  const t = tok.trim();
  if (/^-?\d+$/.test(t)) return +t;
  if (/^-?0x[0-9a-f]+$/i.test(t)) return t.startsWith('-') ? -parseInt(t.slice(3), 16) : parseInt(t.slice(2), 16);
  if (/^-?0b[01]+$/i.test(t)) return t.startsWith('-') ? -parseInt(t.slice(3), 2) : parseInt(t.slice(2), 2);
  const ch = /^'(\\?.)'$/.exec(t);
  if (ch) return unescape(ch[1]).charCodeAt(0);
  return null;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t', '0': '\0', r: '\r' })[c] ?? c);
}

const isLabel = (t: string) => /^[A-Za-z_.][\w.]*$/.test(t);

/** Splits operands on top-level commas, keeping quoted strings intact. */
function splitOps(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') q = !q;
    if (c === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function stripComment(s: string): string {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && s[i - 1] !== '\\') q = !q;
    if (c === '#' && !q) return s.slice(0, i);
  }
  return s;
}

const fits16s = (v: number) => v >= -32768 && v <= 32767;
const fits16u = (v: number) => v >= 0 && v <= 0xffff;

// ---------- basic instruction building ----------

interface Basic {
  def: OpDef;
  rs?: number;
  rt?: number;
  rd?: number;
  shamt?: number;
  imm?: number;
  /** branch/jump target label or absolute address */
  target?: string | number;
}

const B = (name: string, f: Omit<Basic, 'def'>): Basic => ({ def: OP_BY_NAME.get(name)!, ...f });

function encode(b: Basic, addr: number, labels: Map<string, number>): number {
  const { def } = b;
  const rs = b.rs ?? 0;
  const rt = def.rt ?? b.rt ?? 0;
  const rd = b.rd ?? 0;
  const resolve = (t: string | number) => {
    if (typeof t === 'number') return t;
    const v = labels.get(t);
    if (v == null) fail(`ไม่พบ label "${t}"`);
    return v!;
  };
  if (def.fmt === 'R') {
    const sh = b.shamt ?? 0;
    return ((rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | def.funct!) >>> 0;
  }
  if (def.fmt === 'J') {
    const t = resolve(b.target!);
    return ((def.op << 26) | ((t >>> 2) & 0x3ffffff)) >>> 0;
  }
  let imm = b.imm ?? 0;
  if (b.target != null) {
    const t = resolve(b.target);
    const off = (t - (addr + 4)) >> 2;
    if (!fits16s(off)) fail('branch กระโดดไกลเกินไป (เกิน ±32K คำสั่ง)');
    imm = off;
  }
  return ((def.op << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;
}

/** Disassembles a machine word into readable basic assembly. */
export function disasm(word: number, addr: number, labels?: Map<string, number>): string {
  const def = opOf(word);
  if (!def) return `.word 0x${hx(word)}`;
  const f = fields(word);
  const r = (i: number) => '$' + RN[i];
  const name = (a: number) => {
    if (labels) for (const [k, v] of labels) if (v === a) return k;
    return '0x' + hx(a);
  };
  const pad = def.name.padEnd(4);
  switch (def.syntax) {
    case 'd,s,t':
      return `${pad} ${r(f.rd)}, ${r(f.rs)}, ${r(f.rt)}`;
    case 'd,t,s':
      return `${pad} ${r(f.rd)}, ${r(f.rt)}, ${r(f.rs)}`;
    case 'd,t,h':
      return word === 0 ? 'nop' : `${pad} ${r(f.rd)}, ${r(f.rt)}, ${f.shamt}`;
    case 's':
      return `${pad} ${r(f.rs)}`;
    case 'd,s':
      return `${pad} ${r(f.rd)}, ${r(f.rs)}`;
    case 's,t':
      return `${pad} ${r(f.rs)}, ${r(f.rt)}`;
    case 'd':
      return `${pad} ${r(f.rd)}`;
    case 't,s,i':
      return `${pad} ${r(f.rt)}, ${r(f.rs)}, ${def.unsigned ? f.uimm : f.imm}`;
    case 't,i':
      return `${pad} ${r(f.rt)}, 0x${f.uimm.toString(16).toUpperCase()}`;
    case 't,o(s)':
      return `${pad} ${r(f.rt)}, ${f.imm}(${r(f.rs)})`;
    case 's,t,L':
      return `${pad} ${r(f.rs)}, ${r(f.rt)}, ${name((addr + 4 + f.imm * 4) >>> 0)}`;
    case 's,L':
      return `${pad} ${r(f.rs)}, ${name((addr + 4 + f.imm * 4) >>> 0)}`;
    case 'L':
      return `${pad} ${name(((addr + 4) & 0xf0000000) | (f.target << 2))}`;
    default:
      return def.name;
  }
}

// ---------- operand helpers ----------

function want(ops: string[], n: number, mn: string, shape: string) {
  if (ops.length !== n) fail(`คำสั่ง ${mn} ต้องมี ${n} operand (${shape}) แต่เขียนมา ${ops.length}`);
}

function imm(tok: string, lo = -32768, hi = 32767, what = 'ค่าคงที่'): number {
  const v = parseNum(tok);
  if (v == null) fail(`"${tok}" ไม่ใช่ตัวเลข`);
  if (v! < lo || v! > hi) fail(`${what} ${tok} อยู่นอกช่วง ${lo}…${hi} — ลองใช้ li เพื่อโหลดค่าใหญ่ก่อน`);
  return v!;
}

function target(tok: string): string {
  if (!isLabel(tok)) fail(`"${tok}" ไม่ใช่ชื่อ label`);
  return tok;
}

/** Parses `off($rs)`, `($rs)` — returns null for a bare label. */
function memOp(tok: string): { off: number; rs: number } | null {
  const m = /^(.*)\(\s*(\$\w+)\s*\)$/.exec(tok.trim());
  if (!m) return null;
  const off = m[1].trim() ? imm(m[1], -32768, 32767, 'offset') : 0;
  return { off, rs: parseReg(m[2]) };
}

const isImm = (t: string) => parseNum(t) != null;

/** Upper/lower halves so that (hi << 16) + signExtend(lo) == v. */
function hiLo(v: number): [number, number] {
  const lo = v & 0xffff;
  const hi = ((v >>> 16) + (lo & 0x8000 ? 1 : 0)) & 0xffff;
  return [hi, lo];
}

const IMM_FORM: Record<string, string> = {
  add: 'addi', addu: 'addiu', and: 'andi', or: 'ori', xor: 'xori', slt: 'slti', sltu: 'sltiu',
};

/** Expands one source instruction to basic instructions. `labels` is null in pass 1 (sizing only). */
function expand(mn: string, ops: string[], labels: Map<string, number> | null): Basic[] {
  const at = 1;
  const def = OP_BY_NAME.get(mn);

  // R-type arithmetic written with an immediate: add $t0, $t1, 5 → addi
  if (def && def.syntax === 'd,s,t' && ops.length === 3 && isImm(ops[2])) {
    if (mn === 'sub' || mn === 'subu') {
      return [B(mn === 'sub' ? 'addi' : 'addiu', { rt: parseReg(ops[0]), rs: parseReg(ops[1]), imm: -imm(ops[2], -32767, 32768) })];
    }
    const alt = IMM_FORM[mn];
    if (alt) return expand(alt, ops, labels);
  }
  // mul/div/rem with an immediate: load it into $at first
  if (['mul', 'div', 'divu', 'rem'].includes(mn) && ops.length === 3 && isImm(ops[2])) {
    return [B('addi', { rt: at, rs: 0, imm: imm(ops[2]) }), ...expand(mn, [ops[0], ops[1], '$at'], labels)];
  }
  // div/divu with 3 operands is the pseudo form: div rd, rs, rt → div rs, rt; mflo rd
  if ((mn === 'div' || mn === 'divu') && ops.length === 3) {
    return [B(mn, { rs: parseReg(ops[1]), rt: parseReg(ops[2]) }), B('mflo', { rd: parseReg(ops[0]) })];
  }
  // branches comparing against an immediate: beq $t0, 5, L → addi $at, $zero, 5; beq $t0, $at, L
  if (['beq', 'bne', 'blt', 'bgt', 'ble', 'bge'].includes(mn) && ops.length === 3 && isImm(ops[1])) {
    const v = imm(ops[1]);
    return [B('addi', { rt: at, rs: 0, imm: v }), ...expand(mn, [ops[0], '$at', ops[2]], labels)];
  }
  // memory access to a label: lw $t0, value → lui $at, hi; lw $t0, lo($at)
  if (def?.syntax === 't,o(s)' && ops.length === 2 && !memOp(ops[1])) {
    const name = target(ops[1]);
    const a = labels ? labels.get(name) : 0;
    if (a == null) fail(`ไม่พบ label "${name}"`);
    const [hi, lo] = hiLo(a!);
    return [B('lui', { rt: at, imm: hi }), B(mn, { rt: parseReg(ops[0]), rs: at, imm: lo })];
  }

  if (def) {
    switch (def.syntax) {
      case 'd,s,t':
        want(ops, 3, mn, 'rd, rs, rt');
        return [B(mn, { rd: parseReg(ops[0]), rs: parseReg(ops[1]), rt: parseReg(ops[2]) })];
      case 'd,t,s':
        want(ops, 3, mn, 'rd, rt, rs');
        return [B(mn, { rd: parseReg(ops[0]), rt: parseReg(ops[1]), rs: parseReg(ops[2]) })];
      case 'd,t,h':
        want(ops, 3, mn, 'rd, rt, shamt');
        return [B(mn, { rd: parseReg(ops[0]), rt: parseReg(ops[1]), shamt: imm(ops[2], 0, 31, 'จำนวนบิตที่เลื่อน') })];
      case 's':
        want(ops, 1, mn, 'rs');
        return [B(mn, { rs: parseReg(ops[0]) })];
      case 'd,s':
        if (ops.length === 1) return [B(mn, { rd: 31, rs: parseReg(ops[0]) })];
        want(ops, 2, mn, 'rd, rs');
        return [B(mn, { rd: parseReg(ops[0]), rs: parseReg(ops[1]) })];
      case 's,t':
        want(ops, 2, mn, 'rs, rt');
        return [B(mn, { rs: parseReg(ops[0]), rt: parseReg(ops[1]) })];
      case 'd':
        want(ops, 1, mn, 'rd');
        return [B(mn, { rd: parseReg(ops[0]) })];
      case 't,s,i': {
        want(ops, 3, mn, 'rt, rs, imm');
        const v = def.unsigned ? imm(ops[2], 0, 0xffff) : imm(ops[2]);
        return [B(mn, { rt: parseReg(ops[0]), rs: parseReg(ops[1]), imm: v })];
      }
      case 't,i':
        want(ops, 2, mn, 'rt, imm');
        return [B(mn, { rt: parseReg(ops[0]), imm: imm(ops[1], -32768, 0xffff) })];
      case 't,o(s)': {
        want(ops, 2, mn, 'rt, offset(rs)');
        const m = memOp(ops[1])!;
        return [B(mn, { rt: parseReg(ops[0]), rs: m.rs, imm: m.off })];
      }
      case 's,t,L':
        want(ops, 3, mn, 'rs, rt, label');
        return [B(mn, { rs: parseReg(ops[0]), rt: parseReg(ops[1]), target: target(ops[2]) })];
      case 's,L':
        want(ops, 2, mn, 'rs, label');
        return [B(mn, { rs: parseReg(ops[0]), target: target(ops[1]) })];
      case 'L':
        want(ops, 1, mn, 'label');
        return [B(mn, { target: target(ops[0]) })];
      case '':
        want(ops, 0, mn, 'ไม่มี operand');
        return [B(mn, {})];
    }
  }

  switch (mn) {
    case 'nop':
      want(ops, 0, mn, 'ไม่มี operand');
      return [B('sll', { rd: 0, rt: 0, shamt: 0 })];
    case 'move':
      want(ops, 2, mn, 'rd, rs');
      return [B('addu', { rd: parseReg(ops[0]), rs: parseReg(ops[1]), rt: 0 })];
    case 'neg':
      want(ops, 2, mn, 'rd, rs');
      return [B('sub', { rd: parseReg(ops[0]), rs: 0, rt: parseReg(ops[1]) })];
    case 'not':
      want(ops, 2, mn, 'rd, rs');
      return [B('nor', { rd: parseReg(ops[0]), rs: parseReg(ops[1]), rt: 0 })];
    case 'subi':
      want(ops, 3, mn, 'rt, rs, imm');
      return [B('addi', { rt: parseReg(ops[0]), rs: parseReg(ops[1]), imm: -imm(ops[2], -32767, 32768) })];
    case 'li': {
      want(ops, 2, mn, 'rt, imm');
      const rt = parseReg(ops[0]);
      const v = parseNum(ops[1]);
      if (v == null) fail(`"${ops[1]}" ไม่ใช่ตัวเลข`);
      if (v! < -2147483648 || v! > 0xffffffff) fail(`ค่า ${ops[1]} ใหญ่เกิน 32 บิต`);
      if (fits16s(v!)) return [B('addiu', { rt, rs: 0, imm: v! })];
      if (fits16u(v!)) return [B('ori', { rt, rs: 0, imm: v! })];
      return [B('lui', { rt: at, imm: (v! >>> 16) & 0xffff }), B('ori', { rt, rs: at, imm: v! & 0xffff })];
    }
    case 'la': {
      want(ops, 2, mn, 'rt, label');
      const rt = parseReg(ops[0]);
      const name = target(ops[1]);
      const a = labels ? labels.get(name) : 0;
      if (a == null) fail(`ไม่พบ label "${name}"`);
      return [B('lui', { rt: at, imm: (a! >>> 16) & 0xffff }), B('ori', { rt, rs: at, imm: a! & 0xffff })];
    }
    case 'mul':
      want(ops, 3, mn, 'rd, rs, rt');
      return [B('mult', { rs: parseReg(ops[1]), rt: parseReg(ops[2]) }), B('mflo', { rd: parseReg(ops[0]) })];
    case 'rem':
      want(ops, 3, mn, 'rd, rs, rt');
      return [B('div', { rs: parseReg(ops[1]), rt: parseReg(ops[2]) }), B('mfhi', { rd: parseReg(ops[0]) })];
    case 'b':
      want(ops, 1, mn, 'label');
      return [B('beq', { rs: 0, rt: 0, target: target(ops[0]) })];
    case 'beqz':
    case 'bnez':
      want(ops, 2, mn, 'rs, label');
      return [B(mn === 'beqz' ? 'beq' : 'bne', { rs: parseReg(ops[0]), rt: 0, target: target(ops[1]) })];
    case 'blt':
    case 'bgt':
    case 'ble':
    case 'bge': {
      want(ops, 3, mn, 'rs, rt, label');
      const a = parseReg(ops[0]);
      const b = parseReg(ops[1]);
      const swap = mn === 'bgt' || mn === 'ble';
      const br = mn === 'blt' || mn === 'bgt' ? 'bne' : 'beq';
      return [
        B('slt', { rd: at, rs: swap ? b : a, rt: swap ? a : b }),
        B(br, { rs: at, rt: 0, target: target(ops[2]) }),
      ];
    }
  }
  return fail(`ไม่รู้จักคำสั่ง "${mn}"`);
}

const PSEUDO = new Set(['nop', 'move', 'neg', 'not', 'subi', 'li', 'la', 'mul', 'rem', 'b', 'beqz', 'bnez', 'blt', 'bgt', 'ble', 'bge']);
export const MNEMONICS = new Set([...OP_BY_NAME.keys(), ...PSEUDO]);

// ---------- driver ----------

interface Pending {
  line: number;
  addr: number;
  mn: string;
  ops: string[];
  size: number;
}

export function assemble(src: string): AsmResult {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const errors: AsmError[] = [];
  const labels = new Map<string, number>();
  const labelLine = new Map<string, number>();
  const data = new Map<number, number>();
  const pending: Pending[] = [];
  const dataWords: { addr: number; tok: string; size: number; line: number }[] = [];
  let seg: 'text' | 'data' = 'text';
  let pc = TEXT_BASE;
  let dp = DATA_BASE;

  const putBytes = (addr: number, v: number, size: number) => {
    for (let i = 0; i < size; i++) data.set(addr + i, (v >>> (8 * (size - 1 - i))) & 0xff);
  };
  // data labels not yet followed by any data move along when the next directive aligns
  let fresh: string[] = [];
  const align = (n: number) => {
    dp = Math.ceil(dp / n) * n;
    for (const k of fresh) labels.set(k, dp);
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    try {
      let s = stripComment(raw).trim();
      // labels (possibly several) at the start of the line
      let m: RegExpExecArray | null;
      while ((m = /^([A-Za-z_.][\w.]*)\s*:/.exec(s))) {
        const name = m[1];
        if (labels.has(name)) fail(`label "${name}" ประกาศซ้ำ (ประกาศครั้งแรกที่บรรทัด ${labelLine.get(name)})`);
        labels.set(name, seg === 'text' ? pc : dp);
        labelLine.set(name, line);
        if (seg === 'data') fresh.push(name);
        s = s.slice(m[0].length).trim();
      }
      if (!s) return;
      const sp = s.search(/\s/);
      const head = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
      const rest = sp < 0 ? '' : s.slice(sp + 1).trim();

      if (head.startsWith('.')) {
        const args = splitOps(rest);
        switch (head) {
          case '.text':
            seg = 'text';
            return;
          case '.data':
            seg = 'data';
            return;
          case '.globl':
          case '.global':
          case '.ent':
          case '.end':
            return;
        }
        if (seg !== 'data') fail(`ใช้ ${head} ได้เฉพาะในส่วน .data`);
        switch (head) {
          case '.word':
          case '.half':
          case '.byte': {
            const size = head === '.word' ? 4 : head === '.half' ? 2 : 1;
            align(size);
            fresh = [];
            for (const a of args) {
              const n = /^(.+):(\d+)$/.exec(a);
              const reps = n ? +n[2] : 1;
              const tok = n ? n[1] : a;
              for (let r = 0; r < reps; r++) {
                const v = parseNum(tok);
                if (v == null) {
                  if (size !== 4 || !isLabel(tok)) fail(`"${tok}" ไม่ใช่ตัวเลข`);
                  dataWords.push({ addr: dp, tok, size, line });
                } else putBytes(dp, v, size);
                dp += size;
              }
            }
            return;
          }
          case '.space': {
            const n = parseNum(args[0] ?? '');
            if (n == null || n < 0) fail('.space ต้องตามด้วยจำนวน byte');
            fresh = [];
            for (let k = 0; k < n!; k++) data.set(dp + k, 0);
            dp += n!;
            return;
          }
          case '.align': {
            const n = parseNum(args[0] ?? '');
            if (n == null || n < 0 || n > 8) fail('.align ต้องตามด้วยเลข 0–8');
            align(1 << n!);
            return;
          }
          case '.ascii':
          case '.asciiz': {
            const m2 = /^"((?:[^"\\]|\\.)*)"$/.exec(rest);
            if (!m2) fail(`${head} ต้องตามด้วยข้อความในเครื่องหมาย "..."`);
            const str = unescape(m2![1]) + (head === '.asciiz' ? '\0' : '');
            fresh = [];
            for (const ch of str) data.set(dp++, ch.charCodeAt(0) & 0xff);
            return;
          }
        }
        fail(`ไม่รู้จัก directive "${head}"`);
      }

      if (seg !== 'text') fail('เขียนคำสั่งได้เฉพาะในส่วน .text');
      const ops = splitOps(rest);
      const size = expand(head, ops, null).length;
      pending.push({ line, addr: pc, mn: head, ops, size });
      pc += 4 * size;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      errors.push({ line, msg: e.message });
    }
  });

  const text: AsmInstr[] = [];
  for (const p of pending) {
    try {
      const basics = expand(p.mn, p.ops, labels);
      basics.forEach((b, k) => {
        const addr = p.addr + 4 * k;
        const word = encode(b, addr, labels);
        text.push({
          addr,
          word,
          line: p.line,
          basic: disasm(word, addr, labels),
          pseudo: basics.length === 1 && basics[0].def.name === p.mn ? undefined : p.mn,
        });
      });
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      errors.push({ line: p.line, msg: e.message });
    }
  }
  for (const w of dataWords) {
    const a = labels.get(w.tok);
    if (a == null) errors.push({ line: w.line, msg: `ไม่พบ label "${w.tok}"` });
    else putBytes(w.addr, a, 4);
  }

  if (errors.length) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  return { ok: true, prog: { text, data, labels, source: lines } };
}
