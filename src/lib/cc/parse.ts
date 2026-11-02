// Lexer + recursive-descent parser for the teaching subset of C:
// int / void / int* / int[] , functions (≤ 4 params), globals, local arrays,
// if / else / while / do / for / break / continue / return, and the usual
// arithmetic, bitwise, comparison, logical, ternary and assignment operators.

export class CError extends Error {
  constructor(
    readonly line: number,
    msg: string,
  ) {
    super(msg);
  }
}

interface Tok {
  k: 'num' | 'id' | 'kw' | 'op' | 'eof';
  v: string;
  line: number;
  n?: number;
}

const KW = new Set([
  'int',
  'void',
  'char',
  'unsigned',
  'const',
  'if',
  'else',
  'while',
  'for',
  'do',
  'return',
  'break',
  'continue',
  'switch',
  'case',
  'default',
  'sizeof',
]);
const OPS = [
  '<<=',
  '>>=',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '&',
  '|',
  '^',
  '~',
  '?',
  ':',
  ';',
  ',',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw new CError(line, 'ขาด */ ปิด comment');
      const end = e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end;
      continue;
    }
    if (c === '#') {
      throw new CError(line, 'ยังไม่รองรับ preprocessor เช่น #include, #define หรือ #if — ใช้ฟังก์ชัน C ในชุดภาษาที่รองรับโดยตรง');
    }
    const num = /^(0x[0-9a-fA-F]+|\d+)/.exec(src.slice(i, i + 20));
    if (num) {
      out.push({ k: 'num', v: num[1], n: Number(num[1]), line });
      i += num[1].length;
      continue;
    }
    const ch = /^'(\\?.)'/.exec(src.slice(i, i + 4));
    if (ch) {
      const s = ch[1];
      const v = s.length === 2 ? (({ n: 10, t: 9, '0': 0, '\\': 92, "'": 39 } as Record<string, number>)[s[1]] ?? s.charCodeAt(1)) : s.charCodeAt(0);
      out.push({ k: 'num', v: ch[0], n: v, line });
      i += ch[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 64));
    if (id) {
      if (['struct', 'union', 'enum', 'float', 'double', 'long', 'short', 'typedef', 'static', 'goto'].includes(id[0]))
        throw new CError(line, `ยังไม่รองรับ ${id[0]} ใน compiler สำหรับบทเรียนนี้`);
      out.push({ k: KW.has(id[0]) ? 'kw' : 'id', v: id[0], line });
      i += id[0].length;
      continue;
    }
    if (c === '"') throw new CError(line, 'ยังไม่รองรับ string literal และ standard I/O เช่น printf');
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new CError(line, `ไม่รู้จักตัวอักษร "${c}"`);
    out.push({ k: 'op', v: op, line });
    i += op.length;
  }
  out.push({ k: 'eof', v: '', line });
  return out;
}

// ---------- AST ----------

/**
 * Scalars live in one 32-bit register; `char` values are kept sign-extended
 * (`uchar` zero-extended) and cut to 8 bits whenever they are stored. Pointers
 * remember their pointee and array shape; char occupies 1 byte, int and pointers 4.
 */
