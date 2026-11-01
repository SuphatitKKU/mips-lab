import { describe, expect, it } from 'vitest';
import { Z80, assembleZ80 } from './z80';

const LEDS = `        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   A, 01h
LOOP:   OUT  (01h), A
        CALL DELAY
        RLCA       ; เลื่อนไฟ
        JR   LOOP
DELAY:  LD   B, 0FFh
D1:     DJNZ D1
        RET`;

describe('z80', () => {
  it('assembles the running-light program', () => {
    const r = assembleZ80(LEDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prog.size).toBe(18);
    expect(r.prog.labels.get('DELAY')).toBe(0x0d);
  });

  it('runs and rotates the LED output', () => {
    const r = assembleZ80(LEDS);
    if (!r.ok) throw new Error();
    const outs: number[] = [];
    const cpu = new Z80(r.prog, { out: (p, v) => p === 1 && outs.push(v) });
    cpu.runFor(40_000);
    expect(outs.slice(0, 9)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 1]);
  });

  it('does arithmetic, flags, stack and CB ops', () => {
    const r = assembleZ80(`
  LD A, 200
  ADD A, 100      ; 300 → 44 carry
  LD B, A
  LD HL, 1234h
  PUSH HL
  POP DE
  LD A, 0
  SUB 1           ; FF, carry
  JR NC, bad
  LD C, 0F0h
  SRL C
  BIT 3, C
  JR NZ, ok
bad: LD A, 0EEh
  HALT
ok: SET 0, C
  LD A, C
  HALT`);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const cpu = new Z80(r.prog);
    cpu.runFor(1000);
    expect(cpu.halted).toBe(true);
    expect(cpu.r.B).toBe(44);
    expect((cpu.r.D << 8) | cpu.r.E).toBe(0x1234);
    expect(cpu.r.A).toBe(0x79);
  });

  it('reports errors with lines', () => {
    const r = assembleZ80('  LD A, 1\n  FOO\n  JR nowhere');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe('z80: instructions that used to slip through', () => {
  const regsAfter = (src: string, mem: Record<number, number> = {}) => {
    const r = assembleZ80(src);
    if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join('; '));
    const cpu = new Z80(r.prog);
    for (const [a, v] of Object.entries(mem)) cpu.mem[Number(a)] = v;
    cpu.runFor(1000);
    expect(cpu.error).toBeNull();
    return cpu;
  };
  const errorsOf = (src: string) => {
    const r = assembleZ80(src);
    return r.ok ? [] : r.errors.map((e) => e.msg);
  };

  it('DAA turns a binary sum back into BCD, after ADD and after SUB', () => {
    expect(regsAfter('LD A,09h\nADD A,01h\nDAA\nHALT').r.A).toBe(0x10);
    expect(regsAfter('LD A,59h\nADD A,47h\nDAA\nHALT').r.A).toBe(0x06); // 59 + 47 = 106
    expect(regsAfter('LD A,59h\nADD A,47h\nDAA\nHALT').r.F & 1).toBe(1);
    expect(regsAfter('LD A,10h\nSUB 01h\nDAA\nHALT').r.A).toBe(0x09);
  });

  it("EXX and EX AF,AF' swap in the alternate registers", () => {
    const c = regsAfter("LD BC,1122h\nLD DE,3344h\nLD HL,5566h\nEXX\nLD BC,0AAAAh\nEXX\nLD A,7\nEX AF,AF' ; swap\nLD A,9\nEX AF,AF'\nHALT");
    expect([c.r.B, c.r.C, c.r.D, c.r.E, c.r.H, c.r.L]).toEqual([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
    expect([c.alt.B, c.alt.C]).toEqual([0xaa, 0xaa]);
    expect([c.r.A, c.alt.A]).toEqual([7, 9]);
  });

  it('LD rr,(nn) and LD (nn),rr go through memory', () => {
    const c = regsAfter('LD BC,(1234h)\nLD DE,0BEEFh\nLD (2000h),DE\nLD SP,(2000h)\nHALT', { 0x1234: 0x77, 0x1235: 0x66 });
    expect((c.r.B << 8) | c.r.C).toBe(0x6677);
    expect(c.r.SP).toBe(0xbeef);
    expect([c.mem[0x2000], c.mem[0x2001]]).toEqual([0xef, 0xbe]);
  });

  it('rejects LD r,(nn) for registers other than A instead of loading the address', () => {
    expect(errorsOf('LD B,(20h)\nHALT')[0]).toMatch(/ใช้ได้กับ A เท่านั้น/);
  });

  it('a real but unsupported mnemonic in column 0 is an error, not a label', () => {
    expect(errorsOf('NEG\nHALT')[0]).toMatch(/ยังไม่รองรับคำสั่ง NEG/);
    expect(errorsOf('LDIR\nHALT')[0]).toMatch(/ยังไม่รองรับคำสั่ง LDIR/);
    expect(errorsOf('IM 1\nHALT')[0]).toMatch(/ยังไม่รองรับคำสั่ง IM/);
    expect(errorsOf("        DB 'AF'\nLOOP JR LOOP")).toEqual([]);
  });
});
