// MIPS → C: lifts assembly into equivalent C, one statement per instruction.
// Registers become int variables, labels become goto targets, jal becomes a call,
// and stack save/restore around $sp turns into comments (C keeps locals for us).

import { assemble, MNEMONICS, type AsmError } from '../mips/assembler';
import { DATA_BASE } from '../mips/isa';

export interface LiftLine {
  text: string;
  /** 1-based MIPS source line this C line came from (0 = generated) */
  m: number;
}

export type LiftResult = { ok: true; lines: LiftLine[] } | { ok: false; errors: AsmError[] };

interface SrcIns {
  line: number;
  labels: string[];
  mn: string;
  ops: string[];
}

function stripComment(s: string) {
  const i = s.indexOf('#');
  return i < 0 ? s : s.slice(0, i);
}

function scan(src: string): { text: SrcIns[]; dataLabels: string[] } {
  const text: SrcIns[] = [];
  const dataLabels: string[] = [];
  let seg = 'text';
  let pending: string[] = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    let s = stripComment(raw).trim();
    let m: RegExpExecArray | null;
    const labels: string[] = [];
    while ((m = /^([A-Za-z_.][\w.]*)\s*:/.exec(s))) {
      labels.push(m[1]);
      s = s.slice(m[0].length).trim();
    }
    if (seg === 'data') dataLabels.push(...labels);
    else pending.push(...labels);
    if (!s) return;
    const sp = s.search(/\s/);
    const mn = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
    if (mn === '.data') seg = 'data';
    else if (mn === '.text') seg = 'text';
    if (mn.startsWith('.') || seg === 'data') return;
    const ops = sp < 0 ? [] : s.slice(sp + 1).split(',').map((x) => x.trim()).filter(Boolean);
    text.push({ line: i + 1, labels: pending, mn, ops });
    pending = [];
  });
  if (pending.length) text.push({ line: 0, labels: pending, mn: '', ops: [] });
  return { text, dataLabels };
}

const reg = (r: string) => (r === '$zero' || r === '$0' ? '0' : r.replace(/^\$/, '').replace(/^(\d+)$/, 'r$1'));