export type Scalar = 'int' | 'uint' | 'char' | 'uchar' | 'void' | 'ptr' | 'uptr' | 'cptr' | 'ucptr';
export type Type = Scalar | { k: 'pointer'; to: Type } | { k: 'array'; elem: Type; size: number };
const PTR: Partial<Record<Scalar, Scalar>> = {
  int: 'ptr',
  uint: 'uptr',
  char: 'cptr',
  uchar: 'ucptr',
};
const ELEM: Partial<Record<Scalar, Type>> = {
  ptr: 'int',
  uptr: 'uint',
  cptr: 'char',
  ucptr: 'uchar',
};
export const isArray = (t: Type): t is Extract<Type, { k: 'array' }> => typeof t === 'object' && t.k === 'array';
export const isPtr = (t: Type) => typeof t === 'object' || t in ELEM;
export const ptrTo = (t: Type): Type => (typeof t === 'string' && PTR[t] ? PTR[t]! : { k: 'pointer', to: t });
export const elemOf = (t: Type): Type => (typeof t === 'object' ? (t.k === 'array' ? t.elem : t.to) : (ELEM[t] ?? 'int'));
export const decay = (t: Type): Type => (isArray(t) ? ptrTo(t.elem) : t);
export const promote = (t: Type): Type => (t === 'char' || t === 'uchar' ? 'int' : decay(t));
export const isUnsigned = (t: Type) => promote(t) === 'uint';
export function sizeOf(t: Type, line = 1): number {
  if (t === 'void') throw new CError(line, 'ใช้ sizeof หรือคำนวณขนาดของ void ไม่ได้');
  return isArray(t) ? t.size * sizeOf(t.elem, line) : t === 'char' || t === 'uchar' ? 1 : 4;
}
export function typeText(t: Type): string {
  if (isArray(t)) {
    const dims: number[] = [];
    let elem: Type = t;
    while (isArray(elem)) {
      dims.push(elem.size);
      elem = elem.elem;
    }
    return typeText(elem) + dims.map((size) => `[${size}]`).join('');
  }
  if (typeof t === 'object') return `${typeText(t.to)} *`;
  return {
    int: 'int',
    uint: 'unsigned int',
    char: 'char',
    uchar: 'unsigned char',
    void: 'void',
    ptr: 'int *',
    uptr: 'unsigned int *',
    cptr: 'char *',
    ucptr: 'unsigned char *',
  }[t];
}
export function objectType(d: VarDecl): Type {
  return (d.dims ?? (d.size == null ? [] : [d.size])).reduceRight<Type>((elem, size) => ({ k: 'array', elem, size }), d.type);
}
/** Integer constant expressions used for dimensions, case labels and static initializers. */
export function constantInt(e: Expr, sizeofExpr?: (e: Expr) => number): number | null {
  type Constant = { n: number; u: boolean };
  const unsigned = (x: Expr): boolean => {
    switch (x.k) {
      case 'num':
        return x.v > 2147483647;
      case 'sizeof':
        return true;
      case 'cast':
        return x.to === 'uint';
      case 'un':
        return x.op !== '!' && unsigned(x.e);
      case 'cond':
        return unsigned(x.a) || unsigned(x.b);
      case 'bin':
        return ['<', '<=', '>', '>=', '==', '!=', '&&', '||'].includes(x.op)
          ? false
          : x.op === '<<' || x.op === '>>'
            ? unsigned(x.l)
            : unsigned(x.l) || unsigned(x.r);
      default:
        return false;
    }
  };
  const result = (n: number, u = false): Constant => ({
    n: u ? n >>> 0 : n | 0,
    u,
  });
  const evaluate = (x: Expr): Constant | null => {
    if (x.k === 'num') return result(x.v, unsigned(x));
    if (x.k === 'sizeof') {
      const n = x.type ? sizeOf(x.type, x.line) : sizeofExpr ? sizeofExpr(x.e!) : null;
      return n === null ? null : result(n, true);
    }
    if (x.k === 'cast') {
      const v = evaluate(x.e);
      return !v ? null : result(x.to === 'char' ? (v.n << 24) >> 24 : x.to === 'uchar' ? v.n & 255 : v.n, x.to === 'uint');
    }
    if (x.k === 'un' && ['-', '~', '!'].includes(x.op)) {
      const v = evaluate(x.e);
      if (!v) return null;
      return result(x.op === '-' ? -v.n : x.op === '~' ? ~v.n : +!v.n, x.op === '!' ? false : v.u);
    }
    if (x.k === 'cond') {
      const c = evaluate(x.c);
      if (!c) return null;
      const v = evaluate(c.n ? x.a : x.b);
      return v ? result(v.n, unsigned(x)) : null;
    }
    if (x.k !== 'bin') return null;
    const l = evaluate(x.l);
    if (!l) return null;
    if (x.op === '&&' && !l.n) return result(0);
    if (x.op === '||' && l.n) return result(1);
    const r = evaluate(x.r);
    if (!r) return null;
    const u = l.u || r.u,
      a = u ? l.n >>> 0 : l.n,
      b = u ? r.n >>> 0 : r.n;
    switch (x.op) {
      case '+':
        return result(a + b, u);
      case '-':
        return result(a - b, u);
      case '*':
        return result(Math.imul(a, b), u);
      case '/':
      case '%':
        if (!b) throw new CError(x.line, 'หารด้วยศูนย์ในนิพจน์ค่าคงที่');
        return result(x.op === '/' ? Math.trunc(a / b) : a % b, u);
      case '<<':
        return result(l.n << (r.n & 31), l.u);
      case '>>':
        return result(l.u ? l.n >>> (r.n & 31) : l.n >> (r.n & 31), l.u);
      case '&':
        return result(a & b, u);
      case '|':
        return result(a | b, u);
      case '^':
        return result(a ^ b, u);
      case '<':
        return result(+(a < b));
      case '<=':
        return result(+(a <= b));
      case '>':
        return result(+(a > b));
      case '>=':
        return result(+(a >= b));
      case '==':
        return result(+(a === b));
      case '!=':
        return result(+(a !== b));
      case '&&':
        return result(+!!(a && b));
      case '||':
        return result(+!!(a || b));
    }
    return null;
  };
  return evaluate(e)?.n ?? null;
}

