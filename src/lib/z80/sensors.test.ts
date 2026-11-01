import { describe, expect, it } from 'vitest';
import {
  addWires,
  analyze,
  busWires,
  closedSwitches,
  FULL_BOARD,
  DEFAULT_ENV,
  ledCurrents,
  netLevels,
  PINOUT,
  powerWires,
  rfidFrame,
  probe,
  ref,
  type Board,
  type Env,
  type Part,
  type PartType,
} from './board';
import { createMachine } from './machine';
import { assembleZ80 } from './z80';

const pinOf = (b: Board, id: string, name: string) => {
  const p = b.parts.find((x) => x.id === id)!;
  return ref(id, PINOUT[p.type].find((d) => d.name === name)!.n);
};

function withParts(base: Board, ...parts: Part[]): Board {
  const b = { ...base, parts: [...base.parts, ...parts] };
  return addWires(b, powerWires(b));
}
const part = (id: string, type: PartType, x: number, y: number, extra: Partial<Part> = {}): Part => ({ id, type, x, y, rot: 0, ...extra });

/** A second 74HC138 that answers both IN and OUT (/G2B to GND), so ports 0–7 reach the ADC and buffers. */
function ioDecoder(b: Board): Board {
  b = withParts(b, part('u6', '138', 60, 300));
  return addWires(b, [
    ...busWires(b, pinOf(b, 'u6', 'A'), pinOf(b, 'u1', 'A0')),
    { a: pinOf(b, 'u6', 'G1'), b: 'rail:vt' },
    { a: pinOf(b, 'u6', '/G2A'), b: pinOf(b, 'u1', '/IORQ') },
    { a: pinOf(b, 'u6', '/G2B'), b: 'rail:gt' },
  ]);
}

/** ADC0804 on port 02h, VIN+ from `vin`, optional VREF/2. */
function withAdc(b: Board, vin: string, vrefHalf?: string): Board {
  b = withParts(b, part('u7', 'ADC', 560, 300));
  return addWires(b, [
    { a: pinOf(b, 'u7', '/CS'), b: pinOf(b, 'u6', '/Y2') },
    { a: pinOf(b, 'u7', '/RD'), b: pinOf(b, 'u1', '/RD') },
    { a: pinOf(b, 'u7', '/WR'), b: pinOf(b, 'u1', '/WR') },
    { a: pinOf(b, 'u7', 'VIN−'), b: 'rail:gt' },
    { a: pinOf(b, 'u7', 'VIN+'), b: vin },
    ...busWires(b, pinOf(b, 'u7', 'DB0'), pinOf(b, 'u1', 'D0')),
    ...(vrefHalf ? [{ a: pinOf(b, 'u7', 'VREF/2'), b: vrefHalf }] : []),
  ]);
}

/** 74HC244 on port 03h, input bit 0 from `input`. */
function withBuffer(b: Board, input: string): Board {
  b = withParts(b, part('u8', '244', 300, 300));
  return addWires(b, [
    { a: pinOf(b, 'u8', '/1OE'), b: pinOf(b, 'u6', '/Y3') },
    ...busWires(b, pinOf(b, 'u8', '1Y1'), pinOf(b, 'u1', 'D0')),
    { a: pinOf(b, 'u8', '1A1'), b: input },
  ]);
}

/** Pot across the supply: wiper = 5 V × (1 − pos). */
function withPot(b: Board, pos: number, id = 'vr1'): Board {
  b = withParts(b, part(id, 'POT', 200, 120, { pos }));
  return addWires(b, [
    { a: ref(id, 1), b: 'rail:vt' },
    { a: ref(id, 3), b: 'rail:gt' },
  ]);
}

function run(board: Board, src: string, env: Env = DEFAULT_ENV, pressed: ReadonlySet<string> = new Set()) {
  const r = assembleZ80(src);
  if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join('; '));
  const an = analyze(board);
  const m = createMachine(r.prog, () => ({ board, an, pressed, env }));
  m.cpu.runFor(20_000);
  return { an, m };
}

const READ_ADC = `        ORG  0000h
        OUT  (02h), A   ; /WR starts a conversion
WAIT:   IN   A, (03h)   ; poll /INTR on the buffer's bit 0
        BIT  0, A
        JR   NZ, WAIT
        IN   A, (02h)   ; read the result
        OUT  (01h), A
        HALT`;

