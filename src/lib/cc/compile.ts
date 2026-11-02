// C → MIPS code generator. Produces readable assembly in the style taught in
// class: leaf functions keep params in $a0–$a3 and locals in $t registers;
// non-leaf functions move them to saved $s registers and build a stack frame.
// Every instruction remembers the C line it came from and a Thai explanation.

import {
  CError,
  constantInt,
  decay,
  isArray,
  objectType,
  sizeOf,
  typeText,
  elemOf,
  isPtr,
  isUnsigned,
  parse,
  promote,
  ptrTo,
  type Expr,
  type Func,
  type Param,
  type Stmt,
  type Type,
  type Unit,
  type VarDecl,
} from './parse';

export interface OutLine {
  lbl?: string;
  asm?: string;
  /** 1-based C line */
  c: number;
  ex?: string;
}

export interface CompiledFunc {
  name: string;
  params: Param[];
  ret: Type;
}

export type CompileResult = { ok: true; lines: OutLine[]; asm: string; funcs: CompiledFunc[] } | { ok: false; errors: { line: number; msg: string }[] };

type Store =
  | { k: 'reg'; r: string; type: Type }
  | { k: 'stack'; off: number; type: Type }
  | { k: 'arr'; off: number; size: number; elem: Type; shape: Type }
  | { k: 'garr'; label: string; elem: Type; shape: Type }
  | { k: 'gvar'; label: string; type: Type };

interface Val {
  r: string;
  t: Type;
}

const T_REGS = ['$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7', '$t8', '$t9'];
const S_REGS = ['$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7'];
const A_REGS = ['$a0', '$a1', '$a2', '$a3'];

const fits16 = (v: number) => v >= -32768 && v <= 32767;
const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

function hasCall(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false;
  if ((n as { k?: string }).k === 'sizeof') return false;
  if ((n as { k?: string }).k === 'call') return true;
  return Object.values(n as object).some((v) => (Array.isArray(v) ? v.some(hasCall) : hasCall(v)));
}

function collectDecls(s: Stmt | undefined, out: VarDecl[]) {
  if (!s) return;
  switch (s.k) {
    case 'decl':
      out.push(...s.vars);
      break;
    case 'block':
      s.body.forEach((x) => collectDecls(x, out));
      break;
    case 'if':
      collectDecls(s.a, out);
      collectDecls(s.b, out);
      break;
    case 'while':
    case 'do':
      collectDecls(s.body, out);
      break;
    case 'switch':
      s.cases.forEach((c) => c.body.forEach((x) => collectDecls(x, out)));
      break;
    case 'for':
      collectDecls(s.init, out);
      collectDecls(s.body, out);
      break;
  }
}

function addressNames(n: unknown, names = new Set<string>()): Set<string> {
  if (!n || typeof n !== 'object') return names;
  const x = n as Expr;
  if (x.k === 'sizeof') return names;
  if (x.k === 'un' && x.op === '&' && x.e.k === 'var') names.add(x.e.name);
  for (const value of Object.values(n))
    if (Array.isArray(value)) value.forEach((v) => addressNames(v, names));
    else addressNames(value, names);
  return names;
}
const loadOp = (t: Type) => (t === 'char' ? 'lb' : t === 'uchar' ? 'lbu' : 'lw');
const storeOp = (t: Type) => (t === 'char' || t === 'uchar' ? 'sb' : 'sw');
const align4 = (n: number) => (n + 3) & ~3;
function expressionType(e: Expr, lookup: (name: string, line: number) => Store, unit: Unit): Type {
  const resolve = (x: Expr) => expressionType(x, lookup, unit);
  switch (e.k) {
    case 'num':
      return e.v > 0x7fffffff ? 'uint' : 'int';
    case 'var': {
      const s = lookup(e.name, e.line);
      return s.k === 'reg' || s.k === 'stack' || s.k === 'gvar' ? s.type : s.shape;
    }
    case 'bin': {
      const lt = decay(resolve(e.l));
      const rt = decay(resolve(e.r));
      if (lt === 'void' || rt === 'void') throw new CError(e.line, 'ใช้ค่า void ในนิพจน์ไม่ได้');
      if (['<', '<=', '>', '>=', '==', '!=', '&&', '||'].includes(e.op)) return 'int';
      if ((e.op === '+' || e.op === '-') && isPtr(lt) && !isPtr(rt)) return lt;
      if (e.op === '+' && !isPtr(lt) && isPtr(rt)) return rt;
      if (e.op === '-' && isPtr(lt) && isPtr(rt)) return 'int';
      if (e.op === '<<' || e.op === '>>') return promote(lt);
      return isUnsigned(lt) || isUnsigned(rt) ? 'uint' : 'int';
    }
    case 'un':
      if (e.op === '&') {
        if (!['var', 'index'].includes(e.e.k) && !(e.e.k === 'un' && e.e.op === '*')) throw new CError(e.line, 'ใช้ & ได้เฉพาะตัวแปรหรือสมาชิกอาร์เรย์');
        return ptrTo(resolve(e.e));
      }
      if (e.op === '*') {
        const t = resolve(e.e);
        if (!isPtr(t) || elemOf(t) === 'void') throw new CError(e.line, 'dereference ต้องใช้ pointer ที่มีชนิดข้อมูล');
        return elemOf(t);
      }
      if (e.op === '!') {
        if (resolve(e.e) === 'void') throw new CError(e.line, 'ใช้ ! กับ void ไม่ได้');
        return 'int';
      }
      return promote(resolve(e.e));
    case 'index': {
      const t = resolve(e.a);
      if (!isPtr(t) || elemOf(t) === 'void') throw new CError(e.line, 'ใช้ index ได้เฉพาะอาร์เรย์หรือ pointer ที่มีชนิดข้อมูล');
      return elemOf(t);
    }
    case 'assign':
    case 'inc': {
      if (!['var', 'index'].includes(e.t.k) && !(e.t.k === 'un' && e.t.op === '*'))
        throw new CError(e.line, 'ต้องใช้ตัวแปร สมาชิกอาร์เรย์ หรือ *pointer ทางด้านซ้าย');
      const t = resolve(e.t);
      if (isArray(t)) throw new CError(e.line, 'แก้ค่าอาร์เรย์ทั้งก้อนไม่ได้');
      return t;
    }
    case 'cond': {
      if (resolve(e.c) === 'void') throw new CError(e.line, 'เงื่อนไขต้องมีค่า');
      const a = decay(resolve(e.a)),
        b = decay(resolve(e.b));
      if (a === 'void' || b === 'void') {
        if (a === b) return 'void';
        throw new CError(e.line, 'แขนง ternary ต้องมีชนิดที่เข้ากันได้');
      }
      if (isPtr(a)) return a;
      if (isPtr(b)) return b;
      return isUnsigned(a) || isUnsigned(b) ? 'uint' : 'int';
    }
    case 'cast':
      resolve(e.e);
      return e.to;
    case 'sizeof':
      sizeOf(e.type ?? resolve(e.e!), e.line);
      return 'uint';
    case 'call': {
      const f = unit.funcs.find((f) => f.name === e.name);
      if (!f) throw new CError(e.line, `ไม่พบฟังก์ชัน ${e.name}`);
      if (e.args.length !== f.params.length) throw new CError(e.line, `จำนวนอาร์กิวเมนต์ของ ${e.name} ไม่ตรงกับพารามิเตอร์`);
      e.args.forEach((x) => resolve(x));
      return f.ret;
    }
  }
}

