import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hex, type Kind, type StepInfo } from '../lib/mips/cpu';
import { FILL, Icon, ICON } from './Icon';
import { Segmented } from './ui';
import { fields, RN } from '../lib/mips/isa';

// Simplified single-cycle MIPS datapath. Units and wires light up according to
// the kind of instruction that just ran; pointing at one shows the value it carried.

type Unit = 'pc' | 'add4' | 'imem' | 'regs' | 'sext' | 'alu' | 'dmem' | 'badd' | 'pcmux' | 'wbmux' | 'hilo';
type Wire =
  | 'pc-imem' | 'pc-add4' | 'add4-mux' | 'imem-regs' | 'imem-sext' | 'regs-alu-a' | 'regs-alu-b' | 'sext-alu'
  | 'alu-dmem' | 'alu-wb' | 'dmem-wb' | 'regs-dmem' | 'wb-regs' | 'sext-badd' | 'badd-mux' | 'jump-mux' | 'regs-mux'
  | 'mux-pc' | 'regs-hilo' | 'hilo-wb' | 'add4-wb';

const ACTIVE: Record<Kind, [Unit[], Wire[]]> = {
  alu: [['regs', 'alu', 'wbmux'], ['imem-regs', 'regs-alu-a', 'regs-alu-b', 'alu-wb', 'wb-regs']],
  shift: [['regs', 'alu', 'wbmux'], ['imem-regs', 'regs-alu-b', 'alu-wb', 'wb-regs']],
  imm: [['regs', 'sext', 'alu', 'wbmux'], ['imem-regs', 'imem-sext', 'regs-alu-a', 'sext-alu', 'alu-wb', 'wb-regs']],
  load: [['regs', 'sext', 'alu', 'dmem', 'wbmux'], ['imem-regs', 'imem-sext', 'regs-alu-a', 'sext-alu', 'alu-dmem', 'dmem-wb', 'wb-regs']],
  store: [['regs', 'sext', 'alu', 'dmem'], ['imem-regs', 'imem-sext', 'regs-alu-a', 'sext-alu', 'alu-dmem', 'regs-dmem']],
  branch: [['regs', 'alu', 'sext', 'badd'], ['imem-regs', 'imem-sext', 'regs-alu-a', 'regs-alu-b', 'sext-badd']],
  jump: [[], ['jump-mux']],
  jr: [['regs'], ['imem-regs', 'regs-mux']],
  muldiv: [['regs', 'hilo', 'wbmux'], ['imem-regs', 'regs-hilo', 'hilo-wb', 'wb-regs']],
  sys: [['regs'], ['imem-regs']],
};

const UNITS: Record<Unit, { x: number; y: number; w: number; h: number; label: string; sub?: string }> = {
  pc: { x: 20, y: 150, w: 44, h: 60, label: 'PC' },
  add4: { x: 90, y: 40, w: 50, h: 40, label: '+4' },
  imem: { x: 100, y: 130, w: 96, h: 100, label: 'Instruction', sub: 'memory' },
  regs: { x: 280, y: 120, w: 100, h: 120, label: 'Registers', sub: '32 × 32 บิต' },
  sext: { x: 290, y: 270, w: 80, h: 40, label: 'Sign-ext' },
  alu: { x: 470, y: 140, w: 70, h: 90, label: 'ALU' },
  dmem: { x: 590, y: 140, w: 96, h: 100, label: 'Data', sub: 'memory' },
  wbmux: { x: 740, y: 160, w: 30, h: 70, label: 'M' },
  badd: { x: 470, y: 38, w: 60, h: 44, label: 'Add', sub: 'branch' },
  pcmux: { x: 620, y: 30, w: 30, h: 60, label: 'M' },
  hilo: { x: 470, y: 270, w: 90, h: 44, label: 'HI / LO', sub: '× ÷' },
};

const WIRES: Record<Wire, string> = {
  'pc-imem': 'M64 180H100',
  'pc-add4': 'M70 180V60H90',
  'add4-mux': 'M140 50H240V26H605V45H620',
  'add4-wb': 'M140 70H205V112H728V170H740',
  'imem-regs': 'M196 160H280',
  'imem-sext': 'M196 210H235V290H290',
  'regs-alu-a': 'M380 160H470',
  'regs-alu-b': 'M380 190H470',
  'sext-alu': 'M370 283H430V215H470',
  'alu-dmem': 'M540 185H590',
  'alu-wb': 'M540 185H560V262H700V200H740',
  'dmem-wb': 'M686 185H740',
  'regs-dmem': 'M380 218H395V246H575V228H590',
  'wb-regs': 'M770 195H782V330H258V200H280',
  'sext-badd': 'M370 297H450V60H470',
  'badd-mux': 'M530 60H555V70H620',
  'jump-mux': 'M196 140H218V15H635V30',
  'regs-mux': 'M330 120V98H580V85H620',
  'mux-pc': 'M650 60H665V4H10V180H20',
  'regs-hilo': 'M380 232H410V260H500V270',
  'hilo-wb': 'M560 292H715V215H740',
};

