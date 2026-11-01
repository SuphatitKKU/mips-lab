// End-to-end tests for both directions of the converter.
//
//  A. C → MIPS on real programs: compile, run on the CPU, compare with a JS
//     reference that follows C's 32-bit semantics; also checks the calling
//     convention ($sp restored, $s0–$s7 preserved).
//  B. Fuzzing: random expressions and random little programs, same check.
//  C. MIPS → C: everything from A and B is lifted back to C and run by a tiny
//     interpreter for the lifted dialect; it must give what the CPU gave.
//  D. Hand-written MIPS (the problem bank's answers) lifted to C, same check.
//  E. What the subset does not support must fail with a message, never crash
//     or compile to something silently wrong.

import { describe, expect, it } from 'vitest';
import { PROBLEMS, type MipsTest } from '../../data/problems';
import { assemble } from '../mips/assembler';
import { Cpu, layoutArrays } from '../mips/cpu';
import { compileC } from './compile';
import { liftMips } from './lift';

const ARR = 0x10040000;
type Arg = number | number[];

// ---------- C semantics in JS (32-bit two's complement) ----------

const i32 = (x: number) => x | 0;
const mul = (a: number, b: number) => Math.imul(a, b);
const div = (a: number, b: number) => i32(Math.trunc(a / b));
const rem = (a: number, b: number) => i32(a % b);
const shl = (a: number, b: number) => a << (b & 31);
const sar = (a: number, b: number) => a >> (b & 31);
const B = (x: boolean) => (x ? 1 : 0);

// ---------- running compiled code on the CPU ----------

interface Run {
  v0: number;
  arrays: number[][];
}

function runAsm(asm: string, fn: string, args: Arg[]): Run {
  const a = assemble(asm);
  if (!a.ok) throw new Error('assemble: ' + JSON.stringify(a.errors));
  const arrays = args.filter(Array.isArray) as number[][];
  const { mem, addrs } = layoutArrays(arrays, ARR);
  const regs: Record<string, number> = {};
  let k = 0;
  args.forEach((v, i) => (regs['a' + i] = Array.isArray(v) ? addrs[k++] : v));
  const cpu = new Cpu(a.prog, { regs, mem, history: false, entry: fn });
  const sp0 = cpu.r[29];
  const s0 = Array.from(cpu.r.slice(16, 24));
  const h = cpu.run(3_000_000);
  if (h?.kind !== 'return') throw new Error(`${fn}: ${h?.msg}`);
  if (cpu.r[29] !== sp0) throw new Error(`${fn}: $sp not restored`);
  if (s0.some((v, i) => cpu.r[16 + i] !== v)) throw new Error(`${fn}: $s registers not preserved`);
  return { v0: cpu.r[2], arrays: arrays.map((arr, i) => arr.map((_, j) => cpu.readWord(addrs[i] + 4 * j))) };
}

function compile(src: string): string {
  const c = compileC(src);
  if (!c.ok) throw new Error('compile: ' + JSON.stringify(c.errors));
  return c.asm;
}

// ---------- an interpreter for the C that liftMips writes ----------

const C_KEYWORDS = new Set(
  'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(' '),
);

type Val = { t: 'i' | 'u'; v: number } | { t: 'L'; v: bigint };
const I = (v: number): Val => ({ t: 'i', v: v | 0 });
const U = (v: number): Val => ({ t: 'u', v: v >>> 0 });
const num = (x: Val) => (x.t === 'L' ? Number(BigInt.asIntN(32, x.v)) : x.v);
const big = (x: Val) => (x.t === 'L' ? x.v : x.t === 'u' ? BigInt(x.v >>> 0) : BigInt(x.v | 0));

interface Fn {
  name: string;
  params: string[];
  locals: string[];
  /** local arrays (words) and initialised locals, in declaration order */
  arrays: [name: string, words: number][];
  inits: [name: string, expr: string][];
  stmts: { s: string; line: number }[];
  labels: Map<string, number>;
}