describe('resistor values and voltages', () => {
  it('a potentiometer wiper sits where the knob says', () => {
    for (const pos of [0, 0.25, 0.5, 1]) {
      const b = withPot(FULL_BOARD, pos);
      const v = netLevels(b, analyze(b).nets).volts(ref('vr1', 2))!;
      expect(v).toBeCloseTo(5 * (1 - pos), 2);
    }
  });

  it('an LDR divider rises in the dark and falls in bright light', () => {
    let b = withParts(FULL_BOARD, part('r9', 'Ω', 200, 120), part('ldr1', 'LDR', 300, 120));
    b = addWires(b, [
      { a: ref('r9', 1), b: 'rail:vt' },
      { a: ref('r9', 2), b: ref('ldr1', 1) },
      { a: ref('ldr1', 2), b: 'rail:gt' },
    ]);
    const nets = analyze(b).nets;
    const at = (light: number) => netLevels(b, nets, new Map(), { env: { ...DEFAULT_ENV, light } }).volts(ref('ldr1', 1))!;
    expect(at(0.01)).toBeGreaterThan(4.9);
    expect(at(10)).toBeCloseTo(2.5, 1);
    expect(at(1000)).toBeLessThan(0.2);
  });

  it('warns when the LED resistor lets through too much or too little current', () => {
    const set = (val: number): Board => ({ ...FULL_BOARD, parts: FULL_BOARD.parts.map((p) => (p.id === 'rn1' ? { ...p, val } : p)) });
    expect(analyze(set(330)).problems.join()).not.toMatch(/mA/);
    expect(analyze(set(100)).problems.join()).toMatch(/30 mA.*เกินพิกัด/);
    expect(analyze(set(100000)).problems.join()).toMatch(/0\.03 mA.*หรี่/);
  });

  it('LED current follows the series resistor', () => {
    const an = analyze(FULL_BOARD);
    const { nets, lv } = probe(FULL_BOARD, an, new Map([['u5', 0xff]]));
    const mA = ledCurrents(FULL_BOARD, nets, lv).get('d1')!;
    for (const i of mA) expect(i).toBeCloseTo((3 / 330) * 1000, 1);
  });
});

describe('ADC0804', () => {
  const adcBoard = (pos: number) => {
    let b = withPot(ioDecoder(FULL_BOARD), pos);
    b = withAdc(b, ref('vr1', 2));
    return withBuffer(b, pinOf(b, 'u7', '/INTR'));
  };

  it('is wired well enough for the CPU to reach it', () => {
    const an = analyze(adcBoard(0.5));
    expect(an.adcs).toHaveLength(1);
    expect(an.problems.filter((p) => p.includes('ADC'))).toEqual([]);
  });

  it('OUT starts a conversion, /INTR goes low, IN reads Vin / 5 V × 256 (rounded)', () => {
    for (const [pos, code] of [[0.5, 128], [0.75, 64], [0, 255], [1, 0]] as const) {
      const { m } = run(adcBoard(pos), READ_ADC);
      expect(m.cpu.halted && !m.cpu.error).toBe(true);
      expect(m.latch.get('u5')).toBe(code);
    }
  });

  it('LM35 with full scale 2.56 V reads the temperature in °C', () => {
    // VREF/2 = 1.28 V from a pot: 5 × (1 − pos) = 1.28
    let b = withPot(ioDecoder(FULL_BOARD), 1 - 1.28 / 5);
    b = withParts(b, part('u9', 'LM35', 760, 120));
    b = withAdc(b, pinOf(b, 'u9', 'VOUT'), ref('vr1', 2));
    b = withBuffer(b, pinOf(b, 'u7', '/INTR'));
    for (const temp of [25, 37, 80]) {
      const { m } = run(b, READ_ADC, { ...DEFAULT_ENV, temp });
      expect(m.latch.get('u5')).toBe(temp);
    }
  });
});