/** Unit each wire carries a signal from and to. Write-backs into PC / Registers end the cycle rather than feed it. */
const LINKS: Record<Wire, [from: Unit, to: Unit, write?: true]> = {
  'pc-imem': ['pc', 'imem'],
  'pc-add4': ['pc', 'add4'],
  'add4-mux': ['add4', 'pcmux'],
  'add4-wb': ['add4', 'wbmux'],
  'imem-regs': ['imem', 'regs'],
  'imem-sext': ['imem', 'sext'],
  'regs-alu-a': ['regs', 'alu'],
  'regs-alu-b': ['regs', 'alu'],
  'sext-alu': ['sext', 'alu'],
  'alu-dmem': ['alu', 'dmem'],
  'alu-wb': ['alu', 'wbmux'],
  'dmem-wb': ['dmem', 'wbmux'],
  'regs-dmem': ['regs', 'dmem'],
  'wb-regs': ['wbmux', 'regs', true],
  'sext-badd': ['sext', 'badd'],
  'badd-mux': ['badd', 'pcmux'],
  'jump-mux': ['imem', 'pcmux'],
  'regs-mux': ['regs', 'pcmux'],
  'mux-pc': ['pcmux', 'pc', true],
  'regs-hilo': ['regs', 'hilo'],
  'hilo-wb': ['hilo', 'wbmux'],
};

/** drawing width in viewBox units (height is VH) */
const VW = 800;
const VH = 340;

const ALL = new Set<string>([...Object.keys(UNITS), ...Object.keys(WIRES)]);
type ValueSources = Record<Unit | Wire | 'regWrite' | 'pcNext', StepInfo | null>;

function sourcesFor(step: StepInfo | null): ValueSources {
  return Object.fromEntries([...ALL, 'regWrite', 'pcNext'].map((k) => [k, step])) as ValueSources;
}

/** ms for a signal to cross one wire at 1× speed */
const TICK = 210;
const SPEEDS = [0.25, 0.5, 1, 2] as const;
type Speed = (typeof SPEEDS)[number];
const SPEED_KEY = 'datapath-speed';

function savedSpeed(): Speed {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.find((x) => x === v) ?? 0.5;
  } catch {
    return 0.5;
  }
}
/** wires a unit waits for before its output is ready, as a fraction of a tick */
const SETTLE = 0.35;
/** ms the previous instruction's picture stays on screen before the new signals set off */
const HOLD = 400;

/**
 * When each used unit lights up and each used wire starts, in ticks. A unit waits
 * for every signal it needs, so independent paths (PC → +4 and PC → memory,
 * register read and sign-extend, ALU and branch adder) run side by side. PC and
 * the register file only take their new values together at the clock edge.
 */
function schedule(on: Set<string>, kind: Kind) {
  const used = (Object.keys(LINKS) as Wire[]).filter((w) => on.has(w));
  const lit = new Map<Unit, number>([['pc', 0]]);
  const ready = (u: Unit): number => {
    if (!lit.has(u)) {
      const ins = used.filter((w) => LINKS[w][1] === u && !LINKS[w][2]);
      let t = ins.length ? Math.max(...ins.map((w) => ready(LINKS[w][0]) + 1)) : 0;
      // the PC mux needs the ALU's verdict before it can pick a branch target
      if (u === 'pcmux' && kind === 'branch') t = Math.max(t, ready('alu'));
      lit.set(u, t);
    }
    return lit.get(u)! + (u === 'pc' ? 0 : SETTLE);
  };
  const start = new Map<Wire, number>();
  for (const w of used) if (!LINKS[w][2]) start.set(w, ready(LINKS[w][0]));
  const writes = used.filter((w) => LINKS[w][2]);
  const edge = Math.max(0, ...[...start.values()].map((t) => t + 1), ...writes.map((w) => ready(LINKS[w][0])));
  for (const w of writes) {
    start.set(w, edge);
    // a unit only written to (Registers for jal) lights when the write arrives
    if (!lit.has(LINKS[w][1])) lit.set(LINKS[w][1], edge + 1);
  }
  for (const u of Object.keys(UNITS) as Unit[]) if (on.has(u)) ready(u);
  return { lit, start };
}

type Row = [label: string, value: string];
type Tip = { title: string; rows: Row[]; note?: string };