class Labels {
  private n = new Map<string, number>();
  constructor(private taken: Set<string>) {}
  make(base: string) {
    for (;;) {
      const k = (this.n.get(base) ?? 0) + 1;
      this.n.set(base, k);
      const name = k === 1 ? base : base + k;
      if (!this.taken.has(name)) {
        this.taken.add(name);
        return name;
      }
    }
  }
}

class FnGen {
  out: OutLine[] = [];
  private scopes: Map<string, Store>[] = [];
  private names = new Map<string, string>();
  private temps: string[];
  private busy = new Set<string>();
  private loops: {
    brk: string;
    cont: string | null;
    usedBrk: boolean;
    usedCont: boolean;
  }[] = [];
  private frame = 0;
  private saved: [string, number][] = [];
  private ret = '';
  private retUsed = false;
  private localRegs: string[] = [];
  private arrOff = 0;
  private stackDecl = new Set<VarDecl>();
  private declReg = new Map<VarDecl, string>();

  constructor(
    private fn: Func,
    private unit: Unit,
    private globals: Map<string, Store>,
    private labels: Labels,
  ) {
    const leaf = !hasCall(fn.body);
    const decls: VarDecl[] = [];
    collectDecls(fn.body, decls);
    const addressed = addressNames(fn.body);
    const scalars = decls.filter((d) => d.size == null && !addressed.has(d.name));
    decls.filter((d) => d.size == null && addressed.has(d.name)).forEach((d) => this.stackDecl.add(d));
    const arrays = decls.filter((d) => d.size != null);

    if (leaf) {
      // locals in $t0.., keep at least 4 temps; overflow goes to saved $s registers
      const nT = Math.min(scalars.length, T_REGS.length - 4);
      scalars.forEach((d, i) => this.declReg.set(d, i < nT ? T_REGS[i] : S_REGS[i - nT]));
      if (scalars.length - nT > S_REGS.length) throw new CError(fn.line, `ฟังก์ชัน ${fn.name} มีตัวแปรมากเกินไป`);
      this.temps = T_REGS.slice(nT);
      this.localRegs = scalars.slice(nT).map((_, i) => S_REGS[i]);
    } else {
      const need = fn.params.length + scalars.length;
      if (need > S_REGS.length) throw new CError(fn.line, `ฟังก์ชัน ${fn.name} มีพารามิเตอร์และตัวแปรรวม ${need} ตัว เกินจำนวน $s ที่มี (8)`);
      scalars.forEach((d, i) => this.declReg.set(d, S_REGS[fn.params.length + i]));
      this.temps = [...T_REGS];
      this.localRegs = S_REGS.slice(0, need);
    }

    // frame: [local arrays][saved $s][$ra]
    for (const a of arrays) {
      this.declReg.set(a, String(this.arrOff));
      this.arrOff += align4(sizeOf(objectType(a), a.line));
    }
    for (const d of this.stackDecl) {
      this.declReg.set(d, String(this.arrOff));
      this.arrOff += 4;
    }
    const paramOffsets = new Map<string, number>();
    for (const p of fn.params)
      if (addressed.has(p.name)) {
        paramOffsets.set(p.name, this.arrOff);
        this.arrOff += 4;
      }
    let off = this.arrOff;
    for (const r of this.localRegs) {
      this.saved.push([r, off]);
      off += 4;
    }
    if (!leaf) {
      this.saved.push(['$ra', off]);
      off += 4;
    }
    this.frame = align4(off);
    if (this.frame > 32760) throw new CError(fn.line, 'พื้นที่ stack ของฟังก์ชันเกิน 32760 byte — ลดขนาดอาร์เรย์');

    const sc = new Map<string, Store>();
    fn.params.forEach((p, i) => {
      const r = leaf ? A_REGS[i] : S_REGS[i];
      sc.set(p.name, paramOffsets.has(p.name) ? { k: 'stack', off: paramOffsets.get(p.name)!, type: p.type } : { k: 'reg', r, type: p.type });
      if (leaf) this.names.set(r, p.name);
    });
    this.scopes.push(sc);
  }

  // ---------- emission ----------
  private emit(asm: string, line: number, why?: string) {
    const ex = explain(asm, (r) => this.nm(r));
    this.out.push({ asm, c: line, ex: why ? `${ex} — ${why}` : ex });
  }
  private label(name: string, line: number) {
    this.out.push({ lbl: name + ':', c: line });
  }
  private nm(r: string) {
    const n = this.names.get(r);
    if (n) return `\`${r}\` (${n})`;
    if (r === '$v0') return '`$v0` (ค่าคืน)';
    if (r === '$sp') return '`$sp` (stack pointer)';
    return '`' + r + '`';
  }

  /** Cuts register `r` down to what a `t` can hold (char: 8 bits signed, unsigned char: 8 bits). */
  private narrow(r: string, t: Type, line: number) {
    if (t === 'char') {
      this.emit(`sll  ${r}, ${r}, 24`, line, 'char เก็บได้ 8 บิต: เลื่อนบิต 7 ไปไว้บนสุด');
      this.emit(`sra  ${r}, ${r}, 24`, line, 'แล้วเลื่อนกลับแบบรักษาเครื่องหมาย (ตัดเหลือ −128 ถึง 127)');
    } else if (t === 'uchar') this.emit(`andi ${r}, ${r}, 255`, line, 'unsigned char เก็บได้ 8 บิต (0 ถึง 255)');
  }
  /** `v` cut to `t` without touching a variable's own register. */
  private narrowed(v: Val, t: Type, line: number): Val {
    if (t !== 'char' && t !== 'uchar') return v;
    let r = v.r;
    if (!this.temps.includes(r) || !this.busy.has(r)) {
      r = this.alloc(line);
      this.emit(`move ${r}, ${v.r}`, line);
    }
    this.narrow(r, t, line);
    return { r, t };
  }

  private alloc(line: number): string {
    const r = this.temps.find((x) => !this.busy.has(x));
    if (!r) throw new CError(line, 'นิพจน์ซับซ้อนเกินไป (register ชั่วคราวไม่พอ) — ลองแยกเป็นหลายบรรทัด');
    this.busy.add(r);
    return r;
  }
  private free(v: Val | string | null | undefined) {
    const r = typeof v === 'string' ? v : v?.r;
    if (r && this.temps.includes(r)) this.busy.delete(r);
  }

