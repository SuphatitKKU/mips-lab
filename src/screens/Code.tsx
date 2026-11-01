// One workspace for a program: write C or MIPS on the left, then either read
// how it converts (MIPS ⇄ C, machine code, per-instruction notes) or step it on
// the simulated CPU — always the same source, no copying between pages.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CodeEditor, type LineMark } from '../components/CodeEditor';
import { Datapath } from '../components/Datapath';
import { FILL, Icon, ICON } from '../components/Icon';
import { Menu } from '../components/Menu';
import { usePopup } from '../components/Popup';
import { Modal } from '../components/Modal';
import { Explainer, MemArt, RegArt, roleOf, smart, StepFlow } from '../components/RunVisuals';
import { CodeLine, PageHeader, Rich, Segmented, Segs } from '../components/ui';
import { compileC, explain } from '../lib/cc/compile';
import { liftMips } from '../lib/cc/lift';
import { highlight } from '../lib/highlight';
import { assemble, type AsmError, type Program } from '../lib/mips/assembler';
import { Cpu, hex, labelAt, layoutArrays, type StepInfo } from '../lib/mips/cpu';
import { DATA_BASE, decode, hx, RN, type RegName } from '../lib/mips/isa';
import { ERR_BG, INK, M, MS, MT, M_DEEP, SOFT } from '../lib/tokens';

/** What other pages pass in router state to open a program here (it opens in run mode). */
export interface SimHandoff {
  source: string;
  lang: 'mips' | 'c';
  entry?: string;
  args?: (number | number[])[];
  title?: string;
}

type Lang = 'c' | 'mips';
type Mode = 'convert' | 'run';
type Tab = 'step' | 'path' | 'regs' | 'mem' | 'hist';

const ARR_BASE = 0x10040000;
const KEY = 'mipslab.code';

const EXAMPLES: (SimHandoff & { key: string })[] = [
  {
    key: 'sum',
    title: 'sum(n)',
    lang: 'c',
    entry: 'sum',
    args: [5],
    source: 'int sum(int n) {\n    int s = 0;\n    for (int i = 1; i <= n; i++) {\n        s += i;\n    }\n    return s;\n}',
  },
  {
    key: 'max',
    title: 'max(arr, n)',
    lang: 'c',
    entry: 'max',
    args: [[3, 9, 4], 3],
    source: 'int max(int *arr, int n) {\n    int m = arr[0];\n    for (int i = 1; i < n; i++)\n        if (arr[i] > m)\n            m = arr[i];\n    return m;\n}',
  },
  {
    key: 'fib',
    title: 'fib(n) แบบ recursive',
    lang: 'c',
    entry: 'fib',
    args: [4],
    source: 'int fib(int n) {\n    if (n < 2) return n;\n    return fib(n - 1) + fib(n - 2);\n}',
  },
  {
    key: 'maxasm',
    title: 'max(arr, n) แบบ MIPS',
    lang: 'mips',
    entry: 'max',
    args: [[3, 9, 4], 3],
    source:
      'max:\n    lw   $v0, 0($a0)\n    addi $t0, $zero, 1\nloop:\n    slt  $t1, $t0, $a1\n    beq  $t1, $zero, done\n    sll  $t2, $t0, 2\n    add  $t2, $a0, $t2\n    lw   $t3, 0($t2)\n    slt  $t4, $v0, $t3\n    beq  $t4, $zero, skip\n    move $v0, $t3\nskip:\n    addi $t0, $t0, 1\n    j    loop\ndone:\n    jr   $ra',
  },
  {
    key: 'hilo',
    title: 'คูณ / หาร (HI, LO)',
    lang: 'mips',
    entry: 'main',
    args: [123456, 1000],
    source: 'main:\n    mult $a0, $a1      # 64-bit product → HI:LO\n    mfhi $t0\n    mflo $t1\n    div  $a0, $a1      # quotient → LO, remainder → HI\n    mflo $v0\n    mfhi $v1\n    jr   $ra',
  },
  {
    key: 'hello',
    title: 'พิมพ์ข้อความ (syscall)',
    lang: 'mips',
    entry: 'main',
    args: [],
    source:
      '.data\nmsg:  .asciiz "สวัสดี MIPS\\n"\n\n.text\nmain:\n    li   $v0, 4        # print string\n    la   $a0, msg\n    syscall\n    li   $t0, 1\nloop:\n    move $a0, $t0\n    li   $v0, 1        # print int\n    syscall\n    addi $t0, $t0, 1\n    ble  $t0, 3, loop\n    li   $v0, 10       # exit\n    syscall',
  },
];

const TINT: [string, string][] = [
  ['#f1ece9', INK],
  [MT, M],
  [MS, M_DEEP],
  ['#f1ece9', INK],
  [MT, M],
  [MS, M_DEEP],
];

const GROUPS: [string, RegName[]][] = [
  ['ชั่วคราว · $t', ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']],
  ['เก็บค่าข้ามฟังก์ชัน · $s', ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']],
  ['อาร์กิวเมนต์ · ค่าคืน', ['a0', 'a1', 'a2', 'a3', 'v0', 'v1']],
  ['พิเศษ', ['zero', 'at', 'gp', 'sp', 'fp', 'ra', 'k0', 'k1']],
];

const mono = { fontFamily: 'var(--mono)' } as const;
const sectionTitle = { fontFamily: 'var(--head)', fontSize: 15, fontWeight: 500 } as const;
const cardHead = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '16px 18px 8px' } as const;

function parseArg(s: string): number | number[] | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\[.*\]$/.test(t)) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    const xs = inner.split(',').map((x) => Number(x.trim()));
    return xs.some((x) => !Number.isInteger(x)) ? null : xs;
  }
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}
const fmtArg = (v: number | number[] | undefined) => (v == null ? '' : Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
const argTexts = (args?: (number | number[])[]) => [0, 1, 2, 3].map((i) => fmtArg(args?.[i]));

interface Saved {
  lang: Lang;
  src: Record<Lang, string>;
  entry?: string;
  args: string[];
  title?: string;
}

function loadSaved(): Saved {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s) as Saved;
    // carry over what the old convert page remembered
    const old = localStorage.getItem('mipslab.convert');
    if (old) {
      const o = JSON.parse(old) as { c: string; m: string; dirM: boolean };
      return { lang: o.dirM ? 'mips' : 'c', src: { c: o.c, mips: o.m }, args: argTexts([5]) };
    }
  } catch {
    /* ignore */
  }
  return { lang: 'c', src: { c: EXAMPLES[0].source, mips: EXAMPLES[3].source }, entry: 'sum', args: argTexts([5]), title: 'sum(n)' };
}