/** Every module in the circuit, listed in the value panel under the diagram in the order a signal meets them, with their short names. */
const PANEL: [Unit, string][] = [
  ['pc', 'PC'],
  ['add4', 'PC + 4'],
  ['imem', 'Instruction'],
  ['regs', 'Registers'],
  ['sext', 'Sign-ext'],
  ['alu', 'ALU'],
  ['hilo', 'HI / LO'],
  ['badd', 'Branch'],
  ['dmem', 'Data memory'],
  ['wbmux', 'Mux เขียนกลับ'],
  ['pcmux', 'Mux PC'],
];

const addr = (v: number) => '0x' + hex(v);
const reg = (k: string) => '$' + k;

/** What a unit or wire carried while `s` ran; `on` says whether this instruction used it. */
function describe(k: Unit | Wire, s: StepInfo | null, on: boolean, fmt: (v: number) => string): Tip {
  const title = TITLES[k];
  if (!s) return { title, rows: [], note: 'กด “ถัดไป” ก่อน แล้วชี้ที่นี่เพื่อดูค่า' };
  if (!on) return { title, rows: [], note: 'คำสั่งนี้ไม่ได้ใช้ส่วนนี้' };
  const b = s.bus;
  const f = fields(s.ins.word);
  const stage = (key: string) => s.stages.find((x) => x[0] === key)?.[1];
  const imm16 = '0x' + hex(f.uimm).slice(4);
  const usesExt = s.kind === 'imm' || s.kind === 'load' || s.kind === 'store';
  const wb: Row[] = b.wb ? [[`เขียนลง ${reg(b.wb.k)}`, fmt(b.wb.v)]] : [];
  switch (k) {
    case 'pc':
      return { title, rows: [['คำสั่งนี้', addr(s.pcOld)], ['ถัดไป', addr(s.pcNew)]] };
    case 'add4':
      return { title, rows: [[`${addr(s.pcOld)} + 4`, addr(s.pcOld + 4)]] };
    case 'imem':
      return { title, rows: [['address', addr(s.pcOld)], ['คำสั่ง', s.ins.basic.replace(/\s+/, ' ')], ['machine code', addr(s.ins.word)]] };
    case 'regs':
      return { title, rows: [...s.reads.map((r): Row => [`อ่าน ${reg(r.k)}`, fmt(r.v)]), ...wb], note: stage('ID') };
    case 'sext':
      return { title, rows: [['16 บิตในคำสั่ง', imm16], ['32 บิต', fmt(b.ext)]] };
    case 'alu': {
      if (s.kind === 'branch')
        return { title, rows: [['A', fmt(b.a)], ['B', fmt(b.b)], ['A − B', fmt(b.alu ?? 0)], ['Zero', b.alu === 0 ? '1 (เท่ากัน)' : '0']], note: stage('EX') };
      const ins: Row[] = s.kind === 'shift' ? [['ค่าที่เลื่อน', fmt(b.b)]] : [['A', fmt(b.a)], ['B', fmt(usesExt ? b.ext : b.b)]];
      const res = s.kind === 'load' || s.kind === 'store' ? addr(b.alu ?? 0) : fmt(b.alu ?? 0);
      return { title, rows: [...ins, ['ผลลัพธ์', res]], note: stage('EX') };
    }
    case 'dmem':
      return {
        title,
        rows: [
          ['address', addr(b.alu ?? 0)],
          ...(s.memRead ? [['อ่านได้', fmt(s.memRead.v)] as Row] : []),
          ...s.mem.map((m): Row => ['เขียน', `${fmt(m.o)} → ${fmt(m.n)}`]),
        ],
        note: stage('MEM'),
      };
    case 'wbmux': {
      const from = s.kind === 'load' ? 'Data memory' : s.kind === 'muldiv' ? 'HI / LO' : s.kind === 'jump' || s.kind === 'jr' ? 'PC + 4' : 'ALU';
      return { title, rows: [['เลือกจาก', from], ...wb] };
    }
    case 'badd':
      return { title, rows: [['PC + 4', addr(s.pcOld + 4)], ['offset × 4', fmt(b.ext * 4)], ['ปลายทาง', addr(b.target ?? 0)], ['กระโดด?', s.jump ? 'ใช่' : 'ไม่']] };
    case 'pcmux': {
      const from = s.kind === 'branch' && s.jump ? 'ตัวบวก branch' : s.kind === 'jump' ? 'address ในคำสั่ง' : s.kind === 'jr' ? 'register' : 'PC + 4';
      return { title, rows: [['เลือกจาก', from], ['PC ถัดไป', addr(s.pcNew)]] };
    }
    case 'hilo':
      return { title, rows: [['HI', fmt(b.hi)], ['LO', fmt(b.lo)]], note: stage('EX') };
    case 'pc-imem':
    case 'pc-add4':
      return { title, rows: [['PC', addr(s.pcOld)]] };
    case 'add4-mux':
    case 'add4-wb':
      return { title, rows: [['PC + 4', addr(s.pcOld + 4)]] };
    case 'imem-regs':
      return { title, rows: [['rs', reg(b.rs)], ['rt', reg(b.rt)], ...(f.op === 0 ? [['rd', reg(RN[f.rd])] as Row] : [])] };
    case 'imem-sext':
      return { title, rows: [['บิต 15–0', imm16]] };
    case 'regs-alu-a':
      return { title, rows: [[reg(b.rs), fmt(b.a)]] };
    case 'regs-alu-b':
      // blez / bgtz / bltz / bgez compare with 0 instead of a register
      return { title, rows: [[s.kind === 'branch' && f.op !== 4 && f.op !== 5 ? 'ค่าคงที่' : reg(b.rt), fmt(b.b)]] };
    case 'sext-alu':
      return { title, rows: [['ค่าคงที่', fmt(b.ext)]] };
    case 'alu-dmem':
      return { title, rows: [['address', addr(b.alu ?? 0)]] };
    case 'alu-wb':
      return { title, rows: [['ผล ALU', fmt(b.alu ?? 0)]] };
    case 'dmem-wb':
      return { title, rows: [['ค่าที่อ่าน', s.memRead ? fmt(s.memRead.v) : '—']] };
    case 'regs-dmem':
      return { title, rows: [[reg(b.rt), fmt(b.b)]] };
    case 'wb-regs':
      return b.wb ? { title, rows: wb } : { title, rows: [], note: 'ผลไปเก็บที่ HI / LO ไม่ได้เขียน register' };
    case 'sext-badd':
      return { title, rows: [['offset × 4', fmt(b.ext * 4)]] };
    case 'badd-mux':
    case 'jump-mux':
      return { title, rows: [['ปลายทาง', addr(b.target ?? 0)]] };
    case 'regs-mux':
      return { title, rows: [[reg(b.rs), addr(b.a)]] };
    case 'mux-pc':
      return { title, rows: [['PC ถัดไป', addr(s.pcNew)]] };
    case 'regs-hilo':
      return { title, rows: [[reg(b.rs), fmt(b.a)], [reg(b.rt), fmt(b.b)]] };
    case 'hilo-wb':
      return { title, rows: wb };
  }
}