/** Checks the lifted text is well-formed C and returns its functions. */
function parseLifted(text: string[]): { fns: Map<string, Fn>; globals: Map<string, number[]>; problems: string[] } {
  const fns = new Map<string, Fn>();
  const globals = new Map<string, number[]>();
  const problems: string[] = [];
  let cur: Fn | null = null;
  text.forEach((raw, line) => {
    const s = raw.replace(/\/\/.*$/, '').trim();
    if (!s || s.startsWith('#')) return;
    let m: RegExpExecArray | null;
    if (!cur) {
      if ((m = /^int (\w+)\[\] = \{ (.*) \};$/.exec(s))) return void globals.set(m[1], m[2].split(',').map((x) => Number(x.trim())));
      if (s === 'int hi, lo;') return;
      if ((m = /^(int|void) (\w+)\((.*)\) \{$/.exec(s))) {
        if (C_KEYWORDS.has(m[2])) problems.push(`function named with keyword "${m[2]}"`);
        if (fns.has(m[2])) problems.push(`function ${m[2]} defined twice`);
        const params = m[3] === 'void' ? [] : m[3].split(',').map((p) => p.trim().replace(/^int /, ''));
        cur = { name: m[2], params, locals: [], arrays: [], inits: [], stmts: [], labels: new Map() };
        return;
      }
      problems.push(`line ${line + 1} outside any function: ${s}`);
      return;
    }
    if (s === '}') {
      fns.set(cur.name, cur);
      cur = null;
      return;
    }
    if ((m = /^int ([\w, ]+);$/.exec(s)) && !cur.stmts.length) return void cur.locals.push(...m[1].split(',').map((x) => x.trim()));
    if ((m = /^int (\w+)\[(\d+)\];$/.exec(s)) && !cur.stmts.length) return void cur.arrays.push([m[1], +m[2]]);
    if ((m = /^int (\w+) = (.+);$/.exec(s)) && !cur.stmts.length) return void cur.inits.push([m[1], m[2]]);
    if (/^(int|void) \w+\(.*\) \{$/.test(s)) problems.push(`function header inside ${cur.name}: ${s}`);
    if ((m = /^(\w+):\s*;?$/.exec(s))) {
      if (C_KEYWORDS.has(m[1])) problems.push(`label "${m[1]}" is a C keyword`);
      if (cur.labels.has(m[1])) problems.push(`label ${m[1]} twice in ${cur.name}`);
      cur.labels.set(m[1], cur.stmts.length);
      return;
    }
    for (const part of s.split(';').map((x) => x.trim())) if (part) cur.stmts.push({ s: part, line: line + 1 });
  });
  if (cur) problems.push(`function ${(cur as Fn).name} never closed`);
  for (const f of fns.values()) {
    for (const v of [...f.params, ...f.locals]) if (C_KEYWORDS.has(v)) problems.push(`variable "${v}" is a C keyword`);
    for (const { s } of f.stmts) {
      const g = /goto (\w+)$/.exec(s);
      if (g && !f.labels.has(g[1])) problems.push(`goto ${g[1]} has no label in ${f.name}`);
      for (const c of s.matchAll(/\b([A-Za-z_]\w*)\(/g)) if (!/^MEM(8|16|32)$/.test(c[1]) && !fns.has(c[1]) && !text.some((t) => t.startsWith(`int ${c[1]}(`) || t.startsWith(`void ${c[1]}(`))) problems.push(`call to undefined ${c[1]}`);
    }
  }
  return { fns, globals, problems };
}

class LiftedRunner {
  mem = new Map<number, number>();
  hi = I(0);
  lo = I(0);
  steps = 0;
  private addr = new Map<string, number>();
  constructor(
    private fns: Map<string, Fn>,
    globals: Map<string, number[]>,
    labels: Map<string, number>,
  ) {
    for (const [g, words] of globals) {
      const base = labels.get(g)!;
      this.addr.set(g, base);
      words.forEach((w, i) => this.store(base + 4 * i, w, 4));
    }
  }
  load(a: number, n: number) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 8) | (this.mem.get((a + i) >>> 0) ?? 0);
    return n === 4 ? v | 0 : n === 2 ? (v << 16) >> 16 : (v << 24) >> 24;
  }
  store(a: number, v: number, n: number) {
    for (let i = 0; i < n; i++) this.mem.set((a + i) >>> 0, (v >>> (8 * (n - 1 - i))) & 0xff);
  }

  call(name: string, args: number[]): number {
    const f = this.fns.get(name);
    if (!f) throw new Error(`no function ${name}`);
    const env = new Map<string, Val>();
    for (const v of f.locals) env.set(v, I(0));
    f.params.forEach((p, i) => env.set(p, I(args[i] ?? 0)));
    const stackTop = this.stackTop;
    for (const [a, words] of f.arrays) {
      this.stackTop -= 4 * words;
      env.set(a, I(this.stackTop));
    }
    for (const [v, e] of f.inits) env.set(v, this.eval(e, env));
    try {
      return this.exec(f, env);
    } finally {
      this.stackTop = stackTop;
    }
  }

  private stackTop = 0x7f000000;

  private exec(f: Fn, env: Map<string, Val>): number {
    const name = f.name;
    let pc = 0;
    while (pc < f.stmts.length) {
      if (++this.steps > 20_000_000) throw new Error('lifted program runs too long');
      const s = f.stmts[pc++].s;
      let m: RegExpExecArray | null;
      if ((m = /^goto (\w+)$/.exec(s))) pc = f.labels.get(m[1])!;
      else if ((m = /^if \((.*)\) goto (\w+)$/.exec(s))) {
        if (num(this.eval(m[1], env))) pc = f.labels.get(m[2])!;
      } else if ((m = /^return(?: (.*))?$/.exec(s))) return m[1] ? num(this.eval(m[1], env)) : 0;
      else if ((m = /^(\w+)(\+\+|--)$/.exec(s))) env.set(m[1], I(num(env.get(m[1])!) + (m[2] === '++' ? 1 : -1)));
      else if ((m = /^MEM(32|16|8)\((.*)\) = (.+)$/.exec(s))) this.store(num(this.eval(m[2], env)) >>> 0, num(this.eval(m[3], env)), +m[1] / 8);
      else if ((m = /^(\w+) (<<|>>|[+\-*/%&|^])?= (.+)$/.exec(s))) {
        const rhs = this.eval(m[2] ? `${m[1]} ${m[2]} (${m[3]})` : m[3], env);
        const v = rhs.t === 'L' ? I(num(rhs)) : rhs.t === 'u' ? I(rhs.v) : rhs;
        if (m[1] === 'hi') this.hi = v;
        else if (m[1] === 'lo') this.lo = v;
        else if (env.has(m[1])) env.set(m[1], v);
        else throw new Error(`assign to unknown ${m[1]} in ${name}`);
      } else this.eval(s, env); // bare call
    }
    return 0;
  }

  eval(src: string, env: Map<string, Val>): Val {
    const toks = src.match(/0x[0-9a-fA-F]+|\d+|[A-Za-z_]\w*|<<|>>|<=|>=|==|!=|&&|\|\||\S/g) ?? [];
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const take = (t: string) => (toks[p] === t ? (p++, true) : false);
    const CASTS: Record<string, (v: Val) => Val> = {
      int: (v) => I(num(v)),
      unsigned: (v) => U(num(v)),
      'long long': (v) => ({ t: 'L', v: big(v) }),
      'unsigned char': (v) => I(num(v) & 0xff),
      'unsigned short': (v) => I(num(v) & 0xffff),
      'void *': (v) => I(num(v)),
    };
    const primary = (): Val => {
      if (take('(')) {
        // cast?
        let k = p;
        const words: string[] = [];
        while (toks[k] && toks[k] !== ')') words.push(toks[k++]);
        const ty = words.join(' ');
        if (ty in CASTS && toks[k] === ')') {
          p = k + 1;
          return CASTS[ty](unary());
        }
        const v = expr(0);
        if (!take(')')) throw new Error(`expected ) in ${src}`);
        return v;
      }
      const t = next();
      if (t === undefined) throw new Error(`unexpected end in ${src}`);
      if (/^(0x|\d)/.test(t)) return I(Number(t));
      if (/^MEM(32|16|8)$/.test(t)) {
        take('(');
        const a = num(expr(0)) >>> 0;
        take(')');
        return I(this.load(a, +t.slice(3) / 8));
      }
      if (peek() === '(' && this.fns.has(t)) {
        p++;
        const args: number[] = [];
        if (!take(')')) {
          do args.push(num(expr(0)));
          while (take(','));
          take(')');
        }
        return I(this.call(t, args));
      }
      if (t === 'hi') return this.hi;
      if (t === 'lo') return this.lo;
      if (env.has(t)) return env.get(t)!;
      if (this.addr.has(t)) return I(this.addr.get(t)!);
      throw new Error(`unknown name ${t} in ${src}`);
    };
    const unary = (): Val => {
      if (take('-')) {
        const v = unary();
        return v.t === 'L' ? { t: 'L', v: BigInt.asIntN(64, -v.v) } : v.t === 'u' ? U(-v.v) : I(-v.v);
      }
      if (take('~')) {
        const v = unary();
        return v.t === 'u' ? U(~v.v) : I(~num(v));
      }
      if (take('!')) return I(B(!num(unary())));
      return primary();
    };
    const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const bin = (op: string, a: Val, b: Val): Val => {
      if (a.t === 'L' || b.t === 'L') {
        const x = big(a);
        const y = big(b);
        const r: Record<string, () => bigint> = { '*': () => x * y, '+': () => x + y, '-': () => x - y, '>>': () => x >> y, '<<': () => x << y };
        if (!(op in r)) throw new Error(`long long ${op}`);
        return { t: 'L', v: BigInt.asIntN(64, r[op]()) };
      }
      const uns = op === '<<' || op === '>>' ? a.t === 'u' : a.t === 'u' || b.t === 'u';
      const x = uns ? a.v >>> 0 : a.v | 0;
      const y = uns ? b.v >>> 0 : b.v | 0;
      const wrap = (r: number) => (uns ? U(r) : I(r));
      switch (op) {
        case '+': return wrap(x + y);
        case '-': return wrap(x - y);
        case '*': return wrap(Math.imul(x, y));
        case '/': return wrap(Math.trunc(x / y));
        case '%': return wrap(x % y);
        case '&': return wrap(x & y);
        case '|': return wrap(x | y);
        case '^': return wrap(x ^ y);
        case '<<': return wrap(x << (y & 31));
        case '>>': return wrap(uns ? x >>> (y & 31) : x >> (y & 31));
        case '<': return I(B(x < y));
        case '<=': return I(B(x <= y));
        case '>': return I(B(x > y));
        case '>=': return I(B(x >= y));
        case '==': return I(B(x === y));
        case '!=': return I(B(x !== y));
        case '&&': return I(B(!!x && !!y));
        case '||': return I(B(!!x || !!y));
      }
      throw new Error(`operator ${op}`);
    };
    const expr = (min: number): Val => {
      let l = unary();
      while (peek() in PREC && PREC[peek()] > min) {
        const op = next();
        l = bin(op, l, expr(PREC[op]));
      }
      return l;
    };
    const v = expr(0);
    if (p !== toks.length) throw new Error(`junk after expression: ${src}`);
    return v;
  }
}

/** Lifts `asm` to C, checks the C is well-formed, then runs `fn` in it. */
function runLifted(asm: string, fn: string, args: Arg[]): Run {
  const l = liftMips(asm);
  if (!l.ok) throw new Error('lift: ' + JSON.stringify(l.errors));
  const a = assemble(asm);
  if (!a.ok) throw new Error('assemble');
  const { fns, globals, problems } = parseLifted(l.lines.map((x) => x.text));
  if (problems.length) throw new Error('lifted C is not valid:\n  ' + problems.join('\n  '));
  const r = new LiftedRunner(fns, globals, a.prog.labels);
  const arrays = args.filter(Array.isArray) as number[][];
  const { mem, addrs } = layoutArrays(arrays, ARR);
  for (const [k, v] of mem) r.mem.set(k, v);
  let k = 0;
  const v0 = r.call(fn, args.map((v) => (Array.isArray(v) ? addrs[k++] : v)));
  return { v0, arrays: arrays.map((arr, i) => arr.map((_, j) => r.load(addrs[i] + 4 * j, 4))) };
}

// ---------- A. real programs ----------

interface Case {
  name: string;
  src: string;
  fn: string;
  /** reference: gets copies of the array arguments and may change them */
  ref: (...args: never[]) => number;
  inputs: Arg[][];
}

const ARRS = [[5, 3, 9, 1, 7], [-4, 0, 12, -4, 8, 3, 3], [42], [2, 1], [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1]];

const CASES: Case[] = [
  {
    name: 'arithmetic with negative division and overflow',
    src: 'int f(int a, int b) { return a * b - a / b + a % b; }',
    fn: 'f',
    ref: (a: number, b: number) => i32(i32(mul(a, b) - div(a, b)) + rem(a, b)),
    inputs: [[7, 2], [-7, 2], [7, -2], [-7, -2], [2147483647, 2], [-2147483647, 3], [100000, 100000], [0, 5]],
  },
  {
    name: 'bitwise operators and arithmetic shift',
    src: 'int f(int a, int b) { return ((a & b) | (a ^ ~b)) + (a << 3) + (a >> 2) - (b >> 31); }',
    fn: 'f',
    ref: (a: number, b: number) => i32(i32(i32((a & b) | (a ^ ~b)) + shl(a, 3)) + sar(a, 2) - sar(b, 31)),
    inputs: [[12, 10], [-1, 0], [-100, 7], [0x12345678, -2], [-2147483648, 1]],
  },
  {
    name: 'every comparison',
    src: 'int f(int a, int b) { return (a < b) + (a <= b) * 2 + (a > b) * 4 + (a >= b) * 8 + (a == b) * 16 + (a != b) * 32; }',
    fn: 'f',
    ref: (a: number, b: number) => B(a < b) + B(a <= b) * 2 + B(a > b) * 4 + B(a >= b) * 8 + B(a === b) * 16 + B(a !== b) * 32,
    inputs: [[1, 2], [2, 1], [3, 3], [-1, 1], [-2147483648, 2147483647]],
  },
  {
    name: '&& and || short-circuit (side effects on a global)',
    src: 'int cnt; int bump(int r) { cnt = cnt + 1; return r; } int f(int a) { cnt = 0; if (a && bump(1)) cnt = cnt + 10; if (a || bump(0)) cnt = cnt + 100; if (!a && bump(1)) cnt = cnt + 1000; return cnt; }',
    fn: 'f',
    ref: (a: number) => {
      let c = 0;
      if (a) c += 1 + 10;
      if (a) c += 100;
      else c += 1;
      if (!a) c += 1 + 1000;
      return c;
    },
    inputs: [[0], [1], [-5]],
  },
  {
    name: 'nested ternary',
    src: 'int f(int a) { return a > 0 ? (a > 10 ? 2 : 1) : (a < 0 ? -1 : 0); }',
    fn: 'f',
    ref: (a: number) => (a > 0 ? (a > 10 ? 2 : 1) : a < 0 ? -1 : 0),
    inputs: [[-3], [0], [5], [11], [10]],
  },
  {
    name: 'compound assignment operators',
    src: 'int f(int a) { a += 7; a -= 2; a *= 3; a /= 2; a %= 1000; a <<= 2; a >>= 1; a &= 0xFFF; a |= 1; a ^= 5; return a; }',
    fn: 'f',
    ref: (a: number) => {
      a = i32(a + 7); a = i32(a - 2); a = mul(a, 3); a = div(a, 2); a = rem(a, 1000);
      a = shl(a, 2); a = sar(a, 1); a &= 0xfff; a |= 1; a ^= 5;
      return a;
    },
    inputs: [[0], [123], [-77], [99999]],
  },
  {
    name: 'pre / post increment and decrement',
    src: 'int f(int a) { int b = a++; int c = ++a; int d = a--; int e = --a; return b * 1000 + c * 100 + d * 10 + e; }',
    fn: 'f',
    ref: (a: number) => a * 1000 + (a + 2) * 100 + (a + 2) * 10 + a,
    inputs: [[0], [3], [-4]],
  },
  {
    name: 'while / for / do-while with break and continue',
    src: `int f(int n) {
  int s = 0;
  for (int i = 0; i < n; i++) { if (i % 3 == 0) continue; if (i > 20) break; s += i; }
  int k = 0;
  while (1) { k++; if (k >= n) break; }
  int d = 0;
  do { d += 2; } while (d < n);
  return s * 10000 + k * 100 + d;
}`,
    fn: 'f',
    ref: (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) { if (i % 3 === 0) continue; if (i > 20) break; s += i; }
      let k = 0;
      for (;;) { k++; if (k >= n) break; }
      let d = 0;
      do d += 2; while (d < n);
      return s * 10000 + k * 100 + d;
    },
    inputs: [[1], [7], [30], [0]],
  },
  {
    name: 'nested loops: pairs with sum divisible by 3',
    src: 'int f(int n) { int c = 0; for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) if ((i + j) % 3 == 0) c++; return c; }',
    fn: 'f',
    ref: (n: number) => {
      let c = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if ((i + j) % 3 === 0) c++;
      return c;
    },
    inputs: [[0], [5], [40]],
  },
  {
    name: 'Collatz steps',
    src: 'int f(int n) { int s = 0; while (n != 1) { if (n % 2 == 0) n = n / 2; else n = 3 * n + 1; s++; } return s; }',
    fn: 'f',
    ref: (n: number) => {
      let s = 0;
      while (n !== 1) { n = n % 2 === 0 ? n / 2 : 3 * n + 1; s++; }
      return s;
    },
    inputs: [[1], [6], [27], [97]],
  },
  {
    name: 'count primes (nested loop, early exit)',
    src: 'int isprime(int n) { if (n < 2) return 0; for (int d = 2; d * d <= n; d++) if (n % d == 0) return 0; return 1; } int f(int n) { int c = 0; for (int i = 0; i <= n; i++) c += isprime(i); return c; }',
    fn: 'f',
    ref: (n: number) => {
      let c = 0;
      for (let i = 2; i <= n; i++) { let p = 1; for (let d = 2; d * d <= i; d++) if (i % d === 0) { p = 0; break; } c += p; }
      return c;
    },
    inputs: [[1], [2], [100], [500]],
  },
  {
    name: 'recursive and iterative gcd agree',
    src: 'int rg(int a, int b) { if (b == 0) return a; return rg(b, a % b); } int ig(int a, int b) { while (b) { int t = a % b; a = b; b = t; } return a; } int f(int a, int b) { return rg(a, b) * 1000 + ig(a, b); }',
    fn: 'f',
    ref: (a: number, b: number) => {
      const g = (x: number, y: number): number => (y === 0 ? x : g(y, x % y));
      return g(a, b) * 1000 + g(a, b);
    },
    inputs: [[12, 18], [17, 5], [0, 9], [1071, 462]],
  },
  {
    name: 'recursive fibonacci (two calls, value kept across them)',
    src: 'int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }',
    fn: 'fib',
    ref: (n: number) => {
      let a = 0, b = 1;
      for (let i = 0; i < n; i++) [a, b] = [b, a + b];
      return a;
    },
    inputs: [[0], [1], [10], [20]],
  },
  {
    name: 'fast power modulo m (recursion, 3 params)',
    src: 'int pw(int b, int e, int m) { if (e == 0) return 1 % m; int h = pw(b, e / 2, m); h = h * h % m; if (e % 2) h = h * (b % m) % m; return h; }',
    fn: 'pw',
    ref: (b: number, e: number, m: number) => {
      let r = 1 % m;
      let x = b % m;
      while (e > 0) { if (e & 1) r = (r * x) % m; x = (x * x) % m; e >>= 1; }
      return r;
    },
    inputs: [[2, 10, 1000], [3, 13, 97], [7, 0, 5], [12345, 678, 1009]],
  },
  {
    name: 'Ackermann (deep recursion)',
    src: 'int ack(int m, int n) { if (m == 0) return n + 1; if (n == 0) return ack(m - 1, 1); return ack(m - 1, ack(m, n - 1)); }',
    fn: 'ack',
    ref: (m: number, n: number) => {
      const a = (x: number, y: number): number => (x === 0 ? y + 1 : y === 0 ? a(x - 1, 1) : a(x - 1, a(x, y - 1)));
      return a(m, n);
    },
    inputs: [[0, 0], [1, 2], [2, 3], [3, 3]],
  },
  {
    name: 'mutual recursion with a prototype',
    src: 'int odd(int n); int even(int n) { if (n == 0) return 1; return odd(n - 1); } int odd(int n) { if (n == 0) return 0; return even(n - 1); }',
    fn: 'even',
    ref: (n: number) => B(n % 2 === 0),
    inputs: [[0], [7], [10]],
  },
  {
    name: 'four parameters, nested calls in arguments',
    src: 'int g(int a, int b, int c, int d) { return a * 1000 + b * 100 + c * 10 + d; } int f(int x) { return g(g(x, 0, 0, 1) % 10, x + 1, g(0, 0, x, 2) % 10, 9); }',
    fn: 'f',
    ref: (x: number) => {
      const g = (a: number, b: number, c: number, d: number) => a * 1000 + b * 100 + c * 10 + d;
      return g(rem(g(x, 0, 0, 1), 10), x + 1, rem(g(0, 0, x, 2), 10), 9);
    },
    inputs: [[0], [3], [8]],
  },
  {
    name: 'temporaries stay correct around calls in one expression',
    src: 'int g(int x) { return x * x + 1; } int f(int a) { return a * 2 + g(a) * g(a + 1) - g(g(a) % 7) + a; }',
    fn: 'f',
    ref: (a: number) => {
      const g = (x: number) => x * x + 1;
      return a * 2 + g(a) * g(a + 1) - g(g(a) % 7) + a;
    },
    inputs: [[0], [3], [-5]],
  },
  {
    name: 'sum, max and count over an array argument',
    src: 'int f(int *p, int n) { int s = 0, mx = p[0], c = 0; for (int i = 0; i < n; i++) { s += p[i]; if (p[i] > mx) mx = p[i]; if (p[i] == mx) c++; } return s * 10000 + mx * 10 + c; }',
    fn: 'f',
    ref: (p: number[], n: number) => {
      let s = 0, mx = p[0], c = 0;
      for (let i = 0; i < n; i++) { s += p[i]; if (p[i] > mx) mx = p[i]; if (p[i] === mx) c++; }
      return s * 10000 + mx * 10 + c;
    },
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'reverse an array in place (two indices)',
    src: 'void rev(int *a, int n) { int i = 0, j = n - 1; while (i < j) { int t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } } int f(int *a, int n) { rev(a, n); return a[0]; }',
    fn: 'f',
    ref: (a: number[], n: number) => {
      a.splice(0, n, ...a.slice(0, n).reverse());
      return a[0];
    },
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'bubble sort',
    src: 'void sort(int *a, int n) { for (int i = 0; i < n - 1; i++) for (int j = 0; j < n - 1 - i; j++) if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; } } int f(int *a, int n) { sort(a, n); return a[n - 1]; }',
    fn: 'f',
    ref: (a: number[], n: number) => {
      a.sort((x, y) => x - y);
      return a[n - 1];
    },
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'insertion sort then binary search',
    src: `void isort(int *a, int n) { for (int i = 1; i < n; i++) { int k = a[i]; int j = i - 1; while (j >= 0 && a[j] > k) { a[j + 1] = a[j]; j--; } a[j + 1] = k; } }
int bs(int *a, int n, int x) { int lo = 0, hi = n - 1; while (lo <= hi) { int mid = (lo + hi) / 2; if (a[mid] == x) return mid; if (a[mid] < x) lo = mid + 1; else hi = mid - 1; } return -1; }
int f(int *a, int n, int x) { isort(a, n); return bs(a, n, x); }`,
    fn: 'f',
    ref: (a: number[], n: number, x: number) => {
      a.sort((p, q) => p - q);
      let lo = 0, hi = n - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid] === x) return mid; if (a[mid] < x) lo = mid + 1; else hi = mid - 1; }
      return -1;
    },
    inputs: [[[5, 3, 9, 1, 7], 5, 7], [[5, 3, 9, 1, 7], 5, 4], [[-4, 0, 12, 8, 3], 5, -4], [[42], 1, 42]],
  },
  {
    name: 'prefix sums written back through a pointer',
    src: 'void pre(int *a, int n) { for (int i = 1; i < n; i++) a[i] += a[i - 1]; } int f(int *a, int n) { pre(a, n); return a[n - 1]; }',
    fn: 'f',
    ref: (a: number[], n: number) => {
      for (let i = 1; i < n; i++) a[i] += a[i - 1];
      return a[n - 1];
    },
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'pointer walking: *(p + i), p++ and *p',
    src: 'int f(int *p, int n) { int s = 0; int *q = p; for (int i = 0; i < n; i++) { s += *q * (i + 1); q++; } return s + *(p + n - 1); }',
    fn: 'f',
    ref: (p: number[], n: number) => p.slice(0, n).reduce((s, v, i) => s + v * (i + 1), 0) + p[n - 1],
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'recursion over an array',
    src: 'int rsum(int *p, int n) { if (n == 0) return 0; return p[n - 1] + rsum(p, n - 1); }',
    fn: 'rsum',
    ref: (p: number[], n: number) => p.slice(0, n).reduce((s, v) => s + v, 0),
    inputs: ARRS.map((a) => [a, a.length]),
  },
  {
    name: 'local array with initialiser, swap through pointers',
    src: 'void sw(int *x, int *y) { int t = *x; *x = *y; *y = t; } int f(int k) { int a[5] = {1, 2, 3, 4, 5}; for (int i = 0; i < 5; i++) a[i] = a[i] * k; sw(&a[0], &a[4]); return a[0] * 100 + a[4]; }',
    fn: 'f',
    ref: (k: number) => 5 * k * 100 + 1 * k,
    inputs: [[1], [3], [-2]],
  },
  {
    name: 'global scalar and global array changed by calls',
    src: 'int total; int hist[4]; void add(int v) { total += v; hist[v % 4] = hist[v % 4] + 1; } int f(int n) { total = 0; for (int i = 0; i < 4; i++) hist[i] = 0; for (int i = 0; i < n; i++) add(i * i); return total * 10000 + hist[0] * 1000 + hist[1] * 100 + hist[2] * 10 + hist[3]; }',
    fn: 'f',
    ref: (n: number) => {
      let t = 0;
      const h = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) { t += i * i; h[(i * i) % 4]++; }
      return t * 10000 + h[0] * 1000 + h[1] * 100 + h[2] * 10 + h[3];
    },
    inputs: [[0], [5], [9]],
  },
  {
    name: 'global array with initialiser',
    src: 'int sq[6] = {0, 1, 4, 9, 16, 25}; int f(int i) { return sq[i] + sq[5 - i]; }',
    fn: 'f',
    ref: (i: number) => i * i + (5 - i) * (5 - i),
    inputs: [[0], [2], [5]],
  },
  {
    name: 'block scope shadowing',
    src: 'int f(int a) { int x = a; { int x = a * 2; a = x + 1; } return x * 100 + a; }',
    fn: 'f',
    ref: (a: number) => a * 100 + a * 2 + 1,
    inputs: [[1], [7]],
  },
  {
    name: 'void function with early return',
    src: 'int g; void s(int a) { if (a > 0) return; g = a; } int f(int a) { g = 99; s(a); return g; }',
    fn: 'f',
    ref: (a: number) => (a > 0 ? 99 : a),
    inputs: [[1], [0], [-5]],
  },
  {
    name: 'leaf function with many locals (more than the free $t registers)',
    src: 'int f(int a) { int b = a + 1, c = b + 1, d = c + 1, e = d + 1, g = e + 1, h = g + 1, i = h + 1, j = i + 1, k = j + 1; return a + b + c + d + e + g + h + i + j + k; }',
    fn: 'f',
    ref: (a: number) => 10 * a + 45,
    inputs: [[0], [10]],
  },
  {
    name: 'deep and wide expressions',
    src: 'int f(int a) { return a + (a + (a + (a + (a + (a + (a + (a + (a + (a + (a + (a + 1))))))))))) + (a * 1 + a * 2) * (a * 3 + a * 4) * (a * 5 + a * 6) * (a * 7 + a * 8); }',
    fn: 'f',
    ref: (a: number) => i32(12 * a + 1 + mul(mul(mul(3 * a, 7 * a), 11 * a), 15 * a)),
    inputs: [[0], [1], [3], [-2]],
  },
  {
    name: 'large constants and INT_MIN',
    src: 'int f(int a) { int m = -2147483648; int big = 0x12345678; return (a == 0 ? m : big) + 70000 - 0x7FFF0000 + a; }',
    fn: 'f',
    ref: (a: number) => i32((a === 0 ? -2147483648 : 0x12345678) + 70000 - 0x7fff0000 + a),
    inputs: [[0], [1], [-1]],
  },
  {
    name: "character literals",
    src: "int f(int c) { if (c >= 'a' && c <= 'z') return c - 'a' + 'A'; return c; }",
    fn: 'f',
    ref: (c: number) => (c >= 97 && c <= 122 ? c - 32 : c),
    inputs: [[97], [122], [65], [48]],
  },
];