  private lookup(name: string, line: number): Store {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name);
      if (s) return s;
    }
    const g = this.globals.get(name);
    if (g) return g;
    throw new CError(line, `ไม่ได้ประกาศตัวแปร "${name}"`);
  }

  // ---------- function ----------
  run(): OutLine[] {
    const { fn } = this;
    this.ret = this.labels.make(fn.name + '_ret');
    this.label(fn.name, fn.line);
    if (this.frame) {
      this.emit(`addiu $sp, $sp, -${this.frame}`, fn.line, `จองพื้นที่ stack ${this.frame} byte ให้ฟังก์ชันนี้`);
      for (const [r, off] of [...this.saved].reverse()) this.emit(`sw   ${r}, ${off}($sp)`, fn.line, `เก็บค่าเดิมของ ${r} ไว้ก่อนใช้งาน`);
    }
    fn.params.forEach((p, i) => {
      const store = this.scopes[0].get(p.name)!;
      if (store.k === 'stack') {
        this.narrow(A_REGS[i], p.type, fn.line);
        this.emit(`${storeOp(p.type)} ${A_REGS[i]}, ${store.off}($sp)`, fn.line, `เก็บพารามิเตอร์ ${p.name} ในหน่วยความจำเพื่อใช้ &${p.name}`);
        return;
      }
      const r = (store as { r: string }).r;
      this.names.set(r, p.name);
      if (r !== A_REGS[i]) this.emit(`move ${r}, ${A_REGS[i]}`, fn.line, `ย้ายพารามิเตอร์ ${p.name} ไปไว้ใน register ที่ไม่ถูกเขียนทับเมื่อเรียกฟังก์ชันอื่น`);
      this.narrow(r, p.type, fn.line);
    });

    const body = fn.body.body;
    this.scopes.push(new Map());
    body.forEach((s, i) => this.stmt(s, i === body.length - 1));
    this.scopes.pop();

    const last = body.at(-1);
    const endsWithReturn = last?.k === 'return';
    if (this.retUsed) this.label(this.ret, fn.body.end);
    if (this.frame) {
      for (const [r, off] of this.saved) this.emit(`lw   ${r}, ${off}($sp)`, fn.body.end, `คืนค่าเดิมให้ ${r}`);
      this.emit(`addiu $sp, $sp, ${this.frame}`, fn.body.end, 'คืนพื้นที่ stack');
    }
    if (this.frame || this.retUsed || !endsWithReturn) this.emit('jr   $ra', fn.body.end);
    return this.out;
  }

  private stmt(s: Stmt, isLast = false) {
    switch (s.k) {
      case 'block': {
        this.scopes.push(new Map());
        s.body.forEach((x, i) => this.stmt(x, isLast && i === s.body.length - 1));
        this.scopes.pop();
        return;
      }
      case 'decl':
        for (const d of s.vars) this.decl(d);
        return;
      case 'expr':
        this.free(this.expr(s.e, undefined, true));
        return;
      case 'return': {
        if (s.e) {
          if (this.fn.ret === 'void') throw new CError(s.line, `ฟังก์ชัน ${this.fn.name} เป็น void จึงคืนค่าไม่ได้`);
          this.expr(s.e, '$v0');
          this.narrow('$v0', this.fn.ret, s.line);
        }
        if (isLast && !this.frame) this.emit('jr   $ra', s.line);
        else if (!isLast) {
          if (this.frame) {
            this.retUsed = true;
            this.emit(`j    ${this.ret}`, s.line, 'ไปยังส่วนท้ายฟังก์ชันเพื่อคืน stack แล้วกลับ');
          } else this.emit('jr   $ra', s.line);
        }
        return;
      }
      case 'if': {
        const elseL = s.b ? this.labels.make('else') : null;
        const end = this.labels.make('endif');
        this.cond(s.c, elseL ?? end, false, s.line);
        this.stmt(s.a);
        if (s.b) {
          this.emit(`j    ${end}`, s.elseLine ?? s.line, 'ข้ามส่วน else');
          this.label(elseL!, s.elseLine ?? s.line);
          this.stmt(s.b);
        }
        this.label(end, endLine(s.b ?? s.a));
        return;
      }
      case 'while': {
        const top = this.labels.make('loop');
        const done = this.labels.make('done');
        this.label(top, s.line);
        this.cond(s.c, done, false, s.line);
        this.loop(s.body, done, top);
        this.emit(`j    ${top}`, endLine(s.body), 'วนกลับไปตรวจเงื่อนไขอีกครั้ง');
        this.label(done, endLine(s.body));
        return;
      }
      case 'do': {
        const top = this.labels.make('loop');
        const cont = this.labels.make('cond');
        const done = this.labels.make('done');
        this.label(top, s.line);
        const L = this.loop(s.body, done, cont);
        if (L.usedCont) this.label(cont, s.endLine);
        this.cond(s.c, top, true, s.endLine);
        if (L.usedBrk) this.label(done, s.endLine);
        return;
      }
      case 'for': {
        this.scopes.push(new Map());
        if (s.init) this.stmt(s.init);
        const top = this.labels.make('loop');
        const done = this.labels.make('done');
        const cont = this.labels.make('next');
        this.label(top, s.line);
        if (s.c) this.cond(s.c, done, false, s.line);
        const L = this.loop(s.body, done, cont);
        if (L.usedCont) this.label(cont, s.line);
        if (s.step) this.free(this.expr(s.step, undefined, true));
        this.emit(`j    ${top}`, endLine(s.body), 'วนกลับไปตรวจเงื่อนไขอีกครั้ง');
        this.label(done, endLine(s.body));
        this.scopes.pop();
        return;
      }
      case 'switch': {
        if (isPtr(this.typeOf(s.c)) || this.typeOf(s.c) === 'void') throw new CError(s.line, 'switch ต้องใช้ expression จำนวนเต็ม');
        const done = this.labels.make('switch_end');
        const targets = s.cases.map((c) => ({
          ...c,
          label: this.labels.make(c.value ? 'case' : 'default'),
        }));
        const v = this.expr(s.c),
          seen = new Set<number>();
        for (const c of targets)
          if (c.value) {
            const n = this.constOf(c.value);
            if (isPtr(this.typeOf(c.value)) || n === null) throw new CError(c.line, 'case ต้องเป็นนิพจน์จำนวนเต็มคงที่');
            const key = n | 0;
            if (seen.has(key)) throw new CError(c.line, `case ${key} ซ้ำ`);
            seen.add(key);
            const test = this.expr({ k: 'num', v: key, line: c.line });
            this.emit(`beq ${v.r}, ${test.r}, ${c.label}`, c.line, `เลือก case ${key}`);
            this.free(test);
          }
        this.free(v);
        this.emit(`j ${targets.find((c) => !c.value)?.label ?? done}`, s.line, 'ไม่ตรง case: ไป default หรือออกจาก switch');
        this.loops.push({
          brk: done,
          cont: null,
          usedBrk: false,
          usedCont: false,
        });
        this.scopes.push(new Map());
        for (const c of targets) {
          this.label(c.label, c.line);
          c.body.forEach((x) => this.stmt(x));
        }
        this.scopes.pop();
        this.loops.pop();
        this.label(done, s.end);
        return;
      }
      case 'break':
      case 'continue': {
        const L = s.k === 'break' ? this.loops.at(-1) : [...this.loops].reverse().find((x) => x.cont !== null);
        if (!L) throw new CError(s.line, `ใช้ ${s.k} ได้เฉพาะใน${s.k === 'break' ? 'ลูปหรือ switch' : 'ลูป'}`);
        if (s.k === 'break') L.usedBrk = true;
        else L.usedCont = true;
        this.emit(`j    ${s.k === 'break' ? L.brk : L.cont}`, s.line, s.k === 'break' ? 'ออกจากลูปหรือ switch ที่ครอบอยู่' : 'ข้ามไปรอบถัดไป');
        return;
      }
    }
  }

  private loop(body: Stmt, brk: string, cont: string) {
    const L = { brk, cont, usedBrk: false, usedCont: false };
    this.loops.push(L);
    this.stmt(body);
    this.loops.pop();
    return L;
  }

  private decl(d: VarDecl) {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(d.name)) throw new CError(d.line, `ประกาศตัวแปร "${d.name}" ซ้ำ`);
    const loc = this.declReg.get(d)!;
    if (d.size != null) {
      const off = +loc;
      scope.set(d.name, {
        k: 'arr',
        off,
        size: d.size,
        elem: d.type,
        shape: objectType(d),
      });
      if (d.initList) {
        if (d.initList.length > d.size) throw new CError(d.line, `ค่าเริ่มต้นเกินขนาดอาร์เรย์ ${d.name}[${d.size}]`);
        Array.from({ length: d.size }, (_, i) => d.initList![i] ?? { k: 'num' as const, v: 0, line: d.line }).forEach((e, i) => {
          const v = this.narrowed(this.expr(e), d.type, d.line);
          this.emit(`${storeOp(d.type)} ${v.r}, ${off + sizeOf(d.type, d.line) * i}($sp)`, d.line, `${d.name}[${i}] = ${exprText(e)}`);
          this.free(v);
        });
      }
      return;
    }
    if (this.stackDecl.has(d)) {
      scope.set(d.name, { k: 'stack', off: +loc, type: d.type });
      if (d.init) {
        const v = this.narrowed(this.expr(d.init), d.type, d.line);
        this.emit(`${storeOp(d.type)} ${v.r}, ${loc}($sp)`, d.line, `เก็บ ${d.name} ในหน่วยความจำเพื่อใช้ &${d.name}`);
        this.free(v);
      }
      return;
    }
    scope.set(d.name, { k: 'reg', r: loc, type: d.type });
    this.names.set(loc, d.name);
    if (d.init) {
      this.expr(d.init, loc);
      this.narrow(loc, d.type, d.line);
    }
  }

  // ---------- expressions ----------

  private constOf(e: Expr): number | null {
    return constantInt(e, (x) => sizeOf(this.typeOf(x), x.line));
  }

  /** C type of an expression (before integer promotion). */
  private typeOf(e: Expr): Type {
    return expressionType(e, (name, line) => this.lookup(name, line), this.unit);
  }

  /** Whether a comparison of `a` with `b` is unsigned (C converts both to unsigned if either is). */
  private unsignedPair(a: Expr, b: Expr) {
    return isUnsigned(this.typeOf(a)) || isUnsigned(this.typeOf(b));
  }

  /** Evaluates `e`. With `dest` the result lands there; otherwise in a fresh temp or an existing var register. */
  private expr(e: Expr, dest?: string, discard = false): Val {
    const ln = e.line;
    const into = () => dest ?? this.alloc(ln);
    switch (e.k) {
      case 'sizeof': {
        const value = e.type ? sizeOf(e.type, ln) : sizeOf(this.typeOf(e.e!), ln);
        return this.expr({ k: 'num', v: value, line: ln }, dest);
      }
      case 'num': {
        if (!dest && e.v === 0) return { r: '$zero', t: 'int' };
        const d = into();
        if (fits16(e.v)) this.emit(`addiu ${d}, $zero, ${e.v}`, ln);
        else this.emit(`li   ${d}, ${e.v}`, ln);
        return { r: d, t: this.typeOf(e) };
      }
      case 'var': {
        const s = this.lookup(e.name, ln);
        if (s.k === 'reg') {
          if (dest && dest !== s.r) this.emit(`move ${dest}, ${s.r}`, ln);
          return { r: dest ?? s.r, t: s.type };
        }
        if (s.k === 'stack') return this.load(e, dest);
        const d = into();
        if (s.k === 'arr') this.emit(`addiu ${d}, $sp, ${s.off}`, ln, `address ของ ${e.name}[0] บน stack`);
        else if (s.k === 'garr') this.emit(`la   ${d}, ${s.label}`, ln);
        else this.emit(`${loadOp(s.type)} ${d}, ${s.label}`, ln, `อ่านตัวแปร global ${e.name}`);
        return { r: d, t: this.typeOf(e) };
      }
      case 'bin':
        return this.binary(e as Expr & { k: 'bin' }, dest);
      case 'un': {
        if (e.op === '*') return this.load(e, dest);
        if (e.op === '&') {
          const a = this.addr(e.e);
          this.free(a.base);
          const d = into();
          this.emit(`addiu ${d}, ${a.base}, ${a.off}`, ln);
          return { r: d, t: this.typeOf(e) };
        }
        const v = this.expr(e.e);
        this.free(v);
        const d = into();
        if (e.op === '-') this.emit(`subu ${d}, $zero, ${v.r}`, ln);
        else if (e.op === '!') this.emit(`sltiu ${d}, ${v.r}, 1`, ln, 'ได้ 1 เมื่อค่าเป็น 0 (คือ !x)');
        else this.emit(`nor  ${d}, ${v.r}, $zero`, ln);
        return { r: d, t: this.typeOf(e) };
      }
      case 'index':
        return this.load(e, dest);
      case 'assign':
        return this.assign(e as Expr & { k: 'assign' }, dest);
      case 'cast': {
        const to = e.to;
        if (to !== 'char' && to !== 'uchar') {
          const v = this.expr(e.e, dest);
          return { r: v.r, t: to };
        }
        const v = this.expr(e.e);
        const n = this.narrowed(v, to, ln);
        if (dest && dest !== n.r) {
          this.emit(`move ${dest}, ${n.r}`, ln);
          this.free(n);
          return { r: dest, t: to };
        }
        return n;
      }
      case 'inc': {
        const ty = this.typeOf(e.t);
        if (isArray(ty)) throw new CError(ln, 'เพิ่มหรือลดค่าอาร์เรย์ทั้งก้อนไม่ได้');
        const step = isPtr(ty) ? sizeOf(elemOf(ty), ln) : 1;
        const delta = e.op === '++' ? step : -step;
        if (e.t.k === 'var') {
          const s = this.lookup(e.t.name, ln);
          if (s.k === 'reg') {
            let old: string | null = null;
            if (e.post && !discard) {
              old = dest ?? this.alloc(ln);
              this.emit(`move ${old}, ${s.r}`, ln, 'เก็บค่าเดิมไว้ก่อนเพิ่ม');
            }
            this.emit(`addiu ${s.r}, ${s.r}, ${delta}`, ln);
            this.narrow(s.r, s.type, ln);
            if (old) return { r: old, t: s.type };
            if (dest && dest !== s.r) this.emit(`move ${dest}, ${s.r}`, ln);
            return { r: dest ?? s.r, t: s.type };
          }
        }
        // memory target: load, add, store
        const a = this.addr(e.t);
        const v = this.alloc(ln);
        this.emit(`${loadOp(ty)} ${v}, ${a.off}(${a.base})`, ln);
        let old: string | null = null;
        if (e.post && !discard) {
          old = dest ?? this.alloc(ln);
          this.emit(`move ${old}, ${v}`, ln);
        }
        this.emit(`addiu ${v}, ${v}, ${delta}`, ln);
        this.narrow(v, ty, ln);
        this.emit(`${storeOp(ty)} ${v}, ${a.off}(${a.base})`, ln);
        this.free(a.base);
        if (old) {
          this.free(v);
          return { r: old, t: ty };
        }
        if (dest) {
          this.emit(`move ${dest}, ${v}`, ln);
          this.free(v);
          return { r: dest, t: ty };
        }
        return { r: v, t: ty };
      }
      case 'call':
        return this.call(e as Expr & { k: 'call' }, dest, discard);
      case 'cond': {
        const d = this.alloc(ln);
        const elseL = this.labels.make('else');
        const end = this.labels.make('endif');
        this.cond(e.c, elseL, false, ln);
        this.expr(e.a, d);
        this.emit(`j    ${end}`, ln);
        this.label(elseL, ln);
        this.expr(e.b, d);
        this.label(end, ln);
        if (dest) {
          this.emit(`move ${dest}, ${d}`, ln);
          this.free(d);
          return { r: dest, t: this.typeOf(e.a) };
        }
        return { r: d, t: this.typeOf(e.a) };
      }
    }
  }

  private binary(e: Expr & { k: 'bin' }, dest?: string): Val {
    const ln = e.line;
    const op = e.op;
    if (op === '&&' || op === '||' || ['<', '<=', '>', '>=', '==', '!='].includes(op)) {
      if (op === '<' || op === '>') {
        // direct slt for < and >
        const [a, b] = op === '<' ? [e.l, e.r] : [e.r, e.l];
        const u = this.unsignedPair(a, b) ? 'u' : '';
        const l = this.expr(a);
        const k = this.constOf(b);
        if (k != null && fits16(k)) {
          this.free(l);
          const d = dest ?? this.alloc(ln);
          this.emit(`slti${u} ${d}, ${l.r}, ${k}`, ln, u ? 'เทียบแบบไม่มีเครื่องหมาย (unsigned)' : undefined);
          return { r: d, t: 'int' };
        }
        const r = this.expr(b);
        this.free(l);
        this.free(r);
        const d = dest ?? this.alloc(ln);
        this.emit(`slt${u}${u ? '' : ' '} ${d}, ${l.r}, ${r.r}`, ln, u ? 'เทียบแบบไม่มีเครื่องหมาย (unsigned)' : undefined);
        return { r: d, t: 'int' };
      }
      // everything else: materialise 0/1 through branches
      const d = this.alloc(ln);
      const skip = this.labels.make('false');
      this.emit(`addiu ${d}, $zero, 0`, ln, 'ตั้งผลไว้เป็นเท็จก่อน');
      this.cond(e, skip, false, ln);
      this.emit(`addiu ${d}, $zero, 1`, ln, 'เงื่อนไขเป็นจริง');
      this.label(skip, ln);
      if (dest) {
        this.emit(`move ${dest}, ${d}`, ln);
        this.free(d);
        return { r: dest, t: 'int' };
      }
      return { r: d, t: 'int' };
    }

    const lt = decay(this.typeOf(e.l));
    const rt = decay(this.typeOf(e.r));
    if (op === '+' && !isPtr(lt) && isPtr(rt)) return this.binary({ ...e, l: e.r, r: e.l }, dest);
    if (isPtr(lt) && isPtr(rt) && op === '+') throw new CError(ln, 'บวก pointer สองตัวไม่ได้');
    const scale = (op === '+' || op === '-') && isPtr(lt) && !isPtr(rt) ? sizeOf(elemOf(lt), ln) : 1;
    const resT = this.typeOf(e);
    // unsigned: / and % if either side is, >> if the left side is
    const uns = op === '>>' ? isUnsigned(lt) : isUnsigned(lt) || isUnsigned(rt);
    const l = this.expr(e.l);
    const k = this.constOf(e.r);
    // only the logical immediates take 0…65535; addiu's immediate is signed (handled above)
    const IMM: Record<string, string> = {
      '&': 'andi',
      '|': 'ori',
      '^': 'xori',
    };
    if (k != null) {
      const kk = k * scale;
      let ins: string | null = null;
      if (op === '+' && fits16(kk)) ins = `addiu #, ${l.r}, ${kk}`;
      else if (op === '-' && fits16(-kk)) ins = `addiu #, ${l.r}, ${-kk}`;
      else if (IMM[op] && k >= 0 && k <= 0xffff) ins = `${IMM[op].padEnd(4)} #, ${l.r}, ${k}`;
      else if (op === '<<' && k >= 0 && k < 32) ins = `sll  #, ${l.r}, ${k}`;
      else if (op === '>>' && k >= 0 && k < 32) ins = `${uns ? 'srl ' : 'sra '} #, ${l.r}, ${k}`;
      else if (op === '*' && isPow2(k)) ins = `sll  #, ${l.r}, ${Math.log2(k)}`;
      if (ins) {
        this.free(l);
        const d = dest ?? this.alloc(ln);
        this.emit(ins.replace('#', d), ln, op === '*' ? `คูณ ${k} ด้วยการเลื่อนบิต` : undefined);
        return { r: d, t: resT };
      }
    }
    let r = this.expr(e.r);
    if (scale !== 1) r = this.scaled(r, scale, ln);
    this.free(l);
    this.free(r);
    const d = dest ?? this.alloc(ln);
    const R3: Record<string, string> = {
      '+': 'addu',
      '-': 'subu',
      '&': 'and',
      '|': 'or',
      '^': 'xor',
      '<<': 'sllv',
      '>>': uns ? 'srlv' : 'srav',
    };
    if (R3[op]) this.emit(`${R3[op].padEnd(4)} ${d}, ${l.r}, ${r.r}`, ln);
    else if (op === '*') {
      this.emit(`mult ${l.r}, ${r.r}`, ln);
      this.emit(`mflo ${d}`, ln, 'ผลคูณ 32 บิตล่างอยู่ใน LO');
    } else if (op === '/' || op === '%') {
      this.emit(`${uns ? 'divu' : 'div '} ${l.r}, ${r.r}`, ln, uns ? 'หารแบบไม่มีเครื่องหมาย (unsigned)' : undefined);
      this.emit(op === '/' ? `mflo ${d}` : `mfhi ${d}`, ln, op === '/' ? 'ผลหารอยู่ใน LO' : 'เศษอยู่ใน HI');
    } else throw new CError(ln, `ยังไม่รองรับตัวดำเนินการ ${op}`);
    if (isPtr(lt) && isPtr(rt) && op === '-') {
      const stride = sizeOf(elemOf(lt), ln);
      if (JSON.stringify(elemOf(lt)) !== JSON.stringify(elemOf(rt))) throw new CError(ln, 'ลบ pointer ที่ชี้ข้อมูลต่างชนิดกันไม่ได้');
      if (stride > 1) {
        this.emit(`li $at, ${stride}`, ln);
        this.emit(`div ${d}, $at`, ln);
        this.emit(`mflo ${d}`, ln, 'หารด้วยขนาดสมาชิกเพื่อได้ระยะห่างเป็นจำนวนสมาชิก');
      }
    }
    return { r: d, t: resT };
  }

  private scaled(v: Val, scale: number, line: number): Val {
    if (scale === 1) return v;
    const r = this.alloc(line);
    if (isPow2(scale)) this.emit(`sll ${r}, ${v.r}, ${Math.log2(scale)}`, line, `คูณ index ด้วยขนาดสมาชิก ${scale} byte`);
    else {
      this.emit(`li ${r}, ${scale}`, line);
      this.emit(`mult ${v.r}, ${r}`, line);
      this.emit(`mflo ${r}`, line, `คูณ index ด้วยขนาดแถว ${scale} byte`);
    }
    this.free(v);
    return { r, t: 'int' };
  }
  /** Computes an lvalue address once. Array expressions decay without reading memory. */
  private addr(e: Expr): { base: string; off: number } {
    const ln = e.line;
    if (e.k === 'var') {
      const s = this.lookup(e.name, ln);
      if (s.k === 'stack' || s.k === 'arr') return { base: '$sp', off: s.off };
      if (s.k === 'gvar' || s.k === 'garr') {
        const r = this.alloc(ln);
        this.emit(`la ${r}, ${s.label}`, ln);
        return { base: r, off: 0 };
      }
      throw new CError(ln, `ตัวแปร ${e.name} ไม่มีที่อยู่ในหน่วยความจำ`);
    }
    if (e.k === 'un' && e.op === '*') {
      this.typeOf(e);
      const v = this.expr(e.e);
      return { base: v.r, off: 0 };
    }
    if (e.k === 'index') {
      const ty = this.typeOf(e),
        stride = sizeOf(ty, ln),
        k = this.constOf(e.i);
      if (e.a.k === 'var') {
        const s = this.lookup(e.a.name, ln);
        if (s.k === 'arr' && k !== null && fits16(s.off + k * stride)) return { base: '$sp', off: s.off + k * stride };
      }
      const base = this.expr(e.a);
      if (k !== null && fits16(k * stride)) return { base: base.r, off: k * stride };
      const index = this.scaled(this.expr(e.i), stride, ln),
        r = this.alloc(ln);
      this.emit(`addu ${r}, ${base.r}, ${index.r}`, ln, `คำนวณ address ของ ${exprText(e)}`);
      this.free(base);
      this.free(index);
      return { base: r, off: 0 };
    }
    throw new CError(ln, 'ต้องเป็นตัวแปร สมาชิกอาร์เรย์ หรือ *pointer');
  }
  private load(e: Expr, dest?: string): Val {
    const t = this.typeOf(e),
      a = this.addr(e);
    this.free(a.base);
    const d = dest ?? this.alloc(e.line);
    if (isArray(t)) this.emit(`addiu ${d}, ${a.base}, ${a.off}`, e.line, 'address เริ่มต้นของแถว ไม่ได้อ่านค่าแถวเป็นจำนวนเต็ม');
    else this.emit(`${loadOp(t)} ${d}, ${a.off}(${a.base})`, e.line, `อ่าน ${exprText(e)}`);
    return { r: d, t: decay(t) };
  }

  private assign(e: Expr & { k: 'assign' }, dest?: string): Val {
    const ln = e.line;
    const value: Expr = e.op === '=' ? e.v : { k: 'bin', op: e.op.slice(0, -1), l: e.t, r: e.v, line: ln };
    if (e.t.k === 'var') {
      const s = this.lookup(e.t.name, ln);
      if (s.k === 'reg') {
        this.expr(value, s.r);
        this.narrow(s.r, s.type, ln);
        if (dest && dest !== s.r) this.emit(`move ${dest}, ${s.r}`, ln);
        return { r: dest ?? s.r, t: s.type };
      }
      if (s.k === 'arr' || s.k === 'garr') throw new CError(ln, `กำหนดค่าให้อาร์เรย์ ${e.t.name} ทั้งก้อนไม่ได้`);
    }
    const et = this.typeOf(e.t);
    if (isArray(et)) throw new CError(ln, 'กำหนดค่าอาร์เรย์หรือแถวทั้งก้อนไม่ได้');
    const a = this.addr(e.t);
    let v: Val;
    if (e.op === '=') v = this.narrowed(this.expr(e.v), et, ln);
    else {
      const old = this.alloc(ln);
      this.emit(`${loadOp(et)} ${old}, ${a.off}(${a.base})`, ln);
      const name = '$lvalue';
      this.scopes.push(new Map([[name, { k: 'reg', r: old, type: et }]]));
      v = this.narrowed(
        this.binary({
          k: 'bin',
          op: e.op.slice(0, -1),
          l: { k: 'var', name, line: ln },
          r: e.v,
          line: ln,
        }),
        et,
        ln,
      );
      this.scopes.pop();
      if (v.r !== old) this.free(old);
    }
    this.emit(`${storeOp(et)} ${v.r}, ${a.off}(${a.base})`, ln, `เขียนค่าลง ${exprText(e.t)}`);
    this.free(a.base);
    if (dest) {
      this.emit(`move ${dest}, ${v.r}`, ln);
      this.free(v);
      return { r: dest, t: et };
    }
    return v;
  }

  private call(e: Expr & { k: 'call' }, dest?: string, discard = false): Val {
    const ln = e.line;
    const f = this.unit.funcs.find((x) => x.name === e.name);
    if (!f) throw new CError(ln, `ไม่พบฟังก์ชัน "${e.name}"`);
    if (f.params.length !== e.args.length) throw new CError(ln, `ฟังก์ชัน ${e.name} ต้องการ ${f.params.length} อาร์กิวเมนต์ แต่ส่งมา ${e.args.length}`);
    const nested = e.args.some(hasCall);
    if (nested) {
      const vals = e.args.map((a) => this.expr(a));
      vals.forEach((v, i) => {
        this.emit(`move ${A_REGS[i]}, ${v.r}`, ln, `ส่ง ${f.params[i].name} ผ่าน ${A_REGS[i]}`);
        this.free(v);
      });
    } else e.args.forEach((a, i) => this.expr(a, A_REGS[i]));

    const live = this.temps.filter((r) => this.busy.has(r));
    if (live.length) {
      this.emit(`addiu $sp, $sp, -${4 * live.length}`, ln, 'เก็บค่าชั่วคราวที่ยังใช้อยู่ก่อนเรียกฟังก์ชัน');
      live.forEach((r, i) => this.emit(`sw   ${r}, ${4 * i}($sp)`, ln));
    }
    this.emit(`jal  ${e.name}`, ln);
    if (live.length) {
      live.forEach((r, i) => this.emit(`lw   ${r}, ${4 * i}($sp)`, ln));
      this.emit(`addiu $sp, $sp, ${4 * live.length}`, ln);
    }
    if (discard) return { r: '$v0', t: f.ret };
    const d = dest ?? this.alloc(ln);
    if (d !== '$v0') this.emit(`move ${d}, $v0`, ln, `ผลลัพธ์ของ ${e.name} อยู่ใน $v0`);
    return { r: d, t: f.ret };
  }

  /** Emits a branch to `L` when the truth of `e` equals `jumpIf`; falls through otherwise. */
  private cond(e: Expr, L: string, jumpIf: boolean, line: number): void {
    const ln = e.line ?? line;
    const txt = exprText(e);
    if (e.k === 'un' && e.op === '!') return this.cond(e.e, L, !jumpIf, line);
    if (e.k === 'num') {
      if (!!e.v === jumpIf) this.emit(`j    ${L}`, ln);
      return;
    }
    if (e.k === 'bin' && (e.op === '&&' || e.op === '||')) {
      const and = e.op === '&&';
      if (and !== jumpIf) {
        // && jumping when false / || jumping when true: either side decides
        this.cond(e.l, L, jumpIf, line);
        this.cond(e.r, L, jumpIf, line);
      } else {
        const skip = this.labels.make('skip');
        this.cond(e.l, skip, !jumpIf, line);
        this.cond(e.r, L, jumpIf, line);
        this.label(skip, ln);
      }
      return;
    }
    if (e.k === 'bin' && (e.op === '==' || e.op === '!=')) {
      const l = this.expr(e.l);
      const k = this.constOf(e.r);
      const r = k === 0 ? { r: '$zero', t: 'int' as Type } : this.expr(e.r);
      this.free(l);
      this.free(r);
      const eq = (e.op === '==') === jumpIf;
      this.emit(`${eq ? 'beq ' : 'bne '} ${l.r}, ${r.r}, ${L}`, ln, `คือเมื่อ \`${txt}\` เป็น${jumpIf ? 'จริง' : 'เท็จ'}`);
      return;
    }
    if (e.k === 'bin' && ['<', '<=', '>', '>='].includes(e.op)) {
      // a < b and a >= b use slt(a, b); a > b and a <= b use slt(b, a)
      const swap = e.op === '>' || e.op === '<=';
      const [a, b] = swap ? [e.r, e.l] : [e.l, e.r];
      const sltTrue = e.op === '<' || e.op === '>'; // slt result 1 means the relation holds
      const u = this.unsignedPair(a, b) ? 'u' : '';
      const how = u ? 'เทียบแบบไม่มีเครื่องหมาย (unsigned)' : undefined;
      let t: string;
      const kb = this.constOf(b);
      if (kb != null && fits16(kb)) {
        const va = this.expr(a);
        this.free(va);
        t = this.alloc(ln);
        this.emit(`slti${u} ${t}, ${va.r}, ${kb}`, ln, how);
      } else {
        const va = a.k === 'num' && a.v === 0 ? { r: '$zero' } : this.expr(a);
        const vb = this.expr(b);
        this.free(va.r);
        this.free(vb);
        t = this.alloc(ln);
        this.emit(`slt${u}${u ? '' : ' '} ${t}, ${va.r}, ${vb.r}`, ln, sltTrue ? how : `คือเงื่อนไข \`${txt}\` ที่กลับด้าน${u ? ' · unsigned' : ''}`);
      }
      this.free(t);
      const jumpWhenOne = sltTrue === jumpIf;
      this.emit(`${jumpWhenOne ? 'bne ' : 'beq '} ${t}, $zero, ${L}`, ln, jumpIf ? `คือเมื่อ \`${txt}\` เป็นจริง` : `คือเมื่อ \`${txt}\` เป็นเท็จ`);
      return;
    }
    const v = this.expr(e);
    this.free(v);
    this.emit(`${jumpIf ? 'bne ' : 'beq '} ${v.r}, $zero, ${L}`, ln);
  }
}