export type Expr = { line: number } & (
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'un'; op: '-' | '!' | '~' | '*' | '&'; e: Expr }
  | { k: 'assign'; op: string; t: Expr; v: Expr }
  | { k: 'inc'; op: '++' | '--'; post: boolean; t: Expr }
  | { k: 'index'; a: Expr; i: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'cast'; to: Type; e: Expr }
  | { k: 'sizeof'; type?: Type; e?: Expr }
);

export interface VarDecl {
  name: string;
  type: Type;
  /** element count for arrays */
  size?: number;
  dims?: number[];
  init?: Expr;
  initList?: Expr[];
  line: number;
}

export type Stmt = { line: number } & (
  | { k: 'decl'; vars: VarDecl[] }
  | { k: 'expr'; e: Expr }
  | { k: 'if'; c: Expr; a: Stmt; b?: Stmt; elseLine?: number }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; c: Expr; body: Stmt; endLine: number }
  | { k: 'for'; init?: Stmt; c?: Expr; step?: Expr; body: Stmt }
  | { k: 'return'; e?: Expr }
  | { k: 'break' }
  | { k: 'continue' }
  | {
      k: 'switch';
      c: Expr;
      cases: { value?: Expr; body: Stmt[]; line: number }[];
      end: number;
    }
  | { k: 'block'; body: Stmt[]; end: number }
);

export interface Param {
  name: string;
  type: Type;
}
export interface Func {
  name: string;
  ret: Type;
  params: Param[];
  body: Stmt & { k: 'block' };
  line: number;
}
export interface Unit {
  funcs: Func[];
  globals: VarDecl[];
}

// ---------- parser ----------