describe('digital sensors', () => {
  const READ_BIT = `        ORG  0000h
        IN   A, (03h)
        OUT  (01h), A
        HALT`;
  const bit0 = (b: Board, env: Env) => run(b, READ_BIT, env).m.latch.get('u5')! & 1;

  it('PIR output reads HIGH while something moves', () => {
    let b = withParts(ioDecoder(FULL_BOARD), part('m1', 'PIR', 760, 110));
    b = withBuffer(b, pinOf(b, 'm1', 'OUT'));
    expect(bit0(b, { ...DEFAULT_ENV, motion: true })).toBe(1);
    expect(bit0(b, { ...DEFAULT_ENV, motion: false })).toBe(0);
  });

  it('IR module pulls OUT low inside the trimpot range', () => {
    let b = withParts(ioDecoder(FULL_BOARD), part('m1', 'IR', 700, 110, { pos: 0.5 }));
    b = withBuffer(b, pinOf(b, 'm1', 'OUT'));
    expect(bit0(b, { ...DEFAULT_ENV, distance: 10 })).toBe(0);
    expect(bit0(b, { ...DEFAULT_ENV, distance: 25 })).toBe(1);
  });

  it('light module DO goes low when it is brighter than the trimpot setting', () => {
    let b = withParts(ioDecoder(FULL_BOARD), part('m1', 'LDM', 700, 110, { pos: 0.5 }));
    b = withBuffer(b, pinOf(b, 'm1', 'DO'));
    expect(bit0(b, { ...DEFAULT_ENV, light: 500 })).toBe(0);
    expect(bit0(b, { ...DEFAULT_ENV, light: 1 })).toBe(1);
  });

  it('a reed switch with a pull-up reads LOW when the magnet is near', () => {
    let b = withParts(ioDecoder(FULL_BOARD), part('s1', 'REED', 600, 110), part('r9', 'Ω', 500, 120));
    b = addWires(b, [
      { a: ref('r9', 1), b: 'rail:vt' },
      { a: ref('r9', 2), b: ref('s1', 1) },
      { a: ref('s1', 2), b: 'rail:gt' },
    ]);
    b = withBuffer(b, ref('s1', 1));
    expect(closedSwitches(b, new Set(), { ...DEFAULT_ENV, magnet: true }).has('s1')).toBe(true);
    expect(bit0(b, { ...DEFAULT_ENV, magnet: true })).toBe(0);
    expect(bit0(b, { ...DEFAULT_ENV, magnet: false })).toBe(1);
  });

  it('an unpowered module is reported and drives nothing', () => {
    const b = addWires({ ...FULL_BOARD, parts: [...FULL_BOARD.parts, part('m1', 'PIR', 760, 110)] }, [{ a: ref('m1', 2), b: ref('u1', 16) }]);
    const an = analyze(b);
    expect(an.live.has('m1')).toBe(false);
    expect(an.problems.join()).toMatch(/PIR.*ไฟเลี้ยง/);
  });
});