function endLine(s: Stmt): number {
  return s.k === 'block' ? s.end : s.line;
}

/** Short C rendering of an expression for explanations. */
export function exprText(e: Expr): string {
  switch (e.k) {
    case 'num':
      return String(e.v);
    case 'var':
      return e.name;
    case 'bin':
      return `${exprText(e.l)} ${e.op} ${exprText(e.r)}`;
    case 'un':
      return e.op + exprText(e.e);
    case 'assign':
      return `${exprText(e.t)} ${e.op} ${exprText(e.v)}`;
    case 'inc':
      return e.post ? exprText(e.t) + e.op : e.op + exprText(e.t);
    case 'index':
      return `${exprText(e.a)}[${exprText(e.i)}]`;
    case 'call':
      return `${e.name}(${e.args.map(exprText).join(', ')})`;
    case 'cond':
      return `${exprText(e.c)} ? ${exprText(e.a)} : ${exprText(e.b)}`;
    case 'sizeof':
      return `sizeof(${e.type ? typeText(e.type) : exprText(e.e!)})`;
    case 'cast':
      return `(${typeText(e.to)}) ${exprText(e.e)}`;
  }
}

/** Thai description of one assembly instruction; `nm` decorates register names. */
export function explain(asm: string, nm: (r: string) => string = (r) => '`' + r + '`'): string {
  const m = /^\s*(\w+)\s*(.*)$/.exec(asm);
  if (!m) return '';
  const mn = m[1];
  const o = m[2].split(',').map((s) => s.trim());
  const mem = (s: string) => {
    const x = /^(-?\d*)\((\$\w+)\)$/.exec(s);
    return x ? `${nm(x[2])} + ${x[1] || 0}` : s;
  };
  const SYM: Record<string, string> = {
    and: 'AND',
    or: 'OR',
    xor: 'XOR',
    nor: 'NOR',
    andi: 'AND',
    ori: 'OR',
    xori: 'XOR',
  };
  switch (mn) {
    case 'addi':
    case 'addiu': {
      const k = +o[2];
      if (o[1] === '$zero') return `ตั้ง ${nm(o[0])} = ${k}`;
      if (o[0] === o[1]) return k >= 0 ? `เพิ่ม ${nm(o[0])} ขึ้น ${k}` : `ลด ${nm(o[0])} ลง ${-k}`;
      return `${nm(o[0])} = ${nm(o[1])} ${k >= 0 ? '+ ' + k : '− ' + -k}`;
    }
    case 'add':
    case 'addu':
      if (o[2] === '$zero') return `คัดลอก ${nm(o[1])} ไปที่ ${nm(o[0])}`;
      return `บวก ${nm(o[1])} กับ ${nm(o[2])} แล้วเก็บผลใน ${nm(o[0])}`;
    case 'sub':
    case 'subu':
      if (o[1] === '$zero') return `${nm(o[0])} = −${nm(o[2])}`;
      return `ลบ ${nm(o[1])} ด้วย ${nm(o[2])} แล้วเก็บผลใน ${nm(o[0])}`;
    case 'and':
    case 'or':
    case 'xor':
    case 'nor':
    case 'andi':
    case 'ori':
    case 'xori':
      if (mn === 'nor' && o[2] === '$zero') return `กลับบิตทุกบิตของ ${nm(o[1])} เก็บใน ${nm(o[0])}`;
      return `${nm(o[0])} = ${nm(o[1])} ${SYM[mn]} ${o[2].startsWith('$') ? nm(o[2]) : o[2]} (ทีละบิต)`;
    case 'slt':
    case 'sltu':
    case 'slti':
    case 'sltiu':
      if ((mn === 'sltiu' || mn === 'slti') && o[2] === '1') return `ถ้า ${nm(o[1])} เป็น 0 ให้ ${nm(o[0])} = 1 ไม่เช่นนั้นเป็น 0`;
      return `ถ้า ${nm(o[1])} < ${o[2].startsWith('$') ? nm(o[2]) : o[2]} ให้ ${nm(o[0])} = 1 ไม่เช่นนั้นเป็น 0`;
    case 'sll':
      return `เลื่อน ${nm(o[1])} ไปทางซ้าย ${o[2]} บิต (คูณ ${2 ** +o[2]}) เก็บใน ${nm(o[0])}`;
    case 'srl':
    case 'sra':
      return `เลื่อน ${nm(o[1])} ไปทางขวา ${o[2]} บิต (หาร ${2 ** +o[2]}) เก็บใน ${nm(o[0])}`;
    case 'sllv':
    case 'srav':
    case 'srlv':
      return `เลื่อน ${nm(o[1])} ไปทาง${mn === 'sllv' ? 'ซ้าย' : 'ขวา'} ตามจำนวนบิตใน ${nm(o[2])} เก็บใน ${nm(o[0])}`;
    case 'move':
      return `คัดลอก ${nm(o[1])} ไปที่ ${nm(o[0])}`;
    case 'li':
      return `ตั้ง ${nm(o[0])} = ${o[1]}`;
    case 'la':
      return `โหลด address ของ \`${o[1]}\` ไว้ใน ${nm(o[0])}`;
    case 'lui':
      return `วาง ${o[1]} ไว้ที่ 16 บิตบนของ ${nm(o[0])}`;
    case 'lw':
      return `อ่าน word จาก memory ที่ address ${mem(o[1])} มาไว้ใน ${nm(o[0])}`;
    case 'sw':
      return `เขียน ${nm(o[0])} ลง memory ที่ address ${mem(o[1])}`;
    case 'll':
      return `อ่าน word ที่ address ${mem(o[1])} มาไว้ใน ${nm(o[0])} แล้วจอง address นี้ไว้ (load linked)`;
    case 'sc':
      return `เขียน ${nm(o[0])} ลงที่ ${mem(o[1])} เฉพาะเมื่อยังจองอยู่ แล้วตั้ง ${nm(o[0])} = 1 ถ้าสำเร็จ / 0 ถ้าไม่สำเร็จ (store conditional)`;
    case 'beq':
      return o[1] === '$zero' ? `ถ้า ${nm(o[0])} = 0 ให้กระโดดไป \`${o[2]}\`` : `ถ้า ${nm(o[0])} = ${nm(o[1])} ให้กระโดดไป \`${o[2]}\``;
    case 'bne':
      return o[1] === '$zero' ? `ถ้า ${nm(o[0])} ≠ 0 ให้กระโดดไป \`${o[2]}\`` : `ถ้า ${nm(o[0])} ≠ ${nm(o[1])} ให้กระโดดไป \`${o[2]}\``;
    case 'j':
      return `กระโดดไปที่ \`${o[0]}\``;
    case 'jal':
      return `เรียกฟังก์ชัน \`${o[0]}\` (จำที่อยู่กลับไว้ใน \`$ra\`)`;
    case 'jr':
      return o[0] === '$ra' ? 'กระโดดไปยัง address ใน `$ra` คือกลับไปหาผู้เรียกฟังก์ชัน' : `กระโดดไปยัง address ใน ${nm(o[0])}`;
    case 'mult':
      return `คูณ ${nm(o[0])} × ${nm(o[1])} ผล 64 บิตเก็บใน HI และ LO`;
    case 'div':
    case 'divu':
      return `หาร ${nm(o[0])} ÷ ${nm(o[1])} ผลหารเก็บใน LO เศษเก็บใน HI`;
    case 'mflo':
      return `คัดลอกค่าจาก LO มาไว้ใน ${nm(o[0])}`;
    case 'mfhi':
      return `คัดลอกค่าจาก HI มาไว้ใน ${nm(o[0])}`;
    default:
      return '';
  }
}

