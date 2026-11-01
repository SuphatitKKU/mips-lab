import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { Cpu, type StepInfo } from './cpu';
import { aluBits, aluCalc, ALU_FN, cyclesOf } from './multicycle';

function run(src: string, regs: Record<string, number> = {}): StepInfo[] {
  const r = assemble(src);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const cpu = new Cpu(r.prog, { regs });
  const out: StepInfo[] = [];
  for (let s = cpu.step(); s; s = cpu.step()) out.push(s);
  return out;
}

const writes = (s: StepInfo) => cyclesOf(s).map((c) => Object.fromEntries(c.writes));

describe('multicycle cycles', () => {
  it('runs an R-type through IF, ID, EX, WB', () => {
    const [s] = run('add $t2, $t0, $t1', { t0: 5, t1: 7 });
    const cs = cyclesOf(s);
    expect(cs.map((c) => c.state)).toEqual([0, 1, 6, 7]);
    expect(cs[0].alu).toBe(s.pcOld + 4);
    expect(cs[0].memData).toBe(s.ins.word);
    expect(cs[2].alu).toBe(12);
    expect(cs[3].wd).toBe(12);
    expect(writes(s)[3]).toEqual({ $t2: 12 });
  });

  it('loads in five cycles and stores in four', () => {
    const [sw, lw] = run('sw $t0, 4($sp)\nlw $t1, 4($sp)', { t0: 42 });
    expect(cyclesOf(sw).map((c) => c.state)).toEqual([0, 1, 2, 5]);
    const l = cyclesOf(lw);
    expect(l.map((c) => c.state)).toEqual([0, 1, 2, 3, 4]);
    expect(l[3].memAddr).toBe(l[2].alu);
    expect(l[4].wd).toBe(42);
  });

  it('computes the branch target in ID and only writes PC when taken', () => {
    const steps = run('beq $t0, $t1, skip\nnop\nskip: bne $t0, $t1, skip2\nskip2: nop', { t0: 3, t1: 3 });
    const taken = cyclesOf(steps[0]);
    expect(taken[1].alu).toBe(steps[0].bus.target);
    expect(taken[2].zero).toBe(1);
    expect(taken[2].pcEn).toBe(1);
    expect(taken[2].pcNext).toBe(steps[0].pcNew);
    const not = cyclesOf(steps[1]);
    expect(not[2].pcEn).toBe(0);
  });

  it('jumps through the jump-address input of the PC mux', () => {
    const [j] = run('j there\nnop\nthere: nop');
    const c = cyclesOf(j);
    expect(c[2].pcNext).toBe(j.pcNew);
  });

  it('agrees with the CPU on every result an ALU-based instruction writes', () => {
    const steps = run(
      'addi $t0, $zero, -9\nori $t1, $zero, 6\nsub $t2, $t0, $t1\nslt $t3, $t0, $t1\nnor $t4, $t0, $t1\nand $t5, $t0, $t1\nsll $t6, $t1, 3\nlui $t7, 0x1234',
    );
    for (const s of steps) {
      const w = writes(s).at(-1)!;
      expect(w['$' + s.bus.wb!.k]).toBe(s.bus.wb!.v);
    }
  });
});

describe('ripple-carry ALU', () => {
  it('matches the word-level result for every basic function', () => {
    const vals = [0, 1, -1, 7, -8, 0x7fffffff, -0x80000000, 123456, -98765];
    for (const f of Object.values(ALU_FN))
      for (const a of vals)
        for (const b of vals) {
          const { bits } = aluBits(f, a, b);
          const r = bits.reduce((acc, x, i) => acc | (x.res << i), 0);
          expect(r, `${f.name} ${a} ${b}`).toBe(aluCalc(f, a, b));
        }
  });
});