/** 0x0000000A → 0xA, so values stay short */
const short = (t: string) => t.replace(/^0x0+(?=[0-9A-F])/, '0x');

/** A line of a module's current value; `edge` lines are written at the clock edge rather than when the signal arrives. */
interface Line {
  text: string;
  edge?: true;
}

/** Modules tall enough to list values under their name; the small ones show a value in place of their subtitle. */
const ROOMY = new Set<Unit>(['imem', 'regs', 'alu', 'dmem']);

/** What a module holds or produces while `s` runs — what the IF / ID / EX / MEM / WB stages work on. */
function inside(u: Unit, s: StepInfo, on: Set<string>, fmt: (v: number) => string): Line[] {
  if (!on.has(u)) return [];
  const b = s.bus;
  const v = (n: number) => short(fmt(n));
  const a = (n: number) => short(addr(n));
  switch (u) {
    case 'imem':
      return [{ text: s.ins.basic.replace(/\s+/, ' ') }];
    case 'regs': {
      const out: Line[] = s.reads.map((r) => ({ text: `${reg(r.k)} = ${v(r.v)}` }));
      if (b.wb && b.wb.k !== 'zero') out.push({ text: `${reg(b.wb.k)} ← ${v(b.wb.v)}`, edge: true });
      return out;
    }
    case 'alu':
      if (b.alu === undefined) return [];
      if (s.kind === 'branch') return [{ text: `${v(b.a)} − ${v(b.b)}` }, { text: b.alu === 0 ? 'เท่ากัน' : 'ไม่เท่ากัน' }];
      return [{ text: `= ${s.kind === 'load' || s.kind === 'store' ? a(b.alu) : v(b.alu)}` }];
    case 'dmem': {
      if (s.memRead) return [{ text: `อ่าน ${v(s.memRead.v)}` }, { text: `@ ${a(s.memRead.addr)}` }];
      const m = s.mem[0];
      return m ? [{ text: `เขียน ${v(m.n)}` }, { text: `@ ${a(m.addr)}` }] : [];
    }
    case 'hilo':
      return [{ text: `HI ${v(b.hi)} · LO ${v(b.lo)}` }];
    case 'badd':
      return [{ text: s.jump ? 'กระโดด' : 'ไม่กระโดด' }];
    default:
      return [];
  }
}

