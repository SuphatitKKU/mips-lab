// Draws the system address / data bus as shared rails ("bus bars") instead of
// one ribbon per pair of chips: every chip side that touches the bus gets a
// short bar along its pins, and one stub from the bar down / up to a single
// horizontal trunk placed in a free lane of the board. Display only — the
// wires (and so the nets and checks) stay exactly as the student made them.

import { BOARD_H, BOARD_W, parseRef, partSize, pinDef, pinPos, PINOUT, ref, type Board, type Part, type PinDef, type PinRef, type Wire } from './board';

export type SysBus = 'addr' | 'data';

/** Pin bus groups that sit on the CPU's address / data bus. */
const SYS: Record<string, SysBus> = { A: 'addr', SEL: 'addr', D: 'data', OUT: 'data' };
const CORE = new Set(['A', 'D']);

export interface PinEnd {
  part: Part;
  def: PinDef;
  ref: PinRef;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function pinEnd(board: Board, r: PinRef): PinEnd | null {
  const pr = parseRef(r);
  const part = pr && board.parts.find((p) => p.id === pr.part);
  const def = part && pinDef(part.type, pr!.n);
  if (!part || !def) return null;
  return { part, def, ref: r, ...pinPos(part, def.n) };
}

/**
 * The system bus a wire belongs to: both ends on bus pins of the same bit, at
 * least one of them a real A / D pin (so 138 select lines and 244 outputs join
 * when they are wired to the CPU's bus, but a swapped bit stays a plain wire).
 */
export function sysBusOf(board: Board, w: Wire): SysBus | null {
  const a = pinEnd(board, w.a);
  const b = pinEnd(board, w.b);
  if (!a || !b || a.part.id === b.part.id) return null;
  const sa = SYS[a.def.bus ?? ''];
  if (!sa || sa !== SYS[b.def.bus ?? ''] || a.def.bit !== b.def.bit) return null;
  if (!CORE.has(a.def.bus!) && !CORE.has(b.def.bus!)) return null;
  return sa;
}

export interface Tap {
  part: Part;
  pins: PinEnd[];
  /** bar running along the pins, offset outward from the chip */
  bar: { x1: number; y1: number; x2: number; y2: number };
  /** polyline from the bar to the trunk */
  stub: { x: number; y: number }[];
  /** e.g. "A0–A10" */
  label: string;
  wires: Wire[];
}

export interface Trunk {
  bus: SysBus;
  y: number;
  x1: number;
  x2: number;
  taps: Tap[];
  wires: Wire[];
}

const BAR = 9; // bar distance from the pin tips
export const BUS_BAR = BAR;
const OUT = 8; // stub leaves the bar this far before turning
const PAD = 10; // detours keep this far from a chip
const LANE_PAD = 26; // trunks keep this far from a chip, clear of its bars
const EDGE = 44; // left of this run the rail jumpers

function box(p: Part, pad = PAD) {
  const { w, h } = partSize(p);
  return { x1: p.x - pad, y1: p.y - pad, x2: p.x + w + pad, y2: p.y + h + pad };
}

/** "A0–A7,A12" — runs of consecutive bits collapsed. */
function bitLabel(pins: PinEnd[]) {
  const bits = [...new Set(pins.map((p) => p.def.bit!))].sort((a, b) => a - b);
  const name = (b: number) => pins.find((p) => p.def.bit === b)!.def.name;
  const runs: string[] = [];
  for (let i = 0; i < bits.length; ) {
    let j = i;
    while (j + 1 < bits.length && bits[j + 1] === bits[j] + 1) j++;
    runs.push(j === i ? name(bits[i]) : `${name(bits[i])}–${name(bits[j])}`);
    i = j + 1;
  }
  return runs.join(',');
}

/** Groups the bus pins of one chip side and works out its bar. */
function makeTap(pins: PinEnd[], wires: Wire[]): Omit<Tap, 'stub'> & { start: { x: number; y: number }; dx: number; dy: number } {
  const { dx, dy } = pins[0];
  const part = pins[0].part;
  if (dy !== 0) {
    const xs = pins.map((p) => p.x);
    const y = pins[0].y + dy * BAR;
    const bar = { x1: Math.min(...xs), y1: y, x2: Math.max(...xs), y2: y };
    return { part, pins, wires, bar, label: bitLabel(pins), start: { x: (bar.x1 + bar.x2) / 2, y }, dx, dy };
  }
  const ys = pins.map((p) => p.y);
  const x = pins[0].x + dx * BAR;
  const bar = { x1: x, y1: Math.min(...ys), x2: x, y2: Math.max(...ys) };
  return { part, pins, wires, bar, label: bitLabel(pins), start: { x, y: (bar.y1 + bar.y2) / 2 }, dx, dy };
}

/** Path from a tap's bar to the trunk at height Y, going round its own chip when the trunk is on the far side. */
function stubTo(t: ReturnType<typeof makeTap>, Y: number): { x: number; y: number }[] {
  const s = t.start;
  if (t.dx !== 0) {
    const x = s.x + t.dx * OUT;
    return [s, { x, y: s.y }, { x, y: Y }];
  }
  const outward = (t.dy > 0 && Y >= s.y) || (t.dy < 0 && Y <= s.y);
  if (outward) return [s, { x: s.x, y: Y }];
  const b = box(t.part);
  const y0 = s.y + t.dy * OUT;
  // leave on the side nearer the bar's middle, staying on the board
  let x = s.x - b.x1 < b.x2 - s.x ? b.x1 : b.x2;
  if (x < EDGE) x = b.x2;
  if (x > BOARD_W - 20) x = b.x1;
  return [s, { x: s.x, y: y0 }, { x, y: y0 }, { x, y: Y }];
}

/** Best free horizontal lane for a trunk: clear of every chip, closest to the taps. */
function pickLane(board: Board, taps: ReturnType<typeof makeTap>[], avoid: number[]): number {
  const xs = taps.map((t) => t.start.x);
  const x1 = Math.min(...xs) - 30;
  const x2 = Math.max(...xs) + 30;
  const boxes = board.parts.map((p) => box(p, LANE_PAD));
  let best = { y: taps[0].start.y + taps[0].dy * 30, cost: Infinity };
  for (let y = 70; y <= BOARD_H - 70; y += 3) {
    if (avoid.some((a) => Math.abs(a - y) < 14)) continue;
    const blocked = boxes.some((b) => y > b.y1 && y < b.y2 && x2 > b.x1 && x1 < b.x2);
    let cost = blocked ? 1e6 : 0;
    for (const t of taps) {
      const path = stubTo(t, y);
      for (let i = 1; i < path.length; i++) cost += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    }
    if (cost < best.cost) best = { y, cost };
  }
  return best.y;
}

/**
 * Splits the board's wires into bus trunks and everything else. Only buses
 * joining at least two chips become trunks; a lone wire is left as it is.
 */
export function routeBuses(board: Board): { trunks: Trunk[]; rest: Wire[] } {
  const byBus = new Map<SysBus, Wire[]>();
  const rest: Wire[] = [];
  for (const w of board.wires) {
    const b = sysBusOf(board, w);
    if (b) byBus.set(b, [...(byBus.get(b) ?? []), w]);
    else rest.push(w);
  }

  const trunks: Trunk[] = [];
  const used: number[] = [];
  for (const bus of ['addr', 'data'] as SysBus[]) {
    const wires = byBus.get(bus);
    if (!wires) continue;
    // chips joined by these wires, split into connected groups
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x);
      if (p === undefined) parent.set(x, x);
      return p === undefined || p === x ? x : find(p);
    };
    for (const w of wires) parent.set(find(parseRef(w.a)!.part), find(parseRef(w.b)!.part));
    const groups = new Map<string, Wire[]>();
    for (const w of wires) {
      const g = find(parseRef(w.a)!.part);
      groups.set(g, [...(groups.get(g) ?? []), w]);
    }