/** The ones real C defines differently from int: these must match C, not just the CPU. */
const C_TYPES: Case[] = [
  { name: 'unsigned >> is a logical shift', src: 'int f(int a) { unsigned x = a; return x >> 28; }', fn: 'f', ref: (a: number) => (a >>> 28) | 0, inputs: [[-16], [0x70000000]] },
  { name: 'unsigned comparison', src: 'int f(int a, int b) { unsigned x = a; unsigned y = b; return x > y; }', fn: 'f', ref: (a: number, b: number) => B(a >>> 0 > b >>> 0), inputs: [[-1, 1], [1, -1], [3, 2]] },
  { name: 'unsigned division and modulo', src: 'int f(int a, int b) { unsigned x = a; unsigned y = b; return x / y + x % y; }', fn: 'f', ref: (a: number, b: number) => i32(Math.trunc((a >>> 0) / (b >>> 0)) + ((a >>> 0) % (b >>> 0))), inputs: [[-2, 2], [-1, 10], [100, 7]] },
  { name: 'char keeps 8 bits (signed)', src: 'int f(int a) { char c = a; return c; }', fn: 'f', ref: (a: number) => (a << 24) >> 24, inputs: [[200], [65], [-1], [300]] },
];

function argsCopy(args: Arg[]): Arg[] {
  return args.map((a) => (Array.isArray(a) ? [...a] : a));
}

