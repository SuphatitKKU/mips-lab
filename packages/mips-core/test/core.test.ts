import { describe, expect, it } from 'vitest';
import { assemble, compileC, fields, ISA_PROFILE, judge, MipsError, Simulator, SUPPORTED_INSTRUCTIONS } from '../src';

describe('assembler / encoder', () => {
  it('encodes every supported instruction spelling', () => {
    const samples: Record<(typeof SUPPORTED_INSTRUCTIONS)[number], string> = {
      addi: 'addi $t0, $t1, -1', addiu: 'addiu $t0, $t1, -1', andi: 'andi $t0, $t1, 255', ori: 'ori $t0, $t1, 255', xori: 'xori $t0, $t1, 255',
      slti: 'slti $t0, $t1, -1', sltiu: 'sltiu $t0, $t1, -1', lui: 'lui $t0, 1234',
      beq: 'beq $t0, $t1, target\ntarget: nop', bne: 'bne $t0, $t1, target\ntarget: nop', blez: 'blez $t0, target\ntarget: nop', bgtz: 'bgtz $t0, target\ntarget: nop',
      j: 'j target\ntarget: nop', jal: 'jal target\ntarget: nop',
      lb: 'lb $t0, 0($t1)', lh: 'lh $t0, 0($t1)', lw: 'lw $t0, 0($t1)', lbu: 'lbu $t0, 0($t1)', lhu: 'lhu $t0, 0($t1)',
      sb: 'sb $t0, 0($t1)', sh: 'sh $t0, 0($t1)', sw: 'sw $t0, 0($t1)', ll: 'll $t0, 0($t1)', sc: 'sc $t0, 0($t1)', mfc0: 'mfc0 $t0, $12',
      add: 'add $t0, $t1, $t2', addu: 'addu $t0, $t1, $t2', sub: 'sub $t0, $t1, $t2', subu: 'subu $t0, $t1, $t2',
      and: 'and $t0, $t1, $t2', or: 'or $t0, $t1, $t2', xor: 'xor $t0, $t1, $t2', nor: 'nor $t0, $t1, $t2',
      slt: 'slt $t0, $t1, $t2', sltu: 'sltu $t0, $t1, $t2',
      sll: 'sll $t0, $t1, 2', srl: 'srl $t0, $t1, 2', sra: 'sra $t0, $t1, 2',
      sllv: 'sllv $t0, $t1, $t2', srlv: 'srlv $t0, $t1, $t2', srav: 'srav $t0, $t1, $t2',
      jr: 'jr $ra', jalr: 'jalr $t0', syscall: 'syscall',
      mfhi: 'mfhi $t0', mflo: 'mflo $t0', mult: 'mult $t0, $t1', multu: 'multu $t0, $t1', div: 'div $t0, $t1', divu: 'divu $t0, $t1',
      li: 'li $t0, 42', la: 'la $t0, target\ntarget: nop', move: 'move $t0, $t1',
      blt: 'blt $t0, $t1, target\ntarget: nop', bgt: 'bgt $t0, $t1, target\ntarget: nop', ble: 'ble $t0, $t1, target\ntarget: nop', bge: 'bge $t0, $t1, target\ntarget: nop',
      b: 'b target\ntarget: nop', nop: 'nop',
    };
    expect(Object.keys(samples).sort()).toEqual([...SUPPORTED_INSTRUCTIONS].sort());
    for (const [name, src] of Object.entries(samples)) {
      const p = assemble(src);
      expect(p.instructions.length, name).toBeGreaterThan(0);
      expect(p.instructions.every(i => Number.isInteger(i.word)), name).toBe(true);
    }
  });
  it('encodes R, I and J formats and resolves labels after pseudo expansion', () => {
    const p = assemble('start: add $t0, $t1, $t2\naddi $t0, $t0, -1\nbeq $t0, $zero, start\nj start');
    expect(p.instructions.map(i => fields(i.word).hex)).toEqual(['0x012a4020', '0x2108ffff', '0x1100fffd', '0x08100000']);
    expect(p.labels.start).toBe(ISA_PROFILE.textBase);
    expect(assemble('li $t0, 0x12345678').instructions.map(i => fields(i.word).hex)).toEqual(['0x3c081234', '0x35085678']);
  });
  it('rejects invalid registers and range errors with source line', () => {
    expect(() => assemble('add $bad, $t0, $t1')).toThrow('Line 1');
    expect(() => assemble('addi $t0, $zero, 65536')).toThrow('signed 16-bit');
    expect(() => assemble('again: nop\nagain: nop')).toThrow('duplicate label');
  });
  it('assembles static data and resolves la across sections', () => {
    const p = assemble('.data\nvalues: .word 0x11223344, 7\n.text\nla $t0, values\nlw $v0, 4($t0)');
    expect(p.labels.values).toBe(ISA_PROFILE.dataBase);
    expect(p.data).toHaveLength(8);
    const s = new Simulator(p); s.run(); expect(s.registers[2]).toBe(7);
  });
});

