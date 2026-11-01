import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ENV, expandKit, outputs, type Env } from './board';
import { EXAMPLES } from './examples';
import { createMachine } from './machine';
import { assembleZ80 } from './z80';

const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const byName = (prefix: string) => EXAMPLES.find((e) => e.name.startsWith(prefix))!;

/** Boot an example on the emulator; hold buttons and change the room between runs. */
function boot(prefix: string) {
  const ex = byName(prefix);
  const a = assembleZ80(ex.code);
  if (!a.ok) throw new Error(a.errors.map((e) => `${e.line}: ${e.msg}`).join('; '));
  const sim = expandKit(ex.board);
  const an = analyze(sim);
  const io = { pressed: new Set<string>(), env: DEFAULT_ENV as Env };
  const m = createMachine(a.prog, () => ({ board: sim, an, pressed: io.pressed, env: io.env }));
  const press = (id: string, hold: number, after: number) => {
    io.pressed = new Set([id]);
    m.cpu.runFor(hold);
    io.pressed = new Set();
    m.cpu.runFor(after);
  };
  return { ex, sim, an, m, io, press, out1: () => m.latch.get('kit1~u6') ?? 0, out2: () => m.latch.get('kit1~u7') ?? 0 };
}

describe('ตัวอย่างโปรเจกต์', () => {
  it('every example wires cleanly, assembles and runs without errors', () => {
    for (const ex of EXAMPLES) {
      const an = analyze(expandKit(ex.board));
      expect([ex.name, an.canRun, an.problems]).toEqual([ex.name, true, []]);
      const b = boot(ex.name);
      b.m.cpu.runFor(50_000);
      expect([ex.name, b.m.cpu.error]).toEqual([ex.name, null]);
    }
  });

  it('ตัวนับ: SW1 counts, wraps after 9, SW2 clears', () => {
    const { m, sim, an, press, out1, out2 } = boot('ตัวนับ');
    m.cpu.runFor(5000);
    expect([out1(), out2()]).toEqual([SEG[0], 0]);
    for (let i = 0; i < 3; i++) press('sw1', 3000, 5000);
    expect([out1(), out2()]).toEqual([SEG[3], 3]);
    expect(outputs(sim, an, m.latch).get('ds1')).toEqual([true, true, true, true, false, false, true, false]);
    for (let i = 0; i < 7; i++) press('sw1', 3000, 5000);
    expect([out1(), out2()]).toEqual([SEG[0], 0]);
    press('sw1', 3000, 5000);
    press('sw2', 3000, 5000);
    expect(out1()).toBe(SEG[0]);
  });

  it('ไฟวิ่ง: the light moves; SW1 / SW2 change the speed shown on the 7-segment', () => {
    const { m, press, out1, out2 } = boot('ไฟวิ่ง');
    m.cpu.runFor(500);
    expect([out1(), out2()]).toEqual([0x01, SEG[5]]);
    m.cpu.runFor(9000);
    expect(out1()).toBe(0x02);
    press('sw1', 3000, 3000);
    expect(out2()).toBe(SEG[6]);
    press('sw2', 3000, 3000);
    press('sw2', 3000, 3000);
    expect(out2()).toBe(SEG[4]);
    // speed 9 steps faster than speed 1
    const stepTime = () => {
      let t = 0;
      const start = out1();
      while (out1() === start && t < 200_000) {
        m.cpu.runFor(100);
        t += 100;
      }
      return t;
    };
    for (let i = 0; i < 8; i++) press('sw1', 3000, 3000);
    expect(out2()).toBe(SEG[9]);
    stepTime();
    const fast = stepTime();
    for (let i = 0; i < 8; i++) press('sw2', 3000, 3000);
    expect(out2()).toBe(SEG[1]);
    stepTime();
    const slow = stepTime();
    expect(slow).toBeGreaterThan(fast * 4);
  });

  it('เกม: pressing on the last LED scores, pressing early resets the score', () => {
    const { m, press, out1, out2 } = boot('เกม');
    const waitFor = (v: number) => {
      for (let t = 0; out1() !== v && t < 100_000; t += 50) m.cpu.runFor(50);
      expect(out1()).toBe(v);
    };
    m.cpu.runFor(500);
    expect(out2()).toBe(SEG[0]);
    waitFor(0x80);
    press('sw1', 1500, 500);
    expect(out2()).toBe(SEG[1]);
    waitFor(0x01); // next lap
    waitFor(0x80);
    press('sw1', 1500, 500);
    expect(out2()).toBe(SEG[2]);
    waitFor(0x08);
    press('sw1', 1500, 500);
    expect(out2()).toBe(SEG[0]);
  });

  it('PIR: motion lights the LEDs and starts a countdown; they go out on their own', () => {
    const { m, io, out1, out2 } = boot('ไฟติด');
    m.cpu.runFor(20_000);
    expect([out1(), out2()]).toEqual([0, 0]);
    io.env = { ...DEFAULT_ENV, motion: true };
    m.cpu.runFor(15_000);
    expect(out1()).toBe(0xff);
    expect(out2()).toBe(SEG[9]);
    io.env = { ...DEFAULT_ENV, motion: false };
    m.cpu.runFor(40_000);
    expect(out1()).toBe(0xff); // still counting down
    expect([SEG[5], SEG[6]]).toContain(out2());
    m.cpu.runFor(80_000);
    expect([out1(), out2()]).toEqual([0, 0]);
  });

  describe('UART', () => {
    const text = (bytes: number[]) => String.fromCharCode(...bytes);

    it('ทายเลข: the banner reaches the terminal, typed digits get answers, the right one wins', () => {
      const { m, out1 } = boot('ทายเลข');
      const tx = () => text(m.usart.get('kit1~u11')?.tx ?? []);
      m.cpu.runFor(20_000);
      expect(m.cpu.error).toBeNull();
      expect(tx()).toContain('Z80 guessing game');
      expect(tx()).toContain('Press any key to start');
      m.send('kit1~u11', [0x20]);
      m.cpu.runFor(20_000);
      expect(tx()).toContain('Guess 0-9 > ');
      let won = false;
      for (let d = 0; d <= 9 && !won; d++) {
        m.send('kit1~u11', [0x30 + d]);
        m.cpu.runFor(20_000);
        won = tx().includes('correct!');
        expect(out1()).toBe(d + 1); // tries on the LEDs
      }
      expect(won).toBe(true);
      expect(tx()).toMatch(/higher|lower|correct/);
    });

    it('ส่งค่า ADC: the slider value reaches the terminal as "ADC = ###"', () => {
      for (const [pos, want] of [
        [1, 255],
        [0, 0],
      ] as const) {
        const ex = EXAMPLES.find((e) => e.name.startsWith('ส่งค่า ADC'))!;
        const board = { ...ex.board, parts: ex.board.parts.map((p) => (p.id === 'vr1' ? { ...p, pos } : p)) };
        const a = assembleZ80(ex.code);
        if (!a.ok) throw new Error(a.errors.map((e) => `${e.line}: ${e.msg}`).join('; '));
        const sim = expandKit(board);
        const an = analyze(sim);
        const m = createMachine(a.prog, () => ({ board: sim, an, pressed: new Set() }));
        m.cpu.runFor(20_000);
        expect(m.cpu.error).toBeNull();
        expect(text(m.usart.get('kit1~u11')!.tx)).toContain(`ADC = ${String(want).padStart(3, '0')}`);
      }
    });
  });
});