export function compileC(src: string): CompileResult {
  let unit: Unit;
  try {
    unit = parse(src);
  } catch (e) {
    if (e instanceof CError) return { ok: false, errors: [{ line: e.line, msg: e.message }] };
    if (e instanceof RangeError)
      return {
        ok: false,
        errors: [
          {
            line: 1,
            msg: 'โค้ดซ้อนลึกหรือซับซ้อนเกินขอบเขต compiler สำหรับการเรียน',
          },
        ],
      };
    throw e;
  }
  const errors: { line: number; msg: string }[] = [];
  const names = new Set<string>(unit.funcs.map((f) => f.name));
  const labels = new Labels(names);
  const globals = new Map<string, Store>();
  const data: OutLine[] = [];
  const globalTypes = new Map<string, Store>();
  for (const g of unit.globals)
    globalTypes.set(g.name, g.size == null ? { k: 'gvar', label: g.name, type: g.type } : { k: 'garr', label: g.name, elem: g.type, shape: objectType(g) });
  const globalLookup = (name: string, line: number) => {
    const value = globalTypes.get(name);
    if (!value) throw new CError(line, `ไม่ได้ประกาศตัวแปร ${name}`);
    return value;
  };
  for (const g of unit.globals) {
    if (globals.has(g.name) || unit.funcs.some((f) => f.name === g.name)) {
      errors.push({ line: g.line, msg: `ประกาศตัวแปร "${g.name}" ซ้ำ` });
      continue;
    }
    names.add(g.name);
    data.push({ asm: '.align 2', c: g.line });
    let vals: number[] = [];
    try {
      vals = (g.initList ?? (g.init ? [g.init] : [])).map((e) => constantInt(e, (x) => sizeOf(expressionType(x, globalLookup, unit), x.line)) ?? NaN);
    } catch (e) {
      if (!(e instanceof CError)) throw e;
      errors.push({ line: e.line, msg: e.message });
    }
    vals = vals.map((n) => (Number.isNaN(n) ? NaN : g.type === 'char' ? (n << 24) >> 24 : g.type === 'uchar' ? n & 255 : n));
    if (vals.some(Number.isNaN))
      errors.push({
        line: g.line,
        msg: `ค่าเริ่มต้นของตัวแปร global ${g.name} ต้องเป็นค่าคงที่`,
      });
    if (g.size != null) {
      globals.set(g.name, {
        k: 'garr',
        label: g.name,
        elem: g.type,
        shape: objectType(g),
      });
      const words = Array.from({ length: g.size }, (_, i) => vals[i] ?? 0);
      data.push(
        { lbl: g.name + ':', c: g.line },
        {
          asm: `${sizeOf(g.type, g.line) === 1 ? '.byte' : '.word'} ${words.join(', ')}`,
          c: g.line,
          ex: `อาร์เรย์ ${g.name} ${g.size} ช่อง`,
        },
      );
    } else {
      globals.set(g.name, { k: 'gvar', label: g.name, type: g.type });
      data.push(
        { lbl: g.name + ':', c: g.line },
        {
          asm: `${sizeOf(g.type, g.line) === 1 ? '.byte' : '.word'} ${vals[0] ?? 0}`,
          c: g.line,
          ex: `ตัวแปร global ${g.name}`,
        },
      );
    }
  }
  const seen = new Set<string>();
  const lines: OutLine[] = [];
  for (const f of unit.funcs) {
    if (seen.has(f.name)) {
      errors.push({ line: f.line, msg: `ประกาศฟังก์ชัน ${f.name} ซ้ำ` });
      continue;
    }
    seen.add(f.name);
    try {
      lines.push(...new FnGen(f, unit, globals, labels).run());
    } catch (e) {
      if (e instanceof RangeError) errors.push({line:f.line,msg:'นิพจน์ซ้อนลึกเกินขอบเขต compiler สำหรับการเรียน'});
      else if(e instanceof CError)errors.push({line:e.line,msg:e.message});
      else throw e;
    }
  }
  if (errors.length) return { ok: false, errors };
  if (data.length) lines.push({ asm: '.data', c: 0 }, ...data);
  const asm = lines.map((l) => (l.lbl ? l.lbl : '    ' + l.asm)).join('\n');
  return {
    ok: true,
    lines,
    asm,
    funcs: unit.funcs.map((f) => ({
      name: f.name,
      params: f.params,
      ret: f.ret,
    })),
  };
}
