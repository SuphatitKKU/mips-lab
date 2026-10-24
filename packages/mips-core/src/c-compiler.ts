import { assemble } from './assembler';

type Token = { value: string; line: number };
type Expr = { kind: 'num' | 'var' | 'index' | 'call' | 'unary' | 'bin'; value: string; args: Expr[]; line: number };
type Stmt =
  | { kind: 'block'; body: Stmt[]; line: number }
  | { kind: 'decl'; name: string; size: number; init?: Expr; line: number }
  | { kind: 'assign'; name: string; index?: Expr; value: Expr; line: number }
  | { kind: 'expr' | 'return'; value: Expr; line: number }
  | { kind: 'if'; test: Expr; body: Stmt; elseBody?: Stmt; line: number }
  | { kind: 'while'; test: Expr; body: Stmt; line: number }
  | { kind: 'for'; init?: Stmt; test?: Expr; post?: Stmt; body: Stmt; line: number };
type Func = { name: string; params: string[]; body: Stmt; line: number };
export interface CCompileResult { asm: string; mapping: { cLine: number; asmLines: number[] }[] }
export class CCompileError extends Error {
  constructor(message: string, public line: number) { super(`Line ${line}: ${message}`); this.name = 'CCompileError'; }
}
function tokenize(src: string): Token[] {
  const out: Token[] = []; let line = 1, i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { if (src[i] === '\n') line++; i++; continue; }
    if (src.slice(i, i + 2) === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.slice(i, i + 2) === '/*') { i += 2; while (i < src.length && src.slice(i, i + 2) !== '*/') { if (src[i] === '\n') line++; i++; } if (i >= src.length) throw new CCompileError('unterminated comment', line); i += 2; continue; }
    const m = /^(==|!=|<=|>=|&&|\|\||\+\+|--|0x[\da-fA-F]+|\d+|[A-Za-z_]\w*|[{}()[\];,+\-*\/%<>=!])/.exec(src.slice(i));
    if (!m) throw new CCompileError(`unsupported character ${src[i]}`, line);
    out.push({ value: m[0], line }); i += m[0].length;
  }
  out.push({ value: '<eof>', line }); return out;
}
class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}
  get t() { return this.tokens[this.pos]; }
  take(v?: string) { const t = this.t; if (v && t.value !== v) throw new CCompileError(`expected '${v}', got '${t.value}'`, t.line); this.pos++; return t; }
  match(v: string) { if (this.t.value === v) { this.pos++; return true; } return false; }
  ident() { const t = this.take(); if (!/^[A-Za-z_]\w*$/.test(t.value) || ['int','if','else','while','for','return'].includes(t.value)) throw new CCompileError(`expected name, got '${t.value}'`, t.line); return t; }
  program(): Func[] {
    const funcs: Func[] = [];
    while (this.t.value !== '<eof>') {
      const start = this.take('int'); const name = this.ident().value; this.take('(');
      const params: string[] = [];
      if (this.t.value !== ')') do { this.take('int'); params.push(this.ident().value); } while (this.match(','));
      this.take(')'); funcs.push({ name, params, body: this.statement(), line: start.line });
    }
    if (!funcs.some(f => f.name === 'main')) throw new CCompileError('int main() is required', 1);
    if (new Set(funcs.map(f => f.name)).size !== funcs.length) throw new CCompileError('duplicate function name', 1);
    return funcs;
  }
  statement(): Stmt {
    const line = this.t.line;
    if (this.match('{')) { const body: Stmt[] = []; while (this.t.value !== '}') { if (this.t.value === '<eof>') throw new CCompileError('missing }', line); body.push(this.statement()); } this.take('}'); return { kind: 'block', body, line }; }
    if (this.match('int')) {
      const name = this.ident().value; let size = 1;
      if (this.match('[')) { const n = this.take(); size = Number(n.value); if (!Number.isInteger(size) || size < 1 || size > 128) throw new CCompileError('array size must be 1–128', n.line); this.take(']'); }
      const init = this.match('=') ? this.expr() : undefined;
      if (size > 1 && init) throw new CCompileError('array initializer is not supported', line);
      this.take(';'); return { kind: 'decl', name, size, init, line };
    }
    if (this.match('if')) { this.take('('); const test = this.expr(); this.take(')'); const body = this.statement(); const elseBody = this.match('else') ? this.statement() : undefined; return { kind: 'if', test, body, elseBody, line }; }
    if (this.match('while')) { this.take('('); const test = this.expr(); this.take(')'); return { kind: 'while', test, body: this.statement(), line }; }
    if (this.match('for')) {
      this.take('(');
      const init = this.t.value === ';' ? undefined : this.forPart(true);
      this.take(';'); const test = this.t.value === ';' ? undefined : this.expr(); this.take(';');
      const post = this.t.value === ')' ? undefined : this.forPart(false);
      this.take(')'); return { kind: 'for', init, test, post, body: this.statement(), line };
    }
    if (this.match('return')) { const value = this.expr(); this.take(';'); return { kind: 'return', value, line }; }
    const s = this.simple(); this.take(';'); return s;
  }
  private forPart(allowDecl: boolean): Stmt {
    const line = this.t.line;
    if (allowDecl && this.match('int')) { const name = this.ident().value; const init = this.match('=') ? this.expr() : undefined; return { kind: 'decl', name, size: 1, init, line }; }
    return this.simple();
  }
  private simple(): Stmt {
    const line = this.t.line, saved = this.pos;
    if (/^[A-Za-z_]\w*$/.test(this.t.value)) {
      const name = this.take().value;
      let index: Expr | undefined;
      if (this.match('[')) { index = this.expr(); this.take(']'); }
      if (this.match('=')) return { kind: 'assign', name, index, value: this.expr(), line };
      if (this.match('++') || this.match('--')) {
        const increment = this.tokens[this.pos - 1].value === '++' ? 1 : -1;
        return { kind: 'assign', name, index, value: { kind: 'bin', value: '+', args: [{ kind: index ? 'index' : 'var', value: name, args: index ? [index] : [], line }, { kind: 'num', value: String(increment), args: [], line }], line }, line };
      }
      this.pos = saved;
    }
    return { kind: 'expr', value: this.expr(), line };
  }
  expr(min = 0): Expr {
    const t = this.take(); let left: Expr;
    if (t.value === '(') { left = this.expr(); this.take(')'); }
    else if (t.value === '-' || t.value === '!') left = { kind: 'unary', value: t.value, args: [this.expr(7)], line: t.line };
    else if (/^(0x[\da-fA-F]+|\d+)$/.test(t.value)) left = { kind: 'num', value: t.value, args: [], line: t.line };
    else if (/^[A-Za-z_]\w*$/.test(t.value)) {
      if (this.match('(')) { const args: Expr[] = []; if (this.t.value !== ')') do { args.push(this.expr()); } while (this.match(',')); this.take(')'); left = { kind: 'call', value: t.value, args, line: t.line }; }
      else if (this.match('[')) { const index = this.expr(); this.take(']'); left = { kind: 'index', value: t.value, args: [index], line: t.line }; }
      else left = { kind: 'var', value: t.value, args: [], line: t.line };
    } else throw new CCompileError(`unexpected '${t.value}'`, t.line);
    const prec: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    while ((prec[this.t.value] ?? 0) >= min && prec[this.t.value]) { const op = this.take(); const right = this.expr(prec[op.value] + 1); left = { kind: 'bin', value: op.value, args: [left, right], line: op.line }; }
    return left;
  }
}