    for (const gw of groups.values()) {
      // one tap per chip side
      const sides = new Map<string, { pins: Map<PinRef, PinEnd>; wires: Wire[] }>();
      for (const w of gw)
        for (const r of [w.a, w.b]) {
          const e = pinEnd(board, r)!;
          const k = `${e.part.id}:${e.dx},${e.dy}`;
          const s = sides.get(k) ?? { pins: new Map<PinRef, PinEnd>(), wires: [] as Wire[] };
          s.pins.set(r, e);
          s.wires.push(w);
          sides.set(k, s);
        }
      const raw = [...sides.values()].map((s) => makeTap([...s.pins.values()], s.wires));
      if (raw.length < 2) {
        rest.push(...gw);
        continue;
      }
      const y = pickLane(board, raw, used);
      used.push(y);
      const taps: Tap[] = raw.map((t) => ({ part: t.part, pins: t.pins, bar: t.bar, label: t.label, wires: t.wires, stub: stubTo(t, y) }));
      const ends = taps.map((t) => t.stub[t.stub.length - 1].x);
      trunks.push({ bus, y, x1: Math.min(...ends), x2: Math.max(...ends), taps, wires: gw });
    }
  }
  return { trunks, rest };
}

/**
 * Wires every unconnected address / data pin of every other chip to the CPU pin
 * of the same bit (74HC138 select inputs to A0–A2, 74HC244 outputs to D0–D7).
 * Pins that already have a wire are left alone, so a student's own choice wins.
 */
export function autoBusWires(board: Board): Wire[] {
  const cpus = board.parts.filter((p) => p.type === 'CPU');
  if (cpus.length !== 1) return [];
  const cpu = cpus[0];
  const cpuPin = (bus: 'A' | 'D', bit: number) => {
    const d = PINOUT.CPU.find((x) => x.bus === bus && x.bit === bit);
    return d ? ref(cpu.id, d.n) : null;
  };
  const wired = new Set(board.wires.flatMap((w) => [w.a, w.b]));
  const out: Wire[] = [];
  for (const p of board.parts) {
    if (p.id === cpu.id) continue;
    for (const d of PINOUT[p.type]) {
      const sys = SYS[d.bus ?? ''];
      if (!sys || d.bit == null) continue;
      const r = ref(p.id, d.n);
      if (wired.has(r)) continue;
      const target = cpuPin(sys === 'addr' ? 'A' : 'D', d.bit);
      if (target) out.push({ a: r, b: target });
    }
  }
  return out;
}
