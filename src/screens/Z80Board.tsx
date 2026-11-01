import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { CodeEditor, type LineMark } from '../components/CodeEditor';
import { FILL, Icon, ICON } from '../components/Icon';
import { PartDefs, PartModel, PartThumb, type ModelState } from '../components/PartModels';
import { usePopup } from '../components/Popup';
import { CheckCircle, PageHeader, Segmented, XCircle } from '../components/ui';
import { CodeToolbar, LabelList, ProjectBar, RomUsage } from '../components/Z80Tools';
import { HELLO_MS, LOST_MS, newTabId, openLink, openTermTab, type TermState } from '../components/termLink';
import type { GradeResult } from '../lib/grader';
import { M, MS, MT } from '../lib/tokens';
import {
  addWires,
  analyze,
  BOARD_H,
  BAUD,
  BOARD_W,
  busWires,
  closedSwitches,
  DEFAULT_BOARD,
  AUTO_WIRABLE,
  autoWire,
  expandKit,
  isKitInner,
  partDesc,
  partModule,
  partName,
  DEFAULT_ENV,
  fmtOhm,
  inReset,
  irRange,
  isPinBoard,
  isRail,
  label,
  ldmAo,
  ldmThreshold,
  ledCurrents,
  litOf,
  lm35Volts,
  matches,
  netLevels,
  newId,
  ohms,
  parseRef,
  PART_INFO,
  partPos,
  partSize,
  partVal,
  pinDef,
  pinPos,
  PINOUT,
  POT_VALUES,
  powerWires,
  probe,
  RAILS,
  ref,
  RES_VALUES,
  resCode,
  RN_VALUES,
  type Analysis,
  type Board,
  type Env,
  type Levels,
  type Match,
  type Part,
  type PartType,
  type PinRef,
  type Wire,
} from '../lib/z80/board';
import { BUS_BAR, routeBuses, type Trunk } from '../lib/z80/busRoute';
import { MODULES, modOutState, modPos, modQty, modType, modVolts, moduleById, type ModuleDef } from '../lib/z80/modules';
import { createMachine, RX_ENABLE, type AdcState, type Machine, type UsartState } from '../lib/z80/machine';
import { assembleZ80, hex2, hex4, type Z80Error, type Z80Program } from '../lib/z80/z80';

type Tool = 'select' | 'wire' | 'bus' | 'rotate' | 'delete';
const TOOLS: [id: Tool, label: string, d: string][] = [
  ['select', 'เลือก / ย้าย / กดปุ่ม', ICON.select],
  ['wire', 'ต่อสาย ขาต่อขา (คลิกขาต้นทาง แล้วขาปลายทางหรือรางไฟ)', ICON.wire],
  ['bus', 'ต่อบัส — ต่อทุกบิตของบัสในครั้งเดียว เช่น D0–D7 ↔ D0–D7', ICON.bus],
  ['rotate', 'หมุน 90°', ICON.rotate],
  ['delete', 'ลบชิ้นส่วน / สาย (คลิกขาเพื่อลบทุกสายที่ขานั้น)', ICON.trash],
];

/** A parts-list entry: a part type, or "MODI:mq3" for a catalogue module. */
type Item = string;
const itemType = (k: Item) => k.split(':')[0] as PartType;
const itemModel = (k: Item): string | undefined => k.split(':')[1];
const itemName = (k: Item) => moduleById(itemModel(k))?.name ?? PART_INFO[itemType(k)].name;
const itemDesc = (k: Item) => moduleById(itemModel(k))?.desc ?? PART_INFO[itemType(k)].desc;
const isMod = (t: PartType) => t.startsWith('MOD');
/** input levels of an output module with several inputs, IN1 first */
const modLevels = (p: Part, lv: Levels) =>
  PINOUT[p.type]
    .filter((d) => d.bus === 'MIN')
    .map((d) => {
      const l = lv.at(ref(p.id, d.n));
      return l === 0 || l === 1 ? l : null;
    });

const PALETTE: [string, Item[]][] = [
  ['บอร์ด', ['KIT']],
  ['อินพุต / เอาต์พุต', ['LED', '7SG', 'BTN']],
  ['ไฟเลี้ยงและพาสซีฟ', ['5V', 'CLK', 'Ω', 'RN', 'POT']],
  ['เซนเซอร์ดิจิทัล (อ่านด้วย 74HC244)', ['PIR', 'IR', 'LDM', 'REED', 'TILT', 'HALL', 'TCH', 'SND', 'VIB', 'FLM', 'H2O', 'GAS']],
  ['อนาล็อก (อ่านด้วย ADC)', ['ADC', 'LDR', 'NTC', 'LM35']],
  ['สื่อสาร / RFID', ['RFID', 'UART']],
  // the catalogue, one group per kind of module
  ...[...new Set(MODULES.map((m) => m.group))].map((g): [string, Item[]] => [g, MODULES.filter((m) => m.group === g).map((m) => `${modType(m)}:${m.id}`)]),
];

/** What changing the room does to each sensor. */
const SENSE_NOTE: Partial<Record<PartType, string>> = {
  PIR: 'มีการเคลื่อนไหว → ขา OUT = 1 · ไม่มี → 0',
  IR: 'มีวัตถุใกล้กว่าระยะที่ตั้งด้วย trimpot → ขา OUT = 0 · ไกลกว่า → 1',
  LDM: 'มืดกว่าจุดที่ตั้งด้วย trimpot → ขา DO = 1 · ขา AO แรงดันสูงขึ้นเมื่อมืดลง',
  REED: 'แม่เหล็กอยู่ใกล้ → หน้าสัมผัสต่อถึงกัน · เอาออก → ขาด',
  TILT: 'วางตั้งตรง → ต่อถึงกัน · เอียง → ขาด',
  LDR: 'แสงมากขึ้น → ความต้านทานลดลง (ต้องอ่านด้วย ADC)',
  NTC: 'ร้อนขึ้น → ความต้านทานลดลง (ต้องอ่านด้วย ADC)',
  LM35: 'ให้แรงดัน 10 mV ต่อ °C (ต้องอ่านด้วย ADC)',
  RFID: 'แตะการ์ด → ส่งเลขการ์ดออกขา TX แบบอนุกรม',
  HALL: 'แม่เหล็กอยู่ใกล้ → ขา OUT = 0 · ไม่มี → ปล่อยให้ pull-up ดึงเป็น 1',
  TCH: 'กดค้างที่แผ่นสัมผัสบนบอร์ด → ขา OUT = 1 · ปล่อย → 0',
  SND: 'เสียงดังกว่าจุดที่ตั้ง → ขา DO = 0 · เงียบ → 1',
  VIB: 'มีการสั่นสะเทือน → ขา DO = 1 · นิ่ง → 0',
  FLM: 'พบเปลวไฟ → ขา DO = 0 · ไม่พบ → 1',
  H2O: 'แผ่นรับน้ำเปียก → ขา DO = 0 · แห้ง → 1',
  GAS: 'แก๊สหรือควันเกินจุดที่ตั้ง → ขา DO = 0 · ปกติ → 1',
};

/** Sensors that need VCC / GND before they give anything. */
const POWERED: PartType[] = ['LM35', 'LDM', 'PIR', 'IR', 'RFID', 'SND', 'VIB', 'FLM', 'H2O', 'GAS', 'HALL', 'TCH', 'MODI', 'MODA', 'MODO', 'MOD2', 'MOD3', 'MOD4'];

/** What operating a catalogue module does, in one line. */
function modNote(m: ModuleDef): string {
  switch (m.kind) {
    case 'in':
      return `${m.trigger} → ขา OUT = ${m.active} · ปกติ → ${1 - m.active!}`;
    case 'sw':
      return `${m.trigger} → หน้าสัมผัส${m.nc ? 'ขาด' : 'ต่อถึงกัน'} · ต่อกับ IN ที่มี pull-up อ่านได้ ${m.nc ? 1 : 0}`;
    case 'ain':
      return `${m.q!.name} ${m.q!.min}–${m.q!.max} ${m.q!.unit} → ขา AO ${m.q!.v0}–${m.q!.v1} V`;
    case 'outn':
      return m.each
        ? `แต่ละขาทำงานเมื่อเป็น ${m.each.on} · ${m.inputs!.map((n, i) => `${n} = ${m.each!.labels[i]}`).join(', ')}`
        : `${m.inputs!.join(' ')} → ${Object.entries(m.states ?? {})
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}`;
    default:
      return `ขา IN = ${m.active} → ${m.trigger} · สั่งจากโค้ดด้วยคำสั่ง OUT`;
  }
}

/** Panel controls for a catalogue module: its condition switch, or its reading for an analog one. */
function ModControls({ part: p, m, on, onTrigger, onEdit }: { part: Part; m: ModuleDef; on: boolean; onTrigger: () => void; onEdit: (p: Part) => void }) {
  if (m.kind === 'in' || m.kind === 'sw')
    return (
      <div className="env-panel">
        <button type="button" role="switch" aria-checked={on} className="env-switch" onClick={onTrigger}>
          <i aria-hidden="true" />
          {m.trigger}
        </button>
      </div>
    );
  if (m.kind === 'ain') {
    const q = m.q!;
    const step = q.step ?? 1;
    const qty = Math.round(modQty(m, partPos(p)) / step) * step;
    return (
      <div className="env-panel">
        <div className="env-slider">
          <span>
            {q.name} <NumField label={`${q.name} (${q.unit})`} value={Number(qty.toFixed(4))} min={q.min} max={q.max} step={step} unit={q.unit} onChange={(v) => onEdit({ ...p, pos: modPos(m, v) })} />
          </span>
          <input type="range" aria-label={q.name} min={0} max={1000} value={Math.round(partPos(p) * 1000)} onChange={(e) => onEdit({ ...p, pos: Number(e.target.value) / 1000 })} />
        </div>
      </div>
    );
  }
  return null;
}

/** The sensor's output right now, in one line; null while it has nothing to say. */
function senseStatus(p: Part, lv: Levels, triggered = false): { text: string; on: boolean } | null {
  const env = lv.env;
  const out = (n: number, name: string) => {
    const l = lv.at(ref(p.id, n));
    return l === 0 || l === 1 ? { text: `${name} = ${l}`, on: l === 1 } : null;
  };
  switch (p.type) {
    case 'PIR':
      return out(2, 'OUT');
    case 'IR':
      return out(1, 'OUT');
    case 'LDM':
    case 'SND':
    case 'VIB':
    case 'FLM':
    case 'H2O':
    case 'GAS':
      return out(3, 'DO');
    case 'HALL':
    case 'TCH':
    case 'MODI':
      return out(3, 'OUT');
    case 'MODS': {
      const shut = triggered !== !!moduleById(p.model)?.nc;
      return { text: shut ? 'หน้าสัมผัสต่อถึงกัน' : 'หน้าสัมผัสเปิดอยู่', on: shut };
    }
    case 'MODA': {
      const m = moduleById(p.model);
      if (!m?.q) return null;
      const v = modVolts(m, partPos(p));
      return { text: `AO = ${v.toFixed(2)} V · ADC ≈ ${Math.min(255, Math.max(0, Math.floor((v / 5) * 256)))}`, on: false };
    }
    case 'MOD2':
    case 'MOD3':
    case 'MOD4': {
      const m = moduleById(p.model);
      return m ? modOutState(m, modLevels(p, lv)) : null;
    }
    case 'MODO': {
      const m = moduleById(p.model);
      const l = lv.at(ref(p.id, 3));
      if (!m || (l !== 0 && l !== 1)) return null;
      return { text: `IN = ${l} → ${l === m.active ? m.trigger : 'หยุดอยู่'}`, on: l === m.active };
    }
    case 'REED':
      return { text: env.magnet ? 'หน้าสัมผัสต่อถึงกัน' : 'หน้าสัมผัสเปิดอยู่', on: env.magnet };
    case 'TILT':
      return { text: env.tilt ? 'หน้าสัมผัสเปิดอยู่' : 'หน้าสัมผัสต่อถึงกัน', on: !env.tilt };
    default:
      return null;
  }
}

/** EM4100 cards to hold to the reader */
const CARDS: [name: string, uid: string][] = [
  ['การ์ด A', '0A1B2C3D4E'],
  ['การ์ด B', '1F00A3C5B7'],
  ['การ์ด C', '7700FF1234'],
];

/** Sensor parts, and the room conditions each one reacts to. */
const SENSES: Partial<Record<PartType, (keyof Env)[]>> = {
  LDR: ['light'],
  LDM: ['light'],
  NTC: ['temp'],
  LM35: ['temp'],
  IR: ['distance'],
  PIR: ['motion'],
  REED: ['magnet'],
  TILT: ['tilt'],
  HALL: ['magnet'],
  SND: ['sound'],
  VIB: ['vibration'],
  FLM: ['flame'],
  H2O: ['water'],
  GAS: ['gas'],
  TCH: [],
};
/** brightness of a lit LED at this current: full at 10 mA */
const brightness = (mA: number) => Math.min(1, mA / 10);
const fmtV = (v: number | null) => (v == null ? 'ลอย' : `${v.toFixed(2)} V`);