/** A module's value lines, under its name (roomy modules) or in place of its subtitle (small ones). */
function Lines({ u, lines, top }: { u: Unit; lines: Line[]; top: boolean }) {
  const b = UNITS[u];
  const max = b.w - 10;
  const y0 = top ? b.y + (b.sub ? 56 : 48) : b.y + b.h / 2 + 14;
  return (
    <g pointerEvents="none">
      {lines.map((l, i) => {
        const natural = l.text.length * 7.2 + 2;
        return (
          <text
            key={i}
            x={b.x + b.w / 2}
            y={y0 + i * 16}
            textAnchor="middle"
            fontSize={12}
            fontWeight={l.edge ? 700 : 600}
            fill={l.edge ? 'var(--m)' : 'var(--m-deep)'}
            {...(natural > max ? { textLength: max, lengthAdjust: 'spacingAndGlyphs' } : {})}
          >
            {l.text}
          </text>
        );
      })}
    </g>
  );
}

/** Units and wires an instruction uses. */
function usedBy(step: StepInfo | null) {
  const [units, wires] = step ? ACTIVE[step.kind] : [[], []];
  const on = new Set<string>(['pc', 'imem', ...(step ? ['pc-imem'] : []), ...units, ...wires]);
  if (step) {
    on.add('pcmux');
    on.add('mux-pc');
    if (!step.jump) {
      on.add('add4');
      on.add('pc-add4');
      on.add('add4-mux');
    }
    if (step.kind === 'branch' && step.jump) on.add('badd-mux');
    if (step.kind === 'jump' && step.name === 'jal') {
      on.add('add4');
      on.add('pc-add4');
      on.add('regs');
      on.add('wbmux');
      on.add('add4-wb');
      on.add('wb-regs');
    }
  }
  return on;
}

interface Props {
  step: StepInfo | null;
  /** the instruction before `step`, whose values fill the wires until the new ones arrive */
  prev?: StepInfo | null;
  fmt?: (v: number) => string;
  /** called once the animation of `step` has finished */
  onDone?: () => void;
  /** runs the next instruction; shown as a button when the datapath is enlarged */
  onNext?: () => void;
  /** shown left of the toolbar above the diagram */
  heading?: ReactNode;
}