export function liftMips(src: string): LiftResult {
  const asm = assemble(src);
  if (!asm.ok) return { ok: false, errors: asm.errors };
  const { prog } = asm;
  const { text, dataLabels } = scan(src);

  // function entries: the first label, every jal target, and any label nothing
  // jumps to right after a `jr $ra` (a function only called from outside, like main)
  const entries = new Set<string>();
  const first = text.find((t) => t.labels.length)?.labels[0];
  if (first) entries.add(first);
  for (const t of text) if (t.mn === 'jal') entries.add(t.ops[0]);
  const referenced = new Set(text.flatMap((t) => (t.mn === 'jal' ? [] : t.ops.filter((o) => /^[A-Za-z_.][\w.]*$/.test(o)))));
  text.forEach((t, i) => {
    const prev = text[i - 1];
    if (prev?.mn === 'jr' && prev.ops[0] === '$ra') for (const l of t.labels) if (!referenced.has(l)) entries.add(l);
  });

  // split into functions
  type Fn = { name: string; body: SrcIns[]; line: number };
  const fns: Fn[] = [];
  let cur: Fn = { name: first ?? 'program', body: [], line: text[0]?.line ?? 0 };
  for (const t of text) {
    const entry = t.labels.find((l) => entries.has(l));
    if (entry && entry !== cur.name) {
      if (cur.body.length) fns.push(cur);
      cur = { name: entry, body: [], line: t.line };
    }
    cur.body.push(t);
  }
  if (cur.body.length) fns.push(cur);

  // signatures: params are $a regs read before written; returns int if $v0 is written,
  // including by a call to a function that returns a value (repeated until nothing changes)
  const sig = new Map<string, { params: string[]; ret: boolean }>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of fns) {
      const written = new Set<string>();
      const params = new Set<string>();
      let ret = false;
      for (const t of f.body) {
        const [dst, ...srcs] = writesFirst(t.mn) ? t.ops : [null, ...t.ops];
        for (const s of srcs) for (const r of regsIn(s ?? '')) if (/^\$a[0-3]$/.test(r) && !written.has(r)) params.add(r);
        if (dst && dst.startsWith('$')) {
          written.add(dst);
          if (dst === '$v0') ret = true;
        }
        if (t.mn === 'jal' && sig.get(t.ops[0])?.ret) ret = true;
      }
      const n = Math.max(-1, ...[...params].map((r) => +r[2])) + 1;
      const next = { params: Array.from({ length: n }, (_, i) => 'a' + i), ret };
      const prev = sig.get(f.name);
      if (!prev || prev.ret !== next.ret || prev.params.length !== next.params.length) changed = true;
      sig.set(f.name, next);
    }
  }

  const out: LiftLine[] = [];
  const push = (text: string, m = 0) => out.push({ text, m });
  const usesMem = text.some((t) => /^(lw|sw|lh|lhu|sh|lb|lbu|sb)$/.test(t.mn) && !/\(\$sp\)/.test(t.ops[1] ?? ''));
  const usesHiLo = text.some((t) => /^(mult|multu|div|divu|mfhi|mflo|mthi|mtlo)$/.test(t.mn) && t.ops.length < 3);
  if (usesMem) {
    push('#define MEM32(a) (*(int *)(a))');
    if (text.some((t) => /^(lb|lbu|sb|lh|lhu|sh)$/.test(t.mn))) {
      push('#define MEM16(a) (*(short *)(a))');
      push('#define MEM8(a)  (*(signed char *)(a))');
    }
    push('');
  }
  for (const d of dataLabels) {
    const addr = prog.labels.get(d)!;
    const words: number[] = [];
    for (let a = addr; a < addr + 4 * 64 && prog.data.has(a); a += 4) {
      let v = 0;
      for (let k = 0; k < 4; k++) v = (v << 8) | (prog.data.get(a + k) ?? 0);
      words.push(v | 0);
      const next = [...prog.labels.values()].some((x) => x === a + 4 && x !== addr && x >= DATA_BASE);
      if (next) break;
    }
    push(`int ${cname(d)}[] = { ${words.join(', ')} };`);
  }
  if (dataLabels.length) push('');
  if (usesHiLo) {
    push('int hi, lo;  // register พิเศษสำหรับผลคูณ/หาร');
    push('');
  }

  for (const f of fns) {
    const s = sig.get(f.name)!;
    const frame = stackFrame(f.body);
    const locals = new Set<string>();
    for (const t of f.body)
      for (const o of t.ops)
        for (const r of regsIn(o)) {
          const v = reg(r);
          if (v !== '0' && v !== 'sp' && v !== 'ra' && !s.params.includes(v) && v !== 'at') locals.add(v);
        }
    if (s.ret || f.body.some((t) => t.mn === 'jal' && sig.get(t.ops[0])?.ret)) locals.add('v0');
    push(`${s.ret ? 'int' : 'void'} ${cname(f.name)}(${s.params.map((p) => 'int ' + p).join(', ') || 'void'}) {`, f.line);
    const sorted = [...locals].sort(regOrder);
    const slots = [...new Set(f.body.map((_, i) => frame.slotVar(i)).filter((x): x is string => !!x))].sort();
    if (sorted.length || slots.length) push(`    int ${[...sorted, ...slots].join(', ')};`);
    if (frame.real) {
      push(`    int frame[${frame.size / 4}];  // พื้นที่ stack ของฟังก์ชันนี้`);
      push(`    int sp = (int)frame + ${frame.size};`);
    }
    f.body.forEach((t, i) => {
      for (const l of t.labels) if (l !== f.name) push(`${cname(l)}:${t.mn ? '' : ' ;'}`, t.line);
      if (t.mn) push('    ' + stmt(t, s.ret, sig, { real: frame.real, slot: frame.slotVar(i) }), t.line);
    });
    push('}');
    push('');
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return { ok: true, lines: out };
}

const C_KEYWORDS = new Set(
  'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(' '),
);

/** A MIPS label as a C identifier: dots become underscores, keywords get a trailing underscore. */
export function cname(label: string) {
  const s = label.replace(/\./g, '_');
  return C_KEYWORDS.has(s) ? s + '_' : s;
}

/**
 * How a function uses the stack. Usually every `n($sp)` slot can become its own
 * C variable (a save of $ra or of a saved register that is only ever restored to
 * itself stays a comment, since C keeps those for us). When $sp itself is used as
 * a value — the address of a local array — the stack is modelled for real:
 * `frame[]` plus an `sp` variable, and the slots become MEM32(sp + n).
 */