const WIRE_COLOR = { vcc: '#b3261e', gnd: '#2a1f1f', addr: '#8f8682', data: '#b5524c', clk: '#75686a', sig: '#6e1414' } as const;
type WireKind = keyof typeof WIRE_COLOR;

// what the canvas draws; the circuit itself never changes with these
type Layer = 'addr' | 'data' | 'ctrl' | 'power';
const LAYERS: [Layer, string, string][] = [
  ['addr', 'Address', WIRE_COLOR.addr],
  ['data', 'Data', WIRE_COLOR.data],
  ['ctrl', 'ควบคุม / I/O', WIRE_COLOR.sig],
  ['power', 'ไฟเลี้ยง', WIRE_COLOR.vcc],
];
const layerOf = (k: WireKind): Layer => (k === 'vcc' || k === 'gnd' ? 'power' : k === 'addr' ? 'addr' : k === 'data' ? 'data' : 'ctrl');
interface View {
  layers: Record<Layer, boolean>;
  /** address / data bus drawn as shared rails instead of chip-to-chip ribbons */
  rails: boolean;
}
const VIEW_KEY = 'mipslab.z80.view';
const DEFAULT_VIEW: View = { layers: { addr: true, data: true, ctrl: true, power: false }, rails: true };

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<View> | null;
    if (v?.layers) return { ...DEFAULT_VIEW, ...v, layers: { ...DEFAULT_VIEW.layers, ...v.layers } };
  } catch {
    /* ignore */
  }
  return DEFAULT_VIEW;
}
const EMPTY: ReadonlyMap<string, number> = new Map();

const CLOCKS = [1_000, 10_000, 100_000, 4_000_000];
const TICK_MS = 50;
const STORE = 'mipslab.z80';
const DEFAULT_CODE = `        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   A, 01h
LOOP:   OUT  (01h), A
        CALL DELAY
        RLCA       ; เลื่อนไฟ
        JR   LOOP
DELAY:  LD   B, 0FFh
D1:     DJNZ D1
        RET`;

interface Saved {
  v?: number;
  board: Board;
  code: string;
  /** project the board and program were opened from / saved as */
  name?: string;
}

function loadSaved(): Saved {
  try {
    const s = localStorage.getItem(STORE);
    if (s) {
      const v = JSON.parse(s) as Saved;
      // boards from before pin-level wiring can't be read; keep the program, start a fresh board
      return v.v === 2 && isPinBoard(v.board) ? v : { v: 2, board: DEFAULT_BOARD, code: v.code ?? DEFAULT_CODE };
    }
  } catch {
    /* ignore */
  }
  return { v: 2, board: DEFAULT_BOARD, code: DEFAULT_CODE };
}

const fmtHz = (hz: number) => (hz >= 1e6 ? `${hz / 1e6} MHz` : hz >= 1e3 ? `${hz / 1e3} kHz` : `${hz} Hz`);

