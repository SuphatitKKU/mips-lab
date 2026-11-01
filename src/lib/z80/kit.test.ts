import { describe, expect, it } from 'vitest';
import { addWires, analyze, autoWire, busWires, DEFAULT_BOARD, DEFAULT_ENV, expandKit, outputs, ref, type Board, type Env, type Part } from './board';
import { createMachine } from './machine';
import { assembleZ80 } from './z80';

function program(src: string) {
  const r = assembleZ80(src);
  if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join('; '));
  return r.prog;
}

function run(board: Board, src: string, tStates: number, pressed: ReadonlySet<string> = new Set()) {
  const sim = expandKit(board);
  const an = analyze(sim);
  const m = createMachine(program(src), () => ({ board: sim, an, pressed }));
  m.cpu.runFor(tStates);
  return { sim, an, m };
}

/** OUT 01h pin i is trainer pin 1 + i, OUT 02h is 9 + i, IN 03h is 17 + i */
const kitPin = (port: 1 | 2 | 3, bit: number) => ref('kit1', 1 + (port - 1) * 8 + bit);

/** the board plus an LED bar `id` on `port`, cathodes to ground */
function withLeds(b: Board, id: string, port: 1 | 2): Board {
  const next: Board = { parts: [...b.parts, { id, type: 'LED', x: 60 + (port - 1) * 240, y: 330, rot: 0 }], wires: b.wires };
  return addWires(next, [...busWires(next, ref(id, 1), kitPin(port, 0)), ...busWires(next, ref(id, 16), 'rail:gb')]);
}

describe('Z80 trainer', () => {
  it('the hidden core passes every check: ROM, RAM, latches on 01h / 02h, buffer on 03h', () => {
    const an = analyze(expandKit(DEFAULT_BOARD));
    expect(an.checks.filter((c) => !c.ok)).toEqual([]);
    expect(an.problems).toEqual([]);
    expect(an.canRun).toBe(true);
    expect(an.latches.map((l) => l.port.value).sort()).toEqual([1, 2]);
    expect(an.buffers[0].groups).toEqual([
      { mask: 7, value: 3 },
      { mask: 7, value: 3 },
    ]);
  });

  it('the starting board is just the trainer', () => {
    expect(DEFAULT_BOARD.parts.map((p) => p.type)).toEqual(['KIT']);
    expect(DEFAULT_BOARD.wires).toEqual([]);
  });

  it('OUT (01h) lights the LED bar wired straight to the header, through the built-in resistors', () => {
    const { sim, an, m } = run(withLeds(DEFAULT_BOARD, 'd1', 1), 'LD A, 05h\nOUT (01h), A\nHALT', 200);
    expect(m.cpu.error).toBeNull();
    expect(outputs(sim, an, m.latch).get('d1')).toEqual([true, false, true, false, false, false, false, false]);
  });

  it('OUT (02h) drives the second header', () => {
    const b = withLeds(withLeds(DEFAULT_BOARD, 'd1', 1), 'd2', 2);
    const { sim, an, m } = run(b, 'LD A, 80h\nOUT (02h), A\nHALT', 200);
    expect(outputs(sim, an, m.latch).get('d2')).toEqual([false, false, false, false, false, false, false, true]);
    expect(outputs(sim, an, m.latch).get('d1')!.some(Boolean)).toBe(false);
  });

  it('IN (03h) reads 1 on a free pin (pull-up) and 0 while a button to GND is held', () => {
    let b: Board = { parts: [...DEFAULT_BOARD.parts, { id: 'sw1', type: 'BTN', x: 500, y: 330, rot: 0 }], wires: DEFAULT_BOARD.wires };
    b = addWires(b, [
      { a: ref('sw1', 1), b: kitPin(3, 0) },
      { a: ref('sw1', 3), b: 'rail:gb' },
    ]);
    const src = 'IN A, (03h)\nOUT (01h), A\nHALT';
    const up = run(b, src, 300);
    expect(up.m.latch.get('kit1~u6')).toBe(0xff);
    const down = run(b, src, 300, new Set(['sw1']));
    expect(down.m.latch.get('kit1~u6')).toBe(0xfe);
  });

  describe('ต่ออัตโนมัติ', () => {
    const place = (b: Board, ...parts: Part[]): Board => ({ parts: [...b.parts, ...parts], wires: b.wires });
    const wire = (b: Board, id: string) => {
      const r = autoWire(b, id);
      if ('error' in r) throw new Error(r.error);
      return { board: addWires(b, r.wires), msg: r.msg };
    };

    it('LED bars take OUT 01h, then OUT 02h, then report that both are used', () => {
      let b = place(DEFAULT_BOARD, ...['d1', 'd2', 'd3'].map((id, k): Part => ({ id, type: 'LED', x: 60 + k * 200, y: 330, rot: 0 })));
      const one = wire(b, 'd1');
      expect(one.msg).toContain('OUT 01h');
      const two = wire(one.board, 'd2');
      expect(two.msg).toContain('OUT 02h');
      b = two.board;
      expect(autoWire(b, 'd3')).toEqual({ error: expect.stringContaining('ถูกใช้หมดแล้ว') });
      const { sim, an, m } = run(b, 'LD A, 03h\nOUT (02h), A\nHALT', 200);
      expect(outputs(sim, an, m.latch).get('d2')).toEqual([true, true, false, false, false, false, false, false]);
    });

    it('a button goes to the lowest free IN 03h bit and reads 0 while held', () => {
      const b0 = place(DEFAULT_BOARD, { id: 'sw1', type: 'BTN', x: 500, y: 330, rot: 0 }, { id: 'sw2', type: 'BTN', x: 600, y: 330, rot: 0 });
      const first = wire(b0, 'sw1');
      expect(first.msg).toContain('IN 03h บิต 0');
      const second = wire(first.board, 'sw2');
      expect(second.msg).toContain('IN 03h บิต 1');
      const b = withLeds(second.board, 'd1', 1);
      const src = 'IN A, (03h)\nOUT (01h), A\nHALT';
      expect(run(b, src, 300, new Set(['sw2'])).m.latch.get('kit1~u6')).toBe(0xfd);
    });

    it('a PIR gets power from the rails and its output on an IN bit', () => {
      const b = wire(place(DEFAULT_BOARD, { id: 'm1', type: 'PIR', x: 500, y: 330, rot: 0 }), 'm1').board;
      const sim = expandKit(b);
      const an = analyze(sim);
      expect(an.live.has('m1')).toBe(true);
      const src = 'IN A, (03h)\nOUT (01h), A\nHALT';
      for (const motion of [false, true]) {
        const m = createMachine(program(src), () => ({ board: sim, an, pressed: new Set(), env: { ...DEFAULT_ENV, motion } }));
        m.cpu.runFor(300);
        expect(m.latch.get('kit1~u6')! & 1).toBe(motion ? 1 : 0);
      }
    });

    it('leaves wired parts and parts it cannot place alone', () => {
      const b = withLeds(place(DEFAULT_BOARD, { id: 'r1', type: 'Ω', x: 500, y: 330, rot: 0 }), 'd1', 1);
      expect(autoWire(b, 'd1')).toEqual({ error: expect.stringContaining('ต่อสายไว้แล้ว') });
      expect(autoWire(b, 'r1')).toEqual({ error: expect.stringContaining('ต่ออัตโนมัติไม่ได้') });
    });
  });

  describe('เซนเซอร์ดิจิทัลเพิ่มเติม', () => {
    // sensor type, the room change (or a held touch pad), and bit 0 of IN 03h before → after
    const cases: [Part['type'], Partial<Env> | 'touch', number, number][] = [
      ['SND', { sound: true }, 1, 0],
      ['VIB', { vibration: true }, 0, 1],
      ['FLM', { flame: true }, 1, 0],
      ['H2O', { water: true }, 1, 0],
      ['GAS', { gas: true }, 1, 0],
      ['HALL', { magnet: true }, 1, 0],
      ['TCH', 'touch', 0, 1],
    ];
    for (const [type, change, before, after] of cases)
      it(`${type}: ต่ออัตโนมัติแล้ว IN 03h บิต 0 = ${before} → ${after}`, () => {
        let b: Board = { parts: [...DEFAULT_BOARD.parts, { id: 'm1', type, x: 500, y: 330, rot: 0 }], wires: [] };
        const r = autoWire(b, 'm1');
        if ('error' in r) throw new Error(r.error);
        b = addWires(b, r.wires);
        const sim = expandKit(b);
        const an = analyze(sim);
        expect(an.live.has('m1')).toBe(true);
        const read = (env: Env, pressed: Set<string>) => {
          const m = createMachine(program('IN A, (03h)\nOUT (01h), A\nHALT'), () => ({ board: sim, an, pressed, env }));
          m.cpu.runFor(300);
          return m.latch.get('kit1~u6')! & 1;
        };
        expect(read(DEFAULT_ENV, new Set())).toBe(before);
        expect(change === 'touch' ? read(DEFAULT_ENV, new Set(['m1'])) : read({ ...DEFAULT_ENV, ...change }, new Set())).toBe(after);
      });
  });
});

