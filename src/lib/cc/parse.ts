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

const KW = new Set(['int', 'void', 'char', 'unsigned', 'const', 'if', 'else', 'while', 'for', 'do', 'return', 'break', 'continue']);
const OPS = [
  '<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', ';', ',', '(', ')', '{', '}', '[', ']',
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
      const end = e < 0 ? src.length : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end;
      continue;
    }
    if (c === '#') {
      // preprocessor lines (#include …) are ignored
      while (i < src.length && src[i] !== '\n') i++;
      continue;
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
      const v = s.length === 2 ? ({ n: 10, t: 9, '0': 0, '\\': 92, "'": 39 } as Record<string, number>)[s[1]] ?? s.charCodeAt(1) : s.charCodeAt(0);
      out.push({ k: 'num', v: ch[0], n: v, line });
      i += ch[0].length;
      continue;
    }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 64));
    if (id) {
      out.push({ k: KW.has(id[0]) ? 'kw' : 'id', v: id[0], line });
      i += id[0].length;
      continue;
    }
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
 * remember what they point to; every element still takes one 4-byte word.
 */
export type Type = 'int' | 'uint' | 'char' | 'uchar' | 'void' | 'ptr' | 'uptr' | 'cptr' | 'ucptr';

const PTR: Record<string, Type> = { int: 'ptr', uint: 'uptr', char: 'cptr', uchar: 'ucptr' };
const ELEM: Record<string, Type> = { ptr: 'int', uptr: 'uint', cptr: 'char', ucptr: 'uchar' };
export const isPtr = (t: Type) => t in ELEM;
/** pointer to `t`; pointers to pointers (and void *) are treated as int * */
export const ptrTo = (t: Type): Type => PTR[t] ?? 'ptr';
export const elemOf = (t: Type): Type => ELEM[t] ?? 'int';
/** C's integer promotion: char and unsigned char take part in arithmetic as int */
export const promote = (t: Type): Type => (t === 'char' || t === 'uchar' ? 'int' : t);
export const isUnsigned = (t: Type) => promote(t) === 'uint';

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
);

export interface VarDecl {
  name: string;
  type: Type;
  /** element count for arrays */
  size?: number;
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
      if (eat('[')) {
        if (is(']')) d.size = -1;
        else {
          const n = t[p];
          if (n.k !== 'num') throw new CError(n.line, 'ขนาดอาร์เรย์ต้องเป็นตัวเลขคงที่');
          d.size = n.n!;
          p++;
        }
        expect(']');
      }
      if (eat('=')) {
        if (d.size != null) {
          expect('{', 'สำหรับค่าเริ่มต้นของอาร์เรย์');
          d.initList = [];
          if (!is('}'))
            do d.initList.push(assign());
            while (eat(',') && !is('}'));
          expect('}');
          if (d.size === -1) d.size = d.initList.length;
        } else d.init = assign();
      }
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
      if (!['var', 'index'].includes(l.k) && !(l.k === 'un' && l.op === '*'))
        throw new CError(op.line, 'ด้านซ้ายของ = ต้องเป็นตัวแปร, a[i] หรือ *p');
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
            if (t[p].k === 'num') p++;
            expect(']');
            ty = ptrTo(ty);
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