export function Z80Board() {
  const [params] = useSearchParams();
  const problemId = params.get('problem') ? Number(params.get('problem')) : null;
  const wantAnswer = params.get('answer') === '1';
  const saved = useMemo(loadSaved, []);

  const [board, setBoard] = useState<Board>(saved.board);
  const [code, setCode] = useState(saved.code);
  const [projName, setProjName] = useState(saved.name ?? '');
  // the program editor full screen, with a small view of the ports beside it
  const [bigCode, setBigCode] = useState(false);
  const [jump, setJump] = useState<{ line: number; n: number }>();
  const jumpTo = (line: number) => setJump((j) => ({ line, n: (j?.n ?? 0) + 1 }));
  const [tool, setTool] = useState(0);
  const [selId, setSelId] = useState<string | null>('kit1');
  const [partQ, setPartQ] = useState('');
  const hasKit = board.parts.some((p) => p.type === 'KIT');
  // the parts catalogue, narrowed by the search box (name, description, code or group)
  const pq = partQ.trim().toLowerCase();
  const parts = PALETTE.map(([h, items]): [string, Item[]] => [
    h,
    pq ? items.filter((ab) => `${ab} ${itemName(ab)} ${itemDesc(ab)} ${h}`.toLowerCase().includes(pq)) : items,
  ]).filter(([, items]) => items.length);
  const [wireFrom, setWireFrom] = useState<PinRef | null>(null);
  const [hoverPin, setHoverPin] = useState<PinRef | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [chipTab, setChipTab] = useState(0);
  const [hz, setHz] = useState(10_000);
  const [running, setRunning] = useState(false);
  const [rom, setRom] = useState<Z80Program | null>(null);
  const [romSrc, setRomSrc] = useState<string | null>(null);
  const [asmErrors, setAsmErrors] = useState<Z80Error[]>([]);
  const [showLA, setShowLA] = useState(false);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  // catalogue modules switched on from their panel (a pressed button only lasts while held)
  const [triggered, setTriggered] = useState<Set<string>>(new Set());
  const held = useMemo(() => (triggered.size ? new Set([...pressed, ...triggered]) : pressed), [pressed, triggered]);
  const toggleTrigger = (id: string) =>
    setTriggered((t) => {
      const n = new Set(t);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const [env, setEnv] = useState<Env>(DEFAULT_ENV);
  const [lastCard, setLastCard] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const mach = useRef<Machine | null>(null);
  const trace = useRef<{ t: number; port: number; v: number }[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  // problem mode
  const [problem, setProblem] = useState<{ id: number; title: string } | null>(null);
  const [grade, setGrade] = useState<(GradeResult & { kind: string; pass: boolean; awarded: number | null }) | null>(null);
  const [gradeBusy, setGradeBusy] = useState<'test' | 'submit' | null>(null);
  const popup = usePopup();
  const [gradeErr, setGradeErr] = useState<string | null>(null);

  // the trainer stands for a full circuit: analysis and the emulator run on that, the screen shows the trainer
  const sim = useMemo(() => expandKit(board), [board]);
  const an = useMemo(() => analyze(sim), [sim]);
  const [view, setView] = useState<View>(loadView);
  const routed = useMemo(() => (view.rails ? routeBuses(board) : { trunks: [] as Trunk[], rest: board.wires }), [board, view.rails]);

  // ---------- persistence ----------
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* ignore */
    }
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ v: 2, board, code: problemId ? saved.code : code, name: projName }));
    } catch {
      /* ignore */
    }
  }, [board, code, problemId, saved.code, projName]);

  // Esc leaves the full-screen editor
  useEffect(() => {
    if (!bigCode) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBigCode(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bigCode]);

  useEffect(() => {
    if (!problemId) {
      setProblem(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const r = await api<{ problem: { id: number; title: string; starter: string; kind: string }; draft: string | null }>(`/problems/${problemId}`);
        if (!live || r.problem.kind !== 'z80') return;
        setProblem({ id: r.problem.id, title: r.problem.title });
        let src = r.draft ?? r.problem.starter;
        if (wantAnswer) {
          const a = await api<{ answer: { code: { lang: string; lines: string[] }[] } }>(`/problems/${problemId}/answer`).catch(() => null);
          const z = a?.answer.code.find((c) => c.lang === 'z80');
          if (z) src = z.lines.join('\n');
        }
        if (live) setCode(src);
      } catch (e) {
        if (live) setGradeErr((e as ApiError).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [problemId, wantAnswer]);

  // autosave the program as the problem draft
  useEffect(() => {
    if (!problem || wantAnswer) return;
    const t = setTimeout(() => api(`/problems/${problem.id}/draft`, { method: 'PUT', body: { code } }).catch(() => undefined), 1000);
    return () => clearTimeout(t);
  }, [code, problem, wantAnswer]);

  // ---------- emulator ----------
  const ioRef = useRef({ board: sim, an, pressed: held, env, hz });
  ioRef.current = { board: sim, an, pressed: held, env, hz };
  /** power-on count, so the terminal starts a fresh screen for each run */
  const runNo = useRef(0);

  /** power-on: fresh CPU, RAM and latches, program burned into the EPROM */
  const boot = (prog: Z80Program) => {
    trace.current = [];
    runNo.current++;
    mach.current = createMachine(prog, () => ioRef.current, (port, v, t) => {
      trace.current.push({ t, port, v });
      if (trace.current.length > 4000) trace.current.splice(0, 1000);
    });
    if (mach.current.overflow) popup.toast(`โปรแกรมเกิน 8 KB ของ EPROM — ${mach.current.overflow} ไบต์ถูกตัดทิ้ง`, 'err');
  };

  const assembleNow = () => {
    const r = assembleZ80(code);
    if (!r.ok) {
      setAsmErrors(r.errors);
      setRunning(false);
      return null;
    }
    setAsmErrors([]);
    setRom(r.prog);
    setRomSrc(code);
    boot(r.prog);
    setTick((x) => x + 1);
    return r.prog;
  };

  // assemble once on load
  useEffect(() => {
    assembleNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const m = mach.current;
      if (!m) return;
      const io = ioRef.current;
      // a held reset button keeps the CPU at 0000h, like the real /RESET pin
      if (inReset(io.board, io.an, closedSwitches(io.board, io.pressed, io.env))) {
        m.reset();
        setTick((x) => x + 1);
        return;
      }
      const c = m.cpu;
      c.runFor((hz * TICK_MS) / 1000);
      if (c.halted) {
        setRunning(false);
        popup.toast(c.error ?? 'CPU หยุดที่คำสั่ง HALT', c.error ? 'err' : 'info');
      }
      setTick((x) => x + 1);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [running, hz]);

  // stop when the circuit stops being runnable
  useEffect(() => {
    if (!an.canRun) setRunning(false);
  }, [an.canRun]);

  const c = mach.current?.cpu ?? null;
  const latches = mach.current?.latch ?? EMPTY;
  const latchVal = (latchId: string) => latches.get(latchId) ?? 0;
  const kitPart = board.parts.find((x) => x.type === 'KIT');
  const kitAdc = kitPart ? mach.current?.adc.get(`${kitPart.id}~u10`)?.value : undefined;
  const kitUart = kitPart ? mach.current?.usart.get(`${kitPart.id}~u11`) : undefined;
  const kitRxOn = kitUart?.mode != null && !!((kitUart?.command ?? 0) & RX_ENABLE);
  const sendToKit = (bytes: number[]) => {
    if (!kitPart) return;
    mach.current?.send(`${kitPart.id}~u11`, bytes);
    setTick((x) => x + 1);
  };

  // ---------- serial terminal (lives in its own tab, /z80/terminal) ----------
  const tabId = useMemo(newTabId, []);
  const [termOpen, setTermOpen] = useState(false);
  const termTabs = useRef(new Map<string, number>()); // terminal tab → when it last said hello
  const termLink = useRef<ReturnType<typeof openLink>>(null);
  const termSig = useRef('');
  const termNow = useRef<() => TermState | null>(() => null);
  termNow.current = () =>
    kitPart ? { run: runNo.current, tx: kitUart?.tx ?? [], txDropped: kitUart?.txDropped ?? 0, rxOn: kitRxOn, pending: kitUart?.queue.length ?? 0, running } : null;
  const sendRef = useRef(sendToKit);
  sendRef.current = sendToKit;
  useEffect(() => {
    const link = openLink((m) => {
      if (m.k === 'hello' && (m.to === null || m.to === tabId)) {
        termTabs.current.delete('opening');
        termTabs.current.set(m.from, Date.now());
        setTermOpen(true);
        link?.post({ k: 'state', from: tabId, s: termNow.current() });
      } else if (m.k === 'send' && m.to === tabId) sendRef.current(m.bytes);
      else if (m.k === 'bye' && termTabs.current.delete(m.from) && !termTabs.current.size) setTermOpen(false);
    });
    termLink.current = link;
    if (!link) return;
    // a terminal tab that stops saying hello was closed without a goodbye (crash, sleep)
    const t = setInterval(() => {
      for (const [id, at] of termTabs.current) if (Date.now() - at > LOST_MS) termTabs.current.delete(id);
      if (!termTabs.current.size) setTermOpen(false);
    }, HELLO_MS);
    const bye = () => link.post({ k: 'bye', from: tabId });
    window.addEventListener('pagehide', bye);
    return () => {
      bye();
      clearInterval(t);
      window.removeEventListener('pagehide', bye);
      link.close();
      termLink.current = null;
    };
  }, [tabId]);
  // push the terminal's state whenever it changes while a terminal tab is listening
  useEffect(() => {
    if (!termOpen || !termLink.current) return;
    const s = termNow.current();
    const sig = s ? `${s.run}:${s.txDropped + s.tx.length}:${s.rxOn}:${s.pending}:${s.running}` : '-';
    if (sig === termSig.current) return;
    termSig.current = sig;
    termLink.current.post({ k: 'state', from: tabId, s });
  });
  /** open the terminal tab, or switch to it if it's already open */
  const openTerminal = () => {
    if (!openTermTab()) return popup.toast('เบราว์เซอร์บล็อกการเปิดแท็บใหม่ — อนุญาต pop-up ของเว็บนี้ก่อน', 'err');
    // stand-in until the new tab loads and says hello (or doesn't, within LOST_MS)
    if (!termTabs.current.size) termTabs.current.set('opening', Date.now());
    setTermOpen(true);
  };
  const closed = useMemo(() => closedSwitches(sim, held, env), [sim, held, env]);
  const probed = probe(sim, an, latches, closed, env, mach.current?.chips());
  const sending = mach.current?.sending() ?? new Set<string>();
  const hasRfid = board.parts.some((p) => p.type === 'RFID');
  /** hold a card to every RFID module on the board */
  const tapCard = (uid: string) => {
    const m = mach.current;
    if (!m) return;
    const heard = board.parts.filter((p) => p.type === 'RFID').flatMap((p) => m.tap(p.id, uid));
    setLastCard(uid);
    setTick((x) => x + 1);
    if (!heard.length) popup.toast('ไม่มี USART 8251A ที่รับจาก RFID — ต่อ TX ของโมดูลเข้า RxD และต่อไฟเลี้ยงให้ครบ', 'err');
    else popup.toast(running ? `แตะการ์ด ${uid} แล้ว` : `แตะการ์ด ${uid} แล้ว · ข้อมูลจะเข้ามาเมื่อกด “เริ่มจำลอง”`, 'ok');
  };
  const lit = litOf(board, probed.lv);
  const currents = ledCurrents(board, probed.nets, probed.lv);
  const sensed = new Set(board.parts.flatMap((p) => SENSES[p.type] ?? []));
  const editPart = (next: Part) => setBoard((b) => ({ ...b, parts: b.parts.map((q) => (q.id === next.id ? next : q)) }));
  /** "ต่ออัตโนมัติ": wire the part to the trainer and say where it went */
  const autoWirePart = (p: Part) => {
    const r = autoWire(board, p.id);
    if ('error' in r) return popup.toast(r.error, 'err');
    setBoard((b) => addWires(b, r.wires));
    popup.toast(r.msg, 'ok');
  };
  const curLine = c && rom ? rom.lineAt.get(c.r.PC) : undefined;
  const stale = romSrc != null && romSrc !== code;

  const start = () => {
    if (!an.canRun) return;
    if (!rom || stale || !mach.current) {
      if (!assembleNow()) {
        // the error list sits under the program tab, which may be hidden behind another part's details
        const e = assembleZ80(code);
        popup.toast(e.ok ? 'Assemble ไม่ผ่าน' : `Assemble ไม่ผ่าน · บรรทัด ${e.errors[0].line}: ${e.errors[0].msg}`, 'err');
        return;
      }
    }
    if (mach.current?.cpu.halted) {
      if (mach.current.cpu.error) {
        popup.toast(`${mach.current.cpu.error} — แก้โค้ดแล้ว Assemble ใหม่ หรือกดรีเซ็ต CPU`, 'err');
        return;
      }
      boot(rom!);
    }
    setRunning(true);
  };
  /** put a saved / imported / fresh project on the board */
  const openProject = (p: { board: Board; code: string }) => {
    if (!isPinBoard(p.board)) return popup.toast('บอร์ดในไฟล์นี้เป็นรูปแบบเก่า เปิดไม่ได้', 'err');
    setRunning(false);
    setBoard(p.board);
    setCode(p.code);
    setSelId(p.board.parts.find((x) => x.type === 'KIT')?.id ?? null);
  };
  /** like pressing a reset button: back to 0000h, RAM and latches keep their values */
  const resetCpu = () => {
    mach.current?.reset();
    setTick((x) => x + 1);
  };

  // ---------- board editing ----------
  const toBoard = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const snap = (v: number) => Math.round(v / 5) * 5;
  const clampPart = (p: Part): Part => {
    const { w, h } = partSize(p);
    return { ...p, x: Math.max(14, Math.min(BOARD_W - 14 - w, p.x)), y: Math.max(62, Math.min(BOARD_H - 62 - h, p.y)) };
  };
  const addPart = (type: PartType, x?: number, y?: number, model?: string) => {
    if (type === 'KIT' && hasKit) return popup.toast('มีบอร์ด Z80 สำเร็จอยู่แล้ว 1 แผ่น', 'err');
    if (type === 'CPU' && hasKit) return popup.toast('บอร์ดสำเร็จมี CPU อยู่แล้ว — ลบบอร์ดสำเร็จก่อนถ้าจะต่อ CPU เอง', 'err');
    setBoard((b) => {
      const { w, h } = PART_INFO[type];
      const p = clampPart({
        id: newId(b, type),
        type,
        x: snap((x ?? 380) - w / 2),
        y: snap((y ?? 250) - h / 2),
        rot: 0,
        ...(model ? { model } : {}),
      });
      setSelId(p.id);
      return { ...b, parts: [...b.parts, p] };
    });
  };
  const removePart = (id: string) => {
    const mine = (r: PinRef) => parseRef(r)?.part === id;
    setBoard((b) => ({ parts: b.parts.filter((p) => p.id !== id), wires: b.wires.filter((w) => !mine(w.a) && !mine(w.b)) }));
    if (selId === id) setSelId(null);
  };
  /** the trainer carries most of the circuit's wiring, so taking it off asks first */
  const askRemove = async (id: string) => {
    const p = board.parts.find((x) => x.id === id);
    if (p?.type === 'KIT' && !(await popup.confirm({ title: 'ลบบอร์ด Z80 สำเร็จ?', body: 'สายทุกเส้นที่ต่อเข้าบอร์ดนี้จะถูกลบไปด้วย', ok: 'ลบ' }))) return;
    removePart(id);
  };

  const T = TOOLS[tool][0];
  const wiring = T === 'wire' || T === 'bus';

  /** wire / bus tools: first click picks the start, second click connects */
  const connect = (target: PinRef) => {
    if (!wireFrom) return setWireFrom(target);
    if (wireFrom === target) return setWireFrom(null);
    const ws = T === 'bus' ? (isRail(wireFrom) ? busWires(board, target, wireFrom) : busWires(board, wireFrom, target)) : [{ a: wireFrom, b: target }];
    setBoard((b) => addWires(b, ws));
    if (ws.length > 1) popup.toast(`ต่อบัส ${ws.length} เส้น`, 'ok');
    setWireFrom(null);
  };
  const deleteWires = (ws: Wire[]) => setBoard((b) => ({ ...b, wires: b.wires.filter((w) => !ws.includes(w)) }));
  const onPinDown = (e: RPointerEvent, p: Part, r: PinRef) => {
    if (T === 'delete') {
      e.stopPropagation();
      setBoard((b) => ({ ...b, wires: b.wires.filter((w) => w.a !== r && w.b !== r) }));
      return;
    }
    // in select mode a pin starts a plain wire, so there's no need to switch tools first
    if (!wiring && T !== 'select') return onPartDown(e, p);
    e.stopPropagation();
    connect(r);
  };

  const onPartDown = (e: RPointerEvent, p: Part) => {
    e.stopPropagation();
    if (T === 'delete') return void askRemove(p.id);
    if (T === 'rotate') {
      // wires stay on their pins, so they follow the part round
      setBoard((b) => ({ ...b, parts: b.parts.map((q) => (q.id === p.id ? clampPart({ ...q, rot: (q.rot + 1) % 4 }) : q)) }));
      return;
    }
    if (wiring) {
      popup.toast('คลิกที่ปลายขาของชิ้นส่วน (หรือรางไฟ) เพื่อต่อสาย');
      return;
    }
    if (p.type === 'BTN' || p.type === 'TCH' || p.type === 'MODI' || p.type === 'MODS') setPressed((s) => new Set(s).add(p.id));
    setSelId(p.id);
    const pt = toBoard(e.clientX, e.clientY);
    drag.current = { id: p.id, dx: pt.x - p.x, dy: pt.y - p.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    if (wireFrom) setMouse(toBoard(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    const pt = toBoard(e.clientX, e.clientY);
    setBoard((b) => ({ ...b, parts: b.parts.map((q) => (q.id === d.id ? clampPart({ ...q, x: snap(pt.x - d.dx), y: snap(pt.y - d.dy) }) : q)) }));
  };
  const onUp = () => {
    drag.current = null;
    if (pressed.size) setPressed(new Set());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
      if (e.key === 'Escape') setWireFrom(null);
      // part shortcuts only while the board (or nothing) has focus, so Backspace on a menu or button never deletes a part
      if (el !== document.body && !svgRef.current?.contains(el)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) {
        e.preventDefault();
        void askRemove(selId);
      }
      if (e.key.toLowerCase() === 'r' && selId && T === 'select') {
        const p = board.parts.find((x) => x.id === selId);
        if (p) setBoard((b) => ({ ...b, parts: b.parts.map((q) => (q.id === p.id ? clampPart({ ...q, rot: (q.rot + 1) % 4 }) : q)) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sel = board.parts.find((p) => p.id === selId) ?? null;
  const asmMarks = useMemo(() => {
    const m = new Map<number, LineMark>();
    for (const e of asmErrors) m.set(e.line, { bg: MT, title: e.msg });
    if (curLine && !running && c?.cycles) m.set(curLine, { bg: MS });
    if (curLine && running) m.set(curLine, { bg: MT });
    return m;
  }, [asmErrors, curLine, running, c?.cycles]);

  const runGrade = async (kind: 'test' | 'submit') => {
    if (!problem) return;
    setGradeBusy(kind);
    setGradeErr(null);
    try {
      const r = await api<NonNullable<typeof grade>>(`/problems/${problem.id}/${kind}`, { body: { code } });
      setGrade(r);
      if (!r.pass) popup.toast('ไม่ถูก', 'err');
      else if (kind === 'test') popup.toast('ถูก · กดส่งคำตอบได้เลย', 'ok');
      else if (r.awarded == null) popup.toast('ถูก (เคยได้คะแนนข้อนี้แล้ว)', 'ok');
      else popup.celebrate({ title: 'ถูก!', points: r.awarded, body: `${problem.title} · คำตอบถูกต้อง` });
    } catch (e) {
      setGradeErr((e as ApiError).message);
      popup.toast((e as ApiError).message, 'err');
    } finally {
      setGradeBusy(null);
    }
  };

  const modelState = (p: Part): ModelState => {
    const id = p.id.toUpperCase();
    switch (p.type) {
      case 'CPU':
        return { marking: 'Z84C00 · Z80 CPU', sub: id };
      case 'ROM':
        return { marking: '2764 EPROM', sub: `${id}${rom ? ` · ${rom.size} B` : ''}` };
      case 'RAM':
        return { marking: 'HM6264 SRAM', sub: id };
      case '138':
        return { marking: '74HC138', sub: id };
      case '574': {
        const l = an.latches.find((x) => x.id === p.id);
        return { marking: '74HC574', sub: l ? `พอร์ต ${hex2(l.port.value)} · Q=${hex2(latchVal(p.id))}` : 'ยังไม่ทำงาน' };
      }
      case '244':
        return { marking: '74HC244', sub: id };
      case 'RN':
        return { marking: `4116R·${resCode(partVal(p))}` };
      case 'Ω':
        return { val: partVal(p) };
      case 'POT':
        return { pos: partPos(p) };
      case 'LED':
      case '7SG':
        return { lit: lit.get(p.id), level: currents.get(p.id)?.map(brightness) };
      case 'REED':
      case 'TILT':
        return { closed: closed.has(p.id) };
      case 'PIR':
        return { active: an.live.has(p.id) && env.motion };
      case 'IR':
        return { pos: partPos(p), active: an.live.has(p.id) && env.distance <= irRange(p) };
      case 'LDM':
        return { pos: partPos(p), active: an.live.has(p.id) && ldmAo(env) <= ldmThreshold(p) };
      case 'RFID':
        return { active: sending.has(p.id) };
      case 'SND':
        return { active: an.live.has(p.id) && env.sound };
      case 'VIB':
        return { active: an.live.has(p.id) && env.vibration };
      case 'FLM':
        return { active: an.live.has(p.id) && env.flame };
      case 'H2O':
        return { active: an.live.has(p.id) && env.water };
      case 'GAS':
        return { active: an.live.has(p.id) && env.gas };
      case 'TCH':
        return { active: an.live.has(p.id) && pressed.has(p.id) };
      case 'MODI':
        return { look: partModule(p)?.look, active: an.live.has(p.id) && held.has(p.id) };
      case 'MODS':
        return { look: partModule(p)?.look, active: held.has(p.id) };
      case 'MODA':
        return { look: partModule(p)?.look, active: an.live.has(p.id) };
      case 'MODO':
        return { look: partModule(p)?.look, active: an.live.has(p.id) && probed.lv.at(ref(p.id, 3)) === (partModule(p)?.active ?? 1) };
      case 'MOD2':
      case 'MOD3':
      case 'MOD4': {
        const m = partModule(p);
        return { look: m?.look, active: an.live.has(p.id) && !!m && !!modOutState(m, modLevels(p, probed.lv))?.on };
      }
      case 'UART': {
        const u = an.usarts.find((x) => x.id === p.id);
        return { marking: '8251A USART', sub: u?.rd ? `พอร์ต ${hex2(u.rd.value)} / ${hex2(u.rd.value | (1 << u.cd))}` : id };
      }
      case 'ADC': {
        const a = an.adcs.find((x) => x.id === p.id);
        const st = mach.current?.adc.get(p.id);
        return { marking: 'ADC0804', sub: a ? `พอร์ต ${hex2(firstPort(a.rd ?? a.wr))}${st ? ` · ${st.value}` : ''}` : id };
      }
      case 'BTN':
        return { pressed: pressed.has(p.id) };
      case 'CLK':
        return { marking: fmtHz(hz) };
      case 'KIT':
        return {
          lit: [
            ...[0, 1].flatMap((g) => Array.from({ length: 8 }, (_, i) => ((latchVal(`${p.id}~${g ? 'u7' : 'u6'}`) >> i) & 1) === 1)),
            ...Array.from({ length: 8 }, (_, i) => probed.lv.at(ref(p.id, 17 + i)) === 1),
          ],
        };
      default:
        return {};
    }
  };

  const liveNets = probed.nets;
  const hoverNet = hoverPin ? liveNets.of(hoverPin) : null;

  // hidden layers still show the wires of the net under the pointer
  const inHover = (w: Wire) => hoverNet != null && liveNets.of(w.a) === hoverNet;
  const shownWires = routed.rest.filter((w) => view.layers[layerOf(wireKind(board, w))] || inHover(w));
  const hiddenPower = view.layers.power ? [] : routed.rest.filter((w) => layerOf(wireKind(board, w)) === 'power' && !inHover(w));
  const shownTrunks = routed.trunks.filter((t) => view.layers[t.bus] || t.wires.some(inHover));
  const toggleLayer = (k: Layer) => setView((v) => ({ ...v, layers: { ...v.layers, [k]: !v.layers[k] } }));
  const hoverText = (() => {
    if (!hoverPin) return null;
    const lv = probed.lv.at(hoverPin);
    const v = probed.lv.volts(hoverPin);
    const pr = parseRef(hoverPin);
    const part = pr && board.parts.find((x) => x.id === pr.part);
    const d = part ? pinDef(part.type, pr!.n) : null;
    const others = liveNets.members.get(liveNets.of(hoverPin))!.filter((r) => r !== hoverPin && !isKitInner(r));
    const driven = [hoverPin, ...others].some((r) => {
      const e = pinEnd(board, r);
      return e && (e.def.kind === 'out' || e.def.kind === 'io');
    });
    return {
      name: label(board)(hoverPin),
      desc: d?.desc ?? (isRail(hoverPin) ? 'ต่อกับขั้วไฟของแหล่งจ่ายผ่านสาย' : ''),
      level: `${lv === 1 ? 'HIGH' : lv === 0 ? 'LOW' : lv === 'X' ? 'ลัดวงจร!' : driven ? 'สัญญาณ' : 'ลอย'}${v != null && lv !== 'X' ? ` · ${v.toFixed(2)} V` : ''}`,
      others: others.map(label(board)),
    };
  })();

  return (
    <>
      <PageHeader title="บอร์ด Z80" sub={problem ? `โจทย์ ${problem.id}. ${problem.title}` : 'ต่อวงจรแล้วรันโปรแกรมจริง'} back={problem ? { label: 'กลับไปที่โจทย์', to: `/problems/${problem.id}` } : undefined}>
        <Segmented
          role="toolbar"
          label="เครื่องมือ"
          value={tool}
          onChange={(t) => {
            setTool(t);
            setWireFrom(null);
          }}
          btnStyle={{ width: 38, padding: 0 }}
          options={TOOLS.map(([, label, d], i) => ({ value: i, aria: label, label: <Icon d={d} size={18} /> }))}
        />
        <select
          aria-label="ความถี่ clock"
          value={hz}
          onChange={(e) => setHz(Number(e.target.value))}
          style={{ height: 44, padding: '0 12px', border: 0, borderRadius: 999, background: '#fff', boxShadow: 'inset 0 0 0 1.5px var(--ring)', fontSize: 14 }}
        >
          {CLOCKS.map((h) => (
            <option key={h} value={h}>
              Clock {fmtHz(h)}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary btn-round"
          aria-label="รีเซ็ต CPU"
          title="รีเซ็ต CPU"
          onClick={() => {
            resetCpu();
            popup.toast('รีเซ็ต CPU แล้ว');
          }}
        >
          <Icon d={ICON.reset} size={18} />
        </button>
        <button className="btn btn-primary" disabled={!an.canRun && !running} onClick={() => (running ? setRunning(false) : start())} data-tour="z80-run">
          <Icon d={running ? FILL.stop : FILL.play} filled size={14} />
          {running ? 'หยุดจำลอง' : 'เริ่มจำลอง'}
        </button>
      </PageHeader>

      <main className="main" style={{ maxWidth: 1600 }}>
        {/* the board shrinks to fit, which makes pins too small to wire with a finger */}
        <div role="note" className="notice info only-narrow" style={{ alignItems: 'center' }}>
          <Icon d={ICON.info} size={18} />
          <span>บอร์ดนี้ต้องต่อสายที่ขาชิปเล็กๆ — ใช้บนคอมพิวเตอร์หรือแท็บเล็ตแนวนอนจะสะดวกกว่า บนมือถือยังดูวงจรและรันโปรแกรมได้ตามปกติ</span>
        </div>
        {!problem && (
          <ProjectBar name={projName} onName={setProjName} board={board} code={code} onOpen={openProject} fresh={{ board: DEFAULT_BOARD, code: DEFAULT_CODE }} />
        )}
        {problem && (
          <section className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 200 }}>
              {wantAnswer ? 'กำลังรันโค้ดเฉลย' : 'โค้ดในบอร์ดนี้คือคำตอบของคุณ — บันทึกอัตโนมัติ'}
            </span>
            {!wantAnswer && (
              <>
                <button className="btn btn-secondary" disabled={!!gradeBusy} aria-busy={gradeBusy === 'test'} onClick={() => runGrade('test')}>
                  ทดสอบ
                </button>
                <button className="btn btn-primary" disabled={!!gradeBusy} aria-busy={gradeBusy === 'submit'} onClick={() => runGrade('submit')}>
                  ส่งคำตอบ
                </button>
              </>
            )}
            {gradeErr && <div className="notice err" style={{ flexBasis: '100%' }}>{gradeErr}</div>}
            {grade && (
              <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700, color: grade.pass ? 'var(--ok-deep)' : 'var(--err-deep)' }}>
                <span className="pop-in" style={{ display: 'inline-flex' }}>
                  {grade.pass ? <CheckCircle size={22} /> : <XCircle size={22} />}
                </span>
                {grade.pass ? 'ถูก' : 'ไม่ถูก'}
                {grade.kind === 'submit' && grade.pass && grade.awarded != null && <span style={{ fontFamily: 'var(--mono)', color: 'var(--m)' }}>+{grade.awarded} pts</span>}
              </div>
            )}
          </section>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
          {/* Parts */}
          <aside aria-label="อุปกรณ์" className="card" style={{ flex: '1 1 200px', maxWidth: 250, alignSelf: 'flex-start', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500, fontSize: 17, padding: '0 6px 8px' }}>อุปกรณ์</span>
            <label className="search-pill parts-search">
              <Icon d={ICON.search} size={16} color="var(--muted)" />
              <input type="search" aria-label="ค้นหาอุปกรณ์" placeholder="ค้นหาอุปกรณ์" value={partQ} onChange={(e) => setPartQ(e.target.value)} />
            </label>
            {/* a fixed-height list that scrolls, so the panel doesn't grow with the catalogue */}
            <div className="parts-list">
              {parts.map(([h, items]) => (
                <div key={h} style={{ display: 'contents' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', padding: '12px 6px 4px' }}>{h}</span>
                  {items.map((ab) => (
                    <button
                      key={ab}
                      className="part-btn"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/x-part', ab)}
                      onClick={() => addPart(itemType(ab), undefined, undefined, itemModel(ab))}
                      title={itemDesc(ab)}
                    >
                      <PartThumb type={itemType(ab)} w={PART_INFO[itemType(ab)].w} h={PART_INFO[itemType(ab)].h} look={moduleById(itemModel(ab))?.look} />
                      {itemName(ab)}
                    </button>
                  ))}
                </div>
              ))}
              {parts.length === 0 && <span style={{ padding: '14px 6px', fontSize: 13, color: 'var(--muted)' }}>ไม่พบอุปกรณ์ “{partQ.trim()}”</span>}
            </div>
            <button
              className="btn btn-soft"
              style={{ marginTop: 14 }}
              onClick={async () => {
                const ok = await popup.confirm({ title: 'คืนบอร์ดเป็นวงจรตั้งต้น?', body: 'ชิ้นส่วนและสายที่ต่อไว้จะถูกแทนด้วยวงจรตั้งต้น', ok: 'คืนค่า' });
                if (!ok) return;
                setBoard(DEFAULT_BOARD);
                setSelId('kit1');
                popup.toast('คืนบอร์ดเป็นวงจรตั้งต้นแล้ว');
              }}
            >
              วงจรตั้งต้น
            </button>
            <button
              className="btn btn-soft"
              style={{ marginTop: 8 }}
              title="ต่อขั้วไฟเข้ารางไฟ แล้วต่อขา VCC / GND ของทุกชิปเข้ารางที่ใกล้ที่สุด"
              onClick={() => {
                const before = board.wires.length;
                const next = addWires(board, powerWires(board));
                setBoard(next);
                popup.toast(next.wires.length > before ? `ต่อไฟเลี้ยงเพิ่ม ${next.wires.length - before} เส้น` : 'ไฟเลี้ยงต่อครบแล้ว', 'ok');
              }}
            >
              ต่อไฟเลี้ยงทุกชิป
            </button>
          </aside>

          {/* Canvas */}
          <section aria-label="พื้นที่ต่อวงจร" className="card" style={{ flex: '3 1 520px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '14px 20px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>แสดงสาย</span>
              <div role="group" aria-label="ชั้นของสาย" className="seg in-card">
                {LAYERS.map(([k, name, col]) => (
                  <button key={k} type="button" aria-pressed={view.layers[k]} onClick={() => toggleLayer(k)} style={{ height: 30, padding: '0 12px', fontSize: 13, gap: 6 }}>
                    <span aria-hidden="true" style={{ width: 12, height: 4, borderRadius: 2, background: col, opacity: view.layers[k] ? 1 : 0.35 }} />
                    {name}
                  </button>
                ))}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--body-alt)', cursor: 'pointer' }} title="วาดบัส address / data เป็นรางร่วม แทนสายจากชิปถึงชิป">
                <input type="checkbox" checked={view.rails} onChange={(e) => setView((v) => ({ ...v, rails: e.target.checked }))} />
                บัสแบบราง
              </label>
              {!view.layers.power && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>+ / − ที่ขา = ต่อไฟเลี้ยง / กราวด์แล้ว</span>}
            </div>
            <div style={{ padding: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
                width="100%"
                role="application"
                aria-label="breadboard"
                style={{ display: 'block', maxWidth: 1100, fontFamily: "'JetBrains Mono', monospace", touchAction: 'none', cursor: wiring || wireFrom ? 'crosshair' : 'default' }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerDown={() => {
                  setSelId(null);
                  setWireFrom(null);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const k = e.dataTransfer.getData('text/x-part');
                  const t = itemType(k);
                  if (!k || !PART_INFO[t]) return;
                  const pt = toBoard(e.clientX, e.clientY);
                  addPart(t, pt.x, pt.y, itemModel(k));
                }}
              >
                <defs>
                  <PartDefs />
                  <pattern id="dots3" width="15" height="15" patternUnits="userSpaceOnUse">
                    <circle cx="7.5" cy="7.5" r="1.5" fill="#e6dcd7" />
                  </pattern>
                </defs>
                <rect x={10} y={10} width={BOARD_W - 20} height={BOARD_H - 20} rx={20} fill="#fbf9f7" stroke="#efe8e4" strokeWidth={2} />
                <rect x={40} y={62} width={BOARD_W - 80} height={BOARD_H - 124} fill="url(#dots3)" />
                <rect x={40} y={BOARD_H / 2 - 6} width={BOARD_W - 80} height={12} rx={6} fill="#f4efec" />
                {Object.entries(RAILS).map(([r, rail]) => {
                  const col = rail.kind === 'vcc' ? WIRE_COLOR.vcc : WIRE_COLOR.gnd;
                  const lit = hoverNet != null && liveNets.of(r) === hoverNet;
                  return (
                    <g key={r}>
                      <path d={`M40 ${rail.y}H${BOARD_W - 40}`} stroke={col} strokeWidth={lit ? 3.5 : 2} strokeLinecap="round" />
                      {[26, BOARD_W - 26].map((x) => (
                        <text key={x} x={x} y={rail.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={col}>
                          {rail.kind === 'vcc' ? '+' : '−'}
                        </text>
                      ))}
                      <path
                        d={`M40 ${rail.y}H${BOARD_W - 40}`}
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ cursor: wiring ? 'crosshair' : 'default' }}
                        onPointerDown={(e) => {
                          if (!wiring) return;
                          e.stopPropagation();
                          connect(r);
                        }}
                        onPointerEnter={() => setHoverPin(r)}
                        onPointerLeave={() => setHoverPin(null)}
                      >
                        <title>{rail.label}</title>
                      </path>
                    </g>
                  );
                })}

                <BusLayer trunks={shownTrunks} nets={liveNets} hoverNet={hoverNet} onDelete={T === 'delete' ? deleteWires : undefined} />
                <WireLayer board={board} wires={shownWires} nets={liveNets} hoverNet={hoverNet} onDelete={T === 'delete' ? deleteWires : undefined} />

                {board.parts.map((p) => {
                  const { w, h } = partSize(p);
                  const info = PART_INFO[p.type];
                  return (
                    <g key={p.id} transform={`translate(${p.x} ${p.y})`} onPointerDown={(e) => onPartDown(e, p)} style={{ cursor: T === 'select' ? 'grab' : 'pointer' }}>
                      <title>{`${partName(p)} (${p.id.toUpperCase()})${p.type === 'BTN' ? ' · กดค้างเพื่อกดปุ่ม' : p.type === 'TCH' ? ' · กดค้างเพื่อแตะ' : p.type === 'MODI' || p.type === 'MODS' ? ' · กดค้างเพื่อจำลอง' : ''}`}</title>
                      {p.id === selId && <rect x={-8} y={-8} width={w + 16} height={h + 16} rx={12} fill="none" stroke="#8a1c1c" strokeWidth={2} strokeDasharray="6 5" />}
                      <g transform={p.rot % 2 ? `translate(${info.h} 0) rotate(90)` : undefined}>
                        <PartModel type={p.type} w={info.w} h={info.h} {...modelState(p)} />
                      </g>
                    </g>
                  );
                })}

                <PowerGlyphs board={board} wires={hiddenPower} />
                <PinLayer board={board} nets={liveNets} hoverNet={hoverNet} wireFrom={wireFrom} showAll={wiring || !!wireFrom} onPinDown={onPinDown} onHover={setHoverPin} />

                {wireFrom && mouse && (
                  <path
                    d={`M${endAt(board, wireFrom, mouse).x} ${endAt(board, wireFrom, mouse).y}L${mouse.x} ${mouse.y}`}
                    stroke="#8a1c1c"
                    strokeWidth={1.6}
                    strokeDasharray="5 4"
                    fill="none"
                    pointerEvents="none"
                  />
                )}
                {wireFrom && (
                  <text x={BOARD_W / 2} y={22} textAnchor="middle" fontSize={12} fill="#6e1414">
                    {T === 'bus' ? 'คลิกขาหนึ่งของบัสปลายทาง (ต่อทุกบิตให้) หรือรางไฟ' : 'คลิกขาปลายทาง หรือรางไฟ'} · Esc ยกเลิก
                  </text>
                )}
              </svg>
            </div>
            {(sensed.size > 0 || hasRfid) && !(sel && (SENSES[sel.type] || sel.type === 'RFID')) && (
              <div className="env-hint">คลิกที่เซนเซอร์บนบอร์ด เพื่อจำลองสภาพแวดล้อม (แสง อุณหภูมิ การเคลื่อนไหว แม่เหล็ก …)</div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', padding: '14px 20px', background: 'var(--canvas)', fontSize: 14 }}>
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 999, fontWeight: 600, background: running ? MT : 'var(--soft)', color: running ? M : 'var(--muted)' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: running ? 'var(--m)' : 'var(--line-no)' }} />
                {running ? `กำลังรัน · ${fmtHz(hz)}` : c?.error ? 'หยุด — มีข้อผิดพลาด' : c?.halted ? 'หยุดที่ HALT' : 'หยุดอยู่'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--body-alt)' }}>PC {hex4(c?.r.PC ?? 0)}</span>
              {an.latches.map((l) => (
                <span key={l.id} style={{ fontFamily: 'var(--mono)', color: 'var(--body-alt)' }}>
                  {isKitInner(l.id) ? `OUT ${hex2(l.port.value)}` : `${l.id.toUpperCase()} (พอร์ต ${hex2(l.port.value)})`} = {hex2(latchVal(l.id))}
                </span>
              ))}
              {an.adcs.map((a) => (
                <span key={a.id} style={{ fontFamily: 'var(--mono)', color: 'var(--body-alt)' }}>
                  {a.id.toUpperCase()} (ADC) = {mach.current?.adc.get(a.id)?.value ?? 0}
                </span>
              ))}
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{(c?.cycles ?? 0).toLocaleString()} T</span>
              <button className="btn btn-secondary" style={{ marginLeft: 'auto', height: 38, padding: '0 16px', fontSize: 13 }} onClick={() => setShowLA((s) => !s)} aria-pressed={showLA}>
                {showLA ? 'ซ่อน' : 'ดู'}สัญญาณ (Logic analyzer)
              </button>
            </div>
            {hoverText && (
              <div style={{ padding: '10px 20px', fontSize: 13, lineHeight: 1.6, background: 'var(--canvas)', borderTop: '1px solid var(--track)' }}>
                <b style={{ fontFamily: 'var(--mono)' }}>{hoverText.name}</b>
                <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontWeight: 700, color: hoverText.level.startsWith('ลอย') ? 'var(--muted)' : 'var(--m)' }}>{hoverText.level}</span>
                {hoverText.desc && <span style={{ color: 'var(--body-alt)' }}> · {hoverText.desc}</span>}
                <div style={{ color: 'var(--muted)' }}>{hoverText.others.length ? `ต่อกับ: ${hoverText.others.slice(0, 8).join(', ')}${hoverText.others.length > 8 ? ` และอีก ${hoverText.others.length - 8}` : ''}` : 'ยังไม่ได้ต่อกับอะไร'}</div>
              </div>
            )}
            {c?.error && <div className="notice err" style={{ margin: '0 20px 14px' }}>{c.error}</div>}
            {!an.canRun && (
              <div className="notice warn" style={{ margin: '0 20px 14px' }}>
                วงจรยังรันไม่ได้: {an.checks.filter((x) => !x.ok).slice(0, 4).map((x) => x.label).join(' · ')}
              </div>
            )}
            {showLA && <LogicAnalyzer trace={trace.current} now={c?.cycles ?? 0} hz={hz} port={an.latches[0]?.port ?? null} />}
          </section>

          {/* Chip detail */}
          <aside aria-label="รายละเอียดชิปที่เลือก" className="card" style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <PartDetail
              part={sel}
              board={sim}
              an={an}
              latchVal={latchVal}
              lit={lit}
              currents={currents}
              lv={probed.lv}
              adc={sel ? mach.current?.adc.get(sel.id) : undefined}
              usart={sel ? mach.current?.usart.get(sel.id) : undefined}
              hz={hz}
              lastCard={lastCard}
              rom={rom}
              onHoverPin={setHoverPin}
              onEdit={editPart}
              onAuto={hasKit ? autoWirePart : undefined}
              env={env}
              onEnv={setEnv}
              onCard={tapCard}
              triggered={triggered}
              onTrigger={toggleTrigger}
              kitAdc={kitAdc}
            />
            {(!sel || sel.type === 'CPU' || sel.type === 'KIT') && (
              <>
                <div style={{ padding: '0 16px 8px' }}>
                  <Segmented
                    role="tablist"
                    label="มุมมองชิป"
                    inCard
                    value={chipTab}
                    onChange={setChipTab}
                    btnStyle={{ height: 32, padding: '0 14px', fontSize: 13 }}
                    options={[
                      { value: 0, label: 'โปรแกรม' },
                      { value: 1, label: 'Registers' },
                      ...(hasKit ? [] : [{ value: 3, label: 'ขา CPU' }]),
                    ]}
                  />
                </div>
                {chipTab === 0 && (
                  <div style={{ padding: '6px 12px', flex: 1 }}>
                    <CodeToolbar onExpand={() => setBigCode(true)} romSize={rom?.size ?? null} />
                    <CodeEditor value={code} onChange={setCode} lang="z80" marks={asmMarks} label="โปรแกรม Z80" minLines={12} goto={bigCode ? undefined : jump} style={{ maxHeight: 420, fontSize: 13 }} />
                    {asmErrors.length > 0 && (
                      <div className="notice err" style={{ marginTop: 8, flexDirection: 'column', gap: 2 }}>
                        {asmErrors.slice(0, 5).map((e, i) => (
                          <span key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                            บรรทัด {e.line}: {e.msg}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {chipTab === 1 && c && (
                  <div style={{ padding: '6px 20px', flex: 1, fontFamily: 'var(--mono)', fontSize: 14, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 18px', alignContent: 'start' }}>
                    {(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L'] as const).map((k) => (
                      <span key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b>{k}</b>
                        {hex2(c.r[k])}
                      </span>
                    ))}
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <b>SP</b>
                      {hex4(c.r.SP)}
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <b>PC</b>
                      {hex4(c.r.PC)}
                    </span>
                    <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted)', fontFamily: "'Anuphan', sans-serif" }}>
                      Flags: {[['S', 128], ['Z', 64], ['H', 16], ['P/V', 4], ['N', 2], ['C', 1]].map(([n, b]) => `${n}=${c.r.F & (b as number) ? 1 : 0}`).join('  ')}
                    </span>
                  </div>
                )}
                {chipTab === 3 && !hasKit && an.cpu && <PinTable part={an.cpu} board={sim} an={an} onHover={setHoverPin} />}
                <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ height: 46 }}
                    data-tour="assemble"
                    onClick={() => {
                      const prog = assembleNow();
                      popup.toast(prog ? `Assemble ลง ROM แล้ว · ${prog.size} ไบต์` : 'Assemble ไม่ผ่าน — ดูบรรทัดที่ไฮไลต์', prog ? 'ok' : 'err');
                    }}
                  >
                    Assemble ลง ROM
                  </button>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, color: asmErrors.length ? 'var(--m)' : stale ? 'var(--m-mid)' : 'var(--muted)' }}>
                    {asmErrors.length ? (
                      `ล่าสุด: ผิด ${asmErrors.length} จุด`
                    ) : stale ? (
                      'โค้ดเปลี่ยนแล้ว — กด Assemble อีกครั้ง'
                    ) : rom ? (
                      <>
                        <Icon d={ICON.check} size={14} stroke={2.6} />
                        ล่าสุด: Assemble สำเร็จ
                      </>
                    ) : null}
                  </span>
                </div>
              </>
            )}
          </aside>
        </div>
        {kitPart && (
          <section className="card term-launch" aria-label="Serial terminal">
            <Icon d={ICON.external} size={20} color="var(--m)" />
            <div>
              <b>Serial terminal{termOpen ? ' · เปิดอยู่ในแท็บอื่น' : ''}</b>
              <span>
                {typeof BroadcastChannel === 'undefined'
                  ? 'เบราว์เซอร์นี้เปิด terminal ไม่ได้ — ลองใช้ Chrome, Edge หรือ Firefox รุ่นใหม่'
                  : termOpen
                    ? 'พิมพ์และดูผลได้ที่แท็บนั้น — โปรแกรมรันอยู่ในหน้านี้ ต้องเปิดหน้านี้ค้างไว้'
                    : `8251A พอร์ต 06h/07h · เปิดในแท็บใหม่เพื่อดูข้อมูลที่ Z80 ส่งออกและพิมพ์ส่งเข้าไป${kitRxOn ? ' · ตัวรับของ Z80 เปิดอยู่' : ''}`}
              </span>
            </div>
            {typeof BroadcastChannel !== 'undefined' && (
              <button type="button" className={`btn ${termOpen ? 'btn-secondary' : 'btn-primary'}`} onClick={openTerminal}>
                {termOpen ? 'ไปที่แท็บ terminal' : 'เปิด terminal'}
              </button>
            )}
          </section>
        )}
      </main>
      {bigCode &&
        createPortal(
          <div className="code-big" role="dialog" aria-label="โปรแกรม Z80 เต็มจอ">
            <div className="code-big-bar">
              <b>โปรแกรม Z80{projName.trim() ? ` · ${projName.trim()}` : ''}</b>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const prog = assembleNow();
                  popup.toast(prog ? `Assemble ลง ROM แล้ว · ${prog.size} ไบต์` : 'Assemble ไม่ผ่าน — ดูบรรทัดที่ไฮไลต์', prog ? 'ok' : 'err');
                }}
              >
                Assemble
              </button>
              <button type="button" className="btn btn-primary" disabled={!an.canRun && !running} onClick={() => (running ? setRunning(false) : start())}>
                <Icon d={running ? FILL.stop : FILL.play} filled size={14} />
                {running ? 'หยุด' : 'รัน'}
              </button>
              <button type="button" className="btn btn-soft" onClick={() => setBigCode(false)} title="ย่อกลับ (Esc)">
                <Icon d={ICON.x} size={16} />
                ย่อ
              </button>
            </div>
            <div className="code-big-body">
              <LabelList code={code} onJump={jumpTo} />
              <div className="code-big-editor">
                <CodeEditor value={code} onChange={setCode} lang="z80" marks={asmMarks} label="โปรแกรม Z80" minLines={30} goto={jump} style={{ flex: 1, fontSize: 14 }} />
                {asmErrors.length > 0 && (
                  <div className="notice err" style={{ flexDirection: 'column', gap: 2 }}>
                    {asmErrors.slice(0, 5).map((e, i) => (
                      <button key={i} type="button" className="err-jump" onClick={() => jumpTo(e.line)}>
                        บรรทัด {e.line}: {e.msg}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <aside className="code-big-side" aria-label="บอร์ดย่อ">
                <b>พอร์ตตอนนี้</b>
                {board.parts.some((p) => p.type === 'KIT') ? (
                  <KitPorts kitId={board.parts.find((p) => p.type === 'KIT')!.id} latchVal={latchVal} lv={probed.lv} adc={kitAdc} />
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>ไม่มีบอร์ด Z80 สำเร็จบนบอร์ด</span>
                )}
                <span className="code-big-status">
                  {running ? `กำลังรัน · ${fmtHz(hz)}` : c?.error ? 'หยุด — มีข้อผิดพลาด' : c?.halted ? 'หยุดที่ HALT' : 'หยุดอยู่'} · PC {hex4(c?.r.PC ?? 0)}
                </span>
                {!an.canRun && <span className="notice warn">วงจรยังรันไม่ได้ — ปิดหน้านี้แล้วต่อบอร์ดให้ครบ</span>}
                {rom && <RomUsage size={rom.size} />}
                {stale && <span style={{ fontSize: 13, color: 'var(--m-mid)' }}>โค้ดเปลี่ยนแล้ว — กด Assemble หรือรันใหม่</span>}
              </aside>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function PartDetail({
  part,
  board,
  an,
  latchVal,
  lit,
  currents,
  lv,
  adc,
  usart,
  hz,
  lastCard,
  rom,
  onHoverPin,
  onEdit,
  onAuto,
  env,
  onEnv,
  onCard,
  triggered,
  onTrigger,
  kitAdc,
}: {
  part: Part | null;
  board: Board;
  an: Analysis;
  latchVal: (id: string) => number;
  lit: Map<string, boolean[]>;
  currents: Map<string, number[]>;
  lv: Levels;
  adc?: AdcState;
  usart?: UsartState;
  hz: number;
  lastCard: string | null;
  rom: Z80Program | null;
  onHoverPin: (r: PinRef | null) => void;
  onEdit: (p: Part) => void;
  /** wire this part to the trainer; absent when there is no trainer */
  onAuto?: (p: Part) => void;
  env: Env;
  onEnv: (e: Env) => void;
  onCard: (uid: string) => void;
  /** catalogue modules switched on from this panel */
  triggered: ReadonlySet<string>;
  onTrigger: (id: string) => void;
  /** the trainer's ADC reading, 0–255 */
  kitAdc?: number;
}) {
  const p = part ?? board.parts.find((x) => x.type === 'KIT') ?? an.cpu;
  if (!p)
    return <div style={{ padding: 20, color: 'var(--muted)' }}>ยังไม่มี CPU บนบอร์ด — ลาก Z80 CPU จากรายการอุปกรณ์มาวาง</div>;
  const info = PART_INFO[p.type];
  const mine = (r: PinRef) => parseRef(r)?.part === p.id;
  const wires = board.wires.filter((w) => (mine(w.a) || mine(w.b)) && !isKitInner(w.a) && !isKitInner(w.b)).length;
  const latch = an.latches.find((l) => l.id === p.id);
  const on = lit.get(p.id);
  const mod = partModule(p);
  const sensor = !!SENSES[p.type] || p.type === 'RFID' || isMod(p.type);
  const status = sensor && (wires > 0 || !POWERED.includes(p.type)) ? senseStatus(p, lv, triggered.has(p.id)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 52, height: 44, flex: 'none', borderRadius: 14, background: 'var(--soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PartThumb type={p.type} w={info.w} h={info.h} look={mod?.look} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 500 }}>
            {partName(p)}
            {(p.type === 'Ω' || p.type === 'RN' || p.type === 'POT') && ` ${fmtOhm(partVal(p))}`}
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            {p.id.toUpperCase()} · {PINOUT[p.type].length} ขา · ต่อสาย {wires} เส้น
          </span>
        </div>
      </div>
      {p.type !== 'CPU' && (
        <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
          <span style={{ color: 'var(--body-alt)' }}>{p.type === 'KIT' ? 'CPU, ROM, RAM และ clock ต่อไว้แล้ว · ต่ออุปกรณ์เข้าพอร์ตด้านล่างของบอร์ดได้เลย' : partDesc(p)}</span>
          {p.type === '574' && (
            <span style={{ fontFamily: 'var(--mono)' }}>
              {latch ? `พอร์ต ${hex2(latch.port.value)} · Q = ${latchVal(p.id).toString(2).padStart(8, '0')}b (${hex2(latchVal(p.id))})` : 'ยังไม่ทำงาน — ต่อสายให้ครบ'}
            </span>
          )}
          {p.type === 'KIT' && (
            <KitPorts kitId={p.id} latchVal={latchVal} lv={lv} adc={kitAdc} />
          )}
          {(p.type === 'LED' || p.type === '7SG') && on && <LedReadout on={on} mA={currents.get(p.id) ?? []} />}
          {sensor ? (
            <>
              {/* 1. hook it up */}
              {wires === 0 ? (
                <div className="sense-step">
                  <span>ยังไม่ได้ต่อสาย</span>
                  {onAuto && AUTO_WIRABLE.has(p.type) && (
                    <button type="button" className="btn btn-primary" style={{ height: 34, gap: 6, padding: '0 14px', fontSize: 13 }} onClick={() => onAuto(p)}>
                      <Icon d={ICON.wire} size={14} />
                      ต่ออัตโนมัติ
                    </button>
                  )}
                </div>
              ) : (
                POWERED.includes(p.type) &&
                !an.live.has(p.id) && (
                  <div className="sense-step">
                    <span>ยังไม่มีไฟเลี้ยง — ต่อ VCC กับราง + และ GND กับราง −</span>
                  </div>
                )
              )}
              {/* 2. change the room, 3. see what it gives */}
              <div className="sense-box">
                <span className="sense-note">{mod ? modNote(mod) : SENSE_NOTE[p.type]}</span>
                {mod ? (
                  <ModControls part={p} m={mod} on={triggered.has(p.id)} onTrigger={() => onTrigger(p.id)} onEdit={onEdit} />
                ) : (
                  <EnvPanel env={env} onChange={onEnv} show={new Set(SENSES[p.type] ?? [])} onCard={p.type === 'RFID' ? onCard : undefined} />
                )}
                {status && (
                  <span className={`sense-now${status.on ? ' on' : ''}`}>
                    <i />
                    {status.text}
                  </span>
                )}
              </div>
              <PartControls part={p} an={an} lv={lv} adc={adc} usart={usart} hz={hz} lastCard={lastCard} onEdit={onEdit} />
            </>
          ) : (
            <>
              {onAuto && AUTO_WIRABLE.has(p.type) && (
                <button type="button" className="btn btn-soft" style={{ alignSelf: 'flex-start', height: 36, gap: 6 }} onClick={() => onAuto(p)} title="ต่อเข้าพอร์ตที่ว่างของบอร์ดสำเร็จ แล้วบอกว่าต่อที่ไหน">
                  <Icon d={ICON.wire} size={15} />
                  ต่ออัตโนมัติ
                </button>
              )}
              <PartControls part={p} an={an} lv={lv} adc={adc} usart={usart} hz={hz} lastCard={lastCard} onEdit={onEdit} />
            </>
          )}
          {p.type === 'BTN' && <span>ใช้เครื่องมือ “เลือก” แล้วกดค้างที่ปุ่มบนบอร์ด</span>}
          {p.type === 'ROM' && rom && (
            <pre style={{ margin: 0, padding: 12, borderRadius: 12, background: 'var(--page)', fontFamily: 'var(--mono)', fontSize: 12, overflowX: 'auto' }}>
              {hexDump(rom)}
            </pre>
          )}
        </div>
      )}
      {p.type !== 'CPU' &&
        (sensor || p.type === 'KIT' ? (
          <details className="pin-fold">
            <summary>ขาของชิ้นส่วน ({PINOUT[p.type].length} ขา)</summary>
            <PinTable part={p} board={board} an={an} onHover={onHoverPin} />
          </details>
        ) : (
          <PinTable part={p} board={board} an={an} onHover={onHoverPin} />
        ))}
    </div>
  );
}

/** The trainer's three ports as rows of lights, bit 7 on the left. */
function KitPorts({ kitId, latchVal, lv, adc }: { kitId: string; latchVal: (id: string) => number; lv: Levels; adc?: number }) {
  const rows: [string, number][] = [
    ['OUT 01h', latchVal(`${kitId}~u6`)],
    ['OUT 02h', latchVal(`${kitId}~u7`)],
    ['IN 03h', Array.from({ length: 8 }, (_, i) => (lv.at(ref(kitId, 17 + i)) === 0 ? 0 : 1 << i)).reduce((a, b) => a | b, 0)],
    ['ADC 04h', adc ?? 0],
  ];
  return (
    <div className="kit-ports">
      {rows.map(([name, v]) => (
        <div key={name}>
          <span>{name}</span>
          <span className="kit-bits" aria-label={`${name} = ${v.toString(2).padStart(8, '0')}b`}>
            {Array.from({ length: 8 }, (_, k) => (
              <i key={k} className={(v >> (7 - k)) & 1 ? 'on' : undefined} />
            ))}
          </span>
          <b>{hex2(v)}</b>
        </div>
      ))}
    </div>
  );
}

/** Datasheet-style pin list: number, name, and everything that pin is wired to. */
function PinTable({ part, board, an, onHover }: { part: Part; board: Board; an: Analysis; onHover: (r: PinRef | null) => void }) {
  const lv = useMemo(() => netLevels(board, an.nets), [board, an]);
  const name = label(board);
  return (
    <div style={{ margin: '0 12px 16px', maxHeight: 340, overflowY: 'auto', borderRadius: 14, background: 'var(--page)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--soft)', textAlign: 'left' }}>
            <th style={{ padding: '6px 10px', width: 36 }}>ขา</th>
            <th style={{ padding: '6px 4px', width: 64 }}>ชื่อ</th>
            <th style={{ padding: '6px 10px' }}>ต่อกับ</th>
          </tr>
        </thead>
        <tbody>
          {PINOUT[part.type].map((d) => {
            const r = ref(part.id, d.n);
            const others = an.nets.members.get(an.nets.of(r))!.filter((x) => x !== r && !isKitInner(x));
            // only a supply connection counts as +5V / GND here; a divider or pull-up just lists what it's wired to
            const l = lv.strongAt(r);
            return (
              <tr key={d.n} title={d.desc} onMouseEnter={() => onHover(r)} onMouseLeave={() => onHover(null)} style={{ borderTop: '1px solid var(--track)' }}>
                <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{d.n}</td>
                <td style={{ padding: '5px 4px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{d.name}</td>
                <td style={{ padding: '5px 10px', color: others.length ? 'var(--body-alt)' : 'var(--line-no)' }}>
                  {d.kind === 'nc' && !others.length
                    ? 'ไม่ใช้'
                    : others.length
                      ? `${l === 1 ? '+5V · ' : l === 0 ? 'GND · ' : ''}${others.slice(0, 3).map(name).join(', ')}${others.length > 3 ? ` +${others.length - 3}` : ''}`
                      : 'ลอย'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function hexDump(rom: Z80Program): string {
  const addrs = [...rom.bytes.keys()].sort((a, b) => a - b);
  if (!addrs.length) return '(ว่าง)';
  const start = addrs[0] & ~15;
  const end = addrs[addrs.length - 1];
  const rows: string[] = [];
  for (let a = start; a <= end && rows.length < 32; a += 16) {
    const bytes = Array.from({ length: 16 }, (_, i) => {
      const b = rom.bytes.get(a + i);
      return b == null ? '··' : b.toString(16).toUpperCase().padStart(2, '0');
    });
    rows.push(`${a.toString(16).toUpperCase().padStart(4, '0')}  ${bytes.join(' ')}`);
  }
  return rows.join('\n');
}

function LogicAnalyzer({ trace, now, hz, port: decode }: { trace: { t: number; port: number; v: number }[]; now: number; hz: number; port: Match | null }) {
  const port = decode?.value ?? 1;
  const span = Math.max(hz * 2, 2000); // last ~2 s of emulated time
  const from = Math.max(0, now - span);
  const ev = trace.filter((e) => (decode ? matches(decode, e.port) : e.port === port));
  const before = [...ev].reverse().find((e) => e.t <= from)?.v ?? 0;
  const inWin = ev.filter((e) => e.t > from);
  const W = 640;
  const x = (t: number) => 60 + ((t - from) / span) * (W - 70);
  return (
    <div style={{ padding: '0 20px 20px' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>
        บิต D0–D7 ของพอร์ต {hex2(port)} ในช่วง {(span / hz).toFixed(1)} วินาทีล่าสุด (เวลาจำลอง)
      </span>
      <svg viewBox={`0 0 ${W} 200`} width="100%" role="img" aria-label="logic analyzer" style={{ fontFamily: 'var(--mono)', marginTop: 6 }}>
        {Array.from({ length: 8 }, (_, bit) => {
          const y0 = 12 + bit * 23;
          let v = (before >> bit) & 1;
          let d = `M60 ${y0 + (v ? 0 : 14)}`;
          for (const e of inWin) {
            const nv = (e.v >> bit) & 1;
            if (nv !== v) {
              d += `H${x(e.t).toFixed(1)}V${y0 + (nv ? 0 : 14)}`;
              v = nv;
            }
          }
          d += `H${W - 10}`;
          return (
            <g key={bit}>
              <text x={8} y={y0 + 12} fontSize={11} fill="#75686a">
                D{bit}
              </text>
              <path d={d} fill="none" stroke={bit % 2 ? '#8a1c1c' : '#2a1f1f'} strokeWidth={1.8} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- wires & pins ----------

type End = { x: number; y: number; dx: number; dy: number };

function pinEnd(board: Board, r: PinRef) {
  const pr = parseRef(r);
  const part = pr && board.parts.find((x) => x.id === pr.part);
  const def = part && pinDef(part.type, pr!.n);
  return part && def ? { part, def, pos: pinPos(part, def.n) as End } : null;
}

/** Where a wire meets `r`; a rail is met straight above / below the other end. */
function endAt(board: Board, r: PinRef, other: { x: number; y: number }): End {
  if (isRail(r)) {
    const y = RAILS[r].y;
    return { x: Math.max(44, Math.min(BOARD_W - 44, other.x)), y, dx: 0, dy: y < other.y ? 1 : -1 };
  }
  return pinEnd(board, r)?.pos ?? { x: other.x, y: other.y, dx: 0, dy: 0 };
}

const curve = (a: End, b: End) => {
  const k = Math.min(90, Math.max(16, Math.hypot(b.x - a.x, b.y - a.y) * 0.35));
  return `M${a.x} ${a.y}C${a.x + a.dx * k} ${a.y + a.dy * k} ${b.x + b.dx * k} ${b.y + b.dy * k} ${b.x} ${b.y}`;
};

function wireKind(board: Board, w: Wire): WireKind {
  for (const r of [w.a, w.b]) if (isRail(r)) return RAILS[r].kind;
  const ends = [pinEnd(board, w.a), pinEnd(board, w.b)];
  for (const e of ends) if (e && (e.def.kind === 'vcc' || e.def.kind === 'gnd')) return e.def.kind;
  if (ends.some((e) => e?.def.bus === 'A')) return 'addr';
  if (ends.some((e) => e?.def.bus === 'D' || e?.def.bus === 'OUT')) return 'data';
  if (ends.some((e) => e?.def.name === 'CLK' || (e?.part.type === 'CLK' && e.def.name === 'OUT'))) return 'clk';
  return 'sig';
}

/**
 * Every wire, drawn from pin tip to pin tip. Three or more wires running between
 * the same two buses of two parts are drawn as one ribbon with short fan-outs.
 */
function WireLayer({
  board,
  wires,
  nets,
  hoverNet,
  onDelete,
}: {
  board: Board;
  wires: Wire[];
  nets: Analysis['nets'];
  hoverNet: number | null;
  onDelete?: (ws: Wire[]) => void;
}) {
  const groups = new Map<string, { wires: Wire[]; flip: boolean[] }>();
  const singles: Wire[] = [];
  for (const w of wires) {
    const a = pinEnd(board, w.a);
    const b = pinEnd(board, w.b);
    if (!a?.def.bus || !b?.def.bus) {
      singles.push(w);
      continue;
    }
    const ka = `${a.part.id}:${a.def.bus}:${a.pos.dx},${a.pos.dy}`;
    const kb = `${b.part.id}:${b.def.bus}:${b.pos.dx},${b.pos.dy}`;
    const key = ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
    const g = groups.get(key) ?? { wires: [], flip: [] };
    g.wires.push(w);
    g.flip.push(ka > kb);
    groups.set(key, g);
  }
  for (const [k, g] of groups)
    if (g.wires.length < 3) {
      singles.push(...g.wires);
      groups.delete(k);
    }

  const inHover = (w: Wire) => hoverNet != null && nets.of(w.a) === hoverNet;
  const dim = hoverNet != null;
  const hit = (d: string, ws: Wire[]) =>
    onDelete && (
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDelete(ws);
        }}
      >
        <title>{ws.length > 1 ? `คลิกเพื่อลบทั้งชุด (${ws.length} เส้น)` : 'คลิกเพื่อลบสาย'}</title>
      </path>
    );

  return (
    <g>
      {singles.map((w, i) => {
        const col = WIRE_COLOR[wireKind(board, w)];
        let d: string;
        if (isRail(w.a) && isRail(w.b)) {
          // rail jumper down the left edge
          const x = RAILS[w.a].kind === 'vcc' ? 18 : 30;
          d = `M${x + 22} ${RAILS[w.a].y}H${x}V${RAILS[w.b].y}H${x + 22}`;
        } else {
          const pa = isRail(w.a) ? null : pinEnd(board, w.a)?.pos;
          const pb = isRail(w.b) ? null : pinEnd(board, w.b)?.pos;
          const a = pa ?? endAt(board, w.a, pb!);
          const b = pb ?? endAt(board, w.b, pa!);
          d = curve(a, b);
        }
        const on = inHover(w);
        return (
          <g key={`s${i}`}>
            <path d={d} fill="none" stroke={col} strokeWidth={on ? 3 : 1.8} strokeLinecap="round" opacity={dim && !on ? 0.25 : 0.9} />
            {hit(d, [w])}
          </g>
        );
      })}
      {[...groups.values()].map((g, gi) => {
        const ends = g.wires.map((w, i) => {
          const [ra, rb] = g.flip[i] ? [w.b, w.a] : [w.a, w.b];
          return { a: pinEnd(board, ra)!, b: pinEnd(board, rb)! };
        });
        const anchor = (ps: End[]): End => {
          const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
          const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
          return { x: x + ps[0].dx * 22, y: y + ps[0].dy * 22, dx: ps[0].dx, dy: ps[0].dy };
        };
        const A = anchor(ends.map((e) => e.a.pos));
        const B = anchor(ends.map((e) => e.b.pos));
        const col = WIRE_COLOR[wireKind(board, g.wires[0])];
        const on = g.wires.some(inHover);
        const main = curve(A, B);
        const passive = (t: PartType) => t === 'RN' || t === 'LED' || t === '7SG';
        const side = passive(ends[0].a.part.type) && !passive(ends[0].b.part.type) ? 'b' : 'a';
        const sorted = [...ends].sort((x, y) => x[side].def.bit! - y[side].def.bit!);
        const tag = `${sorted[0][side].def.name}–${sorted[sorted.length - 1][side].def.name}`;
        const mid = { x: (A.x + B.x) / 2 + ((A.dx + B.dx) * 10) / 2, y: (A.y + B.y) / 2 + ((A.dy + B.dy) * 10) / 2 };
        return (
          <g key={`g${gi}`} opacity={dim && !on ? 0.25 : 1}>
            {ends.map((e, i) => (
              <g key={i} stroke={col} strokeWidth={1.2} fill="none" opacity={0.9}>
                <path d={`M${e.a.pos.x} ${e.a.pos.y}L${A.x} ${A.y}`} />
                <path d={`M${e.b.pos.x} ${e.b.pos.y}L${B.x} ${B.y}`} />
              </g>
            ))}
            <path d={main} fill="none" stroke={col} strokeWidth={Math.min(9, 2 + g.wires.length * 0.55) + (on ? 1.5 : 0)} strokeLinecap="round" opacity={0.92} />
            <path d={main} fill="none" stroke="#fff" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.5} />
            <text x={mid.x} y={mid.y} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={col} stroke="#fbf9f7" strokeWidth={3} paintOrder="stroke">
              {tag}
            </text>
            {hit(main, g.wires)}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The address / data bus as rails: each chip side gets short pin drops onto a
 * bar, one stub from the bar to the trunk, and the trunk runs in a free lane.
 */
function BusLayer({ trunks, nets, hoverNet, onDelete }: { trunks: Trunk[]; nets: Analysis['nets']; hoverNet: number | null; onDelete?: (ws: Wire[]) => void }) {
  const hit = (d: string, ws: Wire[], what: string) =>
    onDelete && (
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDelete(ws);
        }}
      >
        <title>{`คลิกเพื่อลบ${what} (${ws.length} เส้น)`}</title>
      </path>
    );
  return (
    <g>
      {trunks.map((t, ti) => {
        const col = t.bus === 'addr' ? WIRE_COLOR.addr : WIRE_COLOR.data;
        const name = t.bus === 'addr' ? 'ADDRESS BUS' : 'DATA BUS';
        const on = hoverNet != null && t.wires.some((w) => nets.of(w.a) === hoverNet);
        const trunk = `M${t.x1} ${t.y}H${t.x2}`;
        // address label above its rail, data label below, so the two never sit on each other
        const ly = t.bus === 'addr' ? t.y - 7 : t.y + 13;
        return (
          <g key={ti} opacity={hoverNet != null && !on ? 0.25 : 1}>
            {t.taps.map((tap, i) => {
              const stub = 'M' + tap.stub.map((p) => `${p.x} ${p.y}`).join('L');
              const bar = `M${tap.bar.x1} ${tap.bar.y1}L${tap.bar.x2} ${tap.bar.y2}`;
              return (
                <g key={i}>
                  <title>{`${tap.part.id.toUpperCase()} ${tap.label} → ${name}`}</title>
                  {tap.pins.map((p) => (
                    <path key={p.ref} d={`M${p.x} ${p.y}l${p.dx * BUS_BAR} ${p.dy * BUS_BAR}`} stroke={col} strokeWidth={1.3} />
                  ))}
                  <path d={bar} stroke={col} strokeWidth={3.2} strokeLinecap="round" />
                  <path d={stub} fill="none" stroke={col} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
                  {hit(`${bar}${stub}`, tap.wires, `สายบัสของ ${tap.part.id.toUpperCase()} ${tap.label}`)}
                </g>
              );
            })}
            <path d={trunk} stroke={col} strokeWidth={on ? 8.5 : 7} strokeLinecap="round" />
            <path d={trunk} stroke="#fff" strokeWidth={0.9} strokeDasharray="2 3" opacity={0.6} />
            <text x={t.x2 - 6} y={ly} textAnchor="end" fontSize={9.5} fontWeight={700} fill={col} stroke="#fbf9f7" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
              {name}
            </text>
            {hit(trunk, t.wires, `ทั้งบัส`)}
          </g>
        );
      })}
    </g>
  );
}

/** Hidden supply wires leave a small + / − at the pin, so "is this powered?" is still answered at a glance. */
function PowerGlyphs({ board, wires }: { board: Board; wires: Wire[] }) {
  const at = new Map<PinRef, WireKind>();
  for (const w of wires) {
    const k = wireKind(board, w);
    for (const r of [w.a, w.b]) if (!isRail(r)) at.set(r, k);
  }
  return (
    <g pointerEvents="none">
      {[...at].map(([r, k]) => {
        const e = pinEnd(board, r);
        if (!e) return null;
        const x = e.pos.x + e.pos.dx * 6;
        const y = e.pos.y + e.pos.dy * 6;
        const vcc = k === 'vcc';
        return (
          <g key={r}>
            <circle cx={x} cy={y} r={3.8} fill={vcc ? WIRE_COLOR.vcc : WIRE_COLOR.gnd} />
            <path d={vcc ? `M${x - 2} ${y}H${x + 2}M${x} ${y - 2}V${y + 2}` : `M${x - 2} ${y}H${x + 2}`} stroke="#fff" strokeWidth={1.2} />
          </g>
        );
      })}
    </g>
  );
}

/** Pin tips: a solder dot where a wire lands, and a hit target for wiring and hover. */
function PinLayer({
  board,
  nets,
  hoverNet,
  wireFrom,
  showAll,
  onPinDown,
  onHover,
}: {
  board: Board;
  nets: Analysis['nets'];
  hoverNet: number | null;
  wireFrom: PinRef | null;
  showAll: boolean;
  onPinDown: (e: RPointerEvent, p: Part, r: PinRef) => void;
  onHover: (r: PinRef | null) => void;
}) {
  const wired = new Set(board.wires.flatMap((w) => [w.a, w.b]));
  return (
    <g>
      {board.parts.flatMap((p) =>
        PINOUT[p.type].map((d) => {
          const r = ref(p.id, d.n);
          const { x, y } = pinPos(p, d.n);
          const inNet = hoverNet != null && nets.of(r) === hoverNet;
          return (
            <g key={r}>
              {wired.has(r) && <circle cx={x} cy={y} r={2.3} fill="#ece7e3" stroke="#8f8682" strokeWidth={0.7} />}
              {!wired.has(r) && showAll && d.kind !== 'nc' && <circle cx={x} cy={y} r={1.6} fill="#b5a8a4" />}
              {(inNet || r === wireFrom) && <circle cx={x} cy={y} r={4.6} fill="none" stroke="#8a1c1c" strokeWidth={1.6} />}
              <circle
                cx={x}
                cy={y}
                r={5.5}
                fill="transparent"
                style={{ cursor: showAll ? 'crosshair' : 'pointer' }}
                onPointerDown={(e) => onPinDown(e, p, r)}
                onPointerEnter={() => onHover(r)}
                onPointerLeave={() => onHover(null)}
              >
                <title>{`${p.id.toUpperCase()} ขา ${d.n} · ${d.name}${d.desc ? ` — ${d.desc}` : ''}`}</title>
              </circle>
            </g>
          );
        }),
      )}
    </g>
  );
}

/** Room conditions the sensors on the board react to. */
function EnvPanel({ env, onChange, show, onCard }: { env: Env; onChange: (e: Env) => void; show: ReadonlySet<keyof Env>; onCard?: (uid: string) => void }) {
  const [custom, setCustom] = useState('');
  const set = <K extends keyof Env>(k: K, v: Env[K]) => onChange({ ...env, [k]: v });
  const slider = (k: 'light' | 'temp' | 'distance', name: string, min: number, max: number, step: number, unit: string, hint: string) =>
    show.has(k) && (
      <div key={k} className="env-slider">
        <span>
          {name} <NumField label={`${name} (${unit})`} value={env[k]} min={min} max={max} step={step} unit={unit} onChange={(v) => set(k, v)} />
          <i>{hint}</i>
        </span>
        <input type="range" aria-label={name} min={min} max={max} step={step} value={env[k]} onChange={(e) => set(k, Number(e.target.value))} />
      </div>
    );
  const toggle = (k: 'motion' | 'magnet' | 'tilt' | 'sound' | 'vibration' | 'flame' | 'water' | 'gas', label: string) =>
    show.has(k) && (
      <button key={k} type="button" role="switch" aria-checked={env[k]} className="env-switch" onClick={() => set(k, !env[k])}>
        <i aria-hidden="true" />
        {label}
      </button>
    );
  const light = env.light < 5 ? 'มืดสนิท' : env.light < 50 ? 'สลัว' : env.light < 500 ? 'ในห้อง' : 'แดดจ้า';
  return (
    <div aria-label="สภาพแวดล้อมของเซนเซอร์" className="env-panel">
      {slider('light', 'แสง', 0, 1000, 1, 'lux', light)}
      {slider('temp', 'อุณหภูมิ', 0, 100, 1, '°C', env.temp >= 40 ? 'ร้อน' : env.temp <= 15 ? 'เย็น' : 'ปกติ')}
      {slider('distance', 'วัตถุห่าง', 2, 80, 1, 'cm', 'จากโมดูล IR')}
      {toggle('motion', 'มีการเคลื่อนไหว')}
      {toggle('magnet', 'เอาแม่เหล็กมาใกล้')}
      {toggle('tilt', 'เอียงบอร์ด')}
      {toggle('sound', 'มีเสียงดัง')}
      {toggle('vibration', 'มีการสั่นสะเทือน')}
      {toggle('flame', 'มีเปลวไฟ')}
      {toggle('water', 'แผ่นรับน้ำเปียก')}
      {toggle('gas', 'มีแก๊สหรือควัน')}
      {onCard && (
        <div role="group" aria-label="แตะการ์ด RFID" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--muted)' }}>แตะการ์ด:</span>
          {CARDS.map(([name, uid]) => (
            <button key={uid} type="button" className="btn btn-secondary" style={{ height: 34, padding: '0 12px', fontSize: 13, gap: 6 }} title={`เลขการ์ด ${uid}`} onClick={() => onCard(uid)}>
              {name}
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{uid}</span>
            </button>
          ))}
          <form
            style={{ display: 'flex', gap: 4 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[0-9a-f]{10}$/i.test(custom)) onCard(custom.toUpperCase());
            }}
          >
            <input
              aria-label="เลขการ์ด 10 หลัก (เลขฐานสิบหก)"
              placeholder="เลขการ์ด 10 หลัก"
              value={custom}
              maxLength={10}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9a-f]/gi, ''))}
              style={{ width: 130, height: 34, padding: '0 10px', borderRadius: 10, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--ring)', fontFamily: 'var(--mono)', fontSize: 13 }}
            />
            <button type="submit" className="btn btn-secondary" style={{ height: 34, padding: '0 12px', fontSize: 13 }} disabled={custom.length !== 10}>
              แตะ
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Per-LED current and what it means. */
function LedReadout({ on, mA }: { on: boolean[]; mA: number[] }) {
  const lit = mA.filter((_, i) => on[i]);
  if (!lit.length) return <span>ดับอยู่ทั้งหมด</span>;
  const max = Math.max(...lit);
  const min = Math.min(...lit);
  const range = max - min < 0.05 ? `${max.toFixed(1)} mA` : `${min.toFixed(1)}–${max.toFixed(1)} mA`;
  return (
    <span>
      ติดอยู่ {lit.length} จาก {on.length} · กระแสดวงละ <b style={{ fontFamily: 'var(--mono)' }}>{max >= 40 ? 'เกินพิกัด (ไม่มีตัวต้านทาน)' : range}</b>
      {max > 20 && max < 40 && <span style={{ color: 'var(--m)' }}> · เกินพิกัด LED ~20 mA</span>}
      {max < 1 && <span style={{ color: 'var(--muted)' }}> · หรี่มาก</span>}
    </span>
  );
}

/** Value pickers, knobs and live readings for parts that have them. */
function PartControls({
  part: p,
  an,
  lv,
  adc,
  usart,
  hz,
  lastCard,
  onEdit,
}: {
  part: Part;
  an: Analysis;
  lv: Levels;
  adc?: AdcState;
  usart?: UsartState;
  hz: number;
  lastCard: string | null;
  onEdit: (p: Part) => void;
}) {
  const values = p.type === 'Ω' ? RES_VALUES : p.type === 'RN' ? RN_VALUES : p.type === 'POT' ? POT_VALUES : null;
  const knob = p.type === 'POT' || p.type === 'IR' || p.type === 'LDM';
  const env = lv.env;
  const v = (n: number) => fmtV(lv.volts(ref(p.id, n)));
  const unpowered = (['LM35', 'LDM', 'PIR', 'IR', 'ADC', 'RFID', 'UART'] as PartType[]).includes(p.type) && !an.live.has(p.id);
  // sensors show power and their output in the sensor box above
  const sensor = !!SENSES[p.type] || p.type === 'RFID';
  let note: string | null = null;
  const readings: [string, string][] = [];
  switch (p.type) {
    case 'POT':
      readings.push(['ขา 1 → W', fmtOhm(ohms(p, 0, env))], ['W → ขา 3', fmtOhm(ohms(p, 1, env))], ['แรงดันที่ขา W', v(2)]);
      break;
    case 'LDR':
    case 'NTC':
      readings.push(['ความต้านทานตอนนี้', fmtOhm(ohms(p, 0, env))], ['แรงดันขา 1 / ขา 2', `${v(1)} / ${v(2)}`]);
      break;
    case 'LM35':
      readings.push(['VOUT', unpowered ? '—' : `${(lm35Volts(env) * 1000).toFixed(0)} mV (${env.temp}°C × 10 mV)`]);
      break;
    case 'LDM':
      readings.push(['AO', unpowered ? '—' : fmtV(ldmAo(env))], ['จุดตัด (trimpot)', fmtV(ldmThreshold(p))]);
      break;
    case 'IR':
      readings.push(['ระยะตรวจจับ (trimpot)', `${irRange(p).toFixed(0)} cm`]);
      break;
    case 'ADC': {
      const a = an.adcs.find((x) => x.id === p.id);
      readings.push(['พอร์ต', a ? `${a.wr ? `OUT ${hex2(firstPort(a.wr))} เริ่มแปลง` : ''}${a.rd ? ` · IN ${hex2(firstPort(a.rd))} อ่านผล` : ''}` : 'ยังต่อไม่ครบ'], ['VIN+ ตอนนี้', v(6)]);
      if (adc) readings.push(['แปลงครั้งล่าสุด', `${adc.vin.toFixed(2)} V ÷ ${adc.vref.toFixed(2)} V × 256 = ${adc.value}`], ['/INTR', adc.intr ? 'HIGH' : 'LOW (มีผลรอให้อ่าน)']);
      break;
    }
    case 'RFID':
      readings.push(['การ์ดล่าสุด', lastCard ?? '—']);
      break;
    case 'UART': {
      const u = an.usarts.find((x) => x.id === p.id);
      readings.push(['พอร์ต', u?.rd ? `${hex2(u.rd.value)} ข้อมูล · ${hex2(u.rd.value | (1 << u.cd))} คำสั่ง / สถานะ` : 'ยังต่อไม่ครบ']);
      const st = usart;
      readings.push(
        ['โหมด', st?.mode != null ? hex2(st.mode) : 'ยังไม่ได้ตั้ง — OUT ค่าโหมด (เช่น 4Eh) ไปพอร์ตคำสั่งก่อน'],
        ['ตัวรับ', st?.mode != null && st.command & RX_ENABLE ? 'เปิด' : 'ปิด — OUT คำสั่งที่มีบิต 2 (เช่น 14h) เพื่อเปิด'],
        ['สถานะ', st ? `RxRDY=${st.rxrdy ? 1 : 0} · overrun=${st.overrun ? 1 : 0}` : 'RxRDY=0'],
      );
      if (st?.log.length)
        readings.push([
          'รับล่าสุด',
          st.log
            .slice(-14)
            .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `‹${hex2(b)}›`))
            .join(''),
        ]);
      // a polling loop needs ~40 T-states per byte
      const perByte = (hz * 10) / BAUD;
      if (perByte < 120) note = `ที่ clock ${fmtHz(hz)} ไบต์มาทุก ~${Math.max(1, Math.round(perByte))} T-states ลูปอ่านไม่ทันแน่นอน (overrun) — ตั้ง clock เป็น 4 MHz`;
      break;
    }
  }
  if (!values && !knob && !readings.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {unpowered && !sensor && <span className="notice warn">ยังไม่มีไฟเลี้ยง — ต่อ VCC กับ +5V และ GND กับกราวด์</span>}
      {note && <span className="notice warn">{note}</span>}
      {values && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          ค่าความต้านทาน
          <OhmField value={partVal(p)} presets={values} onChange={(val) => onEdit({ ...p, val })} />
        </label>
      )}
      {knob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.type === 'POT' ? 'ปุ่มหมุน' : 'Trimpot'}
            <NumField label={p.type === 'POT' ? 'ปุ่มหมุน (%)' : 'Trimpot (%)'} value={Math.round(partPos(p) * 100)} min={0} max={100} unit="%" onChange={(v) => onEdit({ ...p, pos: v / 100 })} />
          </span>
          <input type="range" aria-label={p.type === 'POT' ? 'ปุ่มหมุน' : 'Trimpot'} min={0} max={100} value={Math.round(partPos(p) * 100)} onChange={(e) => onEdit({ ...p, pos: Number(e.target.value) / 100 })} />
        </div>
      )}
      {readings.length > 0 && (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
          {readings.map(([k, x]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--muted)' }}>{k}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--mono)', fontWeight: 600 }}>{x}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const firstPort = (m: Match | null) => m?.value ?? 0;

/** A number typed from the keyboard: applied on Enter or when leaving the box, kept within min–max. */
function NumField({ value, min, max, step = 1, unit, label, onChange }: { value: number; min: number; max: number; step?: number; unit?: string; label: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
  const ok = text.trim() !== '' && Number.isFinite(n);
  const commit = () => {
    if (!ok) return setText(String(value));
    const v = Math.min(max, Math.max(min, Math.round(n / step) * step));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <span className="num-field">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!ok}
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {unit && <i>{unit}</i>}
    </span>
  );
}

/** "4.7k", "4k7", "470", "1M", "330Ω" → ohms; null when it isn't a resistance. */
function parseOhm(t: string): number | null {
  const s = t.trim().replace(/\s+/g, '').replace(/(Ω|ohms?)$/i, '');
  // 2.2 × 1000 is 2200.0000000000005 in floating point
  const mult = (c: string) => (/k/i.test(c) ? 1e3 : /m/i.test(c) ? 1e6 : 1);
  const r = (v: number) => Math.round(v * 100) / 100;
  let m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(s);
  if (m) return r(Number(m[1]) * mult(m[2]));
  m = /^(\d+)([kKmMrR])(\d+)$/.exec(s);
  if (m) return r(Number(`${m[1]}.${m[3]}`) * mult(m[2]));
  return null;
}

/** Resistance typed in ohms with k / M, the usual values offered as suggestions. */
function OhmField({ value, presets, onChange }: { value: number; presets: number[]; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmtOhm(value));
  useEffect(() => setText(fmtOhm(value)), [value]);
  const parsed = parseOhm(text);
  const ok = parsed != null && parsed >= 1 && parsed <= 10e6;
  const commit = () => {
    if (!ok) return setText(fmtOhm(value));
    setText(fmtOhm(parsed));
    if (parsed !== value) onChange(parsed);
  };
  const list = `ohm-presets-${presets.join('-')}`;
  return (
    <span className="num-field">
      <input
        list={list}
        aria-label="ค่าความต้านทาน (เช่น 330, 4.7k, 1M)"
        aria-invalid={!ok}
        title="พิมพ์ค่า เช่น 330, 4.7k, 4k7, 1M แล้วกด Enter · หรือเลือกค่ามาตรฐานจากรายการ"
        value={text}
        style={{ width: 96 }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <datalist id={list}>
        {presets.map((x) => (
          <option key={x} value={fmtOhm(x)} />
        ))}
      </datalist>
    </span>
  );
}