describe('A. C → MIPS runs real programs correctly', () => {
  for (const c of CASES)
    it(c.name, () => {
      const asm = compile(c.src);
      for (const input of c.inputs) {
        const want = argsCopy(input);
        const v = (c.ref as (...a: Arg[]) => number)(...want);
        const got = runAsm(asm, c.fn, argsCopy(input));
        expect(got.v0, `${c.fn}(${JSON.stringify(input)})`).toBe(v);
        expect(got.arrays, `arrays after ${c.fn}(${JSON.stringify(input)})`).toEqual(want.filter(Array.isArray));
      }
    });
});

describe('A2. unsigned / char behave like C', () => {
  for (const c of C_TYPES)
    it(c.name, () => {
      const asm = compile(c.src);
      for (const input of c.inputs) expect(runAsm(asm, c.fn, input).v0, `${c.fn}(${input})`).toBe((c.ref as (...a: Arg[]) => number)(...input));
    });
});

// ---------- B. fuzzing ----------

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Env = Record<string, number>;
type Gen = [src: string, ev: (e: Env) => number];
const CONSTS = [0, 1, 2, 3, 7, 31, 100, 255, 65535, 65536, 123456789, 2147483647, -1, -5, -32768, -2147483647];

function genExpr(r: () => number, vars: string[], depth: number, calls: boolean): Gen {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  if (depth <= 0 || r() < 0.2) {
    if (r() < 0.6) {
      const v = pick(vars);
      return [v, (e) => e[v]];
    }
    const k = pick(CONSTS);
    return [k < 0 ? `(${k})` : String(k), () => k];
  }
  const roll = r();
  if (calls && roll < 0.08) {
    const [s, f] = genExpr(r, vars, depth - 1, calls);
    return [`h(${s})`, (e) => i32(mul(f(e), 3) + 1)];
  }
  if (roll < 0.2) {
    const [s, f] = genExpr(r, vars, depth - 1, calls);
    const op = pick(['-', '~', '!']);
    return [`${op}(${s})`, (e) => (op === '-' ? i32(-f(e)) : op === '~' ? ~f(e) : B(!f(e)))];
  }
  if (roll < 0.27) {
    const [c, fc] = genExpr(r, vars, depth - 1, calls);
    const [a, fa] = genExpr(r, vars, depth - 1, calls);
    const [b, fb] = genExpr(r, vars, depth - 1, calls);
    return [`(${c} ? ${a} : ${b})`, (e) => (fc(e) ? fa(e) : fb(e))];
  }
  const op = pick(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '<', '>', '<=', '>=', '==', '!=', '&&', '||']);
  const [a, fa] = genExpr(r, vars, depth - 1, calls);
  let [b, fb] = genExpr(r, vars, depth - 1, calls);
  if (op === '/' || op === '%') {
    // never divide by zero, never INT_MIN / -1 (C leaves both undefined)
    const inner = fb;
    b = `((${b}) | 2)`;
    fb = (e) => inner(e) | 2;
  }
  if (op === '<<' || op === '>>') {
    const inner = fb;
    b = `((${b}) & 31)`;
    fb = (e) => inner(e) & 31;
  }
  const f = (e: Env) => {
    const x = fa(e);
    if (op === '&&') return B(!!x && !!fb(e));
    if (op === '||') return B(!!x || !!fb(e));
    const y = fb(e);
    switch (op) {
      case '+': return i32(x + y);
      case '-': return i32(x - y);
      case '*': return mul(x, y);
      case '/': return div(x, y);
      case '%': return rem(x, y);
      case '&': return x & y;
      case '|': return x | y;
      case '^': return x ^ y;
      case '<<': return shl(x, y);
      case '>>': return sar(x, y);
      case '<': return B(x < y);
      case '>': return B(x > y);
      case '<=': return B(x <= y);
      case '>=': return B(x >= y);
      case '==': return B(x === y);
      default: return B(x !== y);
    }
  };
  return [`(${a} ${op} ${b})`, f];
}