function stackFrame(body: SrcIns[]) {
  const spAdjust = (t: SrcIns) => /^(addi|addiu|add|addu|subi|sub|subu)$/.test(t.mn) && t.ops[0] === '$sp' && t.ops[1] === '$sp' && /^-?\d+$/.test(t.ops[2] ?? '');
  const spSlot = (t: SrcIns) => (/^(lw|sw)$/.test(t.mn) ? /^(-?\d*)\(\$sp\)$/.exec(t.ops[1] ?? '') : null);
  let sp = 0;
  let low = 0;
  const at: (number | null)[] = [];
  const io = new Map<number, Set<string>>();
  let real = false;
  for (const t of body) {
    const m = spSlot(t);
    if (m) {
      const slot = sp + (Number(m[1]) || 0);
      at.push(slot);
      io.set(slot, (io.get(slot) ?? new Set()).add(t.ops[0]));
    } else {
      at.push(null);
      if (!spAdjust(t) && t.ops.some((o, k) => (k > 0 || !writesFirst(t.mn)) && regsIn(o).includes('$sp'))) real = true;
      if (/^(sb|sh|lb|lbu|lh|lhu)$/.test(t.mn) && /\(\$sp\)$/.test(t.ops[1] ?? '')) real = true;
    }
    if (spAdjust(t)) sp += (t.mn.startsWith('sub') ? -1 : 1) * Number(t.ops[2]);
    low = Math.min(low, sp);
  }
  const SAVED = /^\$(ra|fp|s[0-7])$/;
  const comment = (slot: number) => {
    const regs = io.get(slot)!;
    return regs.size === 1 && SAVED.test([...regs][0]);
  };
  return {
    real,
    size: Math.max(4, Math.ceil(-low / 4) * 4),
    /** C variable for the stack slot instruction `i` touches; null when it is a plain save / restore */
    slotVar(i: number): string | null {
      const slot = at[i];
      if (slot == null || real || comment(slot)) return null;
      return slot < 0 ? `stack_${-slot}` : `caller_${slot}`;
    },
  };
}

function regOrder(a: string, b: string) {
  const rank = (r: string) => 'vatsk'.indexOf(r[0]) * 100 + (parseInt(r.slice(1)) || 0);
  return rank(a) - rank(b);
}

function regsIn(op: string): string[] {
  return op.match(/\$\w+/g) ?? [];
}

const WRITE_FIRST = new Set([
  'add', 'addu', 'sub', 'subu', 'and', 'or', 'xor', 'nor', 'slt', 'sltu', 'sll', 'srl', 'sra', 'sllv', 'srlv', 'srav',
  'addi', 'addiu', 'andi', 'ori', 'xori', 'slti', 'sltiu', 'lui', 'lw', 'lh', 'lhu', 'lb', 'lbu', 'mfhi', 'mflo',
  'li', 'la', 'move', 'neg', 'not', 'mul', 'rem', 'subi', 'll', 'sc',
]);
const writesFirst = (mn: string) => WRITE_FIRST.has(mn);

