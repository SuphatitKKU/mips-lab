import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { Cpu, layoutArrays } from './cpu';
import { DATA_BASE, decode } from './isa';

const SUM = `sum:
    addi $t0, $zero, 0
    addi $t1, $zero, 1
loop:
    slt  $t2, $a0, $t1
    bne  $t2, $zero, done
    add  $t0, $t0, $t1
    addi $t1, $t1, 1
    j    loop
done:
    add  $v0, $t0, $zero
    jr   $ra`;

function prog(src: string) {
  const r = assemble(src);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.prog;
}

describe('assembler', () => {
  it('encodes the sum program like the reference hex', () => {
    const p = prog(SUM);
    expect(p.text.map((t) => t.word.toString(16).toUpperCase().padStart(8, '0'))).toEqual([
      '20080000', '20090001', '0089502A', '15400003', '01094020', '21290001', '08100002', '01001020', '03E00008',
    ]);
  });

  it('expands pseudo-instructions', () => {
    const p = prog(`li $t0, 100000\nmove $v0, $t0\nblt $t0, $t1, x\nx: la $a0, arr\n.data\narr: .word 1, 2`);
    expect(p.text.map((t) => t.pseudo ?? '-')).toEqual(['li', 'li', 'move', 'blt', 'blt', 'la', 'la']);
    expect(p.labels.get('arr')).toBe(DATA_BASE);
  });

  it('reports errors with Thai messages and line numbers', () => {
    const r = assemble('add $t0, $t1\nfoo $t0\nj nowhere\naddi $t0, $t0, 99999');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(r.errors[1].msg).toContain('ไม่รู้จักคำสั่ง');
  });

  it('aligns data labels after strings', () => {
    const p = prog(`.data\ns: .asciiz "ab"\nw:\n .word 7`);
    expect(p.labels.get('w')).toBe(DATA_BASE + 4);
  });
});

describe('cpu', () => {
  it.each([
    [1, 1],
    [5, 15],
    [10, 55],
  ])('sum(%i) = %i', (n, want) => {
    const c = new Cpu(prog(SUM), { regs: { a0: n } });
    expect(c.run()?.kind).toBe('return');
    expect(c.r[2]).toBe(want);
  });

  it('steps back exactly', () => {
    const c = new Cpu(prog(SUM), { regs: { a0: 5 } });
    for (let i = 0; i < 15; i++) c.step();
    const regs = Array.from(c.r);
    const pc = c.pc;
    c.step();
    c.back();
    expect(Array.from(c.r)).toEqual(regs);
    expect(c.pc).toBe(pc);
    expect(c.last?.ins.basic).toMatch(/^add/);
  });

  it('loads/stores memory and recursion with the stack', () => {
    const fib = `fib:
    slti $t0, $a0, 2
    beq  $t0, $zero, rec
    move $v0, $a0
    jr   $ra
rec:
    addi $sp, $sp, -12
    sw   $ra, 8($sp)
    sw   $a0, 4($sp)
    addi $a0, $a0, -1
    jal  fib
    sw   $v0, 0($sp)
    lw   $a0, 4($sp)
    addi $a0, $a0, -2
    jal  fib
    lw   $t0, 0($sp)
    add  $v0, $v0, $t0
    lw   $ra, 8($sp)
    addi $sp, $sp, 12
    jr   $ra`;
    const c = new Cpu(prog(fib), { regs: { a0: 10 }, history: false });
    expect(c.run()?.kind).toBe('return');
    expect(c.r[2]).toBe(55);
  });

  it('reads arrays laid out in memory', () => {
    const max = `lw $v0, 0($a0)
 addi $t0, $zero, 1
loop: slt $t1, $t0, $a1
 beq $t1, $zero, done
 sll $t2, $t0, 2
 add $t2, $a0, $t2
 lw $t3, 0($t2)
 slt $t4, $v0, $t3
 beq $t4, $zero, skip
 move $v0, $t3
skip: addi $t0, $t0, 1
 j loop
done: jr $ra`;
    const { mem, addrs } = layoutArrays([[-5, -2, -9]], 0x10040000);
    const c = new Cpu(prog(max), { regs: { a0: addrs[0], a1: 3 }, mem });
    c.run();
    expect(c.r[2]).toBe(-2);
  });

  it('mult/div fill HI and LO', () => {
    const c = new Cpu(prog('li $t0, 100000\nmult $t0, $t0\nmfhi $v0\nmflo $v1\ndiv $t1, $t0, 7\nrem $t2, $t0, 7\njr $ra'));
    c.run();
    expect(c.r[2]).toBe(2); // 10^10 >> 32
    expect(c.r[3]).toBe(1410065408);
    expect(c.r[9]).toBe(14285);
    expect(c.r[10]).toBe(5);
  });

  it('traps on add overflow and on running off the end', () => {
    const c = new Cpu(prog('li $t0, 0x7fffffff\naddi $t0, $t0, 1'));
    expect(c.run()?.kind).toBe('error');
    const d = new Cpu(prog('addi $t0, $zero, 1'));
    expect(d.run()?.msg).toContain('นอกโปรแกรม');
  });
});

