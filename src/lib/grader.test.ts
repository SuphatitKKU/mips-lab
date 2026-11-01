import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../data/problems';
import type { MipsTest, Z80Test } from '../data/problems';
import { grade, runOnce } from './grader';
import { hex2 } from './z80/z80';

describe('grader', () => {
  it.each(PROBLEMS.map((p) => [p.id, p.title, p] as const))('reference answer to #%i %s passes every test', (_id, _t, p) => {
    const code = p.answer.code.find((c) => c.lang === (p.kind === 'c' ? 'c' : p.kind))!.lines.join('\n');
    const r = grade(p, code, true);
    expect(r.errors).toEqual([]);
    expect(r.results.filter((x) => !x.ok)).toEqual([]);
    expect(r.passed).toBe(p.tests.length);
  });

  it.each(PROBLEMS.map((p) => [p.id, p] as const))('starter for #%i does not pass everything', (_id, p) => {
    const r = grade(p, p.starter, true);
    expect(r.passed).toBeLessThan(p.tests.length);
  });

  it('explains the classic max bug', () => {
    const p = PROBLEMS.find((x) => x.id === 2)!;
    const code = p.answer.code[1].lines.join('\n').replace('lw   $v0, 0($a0)', 'addi $v0, $zero, 0').replace('addi $t0, $zero, 1', 'addi $t0, $zero, 0');
    const r = grade(p, code, false);
    // only the all-negative case catches it; every other case happens to have a non-negative maximum
    expect(r.results.map((x) => x.ok)).toEqual([true, true, true, false, true, true, true, true]);
    expect(r.results[3].got).toBe('$v0 = 0');
  });

  it('enforces allowed registers, stack balance and saved registers', () => {
    const p2 = PROBLEMS.find((x) => x.id === 2)!;
    expect(grade(p2, 'max:\n lw $s0, 0($a0)\n move $v0, $s0\n jr $ra', false).errors[0].msg).toContain('$s0');
    const p1 = PROBLEMS.find((x) => x.id === 1)!;
    const leak = 'sum:\n addi $sp, $sp, -4\n li $v0, 0\nl: beq $a0, $zero, d\n add $v0, $v0, $a0\n addi $a0, $a0, -1\n j l\nd: jr $ra';
    expect(grade(p1, leak, false).results[0].msg).toContain('$sp');
  });

  it('detects a missing Z80 delay', () => {
    const p = PROBLEMS.find((x) => x.id === 7)!;
    const r = grade(p, 'START: LD A, 1\nL: OUT (01h), A\n RLCA\n JR L', true);
    expect(r.results.map((x) => x.ok)).toEqual([true, true, false]);
  });
});

describe('running once on the student’s own input', () => {
  const answer = (p: (typeof PROBLEMS)[number]) => p.answer.code.find((c) => c.lang === (p.kind === 'c' ? 'c' : p.kind))!.lines.join('\n');

  it.each(PROBLEMS.filter((p) => p.kind !== 'z80').map((p) => [p.id, p] as const))('#%i: the reference answer on the first sample gives the expected values', (_id, p) => {
    const t = p.tests[0] as MipsTest;
    const r = runOnce(p, answer(p), t.args);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const got = new Map(r.outputs);
    for (const [reg, v] of Object.entries(t.expect)) expect(got.get(`$${reg}`)?.split(' ')[0]).toBe(String(v));
    if (t.expectArr) expect(got.get(p.params[0][1])).toBe(`[${t.expectArr.join(', ')}]`);
  });

  it('takes input the samples never used', () => {
    const p = PROBLEMS.find((x) => x.id === 1)!;
    expect(new Map(runOnce(p, answer(p), [10]).outputs).get('$v0')).toBe('55');
  });

  it('shows a Z80 answer’s OUT values in order', () => {
    const p = PROBLEMS.find((x) => x.kind === 'z80')!;
    const t = p.tests[0] as Z80Test;
    const r = runOnce(p, answer(p), []);
    expect(r.outputs.slice(0, t.outs.length).map(([, v]) => v.split(' ')[0])).toEqual(t.outs.map(hex2));
  });

  it('reports compile errors instead of running', () => {
    const p = PROBLEMS.find((x) => x.id === 1)!;
    const r = runOnce(p, 'sum: addq $v0, $zero, 1', [5]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.outputs).toEqual([]);
  });

  it('warns when $sp is not restored, as grading would fail it', () => {
    const p = PROBLEMS.find((x) => x.id === 1)!;
    const r = runOnce(p, 'sum: addi $sp, $sp, -4\n     addi $v0, $zero, 1\n     jr $ra', [5]);
    expect(r.msg).toMatch(/\$sp/);
  });
});

describe('Z80 grading uses the board memory map', () => {
  const p = { kind: 'z80' as const, fn: 'START', params: [], returns: [], port: 1 };
  it('a write into the EPROM is lost, a write into RAM at 8000h sticks', () => {
    const rom = runOnce(p, 'LD A,5\nLD (1000h),A\nLD A,0\nLD A,(1000h)\nOUT (01h),A\nHALT', []);
    const ram = runOnce(p, 'LD A,5\nLD (8000h),A\nLD A,0\nLD A,(8000h)\nOUT (01h),A\nHALT', []);
    expect(rom.outputs[0][1]).toMatch(/^FFh/);
    expect(ram.outputs[0][1]).toMatch(/^05h/);
  });
});