/** Random statements over a, b, c (params) and x, y, z (locals), with bounded loops. */
function genProgram(r: () => number, calls: boolean): { src: string; ev: (e: Env) => number } {
  const vars = ['a', 'b', 'c', 'x', 'y', 'z'];
  const loopVars = ['i', 'j'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const block = (depth: number, inLoop: number): [string, (e: Env) => void] => {
    const n = 1 + Math.floor(r() * 3);
    const parts: [string, (e: Env) => void][] = [];
    for (let k = 0; k < n; k++) {
      const roll = r();
      const live = [...vars, ...loopVars.slice(0, inLoop)];
      if (depth > 0 && roll < 0.2) {
        const [c, fc] = genExpr(r, live, 2, calls);
        const [t, ft] = block(depth - 1, inLoop);
        const [f, ff] = block(depth - 1, inLoop);
        parts.push([`if (${c}) { ${t} } else { ${f} }`, (e) => (fc(e) ? ft(e) : ff(e))]);
      } else if (depth > 0 && inLoop < 2 && roll < 0.35) {
        const lv = loopVars[inLoop];
        const count = Math.floor(r() * 5);
        const [body, fb] = block(depth - 1, inLoop + 1);
        parts.push([
          `for (int ${lv} = 0; ${lv} < ${count}; ${lv}++) { ${body} }`,
          (e) => {
            const saved = e[lv];
            for (e[lv] = 0; e[lv] < count; e[lv]++) fb(e);
            e[lv] = saved;
          },
        ]);
      } else {
        const v = pick(vars.slice(3));
        const [ex, fe] = genExpr(r, live, 3, calls);
        const op = pick(['=', '+=', '^=']);
        parts.push([
          `${v} ${op} ${ex};`,
          (e) => {
            const val = fe(e);
            e[v] = op === '=' ? val : op === '+=' ? i32(e[v] + val) : e[v] ^ val;
          },
        ]);
      }
    }
    return [parts.map((p) => p[0]).join(' '), (e) => parts.forEach((p) => p[1](e))];
  };
  const [body, fb] = block(2, 0);
  const helper = calls ? 'int h(int v) { return v * 3 + 1; }\n' : '';
  return {
    src: `${helper}int f(int a, int b, int c) {\n  int x = 1, y = 2, z = 3;\n  ${body}\n  return x ^ (y << 1) ^ (z << 2);\n}`,
    ev: (e) => {
      const env: Env = { ...e, x: 1, y: 2, z: 3 };
      fb(env);
      return env.x ^ shl(env.y, 1) ^ shl(env.z, 2);
    },
  };
}

const INPUTS: [number, number, number][] = [
  [0, 0, 0],
  [1, -1, 2],
  [7, 3, -100],
  [2147483647, -2147483648, 65536],
  [-12345, 678, 9],
];

const FUZZ_EXPR = 400;
const FUZZ_PROG = 200;
const fuzzExprs = Array.from({ length: FUZZ_EXPR }, (_, i) => {
  const r = rng(1000 + i);
  const calls = i % 3 === 0;
  const [s, ev] = genExpr(r, ['a', 'b', 'c'], 5, calls);
  return { i, src: `${calls ? 'int h(int v) { return v * 3 + 1; }\n' : ''}int f(int a, int b, int c) { return ${s}; }`, ev };
});
const fuzzProgs = Array.from({ length: FUZZ_PROG }, (_, i) => ({ i, ...genProgram(rng(5000 + i), i % 2 === 0) }));

describe('B. fuzz: random C compiled to MIPS matches C semantics', () => {
  it(`${FUZZ_EXPR} random expressions × ${INPUTS.length} inputs`, () => {
    const bad: string[] = [];
    for (const { i, src, ev } of fuzzExprs) {
      const asm = compile(src);
      for (const [a, b, c] of INPUTS) {
        const want = ev({ a, b, c });
        const got = runAsm(asm, 'f', [a, b, c]).v0;
        if (got !== want) bad.push(`#${i} f(${a}, ${b}, ${c}) want ${want} got ${got}\n${src}`);
      }
    }
    expect(bad.length, bad.slice(0, 3).join('\n\n')).toBe(0);
  });

  it(`${FUZZ_PROG} random programs (if / nested for / calls) × ${INPUTS.length} inputs`, () => {
    const bad: string[] = [];
    for (const { i, src, ev } of fuzzProgs) {
      const asm = compile(src);
      for (const [a, b, c] of INPUTS) {
        const want = ev({ a, b, c });
        const got = runAsm(asm, 'f', [a, b, c]).v0;
        if (got !== want) bad.push(`#${i} f(${a}, ${b}, ${c}) want ${want} got ${got}\n${src}`);
      }
    }
    expect(bad.length, bad.slice(0, 3).join('\n\n')).toBe(0);
  });
});

// ---------- C. C → MIPS → C ----------

describe('C. MIPS → C: lifting compiled programs gives valid C with the same results', () => {
  for (const c of CASES)
    it(c.name, () => {
      const asm = compile(c.src);
      for (const input of c.inputs) {
        const cpu = runAsm(asm, c.fn, argsCopy(input));
        const lifted = runLifted(asm, c.fn, argsCopy(input));
        expect(lifted, `${c.fn}(${JSON.stringify(input)})`).toEqual(cpu);
      }
    });

  it('random expressions and programs survive the round trip', () => {
    const bad: string[] = [];
    for (const { i, src } of [...fuzzExprs.slice(0, 150), ...fuzzProgs.slice(0, 100)]) {
      const asm = compile(src);
      for (const input of INPUTS.slice(0, 3)) {
        try {
          const want = runAsm(asm, 'f', input).v0;
          const got = runLifted(asm, 'f', input).v0;
          if (got !== want) bad.push(`#${i} want ${want} got ${got}\n${src}`);
        } catch (e) {
          bad.push(`#${i} ${(e as Error).message}\n${src}`);
          break;
        }
      }
    }
    expect(bad.length, bad.slice(0, 3).join('\n\n')).toBe(0);
  });
});

// ---------- D. hand-written MIPS → C ----------

describe('D. MIPS → C on the hand-written answers of the problem bank', () => {
  const mips = PROBLEMS.filter((p) => p.kind === 'mips');
  for (const p of mips)
    it(`#${p.id} ${p.title}`, () => {
      const asm = p.answer.code.find((c) => c.lang === 'mips')!.lines.join('\n');
      for (const t of p.tests as MipsTest[]) {
        const cpu = runAsm(asm, p.fn, argsCopy(t.args));
        const lifted = runLifted(asm, p.fn, argsCopy(t.args));
        expect(lifted.v0, `${p.fn}(${JSON.stringify(t.args)})`).toBe(cpu.v0);
        expect(lifted.arrays).toEqual(cpu.arrays);
      }
    });
});

// ---------- E. limits ----------

describe('E. outside the subset: a clear error, never a crash or a wrong program', () => {
  const UNSUPPORTED: [string, string][] = [
    ['struct', 'struct P { int x; }; int f() { struct P p; p.x = 1; return p.x; }'],
    ['float', 'int f() { float x = 1.5; return (int)(x * 2); }'],
    ['string literal / printf', 'int f() { printf("hi"); return 0; }'],
    ['switch', 'int f(int a) { switch (a) { case 1: return 10; default: return 0; } }'],
    ['goto', 'int f() { int i = 0; L: i++; if (i < 3) goto L; return i; }'],
    ['2-D array', 'int f() { int m[2][2]; m[1][1] = 3; return m[1][1]; }'],
    ['sizeof', 'int f() { return sizeof(int); }'],
    ['long / short', 'int f() { long a = 3; return a; }'],
    ['static local', 'int f() { static int c = 0; c++; return c; }'],
    ['address of a register variable', 'void inc(int *p) { *p = *p + 1; } int f() { int x = 4; inc(&x); return x; }'],
    ['comma operator', 'int f(int n) { int i, j, s = 0; for (i = 0, j = n; i < j; i++, j--) s++; return s; }'],
    ['5 parameters', 'int f(int a, int b, int c, int d, int e) { return e; }'],
    ['9 variables in a function that calls', 'int h(int x) { return x; } int f() { int a = 1, b = 2, c = 3, d = 4, e = 5, g = 6, i = 7, j = 8, k = 9; return h(a + b + c + d + e + g + i + j + k); }'],
    ['global initialised with an expression', 'int N = 2 * 3; int f() { return N; }'],
    ['undeclared variable', 'int f() { return y; }'],
    ['missing semicolon', 'int f() { return 1 }'],
  ];
  for (const [name, src] of UNSUPPORTED)
    it(name, () => {
      const r = compileC(src);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.length).toBeGreaterThan(0);
        for (const e of r.errors) {
          expect(e.line).toBeGreaterThan(0);
          expect(e.msg.length).toBeGreaterThan(5);
        }
      }
    });
});