describe('Z80 trainer: reset and bus checks', () => {
  it('a conversion started before /RESET still finishes after it', () => {
    // the delay makes the OUT land late, so the ADC's finish time is well past zero
    const { m } = run(DEFAULT_BOARD, 'LD B,0\nW: DJNZ W\nOUT (04h),A\nL: JR L', 3360);
    expect(m.adc.get('kit1~u10')?.pending).not.toBeNull();
    m.reset();
    expect(m.cpu.r.PC).toBe(0);
    m.cpu.runFor(200);
    m.chips();
    expect(m.adc.get('kit1~u10')?.intr).toBe(0);
  });

  /** the trainer's circuit with a copy of one of its chips, wired pin for pin like the original */
  const withCopy = (pick: (sim: Board) => Part) => {
    const sim = expandKit(DEFAULT_BOARD);
    const orig = pick(sim);
    const id = 'copy';
    const swap = (r: string) => (r.startsWith(`${orig.id}.`) ? `${id}.${r.slice(orig.id.length + 1)}` : r);
    const wires = sim.wires.filter((w) => w.a.startsWith(`${orig.id}.`) || w.b.startsWith(`${orig.id}.`)).map((w) => ({ a: swap(w.a), b: swap(w.b) }));
    return analyze({ parts: [...sim.parts, { ...orig, id }], wires: [...sim.wires, ...wires] });
  };

  it('two buffers answering the same IN port are flagged as a bus fight', () => {
    const an = withCopy((sim) => sim.parts.find((p) => p.type === '244')!);
    expect(an.problems.some((p) => p.includes('ขับบัสข้อมูลพร้อมกัน') && p.includes('03h'))).toBe(true);
  });

  it('a second RAM is reported instead of silently ignored', () => {
    const an = withCopy((sim) => sim.parts.find((p) => p.type === 'RAM')!);
    expect(an.problems.some((p) => p.includes('RAM มากกว่าหนึ่งตัว'))).toBe(true);
  });
});