export function compileC(source: string): CCompileResult {
  const funcs = new Parser(tokenize(source)).program();
  const lines: string[] = [], map = new Map<number, number[]>(); let serial = 0;
  const emit = (s: string, cLine?: number) => { lines.push(s); if (cLine) map.set(cLine, [...(map.get(cLine) ?? []), lines.length]); };
  const label = (base: string) => `__c_${base}_${serial++}`;
  emit('j main');
  for (const f of funcs) {
    if (f.params.length > 4) throw new CCompileError('functions support at most four parameters', f.line);
    const vars = new Map<string, { offset: number; size: number }>(); let used = 0;
    const alloc = (name: string, size: number, line: number) => { if (vars.has(name)) throw new CCompileError(`duplicate variable ${name}`, line); used += size; if (used > 240) throw new CCompileError('too many local variables', line); vars.set(name, { offset: -used * 4, size }); };
    const local = (name: string, line: number) => { const v = vars.get(name); if (!v) throw new CCompileError(`unknown variable ${name}`, line); return v; };
    const end = label(`${f.name}_end`);
    emit(`${f.name}:`, f.line);
    emit('addiu $sp, $sp, -8'); emit('sw $ra, 4($sp)'); emit('sw $s7, 0($sp)'); emit('move $s7, $sp'); emit('addiu $sp, $sp, -1024');
    f.params.forEach((name, i) => { alloc(name, 1, f.line); emit(`sw $a${i}, ${local(name, f.line).offset}($s7)`, f.line); });
    const push = () => { emit('addiu $sp, $sp, -4'); emit('sw $t0, 0($sp)'); };
    const pop = () => { emit('lw $t1, 0($sp)'); emit('addiu $sp, $sp, 4'); };
    const address = (name: string, index: Expr, line: number) => {
      const v = local(name, line); if (v.size === 1) throw new CCompileError(`${name} is not an array`, line);
      expression(index); emit('sll $t0, $t0, 2', line); emit(`addiu $t2, $s7, ${v.offset}`, line); emit('addu $t2, $t2, $t0', line);
    };
    const expression = (e: Expr): void => {
      if (e.kind === 'num') { const n = Number(e.value); if (!Number.isInteger(n) || n < -2147483648 || n > 0xffffffff) throw new CCompileError('integer outside 32-bit range', e.line); emit(`li $t0, ${n}`, e.line); return; }
      if (e.kind === 'var') { const v = local(e.value, e.line); if (v.size !== 1) throw new CCompileError('array needs an index', e.line); emit(`lw $t0, ${v.offset}($s7)`, e.line); return; }
      if (e.kind === 'index') { address(e.value, e.args[0], e.line); emit('lw $t0, 0($t2)', e.line); return; }
      if (e.kind === 'call') {
        const callee = funcs.find(x => x.name === e.value); if (!callee) throw new CCompileError(`unknown function ${e.value}`, e.line);
        if (e.args.length !== callee.params.length) throw new CCompileError(`wrong argument count for ${e.value}`, e.line);
        e.args.forEach(arg => { expression(arg); push(); });
        for (let i = e.args.length - 1; i >= 0; i--) { pop(); emit(`move $a${i}, $t1`, e.line); }
        emit(`jal ${e.value}`, e.line); emit('move $t0, $v0', e.line); return;
      }
      if (e.kind === 'unary') { expression(e.args[0]); emit(e.value === '-' ? 'subu $t0, $zero, $t0' : 'sltiu $t0, $t0, 1', e.line); return; }
      expression(e.args[0]); push(); expression(e.args[1]); pop();
      const ops: Record<string, string[]> = {
        '+': ['addu $t0, $t1, $t0'], '-': ['subu $t0, $t1, $t0'],
        '*': ['mult $t1, $t0', 'mflo $t0'], '/': ['div $t1, $t0', 'mflo $t0'], '%': ['div $t1, $t0', 'mfhi $t0'],
        '<': ['slt $t0, $t1, $t0'], '>': ['slt $t0, $t0, $t1'],
        '<=': ['slt $t0, $t0, $t1', 'xori $t0, $t0, 1'], '>=': ['slt $t0, $t1, $t0', 'xori $t0, $t0, 1'],
        '==': ['xor $t0, $t1, $t0', 'sltiu $t0, $t0, 1'], '!=': ['xor $t0, $t1, $t0', 'sltu $t0, $zero, $t0'],
        '&&': ['sltu $t1, $zero, $t1', 'sltu $t0, $zero, $t0', 'and $t0, $t1, $t0'],
        '||': ['or $t0, $t1, $t0', 'sltu $t0, $zero, $t0'],
      };
      for (const line of ops[e.value]) emit(line, e.line);
    };
    const statement = (s: Stmt): void => {
      if (s.kind === 'block') { s.body.forEach(statement); return; }
      if (s.kind === 'decl') { alloc(s.name, s.size, s.line); if (s.init) { expression(s.init); emit(`sw $t0, ${local(s.name, s.line).offset}($s7)`, s.line); } return; }
      if (s.kind === 'assign') {
        const v = local(s.name, s.line);
        expression(s.value);
        if (s.index) { push(); address(s.name, s.index, s.line); pop(); emit('sw $t1, 0($t2)', s.line); }
        else { if (v.size !== 1) throw new CCompileError('array needs an index', s.line); emit(`sw $t0, ${v.offset}($s7)`, s.line); }
        return;
      }
      if (s.kind === 'expr') { expression(s.value); return; }
      if (s.kind === 'return') { expression(s.value); emit('move $v0, $t0', s.line); emit(`j ${end}`, s.line); return; }
      if (s.kind === 'if') {
        const other = label('else'), done = label('endif'); expression(s.test); emit(`beq $t0, $zero, ${other}`, s.line); statement(s.body); emit(`j ${done}`); emit(`${other}:`); if (s.elseBody) statement(s.elseBody); emit(`${done}:`); return;
      }
      if (s.kind === 'while' || s.kind === 'for') {
        if (s.kind === 'for' && s.init) statement(s.init);
        const start = label('loop'), done = label('endloop'); emit(`${start}:`);
        if (s.test) { expression(s.test); emit(`beq $t0, $zero, ${done}`, s.line); }
        statement(s.body); if (s.kind === 'for' && s.post) statement(s.post);
        emit(`j ${start}`); emit(`${done}:`); return;
      }
    };
    statement(f.body);
    emit(`${end}:`); emit('move $sp, $s7'); emit('lw $s7, 0($sp)'); emit('lw $ra, 4($sp)'); emit('addiu $sp, $sp, 8');
    emit(f.name === 'main' ? 'j __program_end' : 'jr $ra');
  }
  emit('__program_end:'); emit('nop');
  const asm = lines.join('\n');
  // Assemble now so compilation errors point to the generated instruction before returning.
  assemble(asm);
  return { asm, mapping: [...map].sort((a, b) => a[0] - b[0]).map(([cLine, asmLines]) => ({ cLine, asmLines })) };
}