describe('decode', () => {
  it('labels R, I and J fields', () => {
    expect(decode(0x01094020).fields.map((f) => f.label)).toEqual([
      'op', 'rs · $t0', 'rt · $t1', 'rd · $t0', 'shamt', 'funct · add',
    ]);
    expect(decode(0x20090001).fields.at(-1)?.label).toBe('immediate · 1');
    expect(decode(0x08100002).type).toBe('J-type');
    expect(decode(0x08100002).fields[1].label).toBe('address · 0x00400008');
  });
});

describe('step details for the visual explanation', () => {
  it('records which registers an instruction read, its immediate, and what a load fetched', () => {
    const c = new Cpu(prog('main:\n    addi $t0, $zero, 7\n    add  $t1, $t0, $t0\n    sw   $t1, -4($sp)\n    lw   $t2, -4($sp)\n    jr   $ra'), {});
    const s1 = (c.step(), c.last!);
    expect(s1.reads).toEqual([{ k: 'zero', v: 0 }]);
    expect(s1.imm).toBe(7);
    const s2 = (c.step(), c.last!);
    expect(s2.reads).toEqual([{ k: 't0', v: 7 }]);
    const s3 = (c.step(), c.last!);
    expect(s3.reads.map((r) => r.k)).toEqual(['t1', 'sp']);
    expect(s3.imm).toBe(-4);
    const s4 = (c.step(), c.last!);
    expect(s4.memRead?.v).toBe(14);
  });
});

describe('ll / sc (from the SuphatitKKU/mips-lab ISA)', () => {
  const ATOMIC_INC = `.data
counter: .word 41
.text
main:
    la   $t0, counter
retry:
    ll   $t1, 0($t0)
    addi $t1, $t1, 1
    sc   $t1, 0($t0)
    beq  $t1, $zero, retry
    lw   $v0, 0($t0)
    jr   $ra`;

  it('encodes ll / sc with opcodes 0x30 / 0x38', () => {
    const p = prog('ll $t1, 4($t0)\nsc $t1, 4($t0)');
    expect(p.text.map((t) => t.word >>> 26)).toEqual([0x30, 0x38]);
  });

  it('an ll / sc pair stores and reports success', () => {
    const c = new Cpu(prog(ATOMIC_INC));
    c.run();
    expect(c.r[2]).toBe(42);
  });

  it('sc without a matching ll does not store and returns 0', () => {
    const c = new Cpu(prog(`main:\n    li $t0, ${DATA_BASE}\n    li $t1, 7\n    sc $t1, 0($t0)\n    lw $t2, 0($t0)\n    jr $ra`));
    c.run();
    expect(c.r[9]).toBe(0); // $t1: failed
    expect(c.r[10]).toBe(0); // $t2: memory untouched
  });

  it('stepping back over ll restores the reservation', () => {
    const c = new Cpu(prog(ATOMIC_INC));
    while (c.last?.name !== 'll') c.step();
    expect(c.link).not.toBeNull();
    c.back();
    expect(c.link).toBeNull();
  });
});