/** Debounced value so we don't recompile on every keystroke. */
function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function Badge({ children, bg, fg }: { children: string; bg: string; fg: string }) {
  return (
    <span style={{ minWidth: 34, height: 30, padding: '0 10px', borderRadius: 10, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--head)', fontWeight: 600, fontSize: 14 }}>
      {children}
    </span>
  );
}

function BinaryCard({ word }: { word: number }) {
  const bin = decode(word);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <span style={{ fontSize: 14, color: 'var(--muted)' }}>
        เลขฐานสอง 32 บิต · <b style={{ color: 'var(--ink)' }}>{bin.type}</b>
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {bin.fields.map((f, k) => (
          <div key={k} style={{ flex: `${f.width} 1 0`, minWidth: 0, borderRadius: 14, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6, background: TINT[k][0] }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, letterSpacing: '0.04em', overflowWrap: 'anywhere', color: TINT[k][1] }}>{f.bits}</span>
            <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{f.label}</span>
          </div>
        ))}
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>= 0x{hx(word)}</span>
    </div>
  );
}

function ErrList({ errors }: { errors: { line: number; msg: string }[] }) {
  return (
    <div className="notice err" style={{ flexDirection: 'column', gap: 2 }}>
      {errors.slice(0, 6).map((e, i) => (
        <span key={i} style={{ ...mono, fontSize: 13 }}>
          บรรทัด {e.line}: {e.msg}
        </span>
      ))}
    </div>
  );
}

