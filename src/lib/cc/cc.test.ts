import { describe, expect, it } from 'vitest';
import { assemble } from '../mips/assembler';
import { Cpu, layoutArrays } from '../mips/cpu';
import { compileC } from './compile';

function runC(src: string, fn: string, args: (number | number[])[] = []) {
  const c = compileC(src);
  if (!c.ok) throw new Error(JSON.stringify(c.errors));
  const a = assemble(c.asm);
  if (!a.ok) throw new Error(JSON.stringify(a.errors) + '\n' + c.asm);
  const arrays = args.filter(Array.isArray) as number[][];
  const { mem, addrs } = layoutArrays(arrays, 0x10040000);
  let k = 0;
  const regs: Record<string, number> = {};
  args.forEach((v, i) => (regs['a' + i] = Array.isArray(v) ? addrs[k++] : v));
  a.prog.labels.set('main', a.prog.labels.get(fn)!);
  const cpu = new Cpu(a.prog, { regs, mem, history: false });
  const h = cpu.run(1_000_000);
  if (h?.kind !== 'return') throw new Error(h?.msg + '\n' + c.asm);
  return { v0: cpu.r[2], cpu, asm: c.asm, lines: c.lines };
}

const SUM = `int sum(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++) {
        s += i;
    }
    return s;
}`;

describe('C compiler', () => {
  it('compiles sum(n) into the classic shape', () => {
    const { asm, v0 } = runC(SUM, 'sum', [10]);
    expect(v0).toBe(55);
    expect(asm).toContain('addiu $t0, $zero, 0');
    expect(asm).toContain('slt  $t2, $a0, $t1');
    expect(asm).toContain('addu $t0, $t0, $t1');
  });

  it('maps every instruction to a C line with an explanation', () => {
    const { lines } = runC(SUM, 'sum', [3]);
    for (const l of lines) if (l.asm) expect(l.c).toBeGreaterThan(0);
    expect(lines.find((l) => l.asm?.startsWith('addu '))?.c).toBe(4);
    expect(lines.find((l) => l.asm?.startsWith('addu '))?.ex).toContain('(s)');
  });

  it('handles arrays, pointers and if', () => {
    const src = `int max(int *arr, int n) {
  int m = arr[0];
  for (int i = 1; i < n; i++)
    if (arr[i] > m)
      m = arr[i];
  return m;
}`;
    expect(runC(src, 'max', [[-5, -2, -9], 3]).v0).toBe(-2);
    expect(runC(src, 'max', [[3, 9, 4], 3]).v0).toBe(9);
  });

  it('handles recursion with a stack frame', () => {
    const src = `int fib(int n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}`;
    expect(runC(src, 'fib', [10]).v0).toBe(55);
  });

  it('handles while, &&, ||, !, ternary, % and /, local arrays and globals', () => {
    const src = `int g = 7;
int tbl[4] = {1, 2, 3, 4};
int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
int f(int x) {
  int a[5] = {5, 4, 3, 2, 1};
  int s = 0;
  int i = 0;
  do { s += a[i] * (i + 1); i++; } while (i < 5 && !(s > 1000));
  s = s + (x > 3 ? 100 : 200) + g + tbl[3] + gcd(12, 18);
  if (x == 1 || x == 2) s = -s;
  return s / 2;
}`;
    // sum a[i]*(i+1) = 5+8+9+8+5 = 35; x=5 → 35+100+7+4+6 = 152 → 76
    expect(runC(src, 'f', [5]).v0).toBe(76);
    expect(runC(src, 'f', [1]).v0).toBe(-126);
    expect(runC(src, 'gcd', [48, 36]).v0).toBe(12);
  });

  it('counts bits with shifts and break/continue', () => {
    const src = `int bits(int x) {
  int c = 0;
  for (int i = 0; i < 32; i++) {
    if (((x >> i) & 1) == 0) continue;
    c++;
    if (c > 100) break;
  }
  return c;
}`;
    expect(runC(src, 'bits', [0b1011011]).v0).toBe(5);
    expect(runC(src, 'bits', [-1]).v0).toBe(32);
  });

  it('reports errors in Thai with the line', () => {
    const r = compileC('int f(int a) {\n  return b;\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].line).toBe(2);
      expect(r.errors[0].msg).toContain('ไม่ได้ประกาศ');
    }
    const r2 = compileC('int f( {');
    expect(r2.ok).toBe(false);
  });
});

import { liftMips } from './lift';
describe('MIPS → C', () => {
  it('lifts the sum program', () => {
    const r = liftMips(`sum:
    addi $t0, $zero, 0
    addi $t1, $zero, 1
loop:
    slt  $t2, $a0, $t1
    bne  $t2, $zero, done
    add  $t0, $t0, $t1
    addi $t1, $t1, 1
    j    loop
done:
    move $v0, $t0
    jr   $ra`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const txt = r.lines.map((l) => l.text).join('\n');
    expect(txt).toContain('int sum(int a0) {');
    expect(txt).toContain('t0 += t1;');
    expect(txt).toContain('if (t2 != 0) goto done;');
    expect(txt).toContain('return v0;');
    expect(r.lines.find((l) => l.text.includes('t0 += t1'))?.m).toBe(7);
  });

  it('turns jal into calls and stack traffic into comments', () => {
    const r = liftMips(`main:\n addi $sp, $sp, -4\n sw $ra, 0($sp)\n li $a0, 3\n jal sq\n lw $ra, 0($sp)\n addi $sp, $sp, 4\n jr $ra\nsq:\n mul $v0, $a0, $a0\n jr $ra`);
    if (!r.ok) throw new Error();
    const txt = r.lines.map((l) => l.text).join('\n');
    expect(txt).toContain('v0 = sq(a0);');
    expect(txt).toContain('int sq(int a0) {');
    expect(txt).toContain('// บันทึก $ra ลง stack');
  });
});