describe('RFID over an 8251A', () => {
  /** 74HC138 on A1–A3 (A0 left for C/D), answering IN and OUT: /Y2 = ports 04h (data) and 05h (control / status). */
  function rfidBoard(cdOnA0 = true): Board {
    let b = withParts(FULL_BOARD, part('u6', '138', 60, 300), part('u9', 'UART', 300, 290), part('m1', 'RFID', 700, 70));
    const sel = ['A', 'B', 'C'];
    b = addWires(b, [
      ...sel.map((s, i) => ({ a: pinOf(b, 'u6', s), b: pinOf(b, 'u1', `A${cdOnA0 ? i + 1 : i}`) })),
      { a: pinOf(b, 'u6', 'G1'), b: 'rail:vt' },
      { a: pinOf(b, 'u6', '/G2A'), b: pinOf(b, 'u1', '/IORQ') },
      { a: pinOf(b, 'u6', '/G2B'), b: 'rail:gt' },
      { a: pinOf(b, 'u9', '/CS'), b: pinOf(b, 'u6', '/Y2') },
      { a: pinOf(b, 'u9', 'C/D'), b: pinOf(b, 'u1', 'A0') },
      { a: pinOf(b, 'u9', '/RD'), b: pinOf(b, 'u1', '/RD') },
      { a: pinOf(b, 'u9', '/WR'), b: pinOf(b, 'u1', '/WR') },
      { a: pinOf(b, 'u9', 'RESET'), b: 'rail:gt' },
      ...busWires(b, pinOf(b, 'u9', 'D0'), pinOf(b, 'u1', 'D0')),
      { a: pinOf(b, 'u9', 'RxD'), b: pinOf(b, 'm1', 'TX') },
    ]);
    return b;
  }
  const READ_CARD = `        ORG  0000h
        LD   A, 4Eh      ; mode: async, x16, 8 data bits, no parity, 1 stop
        OUT  (05h), A
        LD   A, 14h      ; command: receiver on, clear errors
        OUT  (05h), A
        LD   B, 14       ; STX + 10 digits + 2 checksum + ETX
NEXT:   IN   A, (05h)
        AND  02h         ; RxRDY?
        JR   Z, NEXT
        IN   A, (04h)
        OUT  (01h), A
        DJNZ NEXT
        HALT`;

  it('builds the RDM6300 frame: STX, 10 digits, XOR checksum, ETX', () => {
    const f = rfidFrame('0A1B2C3D4E');
    expect(f).toHaveLength(14);
    expect(f[0]).toBe(0x02);
    expect(f[13]).toBe(0x03);
    expect(String.fromCharCode(...f.slice(1, 13))).toBe(`0A1B2C3D4E${(0x0a ^ 0x1b ^ 0x2c ^ 0x3d ^ 0x4e).toString(16).toUpperCase().padStart(2, '0')}`);
  });

  it('a program that sets up the 8251A receives the whole card frame', () => {
    const b = rfidBoard();
    const an = analyze(b);
    expect(an.usarts).toHaveLength(1);
    expect(an.problems.filter((p) => p.includes('USART'))).toEqual([]);
    const r = assembleZ80(READ_CARD);
    if (!r.ok) throw new Error('asm');
    const outs: number[] = [];
    const m = createMachine(r.prog, () => ({ board: b, an, pressed: new Set(), hz: 4_000_000 }), (port, v) => port === 1 && outs.push(v));
    m.cpu.runFor(200); // set up, then wait for a card
    expect(m.tap('m1', '0A1B2C3D4E')).toEqual(['u9']);
    m.cpu.runFor(80_000);
    expect(outs).toEqual(rfidFrame('0A1B2C3D4E'));
    expect(m.usart.get('u9')!.overrun).toBe(false);
  });

  it('a clock too slow for 9600 baud loses bytes and flags an overrun', () => {
    const b = rfidBoard();
    const an = analyze(b);
    const r = assembleZ80(READ_CARD);
    if (!r.ok) throw new Error('asm');
    const outs: number[] = [];
    const m = createMachine(r.prog, () => ({ board: b, an, pressed: new Set(), hz: 10_000 }), (port, v) => port === 1 && outs.push(v));
    m.cpu.runFor(200);
    m.tap('m1', '0A1B2C3D4E');
    m.cpu.runFor(2_000);
    expect(m.usart.get('u9')!.overrun).toBe(true);
    expect(outs.length).toBeLessThan(14);
  });

  it('door access: the stored card lights every LED, any other card only the two ends', () => {
    const DOOR = `        ORG  0000h
        LD   SP, 0FFFFh
        LD   A, 4Eh
        OUT  (05h), A
        LD   A, 14h
        OUT  (05h), A
WAIT:   CALL GETC
        CP   02h          ; frame starts with STX
        JR   NZ, WAIT
        LD   HL, CARD
        LD   B, 10
        LD   C, 0         ; becomes 1 on any mismatch
CMP:    CALL GETC
        CP   (HL)
        JR   Z, SAME
        LD   C, 1
SAME:   INC  HL
        DJNZ CMP
        LD   A, C
        OR   A
        LD   A, 0FFh
        JR   Z, SHOW
        LD   A, 81h
SHOW:   OUT  (01h), A
        JR   WAIT
GETC:   IN   A, (05h)
        AND  02h
        JR   Z, GETC
        IN   A, (04h)
        RET
CARD:   DB   '0A1B2C3D4E'`;
    const b = rfidBoard();
    const an = analyze(b);
    const r = assembleZ80(DOOR);
    if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join());
    const m = createMachine(r.prog, () => ({ board: b, an, pressed: new Set(), hz: 4_000_000 }));
    m.cpu.runFor(500);
    m.tap('m1', '0A1B2C3D4E');
    m.cpu.runFor(80_000);
    expect(m.latch.get('u5')).toBe(0xff);
    m.tap('m1', '7700FF1234');
    m.cpu.runFor(80_000);
    expect(m.latch.get('u5')).toBe(0x81);
  });

  it('flags a /CS decode that also uses A0, which C/D needs', () => {
    expect(analyze(rfidBoard(false)).problems.join()).toMatch(/USART.*C\/D/);
  });

  it('bytes are lost while the receiver is off', () => {
    const b = rfidBoard();
    const an = analyze(b);
    const r = assembleZ80(`        ORG 0000h\nL:      JR L`);
    if (!r.ok) throw new Error('asm');
    const m = createMachine(r.prog, () => ({ board: b, an, pressed: new Set(), hz: 4_000_000 }));
    m.tap('m1', '0A1B2C3D4E');
    m.cpu.runFor(80_000);
    m.chips();
    expect(m.usart.get('u9')?.log ?? []).toEqual([]);
  });
});