/** History as a flow: each instruction → the values it set, joined by arrows (a jump labels its arrow). */
function HistFlow({ steps, jumpLabel, onPick, locked }: { steps: { h: StepInfo; n: number; now: boolean }[]; jumpLabel: (a: number) => string; onPick: (n: number) => void; locked: boolean }) {
  return (
    <ol className="hflow">
      {steps.map(({ h, n, now }, i) => (
        <li key={n} className={now ? 'now' : undefined}>
          <button type="button" disabled={now || locked} onClick={() => onPick(n)} title={now ? 'ขั้นปัจจุบัน' : `ย้อนกลับไปหลังขั้นที่ ${n}`}>
            <span className="hf-n">{n}</span>
            <code className="hf-ins">{h.ins.basic.replace(/\s+/, ' ')}</code>
            <span className="hf-to" aria-hidden="true">→</span>
            <span className="hf-outs">
              {h.changes.map((x) => (
                <span key={x.k} className="hf-out">
                  <i>{x.k === 'hi' || x.k === 'lo' ? x.k.toUpperCase() : '$' + x.k}</i>
                  {smart(x.n)}
                </span>
              ))}
              {h.mem.map((m) => (
                <span key={m.addr} className="hf-out mem">
                  <i>0x{hex(m.addr)}</i>
                  {smart(m.n)}
                </span>
              ))}
              {!h.changes.length && !h.mem.length && <span className="hf-none">—</span>}
            </span>
          </button>
          {h.jump ? <span className="hf-link jump">↷ ไป {jumpLabel(h.pcNew)}</span> : i < steps.length - 1 && <span className="hf-link" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

/** Steps the history box shows before "แสดงทั้งหมด"; older ones fade off the top. */
const HIST_RECENT = 6;

export function Code() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const popup = usePopup();
  const init = useMemo(loadSaved, []);
  const handoff = location.state && typeof location.state === 'object' && 'source' in location.state ? (location.state as SimHandoff) : null;

  const [lang, setLang] = useState<Lang>(handoff?.lang ?? init.lang);
  const [src, setSrc] = useState<Record<Lang, string>>(handoff ? { ...init.src, [handoff.lang]: handoff.source } : init.src);
  const [entryPick, setEntryPick] = useState<string | undefined>(handoff ? handoff.entry : init.entry);
  const [argText, setArgText] = useState<string[]>(handoff ? argTexts(handoff.args) : init.args);
  const [title, setTitle] = useState<string | undefined>(handoff ? handoff.title : init.title);
  const mode: Mode = params.get('mode') === 'run' || (!params.get('mode') && handoff) ? 'run' : 'convert';
  const setMode = (m: Mode) => setParams({ mode: m }, { replace: true });

  // convert-mode selection: C line + compiled row (C source), or MIPS line (MIPS source)
  const [cLine, setCLine] = useState(4);
  const [sel, setSel] = useState<number | null>(null);
  const [mLine, setMLine] = useState<number | null>(null);
  const [showHex, setShowHex] = useState(false);
  // run-mode view
  const [tab, setTab] = useState<Tab>('step');
  const [fmt, setFmt] = useState<'hex' | 'dec'>('dec');
  const [allRegs, setAllRegs] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [histBig, setHistBig] = useState(false);
  const [argErr, setArgErr] = useState<string | null>(null);
  const cpu = useRef<Cpu | null>(null);
  const [, setV] = useState(0);
  const bump = () => setV((x) => x + 1);
  const listRef = useRef<HTMLDivElement>(null);
  const haltSeen = useRef<unknown>(null);

  // take a handoff (also one arriving while already here), then drop it from history
  // so a reload doesn't throw away edits made since
  useEffect(() => {
    if (!handoff) return;
    setLang(handoff.lang);
    setSrc((s) => ({ ...s, [handoff.lang]: handoff.source }));
    setEntryPick(handoff.entry);
    setArgText(argTexts(handoff.args));
    setTitle(handoff.title);
    setParams({ mode: 'run' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const source = src[lang];
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, src, entry: entryPick, args: argText, title } satisfies Saved));
    } catch {
      /* ignore */
    }
  }, [lang, src, entryPick, argText, title]);

  // ---------- build ----------
  const dsrc = useDebounced(source, 250);
  const comp = useMemo(() => (lang === 'c' ? compileC(dsrc) : null), [lang, dsrc]);
  const asm = useMemo(() => (lang === 'c' ? (comp?.ok ? assemble(comp.asm) : null) : assemble(dsrc)), [lang, comp, dsrc]);
  const lifted = useMemo(() => (lang === 'mips' && mode === 'convert' ? liftMips(dsrc) : null), [lang, dsrc, mode]);
  const errors: AsmError[] = comp && !comp.ok ? comp.errors : asm && !asm.ok ? asm.errors : [];
  const prog: Program | null = asm?.ok ? asm.prog : null;
  const asmText = lang === 'c' ? (comp?.ok ? comp.asm : '') : dsrc;
  const cLineOf = (asmLine: number) => (lang === 'c' && comp?.ok ? comp.lines[asmLine - 1]?.c : undefined);

  // machine words per assembly line
  const words = useMemo(() => {
    const m = new Map<number, number[]>();
    if (prog) for (const t of prog.text) m.set(t.line, [...(m.get(t.line) ?? []), t.word]);
    return m;
  }, [prog]);

  // ---------- CPU ----------
  // where the run can start: the C functions, or any code label in hand-written MIPS
  const entries = useMemo(() => {
    if (!prog) return [];
    const labels = [...prog.labels.entries()].filter(([, a]) => a < DATA_BASE).map(([k]) => k);
    return comp?.ok ? comp.funcs.map((f) => f.name).filter((n) => labels.includes(n)) : labels;
  }, [prog, comp]);
  const entry = entryPick && entries.includes(entryPick) ? entryPick : entries[0];

  const reset = () => {
    if (!prog) {
      cpu.current = null;
      bump();
      return;
    }
    const args = argText.map(parseArg);
    const bad = argText.findIndex((t, i) => t.trim() && args[i] == null);
    if (bad >= 0) {
      setArgErr(`$a${bad} ต้องเป็นจำนวนเต็ม หรืออาร์เรย์ เช่น [3, 9, 4]`);
      return;
    }
    setArgErr(null);
    const arrays = args.filter(Array.isArray) as number[][];
    const { mem, addrs } = layoutArrays(arrays, ARR_BASE);
    const regs: Partial<Record<RegName, number>> = {};
    let k = 0;
    args.forEach((v, i) => {
      if (v != null) regs[('a' + i) as RegName] = Array.isArray(v) ? addrs[k++] : v;
    });
    cpu.current = new Cpu(prog, { regs, mem, entry });
    setPlaying(false);
    bump();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [prog, entry]);
  const dArgs = useDebounced(argText.join('\u0000'), 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [dArgs]);

  const advance = () => {
    const c = cpu.current;
    if (!c || c.done) {
      setPlaying(false);
      return;
    }
    c.step();
    bump();
  };
  // on the Datapath tab each instruction's animation sets the pace instead of the timer
  const pacedByPath = playing && tab === 'path';
  useEffect(() => {
    if (!playing) return;
    if (pacedByPath) {
      advance();
      return;
    }
    const t = setInterval(advance, 450);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, pacedByPath]);
  const pathTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(pathTimer.current), [pacedByPath]);
  /** The datapath finished an instruction (its signals reached PC and the registers): start the next one. */
  const onPathDone = () => {
    if (pacedByPath) pathTimer.current = window.setTimeout(advance, 200);
  };

  const c = cpu.current;
  const L: StepInfo | null = c?.last ?? null;
  const done = !!c?.done;
  const nextIns = c && !done && prog ? prog.text[c.index] : null;

  // pop up once when the program finishes or crashes
  useEffect(() => {
    const h = cpu.current?.halt ?? null;
    if (h === haltSeen.current) return;
    haltSeen.current = h;
    if (h && mode === 'run') popup.toast(h.kind === 'error' ? h.msg : `จบโปรแกรม · ${h.msg}`, h.kind === 'error' ? 'err' : 'ok');
  });

  // keep the next instruction in view — scrolling only the list, never the page
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>('[data-next="1"]');
    if (mode !== 'run' || !box || !el) return;
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop - box.clientHeight / 2;
  });

  const step = () => {
    if (!c || done) return;
    c.step();
    bump();
  };
  const back = () => {
    if (!c || !c.hist.length) return;
    c.back();
    bump();
  };

  const restart = () => {
    reset();
    popup.toast('เริ่มใหม่จากคำสั่งแรก');
  };
  const runAll = () => {
    if (!c || done) return;
    c.run(200_000);
    bump();
  };

  // keyboard: ← / → step, Space plays / pauses, R restarts (not while typing)
  useEffect(() => {
    if (mode !== 'run') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') step();
      if (e.key === 'ArrowLeft') back();
      if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault();
        if (c && !done) setPlaying((p) => !p);
      }
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const chooseExample = (key: string) => {
    const ex = EXAMPLES.find((x) => x.key === key);
    if (!ex) return;
    setLang(ex.lang);
    setSrc((s) => ({ ...s, [ex.lang]: ex.source }));
    setEntryPick(ex.entry);
    setArgText(argTexts(ex.args));
    setTitle(ex.title);
    setSel(null);
    setMLine(null);
    popup.toast(`โหลดตัวอย่าง ${ex.title} แล้ว`);
  };

  // ---------- convert-mode data ----------
  // something is always selected, so the explanation card is never empty
  const outLines = comp?.ok ? comp.lines : [];
  const isIns = (i: number) => !!outLines[i]?.asm && !outLines[i].asm!.startsWith('.');
  const firstIns = (pred: (i: number) => boolean) => {
    const i = outLines.findIndex((_, k) => isIns(k) && pred(k));
    return i < 0 ? null : i;
  };
  const selRow = sel != null && isIns(sel) ? sel : (firstIns((k) => outLines[k].c === cLine) ?? firstIns(() => true));
  const curC = selRow != null ? outLines[selRow].c : cLine;
  const mapCount = outLines.filter((l) => l.asm && l.c === curC && !l.asm.startsWith('.')).length;
  const mipsLines = dsrc.split('\n');
  const mText = (ln: number) => (mipsLines[ln - 1] ?? '').replace(/#.*$/, '').replace(/^\s*[A-Za-z_.][\w.]*:\s*/, '').trim();
  const mSel = mLine != null && words.has(mLine) ? mLine : ([...words.keys()].sort((a, b) => a - b)[0] ?? null);
  let detail: { asm: string; ex: string; words: number[]; from: string } | null = null;
  if (lang === 'c' && selRow != null) {
    const l = outLines[selRow];
    detail = { asm: l.asm!, ex: l.ex ?? '', words: words.get(selRow + 1) ?? [], from: `มาจาก C บรรทัด ${l.c}` };
  } else if (lang === 'mips' && mSel != null && mText(mSel)) {
    detail = { asm: mText(mSel), ex: explain(mText(mSel)), words: words.get(mSel)!, from: `โค้ดบรรทัด ${mSel}` };
  }
  const entryFn = lang === 'c' && comp?.ok ? comp.funcs.find((f) => f.name === entry) : undefined;

  // ---------- editor marks ----------
  const marks = useMemo(() => {
    const m = new Map<number, LineMark>();
    for (const e of errors) m.set(e.line, { bg: ERR_BG, title: e.msg });
    if (errors.length) return m;
    if (mode === 'run') {
      const ln = nextIns ? (lang === 'c' ? cLineOf(nextIns.line) : nextIns.line) : undefined;
      if (ln) m.set(ln, { bg: MS, title: 'คำสั่งถัดไปมาจากบรรทัดนี้' });
    } else if (lang === 'c') m.set(selRow != null ? outLines[selRow].c : cLine, { bg: MT });
    else if (mSel != null) m.set(mSel, { bg: MS });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, mode, nextIns, lang, cLine, selRow, mSel, comp]);

  // ---------- run-mode data ----------
  const rows = useMemo(() => {
    if (!prog) return [];
    const out: ({ kind: 'lbl'; text: string } | { kind: 'ins'; idx: number; text: string; sub: boolean })[] = [];
    const byAddr = new Map<number, string[]>();
    for (const [k, a] of prog.labels) if (a < DATA_BASE) byAddr.set(a, [...(byAddr.get(a) ?? []), k]);
    const lines = asmText.split('\n');
    prog.text.forEach((ins, idx) => {
      for (const l of byAddr.get(ins.addr) ?? []) out.push({ kind: 'lbl', text: l + ':' });
      const prev = prog.text[idx - 1];
      const first = !prev || prev.line !== ins.line;
      const raw = (lines[ins.line - 1] ?? '').replace(/^\s*[A-Za-z_.][\w.]*:\s*/, '').replace(/#.*$/, '').trim();
      out.push({ kind: 'ins', idx, text: first ? raw : ins.basic, sub: !first });
    });
    return out;
  }, [prog, asmText]);

  const fmtV = (v: number) => (fmt === 'hex' ? '0x' + hex(v) : String(v));
  const chg: Record<string, { o: number; n: number }> = L ? Object.fromEntries(L.changes.map((x) => [x.k, x])) : {};
  const histAll = c ? [...c.hist.slice(1).map((h) => h.last), L].filter((x): x is StepInfo => !!x) : [];
  const histSteps = histAll.map((h, i) => ({ h, n: i + 1, now: i === histAll.length - 1 }));
  const memRows = useMemo(() => {
    if (!c) return [];
    const ws = new Set<number>();
    for (const a of c.mem.keys()) ws.add(a & ~3);
    const sp = c.r[29] >>> 0;
    for (let a = sp; a < sp + 32 && a <= 0x7ffffffc; a += 4) ws.add(a);
    return [...ws].sort((a, b) => a - b).slice(0, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, c?.steps]);
  const memChanged = new Set(L?.mem.flatMap((m) => [m.addr & ~3]) ?? []);
  const lastSrc = L ? (lang === 'c' ? cLineOf(L.ins.line) : L.ins.line) : undefined;
  const jumpLabel = (a: number) => (prog ? labelAt(prog, a) : '0x' + hex(a));

  // registers worth showing by default: the ones the program mentions, the inputs, the result, anything that changed
  const usedRegs = useMemo(() => {
    const s = new Set<RegName>(['v0']);
    for (const m of asmText.matchAll(/\$([a-z][a-z0-9]*)/g)) if ((RN as readonly string[]).includes(m[1])) s.add(m[1] as RegName);
    argText.forEach((v, i) => v.trim() && s.add(('a' + i) as RegName));
    return s;
  }, [asmText, argText]);

  // names for memory words: array arguments (arr[0], arr[1] …), .data labels, the stack pointer
  const memNames = useMemo(() => {
    const m = new Map<number, string>();
    const args = argText.map(parseArg);
    const arrays = args.filter(Array.isArray) as number[][];
    const { addrs } = layoutArrays(arrays, ARR_BASE);
    const names = entryFn ? entryFn.params.filter((p) => p.type === 'ptr').map((p) => p.name) : [];
    arrays.forEach((arr, k) => arr.forEach((_, i) => m.set(addrs[k] + 4 * i, `${names[k] ?? `อาร์เรย์ ${k + 1}`}[${i}]`)));
    if (prog) for (const [k, v] of prog.labels) if (v >= DATA_BASE) m.set(v, k);
    return m;
  }, [argText, entryFn, prog]);
  const jumpTo = (n: number) => {
    if (!c) return;
    for (let k = c.steps; k > n && c.hist.length; k--) c.back();
    bump();
  };

  // ---------- render ----------
  const exampleKey = EXAMPLES.find((x) => x.lang === lang && x.source === source)?.key ?? '';

  const editorCard = (
    <section aria-label="โค้ด" className="card ws-card ws-editor">
      <div style={cardHead}>
        <span style={{ fontFamily: 'var(--head)', fontSize: 17, fontWeight: 500 }}>โค้ดของคุณ</span>
        <Segmented
          label="ภาษา"
          inCard
          value={lang}
          onChange={(v) => {
            setLang(v);
            setSel(null);
            setMLine(null);
          }}
          btnStyle={{ height: 32, padding: '0 14px', fontSize: 13 }}
          options={[
            { value: 'c', label: 'C' },
            { value: 'mips', label: 'MIPS' },
          ]}
        />
        <select
          aria-label="โค้ดตัวอย่าง"
          className="mini-input"
          value={exampleKey}
          onChange={(e) => chooseExample(e.target.value)}
          style={{ marginLeft: 'auto', fontFamily: 'inherit', maxWidth: 220 }}
        >
          <option value="" disabled>
            ตัวอย่าง…
          </option>
          {EXAMPLES.map((x) => (
            <option key={x.key} value={x.key}>
              {x.lang === 'c' ? 'C' : 'MIPS'} · {x.title}
            </option>
          ))}
        </select>
      </div>
      <div className="ws-fill" style={{ padding: '4px 12px 12px' }}>
        <CodeEditor
          value={source}
          onChange={(v) => setSrc((s) => ({ ...s, [lang]: v }))}
          lang={lang}
          marks={marks}
          label={`โค้ด ${lang === 'c' ? 'C' : 'MIPS'}`}
          minLines={10}
          style={{ flex: 1, minHeight: 0 }}
          onLineClick={
            mode === 'convert'
              ? (ln) => {
                  if (lang === 'mips') return setMLine(ln);
                  setCLine(ln);
                  const idx = outLines.findIndex((l) => l.asm && l.c === ln);
                  setSel(idx < 0 ? null : idx);
                }
              : undefined
          }
        />
      </div>
      {errors.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <ErrList errors={errors} />
        </div>
      )}

      {mode === 'run' && prog && (
        <div data-tour="args" style={{ margin: '0 12px 14px', padding: '14px 16px', borderRadius: 16, background: 'var(--page)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            ค่าที่ส่งให้ฟังก์ชัน <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--muted)' }}>· แก้แล้วเริ่มใหม่ให้เอง</span>
            {entries.length > 1 ? (
              <select className="mini-input" aria-label="ฟังก์ชันที่จะรัน" value={entry ?? ''} onChange={(e) => setEntryPick(e.target.value)} style={{ marginLeft: 8, height: 30, background: '#fff' }}>
                {entries.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            ) : (
              <span style={{ ...mono, marginLeft: 8, color: 'var(--m)' }}>{entry}</span>
            )}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px' }}>
            {(entryFn ? entryFn.params : [0, 1, 2, 3].map((i) => ({ name: `$a${i}`, type: 'int' as const }))).map((p, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, ...mono }}>
                {p.name} =
                <input
                  className="mini-input"
                  style={{ width: p.type === 'ptr' ? 130 : 84, background: '#fff' }}
                  value={argText[i]}
                  placeholder={p.type === 'ptr' ? '[3, 9, 4]' : '0'}
                  title={p.type === 'ptr' ? 'อาร์เรย์ เช่น [3, 9, 4] — ถูกวางใน memory แล้วส่ง address ไปให้' : 'จำนวนเต็ม'}
                  onChange={(e) => setArgText(argText.map((t, k) => (k === i ? e.target.value : t)))}
                  onKeyDown={(e) => e.key === 'Enter' && reset()}
                />
              </label>
            ))}
            {entryFn?.params.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>ฟังก์ชันนี้ไม่รับค่า</span>}
          </div>
          {argErr && <div className="notice err">{argErr}</div>}
        </div>
      )}

      {mode === 'convert' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 18px 16px', padding: '10px 14px', borderRadius: 14, background: 'var(--page)', fontSize: 14, color: 'var(--muted)' }}>
          <Icon d={ICON.pointer} size={16} />
          คลิกบรรทัดใดก็ได้ เพื่อดูว่า{lang === 'c' ? 'กลายเป็นคำสั่ง MIPS อะไร' : 'คำสั่งนั้นทำอะไร'}
        </div>
      )}
    </section>
  );

  // right column, top card: what the source turns into (convert) or the instruction list with the PC (run)
  const outputCard =
    mode === 'convert' ? (
      <section aria-label={lang === 'c' ? 'MIPS ที่ได้' : 'C ที่ได้'} className="card ws-card ws-out tall">
        <div style={cardHead}>
          <Badge bg={lang === 'c' ? MS : MT} fg={lang === 'c' ? M_DEEP : M}>
            {lang === 'c' ? 'MIPS' : 'C'}
          </Badge>
          <span style={{ fontFamily: 'var(--head)', fontSize: 16, fontWeight: 500 }}>{lang === 'c' ? 'ผลแปลงเป็น MIPS' : 'ผลแปลงกลับเป็น C'}</span>
          {lang === 'c' && comp?.ok && (
            <>
              <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: MT, color: M, display: 'inline-flex', alignItems: 'center', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                C บรรทัด {curC} → {mapCount} คำสั่ง
              </span>
              <span style={{ marginLeft: 'auto' }}>
                <Menu label="ตัวเลือกการแสดงผล" items={[{ label: 'แสดง machine code (เลขฐานสิบหก)', checked: showHex, onSelect: () => setShowHex((v) => !v) }]} />
              </span>
            </>
          )}
        </div>
        <div className="code ws-scroll" style={{ padding: '4px 10px 16px' }}>
          {lang === 'c' ? (
            comp?.ok ? (
              outLines.map((l, i) => {
                const w = words.get(i + 1);
                return (
                  <CodeLine
                    key={i}
                    no={i + 1}
                    src={l.lbl || '    ' + l.asm}
                    lang="mips"
                    bg={i === selRow ? MS : l.c === curC && l.asm ? MT : undefined}
                    onClick={
                      l.asm && !l.asm.startsWith('.')
                        ? () => {
                            setSel(i);
                            setCLine(l.c);
                          }
                        : undefined
                    }
                    right={showHex && w ? <span style={{ color: 'var(--tertiary)', fontSize: 13, paddingLeft: 12 }}>{w.map(hx).join(' ')}</span> : <span />}
                  />
                );
              })
            ) : (
              <div style={{ padding: 12, color: 'var(--muted)', fontFamily: "'Anuphan', sans-serif" }}>แก้โค้ด C ให้ถูกก่อน แล้วผลจะปรากฏที่นี่</div>
            )
          ) : lifted?.ok ? (
            lifted.lines.map((l, i) => (
              <CodeLine key={i} no={i + 1} src={l.text} lang="c" bg={l.m && l.m === mSel ? MT : undefined} hoverable={!!l.m} onClick={l.m ? () => setMLine(l.m) : undefined} />
            ))
          ) : (
            <div style={{ padding: 12, color: 'var(--muted)', fontFamily: "'Anuphan', sans-serif" }}>
              {lifted && !lifted.ok ? `แปลงกลับไม่ได้: ${lifted.errors[0]?.msg ?? ''}` : 'แก้โค้ด MIPS ให้ถูกก่อน แล้วผลจะปรากฏที่นี่'}
            </div>
          )}
        </div>
      </section>
    ) : (
      <section aria-label="คำสั่งที่ CPU รัน" className="card ws-card ws-out">
        <div style={cardHead}>
          <Badge bg={MS} fg={M_DEEP}>
            MIPS
          </Badge>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>คำสั่งที่ CPU รัน{lang === 'c' ? ' (คอมไพล์จาก C)' : ''}</span>
        </div>
        <div ref={listRef} className="ws-scroll" style={{ position: 'relative', padding: '4px 10px 10px', ...mono, fontSize: 14, lineHeight: 2.1 }}>
          {!prog && <div style={{ padding: 12, color: 'var(--muted)', fontFamily: "'Anuphan', sans-serif" }}>แก้โค้ดให้ถูกก่อน แล้วจะรันได้</div>}
          {rows.map((r, i) => {
            if (r.kind === 'lbl')
              return (
                <div key={i} style={{ padding: '0 10px 0 40px', fontWeight: 700 }}>
                  {r.text}
                </div>
              );
            const next = !!c && !done && c.index === r.idx;
            const ran = L?.i === r.idx;
            const tag = next ? 'ถัดไป' : ran ? 'เพิ่งรัน' : '';
            return (
              <div key={i} data-next={next ? '1' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', borderRadius: 12, background: next ? MT : ran ? SOFT : 'transparent' }}>
                <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: next ? M : 'transparent' }}>
                  {next && <Icon d={FILL.play} filled size={10} color="#fff" />}
                </span>
                <span style={{ width: 90, flex: 'none', color: 'var(--tertiary)', fontSize: 13 }}>0x{hex(prog!.text[r.idx].addr)}</span>
                <span style={{ whiteSpace: 'pre', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: r.sub ? 'var(--muted)' : undefined }}>
                  {r.sub ? '  ↳ ' + r.text : <Segs segs={highlight(r.text, 'mips')} />}
                </span>
                {tag && (
                  <span
                    style={{
                      flex: 'none',
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      fontFamily: "'Anuphan', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      background: next ? M : 'var(--ring)',
                      color: next ? '#fff' : INK,
                    }}
                  >
                    {tag}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {c?.out && (
          <div style={{ margin: '0 18px 16px', flex: 'none' }}>
            <span style={sectionTitle}>ผลลัพธ์ที่พิมพ์ (syscall)</span>
            <pre style={{ margin: '8px 0 0', padding: '12px 14px', borderRadius: 14, background: '#2a1f1f', color: 'var(--m-on)', ...mono, fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.out}</pre>
          </div>
        )}
      </section>
    );

  // right column, lower card: the selected instruction (convert) or what the last step did (run)
  const detailCard =
    mode === 'convert' ? (
      <section aria-label="คำสั่งที่เลือก" className="card ws-card ws-detail">
        <div className="ws-scroll" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {detail ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--head)', fontSize: 16, fontWeight: 500 }}>
                คำสั่งนี้ทำอะไร <span style={{ fontFamily: "'Anuphan', sans-serif", fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>· {detail.from}</span>
              </span>
              <span style={{ ...mono, fontSize: 22, fontWeight: 600, whiteSpace: 'pre-wrap' }}>
                <Segs segs={highlight(detail.asm.replace(/\s+/, ' '), 'mips')} weight={false} />
              </span>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.75, textWrap: 'pretty' } as CSSProperties}>
                <Rich text={detail.ex || 'คำสั่งนี้ไม่มีคำอธิบาย'} />
              </p>
              {detail.words.length > 1 && <span style={{ fontSize: 14, color: 'var(--muted)' }}>เป็นคำสั่งเทียม (pseudo) — เครื่องจริงใช้ {detail.words.length} คำสั่งแทน</span>}
            </div>
            {detail.words[0] != null && (
              <details className="more">
                <summary>ดูเลขฐานสองที่ CPU อ่านจริง (machine code)</summary>
                <div style={{ paddingTop: 12 }}>
                  <BinaryCard word={detail.words[0]} />
                </div>
              </details>
            )}
          </>
        ) : (
          <span style={{ fontSize: 15, color: 'var(--muted)' }}>{errors.length ? 'แก้โค้ดให้ถูกก่อน แล้วคำอธิบายจะปรากฏที่นี่' : 'คลิกบรรทัดในโค้ด เพื่อดูว่าคำสั่งนั้นทำอะไร'}</span>
        )}
        </div>
      </section>
    ) : (
      <section aria-label="รายละเอียดขั้นนี้" className="card ws-card ws-detail">
        {c?.halt && (
          <div className={`notice ${c.halt.kind === 'error' ? 'err' : 'ok'}`} style={{ margin: '14px 14px 0', alignItems: 'center', fontWeight: 600 }}>
            <Icon d={c.halt.kind === 'error' ? ICON.alert : ICON.check} size={20} stroke={2.4} />
            {c.halt.kind === 'error' ? c.halt.msg : `จบโปรแกรม · ${c.halt.msg}`}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 14px 4px' }}>
          <div className="ws-tabs">
            <Segmented<Tab>
              role="tablist"
              label="มุมมอง"
              inCard
              value={tab}
              onChange={setTab}
              btnStyle={{ height: 34, padding: '0 12px' }}
              options={[
                { value: 'step', label: 'อธิบาย' },
                { value: 'path', label: 'Datapath' },
                { value: 'regs', label: 'Registers' },
                { value: 'mem', label: 'Memory' },
                { value: 'hist', label: 'ประวัติ' },
              ]}
            />
          </div>
          <Menu
            label="ตัวเลือกการแสดงผล"
            items={[
              { label: 'แสดงตัวเลขเป็นเลขฐานสิบหก', checked: fmt === 'hex', onSelect: () => setFmt((f) => (f === 'hex' ? 'dec' : 'hex')) },
              { label: 'แสดง register ครบ 32 ตัว', checked: allRegs, onSelect: () => setAllRegs((v) => !v) },
            ]}
          />
        </div>

        <div className="ws-scroll">
        {tab === 'step' &&
          (L ? (
            <div style={{ padding: '14px 22px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: 'var(--head)', fontSize: 16, fontWeight: 500 }}>
                  ขั้นที่ {c!.steps} — CPU เพิ่งทำคำสั่งนี้
                  <span style={{ fontFamily: "'Anuphan', sans-serif", fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>{lastSrc ? ` · ${lang === 'c' ? 'C' : 'โค้ด'} บรรทัด ${lastSrc}` : ''}</span>
                </span>
                <span style={{ ...mono, fontSize: 22, fontWeight: 600, whiteSpace: 'pre-wrap' }}>
                  <Segs segs={highlight(L.ins.basic.replace(/\s+/, ' '), 'mips')} weight={false} />
                </span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7 }}>
                  <Rich text={L.desc} />
                </p>
              </div>

              <StepFlow step={L} labelAt={jumpLabel} />
              <button type="button" className="btn btn-soft" style={{ alignSelf: 'flex-start', gap: 6 }} onClick={() => setTab('path')}>
                ดูในวงจร (Datapath)
                <Icon d={ICON.arrowRight} size={16} />
              </button>
            </div>
          ) : prog ? (
            <div style={{ padding: '18px 22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ fontFamily: 'var(--head)', fontSize: 18, fontWeight: 500 }}>พร้อมแล้ว — กด “ถัดไป” เพื่อให้ CPU ทำคำสั่งแรก</span>
              <ol className="howto">
                <li>
                  <b>ซ้าย</b> บรรทัดสีชมพูคือโค้ดที่ CPU กำลังจะทำ
                </li>
                <li>
                  <b>ขวาบน</b> คำสั่ง MIPS ที่ป้าย “ถัดไป” คือคำสั่งที่จะรัน
                </li>
                <li>
                  <b>ตรงนี้</b> อธิบายว่าคำสั่งทำอะไร และค่าไหนเปลี่ยน
                </li>
              </ol>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>ใช้ปุ่ม ← → บนคีย์บอร์ดเพื่อย้อน / เดินหน้าได้</span>
            </div>
          ) : (
            <div style={{ padding: 22, fontSize: 15, color: 'var(--muted)' }}>แก้โค้ดให้ถูกก่อน แล้วจะรันได้</div>
          ))}

        {tab === 'path' && (
          <div style={{ padding: '10px 18px 16px' }}>
            <Datapath
              heading={
                L ? (
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--head)', fontSize: 14, fontWeight: 500, color: 'var(--muted)' }}>ขั้นที่ {c!.steps}</span>
                    <span style={{ ...mono, fontSize: 17, fontWeight: 600 }}>
                      <Segs segs={highlight(L.ins.basic.replace(/\s+/, ' '), 'mips')} weight={false} />
                    </span>
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}>กด “ถัดไป” แล้วส่วนที่คำสั่งนั้นใช้จะเป็นสีแดง · ทุกคำสั่งจบใน 1 clock</span>
                )
              }
              step={L}
              prev={c?.prev ?? null}
              fmt={fmtV}
              onDone={onPathDone}
              onNext={!done && !playing ? step : undefined}
            />
          </div>
        )}

        {tab === 'regs' && c && (
          <div style={{ padding: '10px 18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Explainer art={RegArt} title="Register คือกล่องเก็บตัวเลขในตัว CPU">
              มี 32 กล่อง กล่องละ 32 บิต · CPU คำนวณได้เฉพาะค่าที่อยู่ในกล่องเหล่านี้ ต้องย้ายข้อมูลจาก memory เข้ามาก่อน · กล่องที่กระพริบคือเพิ่งเปลี่ยน
            </Explainer>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {[
                { k: 'PC', v: '0x' + hex(c.pc), note: 'ที่อยู่ของคำสั่งถัดไป', on: !!L },
                { k: 'HI', v: fmtV(c.hi), note: 'ผลคูณครึ่งบน / เศษหาร', on: 'hi' in chg },
                { k: 'LO', v: fmtV(c.lo), note: 'ผลคูณครึ่งล่าง / ผลหาร', on: 'lo' in chg },
              ].map((r) => (
                <div key={r.on ? `${r.k}-${c.steps}` : r.k} className={`reg-box special${r.on ? ' on flash' : ''}`}>
                  <span className="reg-name">
                    {r.k}
                    <small>{r.note}</small>
                  </span>
                  <span className="reg-val">{r.v}</span>
                </div>
              ))}
            </div>
            <span style={sectionTitle}>
              {allRegs ? 'register ทั้ง 32 ตัว' : 'register ที่โปรแกรมนี้ใช้'}
              <span style={{ fontFamily: "'Anuphan', sans-serif", fontSize: 12.5, fontWeight: 400, color: 'var(--muted)' }}> · ดูครบ 32 ตัวได้ที่เมนู ⋯</span>
            </span>
            <div className="reg-grid">
              {GROUPS.flatMap(([, ks]) => ks)
                .filter((kk) => allRegs || usedRegs.has(kk) || chg[kk])
                .map((kk) => {
                  const x = chg[kk];
                  const v = c.r[RN.indexOf(kk)];
                  return (
                    <div key={x ? `${kk}-${c.steps}` : kk} className={`reg-box${x ? ' on flash' : ''}${v === 0 && !x ? ' zero' : ''}`}>
                      <span className="reg-name">
                        ${kk}
                        <small>{roleOf(kk)}</small>
                      </span>
                      <span className="reg-val">{fmtV(v)}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {tab === 'mem' && c && (
          <div style={{ padding: '10px 18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Explainer art={MemArt} title="Memory คือตู้เก็บของใบใหญ่นอก CPU">
              แต่ละช่องมีเลขที่ (address) เก็บได้ช่องละ 4 byte · ใช้ <code>lw</code> หยิบค่าเข้า register และ <code>sw</code> เก็บกลับ · stack คือที่ที่ฟังก์ชันยืมใช้ชั่วคราว โดย <code>$sp</code> ชี้ยอด
            </Explainer>
            {memRows.length === 0 && <span style={{ color: 'var(--muted)' }}>ยังไม่มีข้อมูลใน memory</span>}
            {(
              [
                ['ข้อมูล · อาร์เรย์ที่ส่งเข้าและตัวแปรใน .data', memRows.filter((a) => a < 0x7f000000)],
                ['stack · พื้นที่ยืมใช้ของฟังก์ชัน', memRows.filter((a) => a >= 0x7f000000)],
              ] as const
            )
              .filter(([, rs]) => rs.length)
              .map(([head, rs]) => (
                <div key={head} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={sectionTitle}>{head}</span>
                  <div className="mem-strip">
                    {rs.map((a) => {
                      const v = c.readWord(a);
                      const on = memChanged.has(a);
                      const sp = a === c.r[29] >>> 0;
                      const name = memNames.get(a);
                      return (
                        <div key={on ? `${a}-${c.steps}` : a} className={`mem-cell${on ? ' on flash' : ''}${sp ? ' sp' : ''}`}>
                          <span className="mem-addr">0x{hex(a)}</span>
                          <span className="mem-box">{fmtV(v)}</span>
                          <span className="mem-tag">
                            {name}
                            {sp && <b>{name ? ' · ' : ''}← $sp ยอด stack</b>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab === 'hist' && (
          <div style={{ padding: '10px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="hflow-box">
              {histAll.length === 0 ? (
                <span style={{ color: 'var(--muted)', margin: 'auto' }}>กด “ถัดไป” เพื่อเริ่ม</span>
              ) : (
                <HistFlow steps={histSteps.slice(-HIST_RECENT)} jumpLabel={jumpLabel} onPick={jumpTo} locked={playing} />
              )}
            </div>
            <button type="button" className="btn btn-soft" style={{ alignSelf: 'flex-start', height: 34, fontSize: 14 }} disabled={histAll.length === 0} onClick={() => setHistBig(true)}>
              <Icon d={ICON.expand} size={15} />
              แสดงทั้งหมด{histAll.length > 0 && ` (${histAll.length} ขั้น)`}
            </button>
          </div>
        )}
        {histBig && histAll.length > 0 && (
          <Modal wide title={`ประวัติทั้งหมด · ${histAll.length} ขั้น`} onClose={() => setHistBig(false)}>
            <div className="hflow-big">
              <HistFlow
                steps={histSteps}
                jumpLabel={jumpLabel}
                locked={playing}
                onPick={(n) => {
                  jumpTo(n);
                  setHistBig(false);
                }}
              />
            </div>
          </Modal>
        )}
        </div>
      </section>
    );

  return (
    <>
      <PageHeader title="โค้ด" sub={title ? `กำลังดู: ${title}` : 'เขียนโค้ด แล้วเลือกว่าจะดูผลแปลง หรือรันทีละขั้น'}>
        <div className="mode-tabs" role="tablist" aria-label="โหมด">
          {(
            [
              ['convert', ICON.convert, 'แปลงโค้ด', lang === 'c' ? 'C แต่ละบรรทัดกลายเป็น MIPS อะไร' : 'MIPS เขียนเป็น C ได้แบบไหน'],
              ['run', ICON.sim, 'รันทีละขั้น', 'CPU ทำทีละคำสั่ง ค่าไหนเปลี่ยน'],
            ] as const
          ).map(([m, icon, name, desc]) => (
            <button key={m} role="tab" aria-selected={mode === m} className="mode-tab" onClick={() => setMode(m)} title={desc}>
              <span className="mode-tab-ico">
                <Icon d={icon} size={18} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <b>{name}</b>
                <small>{desc}</small>
              </span>
            </button>
          ))}
        </div>
      </PageHeader>

      <main className="main ws">
        <div className={`code-ws ${mode}`}>
          {editorCard}
          {outputCard}
          {detailCard}

          {mode === 'run' && (
            <div className="player" role="toolbar" aria-label="ควบคุมการรัน">
            <button className="btn btn-secondary btn-round" disabled={!c || c.hist.length === 0 || playing} onClick={back} title="ย้อนกลับ (←)" aria-label="ย้อนกลับ">
              <Icon d={ICON.chevronLeft} size={18} stroke={2.2} />
            </button>
            {playing ? (
              <button className="btn btn-primary" style={{ gap: 6, padding: '0 20px' }} onClick={() => setPlaying(false)} title="หยุด (Space)">
                <Icon d={FILL.stop} filled size={13} />
                หยุด
              </button>
            ) : (
              <button className="btn btn-primary" style={{ gap: 6, padding: '0 12px 0 20px' }} disabled={!c || done} onClick={step} title="ถัดไป (→)">
                ถัดไป
                <Icon d={ICON.chevronRight} size={18} stroke={2.2} />
              </button>
            )}
            <Menu
              up
              label="ตัวเลือกการรัน"
              items={[
                { label: 'เล่นอัตโนมัติ', hint: 'Space', icon: { d: FILL.play, filled: true }, disabled: !c || done || playing, onSelect: () => setPlaying(true) },
                { label: 'รันจนจบ', icon: { d: FILL.fastForward, filled: true }, disabled: !c || done || playing, onSelect: runAll },
                { label: 'เริ่มใหม่', hint: 'R', icon: { d: ICON.reset }, disabled: !c, onSelect: restart },
              ]}
            />
            <span className="player-count">
              ขั้นที่ <b>{c?.steps ?? 0}</b>
              {done && <span style={{ color: 'var(--m)', fontWeight: 600 }}> · จบแล้ว</span>}
            </span>
          </div>
        )}
        </div>
      </main>
    </>
  );
}