export function Datapath({ step, prev, fmt = String, onDone, onNext, heading }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const [tip, setTip] = useState<{ k: Unit | Wire; x: number; y: number } | null>(null);
  const [replay, setReplay] = useState(0);
  const [speed, setSpeed] = useState<Speed>(savedSpeed);
  const [big, setBig] = useState(false);
  const [progress, setProgress] = useState({ run: 0, tick: -1 });
  // Keep what was actually visible, including when Next interrupts a signal.
  const displayed = useRef<ValueSources>(sourcesFor(prev ?? null));
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  const changeSpeed = (v: Speed) => {
    setSpeed(v);
    setReplay((n) => n + 1);
    try {
      localStorage.setItem(SPEED_KEY, String(v));
    } catch {
      // the choice just won't be remembered
    }
  };
  const tick = TICK / speed;
  // Enlarging reparents the SVG into a portal, so restart its value clock too.
  const count = useRef(0);
  const run = useMemo(() => ++count.current, [step, replay, big]);
  const baseline = useMemo(() => step ? displayed.current : sourcesFor(null), [run]);
  const on = usedBy(step);
  // the picture starts as the previous instruction left it; each part changes when this one's signal reaches it
  const was = step && prev ? usedBy(prev) : new Set<string>();
  const col = (k: string) => (on.has(k) ? 'var(--m)' : '#d9cfca');
  const plan = step ? schedule(on, step.kind) : null;
  // when the new values sweep past every part, used or not
  const sweep = step ? schedule(ALL, step.kind) : null;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the last signals to land are the PC / register writes at the clock edge
  const end = plan ? Math.max(...[...plan.start.values()].map((t) => t + 1)) : 0;
  const hold = step && prev && !still ? HOLD / speed : 0;
  /** ms into the animation of tick `t` */
  const at = (t: number) => hold + t * tick;
  const length = at(end);
  /** tick at which an unused part takes its new value — never after the instruction ends */
  const swept = (t: number | undefined) => Math.min(t ?? 0, end);
  const arrival = (k: Unit | Wire | 'regWrite' | 'pcNext') => {
    if (k === 'regWrite') return plan?.start.has('wb-regs') ? plan.start.get('wb-regs')! + 1 : end;
    if (k === 'pcNext') return end;
    if (k in UNITS) return plan?.lit.get(k as Unit) ?? swept(sweep?.lit.get(k as Unit));
    return plan?.start.has(k as Wire) ? plan.start.get(k as Wire)! + 1 : swept((sweep?.start.get(k as Wire) ?? 0) + 0.5);
  };
  const elapsed = still ? Infinity : progress.run === run ? progress.tick : -1;
  const values = sourcesFor(null);
  for (const k of Object.keys(values) as (keyof ValueSources)[]) values[k] = elapsed >= arrival(k) ? step : baseline[k];
  useLayoutEffect(() => {
    displayed.current = values;
  });

  // The diagram, value cards and hover details all use the same arrival clock.
  useEffect(() => {
    if (!step || still) return;
    const times = [...new Set((Object.keys(values) as (keyof ValueSources)[]).map(arrival))];
    const timers = times.map((t) => setTimeout(() => setProgress({ run, tick: t }), at(t)));
    return () => timers.forEach(clearTimeout);
    // Timing changes create a new run; unrelated renders must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const valueTip = (k: Unit | Wire): Tip => {
    const s = values[k];
    const result = describe(k, s, !!s && usedBy(s).has(k), fmt);
    if (k === 'regs') {
      const wb = values.regWrite;
      result.rows = [
        ...result.rows.filter(([l]) => !l.startsWith('เขียนลง ')),
        ...(wb?.bus.wb ? [[`เขียนลง ${reg(wb.bus.wb.k)}`, fmt(wb.bus.wb.v)] as Row] : []),
      ];
      if (result.rows.length && (!s || !usedBy(s).has(k))) delete result.note;
    } else if (k === 'pc') {
      const next = values.pcNext;
      result.rows = result.rows.filter(([l]) => l !== 'ถัดไป');
      if (next) result.rows.push(['ถัดไป', addr(next.pcNew)]);
    }
    return result;
  };
  const valueLines = (u: Unit): Line[] => {
    const s = values[u];
    const lines = s ? inside(u, s, usedBy(s), fmt) : [];
    if (u !== 'regs') return lines;
    const wb = values.regWrite;
    return [
      ...lines.filter((l) => !l.edge),
      ...(wb ? inside(u, wb, usedBy(wb), fmt).filter((l) => l.edge) : []),
    ];
  };
  const unitAnim = (u: Unit, label?: true) => {
    if (!plan || !sweep || u === 'pc') return undefined;
    const now = on.has(u);
    const before = was.has(u);
    // used by both: stays red, so flash it to show the new value arriving
    const name = now && before ? (label ? null : 'dp-unit-pulse') : now ? `dp-${label ? 'label' : 'unit'}` : before ? `dp-${label ? 'label' : 'unit'}-stale` : null;
    if (!name) return undefined;
    return { animation: `${name} ${tick * (now && before ? 1.2 : 0.6)}ms ease-out ${at(plan.lit.get(u) ?? swept(sweep.lit.get(u)))}ms both` };
  };

  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => done.current?.(), still ? 250 : length);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  /** Shows the tip for `k` at the pointer, or at (vx, vy) in viewBox units when focused by keyboard. */
  const point = (k: Unit | Wire, e?: RPointerEvent, vx = 0, vy = 0) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip(e ? { k, x: e.clientX - r.left, y: e.clientY - r.top } : { k, x: (vx / VW) * r.width, y: (vy / VW) * r.width });
  };
  const leave = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') setTip(null);
  };
  const shown = tip && valueTip(tip.k);
  const boxW = box.current?.clientWidth ?? VW;
  // where wires share a stretch (a signal fanning out), the one in use must be drawn on top
  // (fixed for a step: moving nodes while hovering would restart their animations)
  const rank = (w: Wire) => (on.has(w) ? 2 : was.has(w) ? 1 : 0);
  const order = (Object.keys(WIRES) as Wire[]).sort((a, b) => rank(a) - rank(b));

  const view = (
    <div className={`dp${big ? ' dp-big' : ''}`}>
      {big && (
        <div className="dp-big-bar">
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600 }}>{step ? step.ins.basic.replace(/\s+/, ' ') : 'Datapath'}</span>
          {onNext && (
            <button type="button" className="btn btn-primary" style={{ height: 40, gap: 6, padding: '0 12px 0 18px' }} onClick={onNext}>
              ถัดไป
              <Icon d={ICON.chevronRight} size={18} stroke={2.2} />
            </button>
          )}
          <button type="button" className="btn btn-secondary" style={{ height: 40 }} onClick={() => setBig(false)} title="ปิด (Esc)">
            ย่อ
          </button>
        </div>
      )}
      <div className="dp-bar">
        {!big && <div className="dp-heading">{heading}</div>}
        <div className="dp-tools">
          <Segmented<Speed>
            label="ความเร็วแอนิเมชัน"
            inCard
            value={speed}
            onChange={changeSpeed}
            btnStyle={{ height: 30, padding: '0 8px', fontSize: 13 }}
            options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))}
          />
          {step && (
            <button type="button" className="btn btn-soft" style={{ height: 30, padding: '0 10px', gap: 5, fontSize: 13 }} onClick={() => setReplay((n) => n + 1)}>
              <Icon d={FILL.play} filled size={12} />
              เล่นซ้ำ
            </button>
          )}
          {!big && (
            <button type="button" className="btn btn-soft" style={{ height: 30, padding: '0 10px', fontSize: 13 }} onClick={() => setBig(true)}>
              ขยาย
            </button>
          )}
        </div>
      </div>
      <div ref={box} className="dp-stage" style={{ position: 'relative' }}>
        <svg
          key={`svg-${run}`}
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          role="img"
          aria-label={`datapath แบบ single-cycle${step ? ` ขณะทำคำสั่ง ${step.name}` : ''}`}
          style={{ fontFamily: 'var(--mono)', display: 'block' }}
          onPointerDown={(e) => e.target === e.currentTarget && setTip(null)}
        >
          {order.map((w) => {
            const t = plan?.start.get(w);
            const hot = tip?.k === w;
            // the old value clears as the new signal sets off (an unused wire: as the sweep passes its middle)
            const clear = t !== undefined ? t : swept((sweep?.start.get(w) ?? 0) + 0.5);
            const stale = was.has(w) ? { animation: `dp-wire-stale 120ms ease-out ${at(clear)}ms both` } : undefined;
            if (t === undefined)
              return (
                <path
                  key={w}
                  d={WIRES[w]}
                  fill="none"
                  stroke={hot ? 'var(--m-deep)' : col(w)}
                  strokeWidth={hot ? 4.5 : on.has(w) ? 3 : 1.5}
                  strokeLinejoin="round"
                  style={stale}
                />
              );
            // used wire: the old value underneath until it clears, the new one drawn over it from source to destination
            return (
              <g key={w}>
                <path d={WIRES[w]} fill="none" stroke="#d9cfca" strokeWidth={1.5} strokeLinejoin="round" style={stale} />
                <path
                  d={WIRES[w]}
                  pathLength={1}
                  strokeDasharray="1"
                  fill="none"
                  stroke={hot ? 'var(--m-deep)' : 'var(--m)'}
                  strokeWidth={hot ? 4.5 : 3}
                  strokeLinejoin="round"
                  style={{ animation: `dp-wire ${tick}ms linear ${at(t)}ms both` }}
                />
              </g>
            );
          })}
          {/* a dot riding the front of each signal */}
          {plan &&
            !still &&
            [...plan.start].map(([w, t]) => (
              <circle key={`dot-${w}`} r={4.5} fill="var(--m-deep)" opacity={0} pointerEvents="none">
                <animateMotion path={WIRES[w]} begin={`${at(t)}ms`} dur={`${tick}ms`} fill="freeze" />
                <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" begin={`${at(t)}ms`} dur={`${tick * 1.4}ms`} fill="freeze" />
              </circle>
            ))}
          {/* wide invisible copies so thin wires are easy to point at */}
          {order.map((w) => (
            <path
              key={`hit-${w}`}
              d={WIRES[w]}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: 'pointer' }}
              onPointerMove={(e) => point(w, e)}
              onPointerLeave={leave}
            />
          ))}
          {(Object.keys(UNITS) as Unit[]).map((u) => {
            const b = UNITS[u];
            const active = on.has(u);
            const isMux = u === 'pcmux' || u === 'wbmux';
            const lines = valueLines(u);
            const listed = lines.length > 0;
            const top = listed && ROOMY.has(u);
            return (
              <g
                key={u}
                tabIndex={0}
                aria-label={TITLES[u]}
                style={{ cursor: 'pointer', outline: 'none' }}
                onPointerMove={(e) => point(u, e)}
                onPointerLeave={leave}
                onFocus={() => point(u, undefined, b.x + b.w / 2, b.y)}
                onBlur={() => setTip(null)}
              >
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  rx={isMux ? b.w / 2 : u === 'alu' ? 18 : 10}
                  fill={active ? '#f9ecea' : '#fff'}
                  stroke={tip?.k === u ? 'var(--m-deep)' : active ? 'var(--m)' : '#cfc4bf'}
                  strokeWidth={tip?.k === u ? 3.5 : active ? 2.5 : 1.5}
                  style={unitAnim(u)}
                />
                <text
                  x={b.x + b.w / 2}
                  y={top ? b.y + 21 : b.y + b.h / 2 + (b.sub ? -3 : 5)}
                  textAnchor="middle"
                  fontSize={isMux ? 12 : 14}
                  fontWeight={600}
                  fill={active ? '#8a1c1c' : '#9a8d8a'}
                  style={unitAnim(u, true)}
                >
                  {b.label}
                </text>
                {b.sub && (ROOMY.has(u) || !lines.length) && (
                  <text
                    x={b.x + b.w / 2}
                    y={top ? b.y + 35 : b.y + b.h / 2 + 13}
                    textAnchor="middle"
                    fontSize={11}
                    fill={active ? '#75686a' : '#b5a8a4'}
                  >
                    {b.sub}
                  </text>
                )}
                <Lines u={u} lines={lines} top={top} />
              </g>
            );
          })}
        </svg>
        {shown && (
          <div
            role="tooltip"
            style={{
              position: 'absolute',
              left: Math.min(Math.max(tip.x, 115), boxW - 115),
              top: tip.y,
              transform: tip.y < 110 ? 'translate(-50%, 18px)' : 'translate(-50%, calc(-100% - 12px))',
              width: 'max-content',
              maxWidth: 230,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#2a1f1f',
              color: '#fff',
              fontSize: 13,
              lineHeight: 1.5,
              boxShadow: '0 8px 24px rgba(42,31,31,.25)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: shown.rows.length || shown.note ? 4 : 0 }}>{shown.title}</div>
            {shown.rows.map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                <span style={{ color: '#d9cfca' }}>{l}</span>
                <b style={{ fontFamily: 'var(--mono)', textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</b>
              </div>
            ))}
            {shown.note && <div style={{ marginTop: shown.rows.length ? 4 : 0, color: '#f6dcd8' }}>{shown.note}</div>}
          </div>
        )}
      </div>
      {/* Keep each module's previous values until its new inputs arrive. */}
      <div className="dp-vals" aria-label="ค่าในแต่ละโมดูล">
        {PANEL.map(([u, name]) => {
          // The register write row can still hold its old value after the read
          // inputs have cleared, until the write-back part of the cycle ends.
          const rows = valueTip(u).rows.filter(([l]) => !(u === 'imem' && l === 'address'));
          if (!rows.length)
            return (
              <div key={u} className="dp-val idle">
                <b>{name}</b>
                <span aria-label="ไม่ได้ใช้">—</span>
              </div>
            );
          return (
            <div key={`${u}-${elapsed >= arrival(u) ? run : 'previous'}`} className="dp-val" style={elapsed >= arrival(u) ? { animation: `dp-val-card ${tick * 3}ms ease-out` } : undefined}>
              <b>{name}</b>
              <span>
                {rows.map(([l, v]) => (
                  <span key={l}>
                    <i>{l}</i> {v}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
  // enlarged: render at the top of the page so no ancestor can confine the fixed overlay
  return big ? createPortal(view, document.body) : view;
}

const TITLES: Record<Unit | Wire, string> = {
  pc: 'PC (Program Counter)',
  add4: 'ตัวบวก PC + 4',
  imem: 'Instruction memory',
  regs: 'Registers',
  sext: 'Sign-extend',
  alu: 'ALU',
  dmem: 'Data memory',
  wbmux: 'Mux เลือกค่าเขียนกลับ',
  badd: 'ตัวบวก branch',
  pcmux: 'Mux เลือก PC ถัดไป',
  hilo: 'ตัวคูณ / หาร (HI, LO)',
  'pc-imem': 'PC → Instruction memory',
  'pc-add4': 'PC → ตัวบวก +4',
  'add4-mux': 'PC + 4 → Mux PC',
  'add4-wb': 'PC + 4 (ที่อยู่กลับของ jal)',
  'imem-regs': 'ฟิลด์ register ในคำสั่ง',
  'imem-sext': 'immediate 16 บิตในคำสั่ง',
  'regs-alu-a': 'Read data 1 → ALU',
  'regs-alu-b': 'Read data 2 → ALU',
  'sext-alu': 'ค่าคงที่ 32 บิต → ALU',
  'alu-dmem': 'ALU → address ของ Data memory',
  'alu-wb': 'ผลจาก ALU → Mux',
  'dmem-wb': 'ค่าที่อ่านจาก memory → Mux',
  'regs-dmem': 'Read data 2 → Write data ของ memory',
  'wb-regs': 'เขียนกลับ → Registers',
  'sext-badd': 'offset × 4 → ตัวบวก branch',
  'badd-mux': 'ปลายทาง branch → Mux PC',
  'jump-mux': 'ปลายทาง jump → Mux PC',
  'regs-mux': 'register → Mux PC (jr)',
  'mux-pc': 'PC ถัดไป → PC',
  'regs-hilo': 'Registers → ตัวคูณ / หาร',
  'hilo-wb': 'HI / LO → Mux',
};