function stmt(
  t: SrcIns,
  retInt: boolean,
  sig: Map<string, { params: string[]; ret: boolean }>,
  frame: { real: boolean; slot: string | null },
): string {
  const o = t.ops.map((x, i) => (/^[A-Za-z_.][\w.]*$/.test(x) && !x.startsWith('$') && (i === t.ops.length - 1 || t.mn === 'la') ? cname(x) : x));
  const r = (i: number) => {
    const x = o[i] ?? '';
    return x.startsWith('$') ? reg(x) : x;
  };
  const mem = (x: string) => {
    const m = /^(-?\w*)\((\$\w+)\)$/.exec(x);
    if (!m) return `(int)${x}`;
    const base = reg(m[2]);
    const off = m[1] && m[1] !== '0' ? (m[1].startsWith('-') ? ` - ${m[1].slice(1)}` : ` + ${m[1]}`) : '';
    return base === '0' ? m[1] || '0' : base + off;
  };
  const isSp = (x: string | undefined) => !!x && /\(\$sp\)$/.test(x);
  const BIN: Record<string, string> = {
    add: '+', addu: '+', sub: '-', subu: '-', and: '&', or: '|', xor: '^', sllv: '<<', srav: '>>',
    addi: '+', addiu: '+', andi: '&', ori: '|', xori: '^', mul: '*', rem: '%',
  };
  const mn = t.mn;

  if (mn in BIN && o.length === 3) {
    const [d, a, b] = [r(0), r(1), r(2)];
    const op = BIN[mn];
    if (d === 'sp' && frame.real) return op === '+' && b.startsWith('-') ? `sp -= ${b.slice(1)};` : `sp ${op}= ${b};`;
    if (d === 'sp') return `// ${op === '+' && !b.startsWith('-') ? 'คืน' : 'จอง'}พื้นที่ stack (C จัดการตัวแปรให้อัตโนมัติ)`;
    if (a === '0' && op === '+') return `${d} = ${b};`;
    if (b === '0' && (op === '+' || op === '-' || op === '|')) return `${d} = ${a};`;
    if (a === d && (op === '+' || op === '-')) {
      if (b === '1') return `${d}${op}${op};`;
      if (b.startsWith('-') && op === '+') return `${d} -= ${b.slice(1)};`;
      return `${d} ${op}= ${b};`;
    }
    if (op === '+' && b.startsWith('-')) return `${d} = ${a} - ${b.slice(1)};`;
    return `${d} = ${a} ${op} ${b};`;
  }
  switch (mn) {
    case 'subi':
      return `${r(0)} = ${r(1)} - ${r(2)};`;
    case 'nor':
      return r(2) === '0' ? `${r(0)} = ~${r(1)};` : `${r(0)} = ~(${r(1)} | ${r(2)});`;
    case 'slt':
    case 'slti':
      return `${r(0)} = ${r(1)} < ${r(2)};`;
    case 'sltu':
    case 'sltiu':
      return `${r(0)} = (unsigned)${r(1)} < (unsigned)${r(2)};`;
    case 'sll':
      return o[0] === '$zero' && o[2] === '0' ? ';  // nop' : `${r(0)} = ${r(1)} << ${r(2)};`;
    case 'sra':
      return `${r(0)} = ${r(1)} >> ${r(2)};`;
    case 'srl':
    case 'srlv':
      return `${r(0)} = (int)((unsigned)${r(1)} >> ${r(2)});`;
    case 'lui':
      return `${r(0)} = ${r(1)} << 16;`;
    case 'li':
    case 'move':
      return `${r(0)} = ${r(1)};`;
    case 'la':
      return `${r(0)} = (int)${o[1]};`;
    case 'neg':
      return `${r(0)} = -${r(1)};`;
    case 'not':
      return `${r(0)} = ~${r(1)};`;
    case 'lw':
    case 'lh':
    case 'lhu':
    case 'lb':
    case 'lbu': {
      if (isSp(o[1]) && (o[0] === '$ra' || !frame.real)) return frame.slot ? `${r(0)} = ${frame.slot};` : `// คืนค่า $${r(0)} จาก stack`;
      const M = mn === 'lw' ? 'MEM32' : mn.startsWith('lh') ? 'MEM16' : 'MEM8';
      const cast = mn === 'lbu' ? '(unsigned char)' : mn === 'lhu' ? '(unsigned short)' : '';
      return `${r(0)} = ${cast}${M}(${mem(o[1])});`;
    }
    case 'll':
      return `${r(0)} = MEM32(${mem(o[1])}); // ll: จอง address นี้ไว้`;
    case 'sc':
      return `${r(0)} = store_conditional(&MEM32(${mem(o[1])}), ${r(0)}); // 1 = เขียนสำเร็จ, 0 = ไม่ได้เขียน`;
    case 'sw':
    case 'sh':
    case 'sb': {
      if (isSp(o[1]) && (o[0] === '$ra' || !frame.real)) return frame.slot ? `${frame.slot} = ${r(0)};` : `// บันทึก $${r(0)} ลง stack`;
      const M = mn === 'sw' ? 'MEM32' : mn === 'sh' ? 'MEM16' : 'MEM8';
      return `${M}(${mem(o[1])}) = ${r(0)};`;
    }
    case 'mult':
    case 'multu':
      return `lo = ${r(0)} * ${r(1)}; hi = (int)(((long long)${r(0)} * ${r(1)}) >> 32);`;
    case 'div':
    case 'divu':
      return o.length === 3 ? `${r(0)} = ${r(1)} / ${r(2)};` : `lo = ${r(0)} / ${r(1)}; hi = ${r(0)} % ${r(1)};`;
    case 'mfhi':
      return `${r(0)} = hi;`;
    case 'mflo':
      return `${r(0)} = lo;`;
    case 'mthi':
      return `hi = ${r(0)};`;
    case 'mtlo':
      return `lo = ${r(0)};`;
    case 'beq':
    case 'bne':
    case 'blt':
    case 'bgt':
    case 'ble':
    case 'bge': {
      const sym = { beq: '==', bne: '!=', blt: '<', bgt: '>', ble: '<=', bge: '>=' }[mn];
      return `if (${r(0)} ${sym} ${r(1)}) goto ${o[2]};`;
    }
    case 'beqz':
      return `if (${r(0)} == 0) goto ${o[1]};`;
    case 'bnez':
      return `if (${r(0)} != 0) goto ${o[1]};`;
    case 'blez':
    case 'bgtz':
    case 'bltz':
    case 'bgez': {
      const sym = { blez: '<=', bgtz: '>', bltz: '<', bgez: '>=' }[mn];
      return `if (${r(0)} ${sym} 0) goto ${o[1]};`;
    }
    case 'j':
    case 'b':
      return `goto ${o[0]};`;
    case 'jal': {
      const s = sig.get(t.ops[0]);
      const call = `${o[0]}(${(s?.params ?? []).join(', ')})`;
      return s?.ret ? `v0 = ${call};` : `${call};`;
    }
    case 'jr':
      return o[0] === '$ra' ? (retInt ? 'return v0;' : 'return;') : `goto *(void *)${r(0)};  // กระโดดตาม address`;
    case 'jalr':
      return `((void (*)(void))${r(o.length - 1)})();`;
    case 'syscall':
      return 'syscall();  // ขอบริการจากระบบ ตามหมายเลขใน v0';
    case 'nop':
      return ';  // nop';
  }
  return MNEMONICS.has(mn) ? `/* ${mn} ${o.join(', ')} */` : `/* ? ${mn} */`;
}
