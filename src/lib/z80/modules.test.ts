import { describe, expect, it } from 'vitest';
import { addWires, analyze, autoWire, DEFAULT_BOARD, expandKit, PART_INFO, probe, ref, type Board, type PartType } from './board';
import { createMachine } from './machine';
import { MODULES, modOutState, modType, modVolts, type ModuleDef } from './modules';
import { assembleZ80 } from './z80';

function program(src: string) {
  const r = assembleZ80(src);
  if (!r.ok) throw new Error(r.errors.map((e) => e.msg).join('; '));
  return r.prog;
}

/** The trainer with module `m` at knob position `pos`, wired by ต่ออัตโนมัติ. */
function board(m: ModuleDef, pos = 0.5): Board {
  let b: Board = { parts: [...DEFAULT_BOARD.parts, { id: 'm1', type: modType(m) as PartType, model: m.id, pos, x: 500, y: 330, rot: 0 }], wires: [] };
  const r = autoWire(b, 'm1');
  if ('error' in r) throw new Error(`${m.id}: ${r.error}`);
  b = addWires(b, r.wires);
  return b;
}

function run(b: Board, src: string, pressed: Set<string> = new Set()) {
  const sim = expandKit(b);
  const an = analyze(sim);
  const m = createMachine(program(src), () => ({ board: sim, an, pressed }));
  m.cpu.runFor(2000);
  return { sim, an, m };
}

const READ_IN = 'IN A, (03h)\nOUT (01h), A\nHALT';
const READ_ADC = 'OUT (04h), A\n        LD B, 30\nW:      DJNZ W\n        IN A, (04h)\n        OUT (01h), A\n        HALT';

describe('แคตตาล็อกโมดูล', () => {
  it('has 112 modules, each with its own id and name, none repeating a part that was already there', () => {
    expect(MODULES).toHaveLength(112);
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(112);
    expect(new Set(MODULES.map((m) => m.name)).size).toBe(112);
    const existing = new Set(Object.values(PART_INFO).map((i) => i.name));
    expect(MODULES.filter((m) => existing.has(m.name))).toEqual([]);
  });

  for (const mod of MODULES)
    it(`${mod.name}: ต่ออัตโนมัติแล้วทำงานตามคำอธิบาย`, () => {
      const b = board(mod, 0);
      const an = analyze(expandKit(b));
      expect([an.canRun, an.problems]).toEqual([true, []]);
      if (mod.kind !== 'sw') expect(an.live.has('m1')).toBe(true);

      if (mod.kind === 'in' || mod.kind === 'sw') {
        const idle = mod.kind === 'in' ? 1 - mod.active! : mod.nc ? 0 : 1;
        expect(run(b, READ_IN).m.latch.get('kit1~u6')! & 1).toBe(idle);
        expect(run(b, READ_IN, new Set(['m1'])).m.latch.get('kit1~u6')! & 1).toBe(1 - idle);
      } else if (mod.kind === 'ain') {
        for (const pos of [0, 1]) {
          const want = Math.min(255, Math.floor((modVolts(mod, pos) / 5) * 256));
          const got = run(board(mod, pos), READ_ADC).m.latch.get('kit1~u6')!;
          expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
        }
      } else if (mod.kind === 'outn') {
        // OUT 01h bits 0… drive IN1…; every pattern gives a state the description names
        const n = mod.inputs!.length;
        for (let v = 0; v < 1 << n; v++) {
          const { sim, an, m } = run(b, `LD A, ${v}\nOUT (01h), A\nHALT`);
          const lv = probe(sim, an, m.latch).lv;
          const levels = Array.from({ length: n }, (_, k) => lv.at(ref('m1', 3 + k)) as 0 | 1);
          expect(levels).toEqual(Array.from({ length: n }, (_, k) => (v >> k) & 1));
          expect(modOutState(mod, levels)?.text).not.toBe('—');
        }
      } else {
        // OUT 01h bit 0 drives the module's IN
        for (const v of [0, 1]) {
          const { sim, an, m } = run(b, `LD A, ${v}\nOUT (01h), A\nHALT`);
          expect(probe(sim, an, m.latch).lv.at(ref('m1', 3))).toBe(v);
        }
      }
    });
});