describe('simulator', () => {
  const run = (src: string) => { const s = new Simulator(assemble(src)); s.run(); return s; };
  it('runs a loop and can reverse one step', () => {
    const s = new Simulator(assemble('li $t0, 1\nli $v0, 0\nloop: addu $v0, $v0, $t0\naddiu $t0, $t0, 1\nslti $t1, $t0, 6\nbne $t1, $zero, loop'));
    s.run(); expect(s.registers[2]).toBe(15); expect(s.halted).toBe(true);
    expect(s.back()).toBe(true); expect(s.halted).toBe(false); expect(s.current?.op).toBe('bne');
  });
  it('reads and writes bytes in the selected endian profile', () => {
    const s = run('li $t0, 0x11223344\nli $t1, 0x10000000\nsw $t0, 0($t1)\nlbu $v0, 0($t1)\nlhu $v1, 2($t1)');
    expect(s.registers[2]).toBe(ISA_PROFILE.endian === 'little' ? 0x44 : 0x11);
    expect(s.registers[3]).toBe(ISA_PROFILE.endian === 'little' ? 0x1122 : 0x3344);
  });
  it('raises Ov, AdEL and AdES', () => {
    expect(() => run('li $t0, 0x7fffffff\naddi $t0, $t0, 1')).toThrowError(MipsError);
    expect(() => run('lw $t0, 1($zero)')).toThrow(/unaligned/);
    expect(() => run('sw $t0, 2($zero)')).toThrow(/unaligned/);
  });
  it('handles jal return address and ll/sc', () => {
    const s = run('jal work\nj done\nwork: li $t0, 0x10000000\nli $t1, 42\nll $t2, 0($t0)\nsc $t1, 0($t0)\nlw $v0, 0($t0)\njr $ra\ndone: nop');
    expect(s.registers[2]).toBe(42); expect(s.registers[9]).toBe(1);
    expect(s.registers[31]).toBe(ISA_PROFILE.textBase + (ISA_PROFILE.delaySlot ? 8 : 4));
  });
  it('runs logic, shifts and unsigned comparisons', () => {
    const cases: [string, number][] = [
      ['and $v0, $a0, $a1', 0], ['or $v0, $a0, $a1', 15],
      ['xor $v0, $a0, $a1', 15], ['nor $v0, $a0, $a1', -16],
      ['andi $v0, $a0, 3', 2], ['ori $v0, $a0, 1', 11],
      ['xori $v0, $a0, 15', 5], ['slt $v0, $a0, $a1', 0],
      ['sltu $v0, $a0, $a1', 0], ['slti $v0, $a0, 11', 1],
      ['sltiu $v0, $a0, -1', 1], ['sll $v0, $a0, 2', 40],
      ['srl $v0, $a0, 1', 5], ['sra $v0, $a0, 1', 5],
      ['sllv $v0, $a0, $a1', 320], ['srlv $v0, $a0, $a1', 0],
      ['srav $v0, $a0, $a1', 0],
    ];
    for (const [src, expected] of cases) {
      const s = new Simulator(assemble(src), { '$a0': 10, '$a1': 5 }); s.run();
      expect(s.registers[2], src).toBe(expected);
    }
  });
  it('runs signed byte/halfword stores and loads', () => {
    const s = run('li $t0, 0x10000000\nli $t1, -1\nsb $t1, 0($t0)\nsh $t1, 2($t0)\nlb $v0, 0($t0)\nlh $v1, 2($t0)');
    expect(s.registers[2]).toBe(-1); expect(s.registers[3]).toBe(-1);
  });
  it('supports jalr, blez, bgtz, mfc0 and syscall exit', () => {
    const s = run('li $t0, 0x00400010\njalr $t0\nj done\ntarget: mfc0 $t1, $12\nblez $t1, yes\nli $v0, 99\nyes: bgtz $t1, done\nli $v0, 10\nsyscall\ndone: nop');
    expect(s.registers[2]).toBe(10); expect(s.halted).toBe(true);
  });
});

describe('judge and C compiler', () => {
  it('checks isolated test cases', () => {
    expect(judge('addu $v0, $a0, $a1', [
      { input: { '$a0': 2, '$a1': 3 }, expected: { '$v0': 5 } },
      { input: { '$a0': -5, '$a1': 7 }, expected: { '$v0': 2 } },
    ])).toMatchObject({ passed: 2, total: 2, failures: [] });
    expect(judge('bad $t0', [{ input: {}, expected: {} }]).error?.code).toBe('Syntax');
  });
  it('compiles for loops, arrays and function calls', () => {
    const c = `int doubleIt(int x) { return x * 2; }
int main() {
  int a[3];
  for (int i = 0; i < 3; i++) a[i] = doubleIt(i + 1);
  return a[0] + a[1] + a[2];
}`;
    const out = compileC(c);
    expect(out.mapping.some(x => x.cLine === 4)).toBe(true);
    const s = new Simulator(assemble(out.asm)); s.run(); expect(s.registers[2]).toBe(12);
  });
  it('compiles if/else and while', () => {
    const c = `int main() { int n = 5; int v = 0; while (n > 0) { v = v + n; n--; } if (v == 15) return v; else return 0; }`;
    const s = new Simulator(assemble(compileC(c).asm)); s.run(); expect(s.registers[2]).toBe(15);
  });
  it('preserves nested function call arguments', () => {
    const c = 'int inc(int n) { return n + 1; } int add(int a, int b) { return a + b; } int main() { return add(inc(2), inc(3)); }';
    const s = new Simulator(assemble(compileC(c).asm)); s.run(); expect(s.registers[2]).toBe(7);
  });
});
