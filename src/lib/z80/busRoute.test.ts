import { describe, expect, it } from 'vitest';
import { addWires, FULL_BOARD, partSize, ref, type Board } from './board';
import { autoBusWires, routeBuses, sysBusOf } from './busRoute';

describe('bus rails', () => {
  it('draws the starting board as one address trunk and one data trunk', () => {
    const { trunks, rest } = routeBuses(FULL_BOARD);
    expect(trunks.map((t) => t.bus).sort()).toEqual(['addr', 'data']);
    const onTrunks = trunks.flatMap((t) => t.wires);
    expect(onTrunks.length + rest.length).toBe(FULL_BOARD.wires.length);
    // CPU, ROM, RAM and the 138 hang off the address bus; CPU, ROM, RAM and the 574 off the data bus
    const chips = (bus: string) => new Set(trunks.find((t) => t.bus === bus)!.taps.map((t) => t.part.id));
    expect([...chips('addr')].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect([...chips('data')].sort()).toEqual(['u1', 'u2', 'u3', 'u5']);
  });

  it('puts each trunk in a lane clear of every chip, and the two trunks apart', () => {
    const { trunks } = routeBuses(FULL_BOARD);
    for (const t of trunks)
      for (const p of FULL_BOARD.parts) {
        const { w, h } = partSize(p);
        const crossesX = t.x2 > p.x && t.x1 < p.x + w;
        expect(crossesX && t.y > p.y && t.y < p.y + h, `${t.bus} trunk runs through ${p.id}`).toBe(false);
      }
    expect(Math.abs(trunks[0].y - trunks[1].y)).toBeGreaterThanOrEqual(14);
  });

  it('every stub ends on its trunk', () => {
    for (const t of routeBuses(FULL_BOARD).trunks)
      for (const tap of t.taps) {
        const end = tap.stub[tap.stub.length - 1];
        expect(end.y).toBe(t.y);
        expect(end.x).toBeGreaterThanOrEqual(t.x1);
        expect(end.x).toBeLessThanOrEqual(t.x2);
      }
  });

  it('leaves a swapped address bit out of the trunk so the mistake stays visible', () => {
    const b: Board = { ...FULL_BOARD, wires: [...FULL_BOARD.wires, { a: ref('u2', 10), b: ref('u1', 31) }] }; // ROM A0 ↔ CPU A1
    expect(sysBusOf(b, b.wires[b.wires.length - 1])).toBeNull();
    expect(routeBuses(b).rest).toContainEqual({ a: ref('u2', 10), b: ref('u1', 31) });
  });
});

describe('auto bus wiring', () => {
  it('has nothing to add on the finished starting board', () => {
    expect(autoBusWires(FULL_BOARD)).toEqual([]);
  });

  it('wires a bare ROM to the CPU: 13 address bits and 8 data bits', () => {
    const bare: Board = { parts: FULL_BOARD.parts.filter((p) => p.id === 'u1' || p.id === 'u2'), wires: [] };
    const ws = autoBusWires(bare);
    expect(ws).toHaveLength(21);
    const wired = addWires(bare, ws);
    expect(wired.wires.every((w) => sysBusOf(wired, w))).toBe(true);
  });

  it('keeps a pin the student already wired', () => {
    const bare: Board = { parts: FULL_BOARD.parts.filter((p) => p.id === 'u1' || p.id === 'u4'), wires: [{ a: ref('u4', 1), b: ref('u1', 34) }] }; // 138 A ← CPU A4
    const ws = autoBusWires(bare);
    expect(ws.some((w) => w.a === ref('u4', 1))).toBe(false);
    expect(ws).toHaveLength(2); // B, C → A1, A2
  });
});