export function parse(src: string): Unit {
  const t = lex(src);
  let p = 0;
  const peek = (o = 0) => t[p + o];
  const is = (v: string) => (t[p].k === 'op' || t[p].k === 'kw') && t[p].v === v;
  const eat = (v: string) => {
    if (is(v)) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (v: string, what?: string) => {
    if (!eat(v)) throw new CError(t[p].line, `ต้องมี "${v}"${what ? ' ' + what : ''} แต่เจอ "${t[p].v || 'จบไฟล์'}"`);
    return t[p - 1];
  };
  const ident = () => {
    if (t[p].k !== 'id') throw new CError(t[p].line, `ต้องเป็นชื่อตัวแปรหรือฟังก์ชัน แต่เจอ "${t[p].v || 'จบไฟล์'}"`);
    return t[p++].v;
  };
  const isType = () => t[p].k === 'kw' && ['int', 'void', 'char', 'unsigned', 'const'].includes(t[p].v);
  const baseType = (): Type => {
    while (eat('const'));
    if (eat('void')) return 'void';
    if (eat('unsigned')) {
      if (eat('char')) return 'uchar';
      eat('int');
      return 'uint';
    }
    if (eat('char')) return 'char';
    if (eat('int')) return 'int';
    throw new CError(t[p].line, `ต้องระบุชนิดข้อมูล (int) แต่เจอ "${t[p].v}"`);
  };
  const stars = (b: Type): Type => {
    let ty = b;
    while (eat('*')) ty = ptrTo(ty);
    return ty;
  };

  function declarators(base: Type, line: number): VarDecl[] {
    const vars: VarDecl[] = [];
    do {
      const type = stars(base);
      const ln = t[p].line;
      const name = ident();
      if (type === 'void') throw new CError(ln, `ตัวแปร ${name} เป็น void ไม่ได้`);
      const d: VarDecl = { name, type, line: ln };
      const dims: number[] = [];
      while (eat('[')) {
        if (dims.length >= 2) throw new CError(ln, 'รองรับอาร์เรย์ได้ไม่เกิน 2 มิติ');
        if (is(']')) {
          if (dims.length) throw new CError(ln, 'ต้องระบุจำนวนคอลัมน์ของอาร์เรย์ 2 มิติ');
          dims.push(-1);
        } else {
          const value = constantInt(assign());
          if (value === null || !Number.isInteger(value) || value <= 0 || value > 4096)
            throw new CError(ln, 'ขนาดอาร์เรย์ต้องเป็นจำนวนเต็มคงที่ 1–4096 (ยังไม่รองรับ VLA)');
          dims.push(value);
        }
        expect(']');
      }
      if (dims.length) {
        d.dims = dims;
        d.size = dims.reduce((a, b) => a * b, 1);
      }
      if (eat('=')) {
        if (dims.length) {
          expect('{', 'สำหรับค่าเริ่มต้นของอาร์เรย์');
          const values: Expr[] = [];
          const rowSize = dims[1] ?? 1;
          while (!is('}')) {
            if (eat('{')) {
              if (dims.length !== 2) throw new CError(ln, 'initializer ซ้อนใช้กับอาร์เรย์ 2 มิติเท่านั้น');
              if (values.length % rowSize) throw new CError(ln, 'จัด initializer ให้เริ่มที่ต้นแถว');
              const row: Expr[] = [];
              if (!is('}'))
                do {
                  row.push(assign());
                } while (eat(',') && !is('}'));
              expect('}');
              if (row.length > rowSize) throw new CError(ln, 'ค่าเริ่มต้นเกินจำนวนคอลัมน์');
              values.push(
                ...row,
                ...Array.from({ length: rowSize - row.length }, () => ({
                  k: 'num' as const,
                  v: 0,
                  line: ln,
                })),
              );
            } else values.push(assign());
            if (!eat(',')) break;
          }
          expect('}');
          if (dims[0] === -1) {
            dims[0] = Math.ceil(values.length / rowSize);
            d.size = dims.reduce((a, b) => a * b, 1);
          }
          d.initList = values;
        } else d.init = assign();
      }
      if (dims.length && (dims[0] === -1 || !d.size || d.size > 4096)) throw new CError(ln, `ต้องระบุขนาดอาร์เรย์ ${name} และจำนวนสมาชิกต้องไม่เกิน 4096`);
      if (d.initList && d.initList.length > d.size!) throw new CError(ln, `ค่าเริ่มต้นเกินขนาดอาร์เรย์ ${name}`);
      if (d.size === -1) throw new CError(ln, `ต้องระบุขนาดอาร์เรย์ ${name}`);
      vars.push(d);
    } while (eat(','));
    expect(';');
    void line;
    return vars;
  }

  // expressions, lowest precedence first
  function expr(): Expr {
    return assign();
  }
  function assign(): Expr {
    const l = ternary();
    const op = t[p];
    if (op.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(op.v)) {
      p++;
      if (!['var', 'index'].includes(l.k) && !(l.k === 'un' && l.op === '*')) throw new CError(op.line, 'ด้านซ้ายของ = ต้องเป็นตัวแปร, a[i] หรือ *p');
      return { k: 'assign', op: op.v, t: l, v: assign(), line: op.line };
    }
    return l;
  }
  function ternary(): Expr {
    const c = binary(0);
    if (is('?')) {
      const line = t[p++].line;
      const a = expr();
      expect(':');
      return { k: 'cond', c, a, b: ternary(), line };
    }
    return c;
  }
  const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  function binary(level: number): Expr {
    if (level === LEVELS.length) return unary();
    let l = binary(level + 1);
    while (t[p].k === 'op' && LEVELS[level].includes(t[p].v)) {
      const op = t[p++];
      l = { k: 'bin', op: op.v, l, r: binary(level + 1), line: op.line };
    }
    return l;
  }
  function unary(): Expr {
    const tk = t[p];
    if (eat('sizeof')) {
      if (is('(') && peek(1).k === 'kw' && ['int', 'unsigned', 'char', 'void', 'const'].includes(peek(1).v)) {
        p++;
        let ty = stars(baseType());
        const dims: number[] = [];
        while (eat('[')) {
          const n = constantInt(assign());
          if (n === null || n <= 0 || n > 4096) throw new CError(tk.line, 'ขนาดอาร์เรย์ใน sizeof ต้องเป็นค่าคงที่ 1–4096');
          dims.push(n);
          expect(']');
        }
        ty = dims.reduceRight<Type>((elem, size) => ({ k: 'array', elem, size }), ty);
        expect(')');
        return { k: 'sizeof', type: ty, line: tk.line };
      }
      return { k: 'sizeof', e: unary(), line: tk.line };
    }
    if (tk.k === 'op') {
      if (tk.v === '++' || tk.v === '--') {
        p++;
        return { k: 'inc', op: tk.v, post: false, t: unary(), line: tk.line };
      }
      if (['-', '!', '~', '*', '&'].includes(tk.v)) {
        p++;
        const e = unary();
        if (tk.v === '-' && e.k === 'num') return { ...e, v: -e.v };
        return { k: 'un', op: tk.v as '-', e, line: tk.line };
      }
      if (tk.v === '+') {
        p++;
        return unary();
      }
      if (tk.v === '(' && peek(1).k === 'kw' && ['int', 'unsigned', 'char', 'const'].includes(peek(1).v)) {
        // (int) x, (unsigned) x, (char) x, (int *) p
        p++;
        const to = stars(baseType());
        expect(')');
        return { k: 'cast', to, e: unary(), line: tk.line };
      }
    }
    return postfix();
  }
  function postfix(): Expr {
    let e = primary();
    for (;;) {
      if (is('[')) {
        const line = t[p++].line;
        const i = expr();
        expect(']');
        e = { k: 'index', a: e, i, line };
      } else if (is('++') || is('--')) {
        const tk = t[p++];
        e = { k: 'inc', op: tk.v as '++', post: true, t: e, line: tk.line };
      } else return e;
    }
  }
  function primary(): Expr {
    const tk = t[p];
    if (tk.k === 'num') {
      p++;
      return { k: 'num', v: tk.n!, line: tk.line };
    }
    if (tk.k === 'id') {
      p++;
      if (eat('(')) {
        const args: Expr[] = [];
        if (!is(')'))
          do args.push(assign());
          while (eat(','));
        expect(')');
        return { k: 'call', name: tk.v, args, line: tk.line };
      }
      return { k: 'var', name: tk.v, line: tk.line };
    }
    if (eat('(')) {
      const e = expr();
      expect(')');
      return e;
    }
    throw new CError(tk.line, `ไม่คาดว่าจะเจอ "${tk.v || 'จบไฟล์'}" ตรงนี้`);
  }

  function stmt(): Stmt {
    const tk = t[p];
    const line = tk.line;
    if (is('{')) return block();
    if (isType()) return { k: 'decl', vars: declarators(baseType(), line), line };
    if (eat('if')) {
      expect('(');
      const c = expr();
      expect(')');
      const a = stmt();
      if (is('else')) {
        const elseLine = t[p++].line;
        return { k: 'if', c, a, b: stmt(), elseLine, line };
      }
      return { k: 'if', c, a, line };
    }
    if (eat('switch')) {
      expect('(');
      const c = expr();
      expect(')');
      expect('{');
      const cases: Extract<Stmt, { k: 'switch' }>['cases'] = [];
      while (!is('}')) {
        const at = t[p].line;
        let value: Expr | undefined;
        if (eat('case')) value = ternary();
        else if (eat('default')) {
          if (cases.some((x) => !x.value)) throw new CError(at, 'switch มี default ซ้ำ');
        } else throw new CError(at, 'คำสั่งใน switch ต้องเริ่มด้วย case หรือ default');
        expect(':');
        const body: Stmt[] = [];
        while (!is('case') && !is('default') && !is('}')) {
          if (t[p].k === 'eof') throw new CError(at, 'ขาด } ปิด switch');
          body.push(stmt());
        }
        cases.push({ value, body, line: at });
      }
      return { k: 'switch', c, cases, end: expect('}').line, line };
    }
    if (eat('while')) {
      expect('(');
      const c = expr();
      expect(')');
      return { k: 'while', c, body: stmt(), line };
    }
    if (eat('do')) {
      const body = stmt();
      const endLine = expect('while').line;
      expect('(');
      const c = expr();
      expect(')');
      expect(';');
      return { k: 'do', c, body, endLine, line };
    }
    if (eat('for')) {
      expect('(');
      let init: Stmt | undefined;
      if (isType()) init = { k: 'decl', vars: declarators(baseType(), t[p].line), line };
      else if (!eat(';')) {
        init = { k: 'expr', e: expr(), line };
        expect(';');
      }
      const c = is(';') ? undefined : expr();
      expect(';');
      const step = is(')') ? undefined : expr();
      expect(')');
      return { k: 'for', init, c, step, body: stmt(), line };
    }
    if (eat('return')) {
      const e = is(';') ? undefined : expr();
      expect(';', 'หลัง return');
      return { k: 'return', e, line };
    }
    if (eat('break')) {
      expect(';');
      return { k: 'break', line };
    }
    if (eat('continue')) {
      expect(';');
      return { k: 'continue', line };
    }
    if (eat(';')) return { k: 'block', body: [], end: line, line };
    const e = expr();
    expect(';', 'ท้ายคำสั่ง');
    return { k: 'expr', e, line };
  }
  function block(): Stmt & { k: 'block' } {
    const line = expect('{').line;
    const body: Stmt[] = [];
    while (!is('}')) {
      if (t[p].k === 'eof') throw new CError(t[p].line, 'ขาด "}" ปิดบล็อก');
      body.push(stmt());
    }
    const end = t[p++].line;
    return { k: 'block', body, end, line };
  }

  const unit: Unit = { funcs: [], globals: [] };
  while (t[p].k !== 'eof') {
    const line = t[p].line;
    const base = baseType();
    // function or global?
    let q = p;
    while (t[q].k === 'op' && t[q].v === '*') q++;
    if (t[q].k === 'id' && t[q + 1].k === 'op' && t[q + 1].v === '(') {
      const ret = stars(base);
      const name = ident();
      expect('(');
      const params: Param[] = [];
      if (is('void') && peek(1).v === ')') p++;
      if (!is(')'))
        do {
          let ty = stars(baseType());
          const pn = ident();
          if (eat('[')) {
            if (!is(']')) {
              const n = constantInt(assign());
              if (n === null || n <= 0 || n > 4096) throw new CError(line, 'ขนาดพารามิเตอร์อาร์เรย์ต้องเป็นค่าคงที่ (ยังไม่รองรับ VLA)');
            }
            expect(']');
            if (eat('[')) {
              const cols = constantInt(assign());
              if (cols === null || cols <= 0 || cols > 4096) throw new CError(line, 'ต้องระบุจำนวนคอลัมน์คงที่ 1–4096');
              expect(']');
              ty = ptrTo({ k: 'array', elem: ty, size: cols });
            } else ty = ptrTo(ty);
            if (is('[')) throw new CError(line, 'รองรับอาร์เรย์ได้ไม่เกิน 2 มิติ');
          }
          params.push({ name: pn, type: ty });
        } while (eat(','));
      expect(')');
      if (eat(';')) continue; // prototype
      if (params.length > 4) throw new CError(line, `ฟังก์ชัน ${name} มีพารามิเตอร์เกิน 4 ตัว (ส่งผ่าน $a0–$a3 ได้แค่ 4)`);
      unit.funcs.push({ name, ret, params, body: block(), line });
    } else unit.globals.push(...declarators(base, line));
  }
  if (!unit.funcs.length) throw new CError(1, 'ไม่พบฟังก์ชันในโค้ด');
  return unit;
}
