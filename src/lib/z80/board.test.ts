import { describe, expect, it } from 'vitest';
import { addWires, analyze, busWires, FULL_BOARD, inReset, outputs, PINOUT, pinPos, powerWires, ref, type Board, type Part } from './board';
import { createMachine } from './machine';
import { assembleZ80 } from './z80';

const LEDS = `        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   A, 01h
LOOP:   OUT  (01h), A
        CALL DELAY
        RLCA
        JR   LOOP
DELAY:  LD   B, 08h
D1:     DJNZ D1
        RET`;

function program(src: string) {
  const r = assembleZ80(src);
  if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join('; '));
  return r.prog;
}

function run(board: Board, src: string, tStates: number, pressed: ReadonlySet<string> = new Set()) {
  const an = analyze(board);
  const outs: number[] = [];
  const m = createMachine(program(src), () => ({ board, an, pressed }), (_port, v) => outs.push(v));
  m.cpu.runFor(tStates);
  return { an, m, outs };
}

const pinOf = (p: Part, name: string) => ref(p.id, PINOUT[p.type].find((d) => d.name === name)!.n);
const without = (b: Board, ...refs: string[]) => ({ ...b, wires: b.wires.filter((w) => !refs.includes(w.a) && !refs.includes(w.b)) });

describe('pin-level breadboard', () => {
  it('pin geometry follows DIP numbering: pin 1 bottom-left, counter-clockwise', () => {
    const cpu = FULL_BOARD.parts.find((p) => p.id === 'u1')!;
    const p1 = pinPos(cpu, 1);
    const p20 = pinPos(cpu, 20);
    const p21 = pinPos(cpu, 21);
    const p40 = pinPos(cpu, 40);
    expect(p1.y).toBe(p20.y);
    expect(p1.x).toBeLessThan(p20.x);
    expect(p21.x).toBeCloseTo(p20.x);
    expect(p40.x).toBeCloseTo(p1.x);
    expect(p40.y).toBeLessThan(p1.y);
  });

  it('the starting board passes every check: ROM low, RAM high, latch on port 01h', () => {
    const an = analyze(FULL_BOARD);
    expect(an.checks.filter((c) => !c.ok)).toEqual([]);
    expect(an.problems).toEqual([]);
    expect(an.canRun).toBe(true);
    expect(an.rom?.at).toEqual({ mask: 0x8000, value: 0 });
    expect(an.ram?.at).toEqual({ mask: 0x8000, value: 0x8000 });
    expect(an.latches.map((l) => l.port)).toEqual([{ mask: 7, value: 1 }]);
  });

  it('runs a program through the EPROM, keeps the stack in RAM and lights the LEDs from the latch', () => {
    const { an, m, outs } = run(FULL_BOARD, LEDS, 4000);
    expect(m.cpu.error).toBeNull();
    expect(outs.slice(0, 5)).toEqual([1, 2, 4, 8, 16]);
    const lit = outputs(FULL_BOARD, an, m.latch).get('d1')!;
    expect(lit.reduce((acc, on, i) => acc | (+on << i), 0)).toBe(m.latch.get('u5'));
  });

  it('reports a missing data wire pin by pin and refuses to run', () => {
    const rom = FULL_BOARD.parts.find((p) => p.id === 'u2')!;
    const an = analyze(without(FULL_BOARD, pinOf(rom, 'O3')));
    const c = an.checks.find((x) => x.label.startsWith('ROM: data'))!;
    expect(an.canRun).toBe(false);
    expect(c.ok).toBe(false);
    expect(c.detail!.join(' ')).toContain('O3');
  });

  it('spots address lines swapped between CPU and ROM', () => {
    const rom = FULL_BOARD.parts.find((p) => p.id === 'u2')!;
    const cpu = FULL_BOARD.parts.find((p) => p.id === 'u1')!;
    let b = without(FULL_BOARD, pinOf(rom, 'A0'), pinOf(rom, 'A1'));
    b = addWires(b, [
      { a: pinOf(rom, 'A0'), b: pinOf(cpu, 'A1') },
      { a: pinOf(rom, 'A1'), b: pinOf(cpu, 'A0') },
    ]);
    const c = analyze(b).checks.find((x) => x.label.startsWith('ROM: address'))!;
    expect(c.ok).toBe(false);
    expect(c.detail!.join(' ')).toContain('A0 (ขา 10) ต่อกับ A1 ของ CPU');
  });

  it('without RAM the return address is lost and the subroutine call runs away', () => {
    const board: Board = {
      parts: FULL_BOARD.parts.filter((p) => p.id !== 'u3'),
      wires: FULL_BOARD.wires.filter((w) => !w.a.startsWith('u3.') && !w.b.startsWith('u3.')),
    };
    const { an, outs } = run(board, LEDS, 4000);
    expect(an.canRun).toBe(true);
    expect(an.ram).toBeNull();
    expect(outs).toEqual([1]);
  });

  it('a floating /WAIT pin is caught', () => {
    const cpu = FULL_BOARD.parts.find((p) => p.id === 'u1')!;
    const an = analyze(without(FULL_BOARD, pinOf(cpu, '/WAIT')));
    expect(an.canRun).toBe(false);
    expect(an.checks.find((c) => c.label.startsWith('ขาควบคุม'))!.detail!.join(' ')).toContain('/WAIT');
  });

  it('holding the reset button pulls /RESET low through the pull-up', () => {
    const an = analyze(FULL_BOARD);
    expect(inReset(FULL_BOARD, an, new Set())).toBe(false);
    expect(inReset(FULL_BOARD, an, new Set(['sw1']))).toBe(true);
  });

  it('reads a pulled-up button through a 74HC244 on its own read decoder', () => {
    const extra: Part[] = [
      { id: 'u6', type: '244', x: 300, y: 460, rot: 0 },
      { id: 'u7', type: '138', x: 520, y: 460, rot: 0 },
      { id: 'r2', type: 'Ω', x: 700, y: 90, rot: 0 },
      { id: 'sw2', type: 'BTN', x: 800, y: 120, rot: 0 },
    ];
    let b: Board = { parts: [...FULL_BOARD.parts, ...extra], wires: FULL_BOARD.wires };
    const cpu = b.parts.find((p) => p.id === 'u1')!;
    const [buf, dec] = extra;
    b = addWires(b, powerWires(b));
    b = addWires(b, [
      ...busWires(b, pinOf(dec, 'A'), pinOf(cpu, 'A0')),
      { a: pinOf(dec, 'G1'), b: 'rail:vb' },
      { a: pinOf(dec, '/G2A'), b: pinOf(cpu, '/IORQ') },
      { a: pinOf(dec, '/G2B'), b: pinOf(cpu, '/RD') },
      { a: pinOf(buf, '/1OE'), b: pinOf(dec, '/Y2') },
      ...busWires(b, pinOf(buf, '1Y1'), pinOf(cpu, 'D0')),
      { a: pinOf(buf, '1A1'), b: ref('r2', 1) },
      { a: ref('r2', 2), b: 'rail:vt' },
      { a: pinOf(buf, '1A1'), b: ref('sw2', 1) },
      { a: ref('sw2', 3), b: 'rail:gt' },
    ]);
    const prog = '        ORG 0000h\n        IN  A, (02h)\n        OUT (01h), A\n        HALT';
    expect(run(b, prog, 200).m.latch.get('u5')).toBe(0xff);
    expect(run(b, prog, 200, new Set(['sw2'])).m.latch.get('u5')).toBe(0xfe);
  });
});
