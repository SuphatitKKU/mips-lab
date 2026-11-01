import { useState, type ReactNode } from 'react';
import { hex, type StepInfo } from '../lib/mips/cpu';
import { fields, opOf, RN } from '../lib/mips/isa';
import { aluBits, CTRL, EDGES, STATES, statesFor, type Ctrl, type CtrlKey, type Cycle } from '../lib/mips/multicycle';

// The inside of each part of the multicycle datapath, down to logic gates. Every
// view is drawn in the same 1280 × 720 box so zooming in keeps the stage still,
// and reads its values from the cycle on screen, so it keeps up while the
// instruction plays. 1 is drawn red, 0 grey, unknown pale.

export const VW = 1280;
export const VH = 720;

export type MuxId = 'muxI' | 'muxR' | 'muxW' | 'muxA' | 'muxB' | 'muxPC';
export type RegId = 'pc' | 'ir' | 'aluOut' | `r${number}`;
export type GmuxCtx = { src: 'ainv' | 'binv' | 'op'; bit: number } | { src: 'word'; id: MuxId; bit: number } | { src: 'en'; reg: RegId; bit: number };
export type View =
  | { k: 'top' }
  | { k: 'alu' }
  | { k: 'alu1'; bit: number }
  | { k: 'fa'; bit: number }
  | { k: 'xor'; bit: number; n: 1 | 2 }
  | { k: 'gmux'; ctx: GmuxCtx }
  | { k: 'mux'; id: MuxId }
  | { k: 'reg'; id: RegId }
  | { k: 'bit'; id: RegId; bit: number }
  | { k: 'dff'; id: RegId; bit: number }
  | { k: 'regs' }
  | { k: 'dec'; port: 'r1' | 'r2' | 'w' }
  | { k: 'mem' }
  | { k: 'ir' }
  | { k: 'sext' }
  | { k: 'sl2'; id: 'b' | 'j' }
  | { k: 'aluctl' }
  | { k: 'ctrl' }
  | { k: 'opdec' }
  | { k: 'pcen' };

export type Box = { x: number; y: number; width: number; height: number };
export type Go = (v: View, box: Box) => void;
export type Fmt = (v: number) => string;

export interface Ctx {
  cy: Cycle | null;
  s: StepInfo | null;
  fmt: Fmt;
  go: Go;
  /** register file after the instruction ran */
  regs?: ArrayLike<number>;
  /** word in memory at an address */
  peek?: (addr: number) => number | undefined;
}

const MUX_NAME: Record<MuxId, string> = {
  muxI: 'Mux IorD',
  muxR: 'Mux RegDst',
  muxW: 'Mux MemtoReg',
  muxA: 'Mux ALUSrcA',
  muxB: 'Mux ALUSrcB',
  muxPC: 'Mux PCSource',
};

export function viewTitle(v: View): string {
  switch (v.k) {
    case 'top':
      return 'Datapath';
    case 'alu':
      return 'ALU 32 บิต';
    case 'alu1':
      return `ALU บิต ${v.bit}`;
    case 'fa':
      return 'Full adder';
    case 'xor':
      return 'XOR';
    case 'gmux':
      return 'Mux ระดับเกต';
    case 'mux':
      return MUX_NAME[v.id];
    case 'reg':
      return regName(v.id);
    case 'bit':
      return `บิต ${v.bit}`;
    case 'dff':
      return 'D flip-flop';
    case 'regs':
      return 'Registers';
    case 'dec':
      return v.port === 'w' ? 'Decoder (เขียน)' : `Decoder (Read register ${v.port === 'r1' ? 1 : 2})`;
    case 'mem':
      return 'Memory';
    case 'ir':
      return 'Instruction register';
    case 'sext':
      return 'Sign extend';
    case 'sl2':
      return v.id === 'b' ? 'Shift left 2 (branch)' : 'Shift left 2 (jump)';
    case 'aluctl':
      return 'ALU control';
    case 'ctrl':
      return 'Main control (FSM)';
    case 'opdec':
      return 'ถอด opcode';
    case 'pcen':
      return 'PC write enable';
  }
}

const regName = (id: RegId) => (id === 'pc' ? 'PC' : id === 'ir' ? 'IR' : id === 'aluOut' ? 'ALUOut' : '$' + RN[+id.slice(1)]);

// ---------- values ----------

export type Bit = number | undefined;
export const bitOf = (v: number | undefined, i: number): Bit => (v === undefined ? undefined : (v >>> i) & 1);
const AND = (...xs: Bit[]): Bit => (xs.some((x) => x === 0) ? 0 : xs.every((x) => x === 1) ? 1 : undefined);
const OR = (...xs: Bit[]): Bit => (xs.some((x) => x === 1) ? 1 : xs.every((x) => x === 0) ? 0 : undefined);
const NOT = (x: Bit): Bit => (x === undefined ? undefined : 1 - x);
const XOR = (a: Bit, b: Bit): Bit => (a === undefined || b === undefined ? undefined : a ^ b);
const bin = (v: number | undefined, n: number) => (v === undefined ? '?'.repeat(n) : (v >>> 0).toString(2).padStart(32, '0').slice(32 - n));
const addr = (v: number | undefined) => (v === undefined ? '—' : '0x' + hex(v));
const val = (fmt: Fmt, v: number | undefined) => (v === undefined ? '—' : fmt(v));

/** A datapath mux: what is on each input, its select signal and what comes out. */
export function muxWord(id: MuxId, cy: Cycle) {
  const f = cy.ir === undefined ? null : fields(cy.ir);
  const c = cy.ctrl;
  const ins: { label: string; v?: number }[] =
    id === 'muxI'
      ? [{ label: 'PC', v: cy.pc }, { label: 'ALUOut', v: cy.aluOut }]
      : id === 'muxR'
        ? [{ label: 'Instruction [20–16] (rt)', v: f?.rt }, { label: 'Instruction [15–11] (rd)', v: f?.rd }]
        : id === 'muxW'
          ? [{ label: 'ALUOut', v: cy.aluOut }, { label: 'MemData', v: cy.memData }]
          : id === 'muxA'
            ? [{ label: 'PC', v: cy.pc }, { label: 'Read data 1', v: cy.rd1 }]
            : id === 'muxB'
              ? [{ label: 'Read data 2', v: cy.rd2 }, { label: 'ค่าคงที่ 4', v: 4 }, { label: 'Sign extend', v: cy.ext }, { label: 'Sign extend × 4', v: cy.extSh }]
              : [{ label: 'ผล ALU', v: cy.alu }, { label: 'ALUOut', v: cy.aluOut }, { label: 'Jump address', v: cy.jump }];
  const sig: CtrlKey = id === 'muxI' ? 'IorD' : id === 'muxR' ? 'RegDst' : id === 'muxW' ? 'MemtoReg' : id === 'muxA' ? 'ALUSrcA' : id === 'muxB' ? 'ALUSrcB' : 'PCSource';
  const sel = c[sig];
  return { ins, sig, sel, selBits: ins.length > 2 ? 2 : 1, out: ins[sel]?.v, width: id === 'muxR' ? 5 : 32 };
}

/** A register: its output Q, the value on its input, and whether it is written at the clock edge. */
export function regCtx(id: RegId, cy: Cycle, s: StepInfo | null, regs?: ArrayLike<number>) {
  const c = cy.ctrl;
  if (id === 'pc') return { q: cy.pc, din: cy.pcNext, en: cy.pcEn, enName: 'PCWrite + PCWriteCond · Zero' };
  if (id === 'ir') return { q: cy.ir, din: cy.memData, en: c.IRWrite, enName: 'IRWrite' };
  if (id === 'aluOut') return { q: cy.aluOut, din: cy.alu, en: 1, enName: 'เขียนทุก cycle' };
  const k = +id.slice(1);
  const ch = s?.changes.find((x) => x.k === RN[k]);
  const q = k === 0 ? 0 : ch ? ch.o : regs?.[k];
  return { q, din: cy.wd, en: k !== 0 && c.RegWrite && cy.wr === k ? 1 : 0, enName: `RegWrite · (Write register = ${k})` };
}

// ---------- drawing kit ----------

const ON = 'var(--m)';
const OFF = '#bcb0ab';
const UNK = '#e2d9d5';
const ORANGE = '#e07b24';
const INK = '#2a1f1f';
const MUTED = '#75686a';
const wcol = (v: Bit) => (v === 1 ? ON : v === 0 ? OFF : UNK);

const P = (...pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${x},${y}`).join('L');

function W({ d, v, ctrl }: { d: string; v: Bit; ctrl?: boolean }) {
  const stroke = ctrl ? (v ? ORANGE : '#f1cfae') : wcol(v);
  return <path d={d} fill="none" stroke={stroke} strokeWidth={v === 1 ? 3.4 : 2.2} strokeLinejoin="round" />;
}

function Dot({ x, y, v }: { x: number; y: number; v: Bit }) {
  return <circle cx={x} cy={y} r={4.5} fill={wcol(v)} />;
}

function T({
  x,
  y,
  children,
  size = 17,
  anchor = 'start',
  fill = INK,
  weight = 500,
  mono,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  weight?: number;
  mono?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={size} textAnchor={anchor} fill={fill} fontWeight={weight} fontFamily={mono ? 'var(--mono)' : undefined}>
      {children}
    </text>
  );
}

/** A 0 / 1 label, haloed so it reads on top of a wire. */
function V({ x, y, v, size = 16, anchor = 'middle' }: { x: number; y: number; v: Bit; size?: number; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={700}
      textAnchor={anchor}
      fontFamily="var(--mono)"
      fill={v === 1 ? ON : v === 0 ? '#8e807c' : '#c4b8b4'}
      stroke="#fff"
      strokeWidth={5}
      paintOrder="stroke"
    >
      {v ?? '?'}
    </text>
  );
}

type GK = 'and' | 'or' | 'xor' | 'not' | 'nand' | 'nor';

function Gate({ k, x, y, h = 48, w = 64, v }: { k: GK; x: number; y: number; h?: number; w?: number; v: Bit }) {
  const stroke = v === 1 ? ON : '#7c6f6c';
  const fill = v === 1 ? '#f9ecea' : '#fff';
  const r = h / 2;
  let body: string;
  if (k === 'not') body = `M${x},${y}L${x + 40},${y + r}L${x},${y + h}Z`;
  else if (k === 'and' || k === 'nand') body = `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`;
  else body = `M${x},${y}Q${x + w * 0.62},${y} ${x + w},${y + r}Q${x + w * 0.62},${y + h} ${x},${y + h}Q${x + w * 0.28},${y + r} ${x},${y}Z`;
  const bubble = k === 'not' ? x + 45 : k === 'nand' || k === 'nor' ? x + w + 5 : null;
  return (
    <g>
      {k === 'xor' && <path d={`M${x - 9},${y}Q${x + w * 0.28 - 9},${y + r} ${x - 9},${y + h}`} fill="none" stroke={stroke} strokeWidth={2.2} />}
      <path d={body} fill={fill} stroke={stroke} strokeWidth={2.2} />
      {bubble !== null && <circle cx={bubble} cy={y + r} r={5} fill="#fff" stroke={stroke} strokeWidth={2.2} />}
    </g>
  );
}
/** A rounded multiplexer body with its input numbers. */
function MuxBody({ x, y, w, h, n, v, sel }: { x: number; y: number; w: number; h: number; n: number; v?: Bit; sel?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w / 2} fill={v === 1 ? '#f9ecea' : '#fff'} stroke={v === 1 ? ON : '#7c6f6c'} strokeWidth={2.2} />
      {Array.from({ length: n }, (_, i) => (
        <text key={i} x={x + 9} y={y + (h * (i + 1)) / (n + 1) + 5} fontSize={14} fontWeight={i === sel ? 800 : 500} fill={i === sel ? ON : MUTED}>
          {i}
        </text>
      ))}
    </g>
  );
}

/** A part that can be clicked to zoom into. */
function Zoom({ to, go, label, children }: { to: View; go: Go; label: string; children: ReactNode }) {
  const open = (el: SVGGElement) => go(to, el.getBBox());
  return (
    <g
      className="lz-hit"
      role="button"
      tabIndex={0}
      aria-label={`ซูมเข้าไปดู ${label}`}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(e.currentTarget);
        }
      }}
    >
      <title>{label} — คลิกเพื่อซูมเข้าไป</title>
      {children}
    </g>
  );
}

function Note({ y = 700, children }: { y?: number; children: ReactNode }) {
  return (
    <T x={24} y={y} size={16} fill={MUTED}>
      {children}
    </T>
  );
}

/** x of bit `i` in a 32-bit row, bit 31 on the left */
const col = (i: number) => 1214 - i * 36.5;

// ---------- views ----------

export function LogicView({ view, ctx }: { view: View; ctx: Ctx }) {
  switch (view.k) {
    case 'alu':
      return <AluView {...ctx} />;
    case 'alu1':
      return <Alu1View {...ctx} bit={view.bit} />;
    case 'fa':
      return <FaView {...ctx} bit={view.bit} />;
    case 'xor':
      return <XorView {...ctx} bit={view.bit} n={view.n} />;
    case 'gmux':
      return <GmuxView {...ctx} c={view.ctx} />;
    case 'mux':
      return <MuxView {...ctx} id={view.id} />;
    case 'reg':
      return <RegView {...ctx} id={view.id} />;
    case 'bit':
      return <BitView {...ctx} id={view.id} bit={view.bit} />;
    case 'dff':
      return <DffView {...ctx} id={view.id} bit={view.bit} />;
    case 'regs':
      return <RegsView {...ctx} />;
    case 'dec':
      return <DecView {...ctx} port={view.port} />;
    case 'mem':
      return <MemView {...ctx} />;
    case 'ir':
      return <IrView {...ctx} />;
    case 'sext':
      return <SextView {...ctx} />;
    case 'sl2':
      return <Sl2View {...ctx} id={view.id} />;
    case 'aluctl':
      return <AluCtlView {...ctx} />;
    case 'ctrl':
      return <CtrlView {...ctx} />;
    case 'opdec':
      return <OpdecView {...ctx} />;
    case 'pcen':
      return <PcenView {...ctx} />;
    case 'top':
      return null;
  }
}

function useAlu(cy: Cycle | null) {
  const f = cy?.fn;
  const r = f?.basic && cy?.a !== undefined && cy?.b !== undefined ? aluBits(f, cy.a, cy.b) : null;
  return { f, r };
}

function AluView({ cy, go, fmt }: Ctx) {
  const { f, r } = useAlu(cy);
  const res = cy?.alu;
  return (
    <>
      <T x={24} y={50} size={18} fill={ORANGE} weight={600}>
        {f ? `Ainvert = ${f.ainv} · Bnegate = ${f.bneg} · Operation = ${bin(f.op, 2)} → ${f.name}` : 'ยังไม่มีคำสั่ง'}
      </T>
      <T x={24} y={124} weight={700}>
        A
      </T>
      <T x={24} y={156} weight={700}>
        B
      </T>
      {/* Set: the sign of a − b from bit 31, fed back to bit 0's Less input */}
      <W d={P([col(31) - 13, 262], [26, 262], [26, 412], [1262, 412], [1262, 262], [col(0) + 13, 262])} v={r?.set} />
      <T x={40} y={404} size={14} fill={MUTED}>
        Set (บิตเครื่องหมายของ a − b) → Less ของบิต 0
      </T>
      <W d={P([1270, 310], [col(0) + 13, 310])} v={f?.basic ? f.bneg : undefined} />
      <T x={1270} y={300} size={13} anchor="end" fill={MUTED}>
        CarryIn
      </T>
      {Array.from({ length: 32 }, (_, i) => {
        const x = col(i);
        const b = r?.bits[i];
        return (
          <g key={i}>
            <W d={P([x - 6, 130], [x - 6, 240])} v={bitOf(cy?.a, i)} />
            <W d={P([x + 6, 162], [x + 6, 240])} v={bitOf(cy?.b, i)} />
            <V x={x - 6} y={124} v={bitOf(cy?.a, i)} size={14} />
            <V x={x + 6} y={156} v={bitOf(cy?.b, i)} size={14} />
            {i < 31 && <W d={P([x - 13, 310], [col(i + 1) + 13, 310])} v={b?.cout} />}
            <W d={P([x, 330], [x, 440])} v={bitOf(res, i)} />
            <V x={x} y={392} v={bitOf(res, i)} size={14} />
            <Zoom to={{ k: 'alu1', bit: i }} go={go} label={`ALU บิต ${i}`}>
              <rect x={x - 13} y={240} width={26} height={90} rx={5} fill={bitOf(res, i) === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={1.8} />
              <text x={x} y={290} fontSize={13} textAnchor="middle" fill={INK} fontWeight={600}>
                {i}
              </text>
            </Zoom>
          </g>
        );
      })}
      <rect x={40} y={440} width={1180} height={34} rx={17} fill={cy?.zero === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={1.8} />
      <T x={630} y={463} anchor="middle" size={15} fill={MUTED}>
        NOR ทุกบิตของผลลัพธ์ → Zero
      </T>
      <W d={P([630, 474], [630, 520])} v={cy?.zero} />
      <T x={646} y={512} weight={700}>
        Zero = {cy?.zero ?? '—'}
      </T>
      <T x={24} y={580} size={20} mono>
        A = {val(fmt, cy?.a)}
      </T>
      <T x={24} y={614} size={20} mono>
        B = {val(fmt, cy?.b)}
      </T>
      <T x={24} y={648} size={20} mono weight={700} fill={ON}>
        ผลลัพธ์ = {val(fmt, res)}
      </T>
      <Note>
        {f && !f.basic
          ? `${f.name} ไม่ได้ใช้ ALU 1 บิตต่อกันแบบนี้ (ใช้วงจรเพิ่ม) — ผลลัพธ์ที่แสดงมาจากวงจรนั้น`
          : 'ALU 1 บิต 32 ตัวต่อกัน: CarryOut ของแต่ละบิตเป็น CarryIn ของบิตถัดไป (ripple carry) · คลิกบิตใดก็ได้เพื่อซูมเข้าไป'}
      </Note>
    </>
  );
}

function Alu1View({ cy, go, bit }: Ctx & { bit: number }) {
  const { f, r } = useAlu(cy);
  const x = r?.bits[bit];
  const ainv = f?.basic ? f.ainv : undefined;
  const bneg = f?.basic ? f.bneg : undefined;
  const a = bitOf(cy?.a, bit);
  const b = bitOf(cy?.b, bit);
  const op = f?.basic ? f.op : undefined;
  return (
    <>
      <T x={30} y={180} weight={700}>
        a
      </T>
      <V x={56} y={180} v={a} />
      <W d={P([30, 190], [110, 190])} v={a} />
      <W d={P([110, 190], [110, 165], [300, 165])} v={a} />
      <W d={P([110, 190], [110, 215], [172, 215])} v={a} />
      <Gate k="not" x={170} y={195} h={40} v={NOT(a)} />
      <W d={P([220, 215], [300, 215])} v={NOT(a)} />
      <V x={262} y={207} v={NOT(a)} />
      <W d={P([320, 70], [320, 135])} v={ainv} ctrl />
      <T x={320} y={60} anchor="middle" fill={ORANGE} weight={600} size={16}>
        Ainvert = {ainv ?? '—'}
      </T>
      <Zoom to={{ k: 'gmux', ctx: { src: 'ainv', bit } }} go={go} label="Mux Ainvert">
        <MuxBody x={300} y={135} w={40} h={110} n={2} v={x?.ai} sel={ainv} />
      </Zoom>

      <T x={30} y={410} weight={700}>
        b
      </T>
      <V x={56} y={410} v={b} />
      <W d={P([30, 420], [110, 420])} v={b} />
      <W d={P([110, 420], [110, 395], [300, 395])} v={b} />
      <W d={P([110, 420], [110, 445], [172, 445])} v={b} />
      <Gate k="not" x={170} y={425} h={40} v={NOT(b)} />
      <W d={P([220, 445], [300, 445])} v={NOT(b)} />
      <V x={262} y={437} v={NOT(b)} />
      <W d={P([320, 310], [320, 365])} v={bneg} ctrl />
      <T x={320} y={300} anchor="middle" fill={ORANGE} weight={600} size={16}>
        Binvert = {bneg ?? '—'}
      </T>
      <Zoom to={{ k: 'gmux', ctx: { src: 'binv', bit } }} go={go} label="Mux Binvert">
        <MuxBody x={300} y={365} w={40} h={110} n={2} v={x?.bi} sel={bneg} />
      </Zoom>

      {/* a' and b' fan out to AND, OR and the adder */}
      <W d={P([340, 190], [420, 190])} v={x?.ai} />
      <W d={P([420, 190], [420, 126], [530, 126])} v={x?.ai} />
      <W d={P([420, 190], [420, 340], [520, 340])} v={x?.ai} />
      <W d={P([420, 216], [530, 216])} v={x?.ai} />
      <W d={P([340, 420], [520, 420])} v={x?.bi} />
      <W d={P([460, 420], [460, 142], [530, 142])} v={x?.bi} />
      <W d={P([460, 232], [530, 232])} v={x?.bi} />
      <Dot x={420} y={190} v={x?.ai} />
      <Dot x={420} y={216} v={x?.ai} />
      <Dot x={460} y={420} v={x?.bi} />
      <Dot x={460} y={232} v={x?.bi} />
      <V x={380} y={182} v={x?.ai} />
      <V x={380} y={412} v={x?.bi} />
      <Gate k="and" x={520} y={110} v={x?.and} />
      <Gate k="or" x={520} y={200} v={x?.or} />
      <W d={P([600, 40], [600, 300])} v={x?.cin} />
      <T x={612} y={44} size={16} weight={600}>
        CarryIn = {x?.cin ?? '—'}
      </T>
      <Zoom to={{ k: 'fa', bit }} go={go} label="Full adder">
        <rect x={520} y={300} width={130} height={170} rx={12} fill={x?.sum === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={2.2} />
        <text x={585} y={398} fontSize={44} textAnchor="middle" fill={INK}>
          +
        </text>
        <text x={585} y={450} fontSize={13} textAnchor="middle" fill={MUTED}>
          full adder
        </text>
      </Zoom>
      <W d={P([585, 470], [585, 560])} v={x?.cout} />
      <T x={600} y={560} size={16} weight={600}>
        CarryOut = {x?.cout ?? '—'}
      </T>
      <W d={P([584, 134], [700, 134], [700, 170], [780, 170])} v={x?.and} />
      <W d={P([584, 224], [720, 224], [720, 290], [780, 290])} v={x?.or} />
      <W d={P([650, 385], [740, 385], [740, 410], [780, 410])} v={x?.sum} />
      <V x={660} y={126} v={x?.and} />
      <V x={660} y={216} v={x?.or} />
      <V x={690} y={377} v={x?.sum} />
      <T x={30} y={612} weight={700}>
        Less
      </T>
      <V x={84} y={612} v={x?.less} />
      <W d={P([30, 620], [760, 620], [760, 530], [780, 530])} v={x?.less} />
      <W d={P([804, 60], [804, 120])} v={op === undefined ? undefined : +(op > 0)} ctrl />
      <T x={816} y={56} fill={ORANGE} weight={600} size={16}>
        Operation = {op === undefined ? '—' : bin(op, 2)}
      </T>
      <Zoom to={{ k: 'gmux', ctx: { src: 'op', bit } }} go={go} label="Mux เลือกผลลัพธ์">
        <MuxBody x={780} y={120} w={48} h={460} n={4} v={x?.res} sel={op} />
      </Zoom>
      <W d={P([828, 350], [960, 350])} v={x?.res} />
      <T x={975} y={357} size={20} weight={700}>
        Result = {x?.res ?? '—'}
      </T>
      <Note>
        {!r
          ? f && !f.basic
            ? `${f.name} ไม่ได้ผ่าน ALU 1 บิตแบบนี้`
            : 'ALU ยังไม่มีอินพุตใน cycle นี้'
          : bit === 0
            ? 'บิต 0: Less มาจาก Set ของบิต 31 · CarryIn = Bnegate (ลบ = บวกกับ NOT b แล้ว +1)'
            : bit === 31
              ? 'บิต 31 ยังส่ง Set (Sum ของบิตนี้ แก้ overflow แล้ว) กลับไปเป็น Less ของบิต 0 สำหรับ slt'
              : `บิต ${bit}: Less = 0 เสมอ · CarryIn มาจาก CarryOut ของบิต ${bit - 1}`}
      </Note>
    </>
  );
}

function FaView({ cy, go, bit }: Ctx & { bit: number }) {
  const { r } = useAlu(cy);
  const x = r?.bits[bit];
  const p = XOR(x?.ai, x?.bi);
  const g = AND(x?.ai, x?.bi);
  const t = AND(p, x?.cin);
  return (
    <>
      <T x={30} y={192} weight={700}>
        a
      </T>
      <V x={56} y={192} v={x?.ai} />
      <W d={P([30, 200], [230, 200], [230, 240], [350, 240])} v={x?.ai} />
      <W d={P([230, 240], [230, 380], [570, 380])} v={x?.ai} />
      <Dot x={230} y={240} v={x?.ai} />
      <T x={30} y={292} weight={700}>
        b
      </T>
      <V x={56} y={292} v={x?.bi} />
      <W d={P([30, 300], [270, 300], [270, 260], [350, 260])} v={x?.bi} />
      <W d={P([270, 300], [270, 400], [570, 400])} v={x?.bi} />
      <Dot x={270} y={300} v={x?.bi} />
      <T x={30} y={552} weight={700}>
        CarryIn
      </T>
      <V x={110} y={552} v={x?.cin} />
      <W d={P([30, 560], [660, 560], [660, 290], [720, 290])} v={x?.cin} />
      <W d={P([660, 520], [730, 520])} v={x?.cin} />
      <Dot x={660} y={520} v={x?.cin} />
      <W d={P([404, 250], [620, 250], [620, 270], [720, 270])} v={p} />
      <W d={P([620, 270], [620, 500], [730, 500])} v={p} />
      <Dot x={620} y={270} v={p} />
      <V x={510} y={242} v={p} />
      <Zoom to={{ k: 'xor', bit, n: 1 }} go={go} label="XOR ตัวแรก">
        <Gate k="xor" x={340} y={220} h={60} v={p} />
      </Zoom>
      <Zoom to={{ k: 'xor', bit, n: 2 }} go={go} label="XOR ตัวที่สอง">
        <Gate k="xor" x={710} y={250} h={60} v={x?.sum} />
      </Zoom>
      <Gate k="and" x={560} y={360} h={60} v={g} />
      <Gate k="and" x={720} y={480} h={60} v={t} />
      <W d={P([624, 390], [860, 390], [860, 440], [910, 440])} v={g} />
      <W d={P([784, 510], [860, 510], [860, 460], [910, 460])} v={t} />
      <V x={760} y={382} v={g} />
      <V x={820} y={502} v={t} />
      <Gate k="or" x={900} y={420} h={60} v={x?.cout} />
      <W d={P([774, 280], [1000, 280])} v={x?.sum} />
      <W d={P([964, 450], [1000, 450])} v={x?.cout} />
      <T x={1012} y={287} size={20} weight={700}>
        Sum = {x?.sum ?? '—'}
      </T>
      <T x={1012} y={457} size={20} weight={700}>
        CarryOut = {x?.cout ?? '—'}
      </T>
      <T x={24} y={630} size={19} mono>
        Sum = a ⊕ b ⊕ CarryIn
      </T>
      <T x={24} y={664} size={19} mono>
        CarryOut = a·b + (a ⊕ b)·CarryIn
      </T>
      <Note>full adder ของบิต {bit} — เกตพื้นฐาน 5 ตัว · คลิก XOR เพื่อดูว่าสร้างจาก AND / OR / NOT อย่างไร</Note>
    </>
  );
}

function XorView({ cy, bit, n }: Ctx & { bit: number; n: 1 | 2 }) {
  const { r } = useAlu(cy);
  const b = r?.bits[bit];
  const xv = n === 1 ? b?.ai : XOR(b?.ai, b?.bi);
  const yv = n === 1 ? b?.bi : b?.cin;
  const a1 = AND(xv, NOT(yv));
  const a2 = AND(NOT(xv), yv);
  return (
    <>
      <T x={30} y={182} weight={700}>
        {n === 1 ? 'a' : 'a ⊕ b'}
      </T>
      <V x={n === 1 ? 56 : 100} y={182} v={xv} />
      <W d={P([30, 190], [570, 190])} v={xv} />
      <W d={P([200, 190], [200, 390], [262, 390])} v={xv} />
      <Dot x={200} y={190} v={xv} />
      <Gate k="not" x={260} y={370} h={40} v={NOT(xv)} />
      <W d={P([310, 390], [470, 390], [470, 450], [570, 450])} v={NOT(xv)} />
      <T x={30} y={462} weight={700}>
        {n === 1 ? 'b' : 'CarryIn'}
      </T>
      <V x={n === 1 ? 56 : 110} y={462} v={yv} />
      <W d={P([30, 470], [570, 470])} v={yv} />
      <W d={P([240, 470], [240, 270], [262, 270])} v={yv} />
      <Dot x={240} y={470} v={yv} />
      <Gate k="not" x={260} y={250} h={40} v={NOT(yv)} />
      <W d={P([310, 270], [440, 270], [440, 210], [570, 210])} v={NOT(yv)} />
      <V x={380} y={262} v={NOT(yv)} />
      <V x={380} y={382} v={NOT(xv)} />
      <Gate k="and" x={560} y={170} h={60} v={a1} />
      <Gate k="and" x={560} y={430} h={60} v={a2} />
      <W d={P([624, 200], [760, 200], [760, 310], [870, 310])} v={a1} />
      <W d={P([624, 460], [760, 460], [760, 330], [870, 330])} v={a2} />
      <V x={700} y={192} v={a1} />
      <V x={700} y={452} v={a2} />
      <Gate k="or" x={860} y={290} h={60} v={XOR(xv, yv)} />
      <W d={P([924, 320], [1040, 320])} v={XOR(xv, yv)} />
      <T x={1052} y={327} size={20} weight={700}>
        ออก = {XOR(xv, yv) ?? '—'}
      </T>
      <T x={24} y={630} size={19} mono>
        x ⊕ y = x·ȳ + x̄·y
      </T>
      <Note>XOR ให้ 1 เมื่ออินพุตต่างกัน — สร้างจาก NOT 2 ตัว, AND 2 ตัว และ OR 1 ตัว (ระดับล่างสุดคือเกตพื้นฐาน)</Note>
    </>
  );
}

function gmuxValues(c: GmuxCtx, cy: Cycle | null, s: StepInfo | null, regs?: ArrayLike<number>) {
  if (c.src === 'word') {
    const m = cy ? muxWord(c.id, cy) : null;
    const n = c.id === 'muxB' || c.id === 'muxPC' ? 4 : 2;
    const ins = Array.from({ length: n }, (_, i) => (m && i < m.ins.length ? bitOf(m.ins[i].v, c.bit) : undefined));
    const names = Array.from({ length: n }, (_, i) => (m && i < m.ins.length ? m.ins[i].label : 'ไม่ใช้'));
    const sel = m ? m.sel : undefined;
    return { ins, names, sel, selName: m?.sig ?? 'select', title: `${MUX_NAME[c.id]} · บิต ${c.bit}` };
  }
  if (c.src === 'en') {
    const r = cy ? regCtx(c.reg, cy, s, regs) : null;
    return { ins: [bitOf(r?.q, c.bit), bitOf(r?.din, c.bit)], names: ['Q (ค่าเดิม)', 'D (ค่าใหม่)'], sel: r?.en, selName: 'Write', title: `${regName(c.reg)} · บิต ${c.bit}` };
  }
  const f = cy?.fn;
  const r = f?.basic && cy?.a !== undefined && cy?.b !== undefined ? aluBits(f, cy.a, cy.b) : null;
  const x = r?.bits[c.bit];
  if (c.src === 'op')
    return { ins: [x?.and, x?.or, x?.sum, x?.less], names: ['AND', 'OR', 'Sum', 'Less'], sel: r ? f!.op : undefined, selName: 'Operation', title: `ALU บิต ${c.bit}` };
  const v = c.src === 'ainv' ? bitOf(cy?.a, c.bit) : bitOf(cy?.b, c.bit);
  const nm = c.src === 'ainv' ? 'a' : 'b';
  return { ins: [v, NOT(v)], names: [nm, `NOT ${nm}`], sel: r ? (c.src === 'ainv' ? f!.ainv : f!.bneg) : undefined, selName: c.src === 'ainv' ? 'Ainvert' : 'Binvert', title: `ALU บิต ${c.bit}` };
}

function GmuxView({ cy, s, regs, c }: Ctx & { c: GmuxCtx }) {
  const m = gmuxValues(c, cy, s, regs);
  const out = m.sel === undefined ? undefined : m.ins[m.sel];
  if (m.ins.length === 2) {
    const sv: Bit = m.sel;
    const a0 = AND(m.ins[0], NOT(sv));
    const a1 = AND(m.ins[1], sv);
    return (
      <>
        <T x={30} y={170} weight={700}>
          0: {m.names[0]}
        </T>
        <V x={40} y={204} v={m.ins[0]} anchor="start" />
        <W d={P([30, 180], [570, 180])} v={m.ins[0]} />
        <T x={30} y={460} weight={700}>
          1: {m.names[1]}
        </T>
        <V x={40} y={494} v={m.ins[1]} anchor="start" />
        <W d={P([30, 470], [570, 470])} v={m.ins[1]} />
        <T x={30} y={630} weight={700} fill={ORANGE}>
          {m.selName} = {sv ?? '—'}
        </T>
        <W d={P([30, 640], [336, 640])} v={sv} />
        <W d={P([250, 640], [250, 490], [570, 490])} v={sv} />
        <Dot x={250} y={640} v={sv} />
        <Gate k="not" x={330} y={620} h={40} v={NOT(sv)} />
        <W d={P([380, 640], [440, 640], [440, 200], [570, 200])} v={NOT(sv)} />
        <V x={460} y={420} v={NOT(sv)} />
        <Gate k="and" x={560} y={160} h={60} v={a0} />
        <Gate k="and" x={560} y={450} h={60} v={a1} />
        <W d={P([624, 190], [760, 190], [760, 320], [870, 320])} v={a0} />
        <W d={P([624, 480], [760, 480], [760, 340], [870, 340])} v={a1} />
        <V x={700} y={182} v={a0} />
        <V x={700} y={472} v={a1} />
        <Gate k="or" x={860} y={300} h={60} v={out} />
        <W d={P([924, 330], [1040, 330])} v={out} />
        <T x={1052} y={337} size={20} weight={700}>
          ออก = {out ?? '—'}
        </T>
        <T x={24} y={560} size={19} mono>
          ออก = in0·S̄ + in1·S
        </T>
        <Note>{m.title} — mux 2 ทางคือ AND 2 ตัวที่ “เปิดทาง” ให้อินพุตเดียว แล้ว OR รวมกัน</Note>
      </>
    );
  }
  const s1: Bit = m.sel === undefined ? undefined : (m.sel >> 1) & 1;
  const s0: Bit = m.sel === undefined ? undefined : m.sel & 1;
  const rows = [90, 205, 320, 435];
  const ands = rows.map((_, i) => AND(m.ins[i], (i >> 1) & 1 ? s1 : NOT(s1), i & 1 ? s0 : NOT(s0)));
  const rail = { s1: 300, ns1: 350, s0: 420, ns0: 470 };
  return (
    <>
      <W d={P([30, 575], [300, 575], [300, 60])} v={s1} />
      <W d={P([180, 575], [180, 614], [232, 614])} v={s1} />
      <Dot x={180} y={575} v={s1} />
      <Gate k="not" x={230} y={598} h={32} v={NOT(s1)} />
      <W d={P([280, 614], [350, 614], [350, 60])} v={NOT(s1)} />
      <W d={P([30, 650], [420, 650], [420, 60])} v={s0} />
      <W d={P([160, 650], [160, 688], [232, 688])} v={s0} />
      <Dot x={160} y={650} v={s0} />
      <Gate k="not" x={230} y={672} h={32} v={NOT(s0)} />
      <W d={P([280, 688], [470, 688], [470, 60])} v={NOT(s0)} />
      <T x={30} y={567} weight={700} fill={ORANGE} size={15}>
        {m.selName}[1] = {s1 ?? '—'}
      </T>
      <T x={30} y={642} weight={700} fill={ORANGE} size={15}>
        {m.selName}[0] = {s0 ?? '—'}
      </T>
      {[
        ['S1', rail.s1],
        ['S̄1', rail.ns1],
        ['S0', rail.s0],
        ['S̄0', rail.ns0],
      ].map(([l, x]) => (
        <T key={l} x={x as number} y={50} anchor="middle" size={14} fill={MUTED}>
          {l}
        </T>
      ))}
      {rows.map((y, i) => {
        const r1 = (i >> 1) & 1 ? rail.s1 : rail.ns1;
        const r0 = i & 1 ? rail.s0 : rail.ns0;
        const v1 = (i >> 1) & 1 ? s1 : NOT(s1);
        const v0 = i & 1 ? s0 : NOT(s0);
        const ox = 780 + i * 22;
        const pin = 190 + (180 * (i + 1)) / 5;
        return (
          <g key={i}>
            <T x={30} y={y - 22} size={15} weight={600}>
              {i}: {m.names[i]}
            </T>
            <V x={20} y={y - 9} v={m.ins[i]} anchor="start" size={14} />
            <W d={P([30, y - 15], [630, y - 15])} v={m.ins[i]} />
            <W d={P([r1, y], [630, y])} v={v1} />
            <W d={P([r0, y + 15], [630, y + 15])} v={v0} />
            <Dot x={r1} y={y} v={v1} />
            <Dot x={r0} y={y + 15} v={v0} />
            <Gate k="and" x={620} y={y - 30} h={60} v={ands[i]} />
            <W d={P([684, y], [ox, y], [ox, pin], [910, pin])} v={ands[i]} />
          </g>
        );
      })}
      <Gate k="or" x={900} y={190} h={180} w={80} v={out} />
      <W d={P([980, 280], [1060, 280])} v={out} />
      <T x={1070} y={287} size={20} weight={700}>
        ออก = {out ?? '—'}
      </T>
      <Note>{m.title} — mux 4 ทาง: AND 3 อินพุตแต่ละตัวผ่านได้เมื่อ select ตรงกับเลขแถว แล้ว OR ทั้งสี่รวมกัน</Note>
    </>
  );
}

function MuxView({ cy, go, fmt, id }: Ctx & { id: MuxId }) {
  const m = cy ? muxWord(id, cy) : null;
  const n = m?.ins.length ?? (id === 'muxB' ? 4 : id === 'muxPC' ? 3 : 2);
  const show = (v: number | undefined) => (id === 'muxR' ? (v === undefined ? '—' : `$${RN[v]} (${v})`) : val(fmt, v));
  const width = id === 'muxR' ? 5 : 32;
  const cell = (i: number) => (width === 32 ? col(i) : 760 - i * 80);
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const y = 100 + (380 * (i + 1)) / (n + 1);
        const on = m?.sel === i;
        return (
          <g key={i}>
            <W d={P([380, y], [560, y])} v={on ? 1 : 0} />
            <T x={30} y={y - 8} weight={600} fill={on ? ON : INK}>
              {i}: {m?.ins[i].label ?? ''}
            </T>
            <T x={30} y={y + 18} mono size={16} fill={on ? ON : MUTED}>
              {show(m?.ins[i].v)}
            </T>
          </g>
        );
      })}
      <MuxBody x={560} y={100} w={70} h={380} n={n} v={1} sel={m?.sel} />
      <W d={P([595, 540], [595, 480])} v={m?.sel ? 1 : 0} ctrl />
      <T x={595} y={566} anchor="middle" fill={ORANGE} weight={700}>
        {m ? `${m.sig} = ${bin(m.sel, m.selBits)}` : 'select'}
      </T>
      <W d={P([630, 290], [820, 290])} v={1} />
      <T x={836} y={282} weight={600}>
        ออก
      </T>
      <T x={836} y={310} mono size={20} weight={700} fill={ON}>
        {show(m?.out)}
      </T>
      <T x={24} y={612} size={15} fill={MUTED}>
        ข้างในคือ mux 1 บิต × {width} ตัว ใช้ select เดียวกัน — คลิกบิตเพื่อดูระดับเกต
      </T>
      {Array.from({ length: width }, (_, i) => {
        const v = bitOf(m?.out, i);
        return (
          <Zoom key={i} to={{ k: 'gmux', ctx: { src: 'word', id, bit: i } }} go={go} label={`บิต ${i}`}>
            <rect x={cell(i) - 13} y={630} width={26} height={44} rx={13} fill={v === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={1.6} />
            <V x={cell(i)} y={658} v={v} size={14} />
            <text x={cell(i)} y={692} fontSize={11} textAnchor="middle" fill={MUTED}>
              {i}
            </text>
          </Zoom>
        );
      })}
    </>
  );
}

function RegView({ cy, s, go, fmt, regs, id }: Ctx & { id: RegId }) {
  const r = cy ? regCtx(id, cy, s, regs) : null;
  const x = (i: number) => 1230 - i * 35;
  const after = r ? (r.en ? r.din : r.q) : undefined;
  return (
    <>
      <T x={24} y={60} size={19} weight={600}>
        {regName(id)}: D flip-flop 32 ตัว เปลี่ยนค่าพร้อมกันที่ขอบสัญญาณนาฬิกา
      </T>
      <T x={20} y={176} size={15} weight={600}>
        D (เข้า)
      </T>
      <T x={20} y={416} size={15} weight={600}>
        Q (ออก)
      </T>
      <W d={P([20, 222], [1250, 222])} v={r?.en} ctrl />
      <T x={20} y={214} size={13} fill={ORANGE} weight={700}>
        Write = {r?.en ?? '—'}
      </T>
      <W d={P([20, 348], [1250, 348])} v={0} />
      <T x={20} y={342} size={13} fill={MUTED}>
        clk
      </T>
      {Array.from({ length: 32 }, (_, i) => {
        const d = bitOf(r?.din, i);
        const q = bitOf(r?.q, i);
        return (
          <g key={i}>
            <V x={x(i)} y={176} v={d} size={14} />
            <W d={P([x(i), 184], [x(i), 240])} v={d} />
            <W d={P([x(i), 330], [x(i), 396])} v={q} />
            <V x={x(i)} y={416} v={q} size={14} />
            <Zoom to={{ k: 'bit', id, bit: i }} go={go} label={`บิต ${i}`}>
              <rect x={x(i) - 13} y={240} width={26} height={90} rx={4} fill={q === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={1.6} />
              <text x={x(i)} y={290} fontSize={12} textAnchor="middle" fill={INK} fontWeight={600}>
                {i}
              </text>
            </Zoom>
          </g>
        );
      })}
      <T x={24} y={490} size={20} mono>
        Q (ตอนนี้) = {id === 'ir' && r?.q !== undefined ? addr(r.q) : val(fmt, r?.q)}
      </T>
      <T x={24} y={526} size={20} mono>
        D (เข้า) = {id === 'ir' && r?.din !== undefined ? addr(r.din) : val(fmt, r?.din)}
      </T>
      <T x={24} y={566} size={17} fill={ORANGE} weight={600}>
        {r?.enName} = {r?.en ?? '—'}
      </T>
      <T x={24} y={604} size={18} weight={700} fill={r?.en ? ON : MUTED}>
        {!r ? '' : r.en ? `ที่ขอบสัญญาณนาฬิกาตอนจบ cycle → Q = ${id === 'ir' ? addr(after) : val(fmt, after)}` : 'ไม่เขียน — Q คงค่าเดิม'}
      </T>
      {id === 'r0' && <Note y={650}>$zero ต่อสายไว้กับ 0 เสมอ — เขียนอะไรลงไปก็ไม่เปลี่ยน</Note>}
      {r && (r.q === undefined || r.din === undefined) && <Note y={650}>? = ค่าที่ค้างมาจากคำสั่งก่อนหน้า / ยังไม่มีค่าใน cycle นี้</Note>}
      <Note>คลิกบิตใดก็ได้เพื่อดู mux เลือกเขียน + D flip-flop ของบิตนั้น</Note>
      {id === 'pc' && (
        <Zoom to={{ k: 'pcen' }} go={go} label="วงจร PC write enable">
          <rect x={960} y={470} width={280} height={60} rx={12} fill="#fff" stroke={ORANGE} strokeWidth={2} />
          <text x={1100} y={507} fontSize={16} textAnchor="middle" fill={INK}>
            วงจร PC write enable ›
          </text>
        </Zoom>
      )}
    </>
  );
}

function BitView({ cy, s, go, regs, id, bit }: Ctx & { id: RegId; bit: number }) {
  const r = cy ? regCtx(id, cy, s, regs) : null;
  const q = bitOf(r?.q, bit);
  const d = bitOf(r?.din, bit);
  const en: Bit = r?.en;
  const m = en === undefined ? undefined : en ? d : q;
  return (
    <>
      <W d={P([880, 280], [880, 130], [340, 130], [340, 240], [400, 240])} v={q} />
      <Dot x={880} y={280} v={q} />
      <T x={360} y={120} size={14} fill={MUTED}>
        Q ย้อนกลับมา (ถ้าไม่เขียนก็เก็บค่าเดิม)
      </T>
      <T x={30} y={310} weight={700}>
        D (ค่าใหม่)
      </T>
      <V x={140} y={310} v={d} />
      <W d={P([30, 320], [400, 320])} v={d} />
      <Zoom to={{ k: 'gmux', ctx: { src: 'en', reg: id, bit } }} go={go} label="Mux เลือกเขียน">
        <MuxBody x={400} y={200} w={50} h={160} n={2} v={m} sel={en} />
      </Zoom>
      <W d={P([425, 440], [425, 360])} v={en} ctrl />
      <T x={425} y={466} anchor="middle" weight={700} fill={ORANGE}>
        Write = {en ?? '—'}
      </T>
      <W d={P([450, 280], [600, 280])} v={m} />
      <V x={525} y={272} v={m} />
      <Zoom to={{ k: 'dff', id, bit }} go={go} label="D flip-flop">
        <rect x={600} y={200} width={170} height={160} rx={10} fill={q === 1 ? '#f9ecea' : '#fff'} stroke="#7c6f6c" strokeWidth={2.2} />
        <text x={612} y={286} fontSize={16} fill={INK}>
          D
        </text>
        <text x={758} y={286} fontSize={16} fill={INK} textAnchor="end">
          Q
        </text>
        <text x={685} y={240} fontSize={15} fill={MUTED} textAnchor="middle">
          D flip-flop
        </text>
        <path d={P([600, 326], [616, 338], [600, 350])} fill="none" stroke="#7c6f6c" strokeWidth={2} />
      </Zoom>
      <W d={P([520, 338], [600, 338])} v={0} />
      <T x={510} y={344} anchor="end" size={15} fill={MUTED}>
        clk
      </T>
      <W d={P([770, 280], [1000, 280])} v={q} />
      <T x={1012} y={287} size={20} weight={700}>
        Q = {q ?? '—'}
      </T>
      <T x={24} y={600} size={18}>
        {en === 1 ? `Write = 1: mux ส่ง D (${d ?? '?'}) เข้า flip-flop → หลังขอบนาฬิกา Q = ${d ?? '?'}` : en === 0 ? `Write = 0: mux ส่ง Q เดิม (${q ?? '?'}) วนกลับ → ค่าไม่เปลี่ยน` : ''}
      </T>
      <Note>
        {regName(id)} บิต {bit} · คลิก mux หรือ D flip-flop เพื่อซูมลงไปอีก
      </Note>
    </>
  );
}

/** A D latch out of NAND gates: transparent while C = 1, holding while C = 0. */
function Latch({ ox, oy, d, c, q, label }: { ox: number; oy: number; d: Bit; c: Bit; q: Bit; label: string }) {
  const n1 = NOT(AND(d, c));
  const n2 = NOT(AND(NOT(d), c));
  const qb = NOT(q);
  return (
    <g>
      <rect x={ox - 14} y={oy - 4} width={480} height={316} rx={14} fill="none" stroke="#d9cfca" strokeDasharray="6 5" strokeWidth={1.6} />
      <T x={ox} y={oy + 20} size={14} fill={MUTED}>
        {label}
      </T>
      <W d={P([ox - 40, oy + 50], [ox + 160, oy + 50])} v={d} />
      <W d={P([ox + 20, oy + 50], [ox + 20, oy + 220], [ox + 44, oy + 220])} v={d} />
      <Dot x={ox + 20} y={oy + 50} v={d} />
      <Gate k="not" x={ox + 40} y={oy + 200} h={40} v={NOT(d)} />
      <W d={P([ox + 90, oy + 220], [ox + 110, oy + 220], [ox + 110, oy + 230], [ox + 160, oy + 230])} v={NOT(d)} />
      <W d={P([ox + 130, oy + 312], [ox + 130, oy + 70], [ox + 160, oy + 70])} v={c} />
      <W d={P([ox + 130, oy + 210], [ox + 160, oy + 210])} v={c} />
      <Dot x={ox + 130} y={oy + 210} v={c} />
      <Gate k="nand" x={ox + 150} y={oy + 30} h={60} v={n1} />
      <Gate k="nand" x={ox + 150} y={oy + 190} h={60} v={n2} />
      <W d={P([ox + 224, oy + 60], [ox + 320, oy + 60])} v={n1} />
      <W d={P([ox + 224, oy + 220], [ox + 320, oy + 220])} v={n2} />
      <W d={P([ox + 404, oy + 70], [ox + 404, oy + 130], [ox + 290, oy + 130], [ox + 290, oy + 200], [ox + 320, oy + 200])} v={q} />
      <W d={P([ox + 384, oy + 210], [ox + 420, oy + 210], [ox + 420, oy + 150], [ox + 300, oy + 150], [ox + 300, oy + 80], [ox + 320, oy + 80])} v={qb} />
      <Gate k="nand" x={ox + 310} y={oy + 40} h={60} v={q} />
      <Gate k="nand" x={ox + 310} y={oy + 180} h={60} v={qb} />
      <W d={P([ox + 384, oy + 70], [ox + 470, oy + 70])} v={q} />
      <Dot x={ox + 404} y={oy + 70} v={q} />
      <V x={ox + 250} y={oy + 52} v={n1} size={14} />
      <V x={ox + 250} y={oy + 212} v={n2} size={14} />
      <V x={ox + 440} y={oy + 62} v={q} size={14} />
    </g>
  );
}

function DffView({ cy, s, regs, id, bit }: Ctx & { id: RegId; bit: number }) {
  const [hi, setHi] = useState(true);
  const r = cy ? regCtx(id, cy, s, regs) : null;
  const q = bitOf(r?.q, bit);
  const dIn: Bit = r === null ? undefined : r.en ? bitOf(r.din, bit) : q;
  const clk = hi ? 1 : 0;
  // master follows D while clk = 1 and keeps it after; slave opens once clk falls
  const qm = dIn;
  const qs = hi ? q : qm;
  return (
    <>
      <T x={20} y={162} weight={700}>
        D
      </T>
      <V x={44} y={162} v={dIn} />
      <Latch ox={90} oy={120} d={dIn} c={clk} q={qm} label="D latch (master) — เปิดเมื่อ clk = 1" />
      <W d={P([560, 190], [600, 190], [600, 170], [610, 170])} v={qm} />
      <Latch ox={650} oy={120} d={qm} c={NOT(clk)} q={qs} label="D latch (slave) — เปิดเมื่อ clk = 0" />
      <W d={P([1120, 190], [1180, 190])} v={qs} />
      <T x={1186} y={197} size={20} weight={700}>
        Q = {qs ?? '—'}
      </T>
      <T x={20} y={512} weight={700}>
        clk = {clk}
      </T>
      <W d={P([20, 520], [220, 520], [220, 432])} v={clk} />
      <W d={P([220, 520], [602, 520])} v={clk} />
      <Dot x={220} y={520} v={clk} />
      <Gate k="not" x={600} y={500} h={40} v={NOT(clk)} />
      <W d={P([650, 520], [780, 520], [780, 432])} v={NOT(clk)} />
      <g className="lz-hit" role="button" tabIndex={0} onClick={() => setHi((v) => !v)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setHi((v) => !v)}>
        <rect x={900} y={490} width={340} height={56} rx={28} fill="var(--m)" />
        <text x={1070} y={525} fontSize={17} fill="#fff" textAnchor="middle" fontWeight={600}>
          {hi ? 'ให้ clk ตกเป็น 0 (ขอบขาลง) ›' : '‹ กลับไป clk = 1'}
        </text>
      </g>
      <T x={24} y={610} size={18}>
        {hi
          ? `clk = 1: master เปิด รับ D = ${dIn ?? '?'} ตามทันที · slave ปิดอยู่จึงยังส่ง Q เดิม = ${q ?? '?'}`
          : `clk ตกเป็น 0: master ล็อกค่า ${qm ?? '?'} ไว้ · slave เปิดรับ → Q = ${qs ?? '?'}`}
      </T>
      <Note>D flip-flop แบบ master–slave: เปลี่ยนค่าเฉพาะตอนขอบนาฬิกา · D latch แต่ละตัวคือ NAND 4 ตัว + NOT 1 ตัว (ระดับล่างสุด)</Note>
    </>
  );
}

function RegsView({ cy, s, go, fmt, regs }: Ctx) {
  const f = cy?.ir === undefined ? null : fields(cy.ir);
  const rw = cy?.ctrl.RegWrite ?? 0;
  const wr = cy?.wr;
  const before = (k: number) => (k === 0 ? 0 : (s?.changes.find((x) => x.k === RN[k])?.o ?? regs?.[k]));
  const cellX = (k: number) => 380 + Math.floor(k / 8) * 135;
  const cellY = (k: number) => 60 + (k % 8) * 76;
  const reading = (k: number) => !!f && (k === f.rs || k === f.rt);
  return (
    <>
      <T x={20} y={34} size={15} weight={600}>
        Read register 1 = {f ? `$${RN[f.rs]} (${f.rs})` : '—'}
      </T>
      <W d={P([300, 40], [1000, 40], [1000, 70])} v={f ? 1 : undefined} />
      <T x={20} y={712} size={15} weight={600}>
        Read register 2 = {f ? `$${RN[f.rt]} (${f.rt})` : '—'}
      </T>
      <W d={P([300, 702], [1000, 702], [1000, 580])} v={f ? 1 : undefined} />
      {Array.from({ length: 32 }, (_, k) => {
        const x = cellX(k);
        const y = cellY(k);
        const w = !!rw && wr === k;
        const rd = reading(k);
        return (
          <Zoom key={k} to={{ k: 'reg', id: `r${k}` }} go={go} label={`$${RN[k]}`}>
            <rect x={x} y={y} width={125} height={70} rx={8} fill={w ? '#f6dcd8' : rd ? '#f9ecea' : '#fff'} stroke={w || rd ? ON : '#cfc4bf'} strokeWidth={w || rd ? 2.4 : 1.4} />
            <text x={x + 10} y={y + 22} fontSize={15} fontWeight={700} fill={k === 0 ? MUTED : INK}>
              ${RN[k]}
            </text>
            <text x={x + 115} y={y + 22} fontSize={12} textAnchor="end" fill={MUTED}>
              {k}
            </text>
            <text x={x + 10} y={y + 44} fontSize={14} fontFamily="var(--mono)" fill={INK}>
              {val(fmt, before(k))}
            </text>
            {w && cy?.wd !== undefined && (
              <text x={x + 10} y={y + 63} fontSize={13} fontFamily="var(--mono)" fontWeight={700} fill={ON}>
                ← {fmt(cy.wd)}
              </text>
            )}
          </Zoom>
        );
      })}
      <W d={P([920, 185], [960, 185])} v={f ? 1 : undefined} />
      <W d={P([920, 465], [960, 465])} v={f ? 1 : undefined} />
      {(['r1', 'r2'] as const).map((p, i) => (
        <Zoom key={p} to={{ k: 'dec', port: p }} go={go} label={`Mux อ่าน ${i + 1}`}>
          <rect x={960} y={i ? 350 : 70} width={80} height={230} rx={40} fill="#fff" stroke="#7c6f6c" strokeWidth={2.2} />
          <text x={1000} y={(i ? 350 : 70) + 120} fontSize={14} textAnchor="middle" fill={INK}>
            32→1
          </text>
        </Zoom>
      ))}
      <W d={P([1040, 185], [1250, 185])} v={f ? 1 : undefined} />
      <W d={P([1040, 465], [1250, 465])} v={f ? 1 : undefined} />
      <T x={1054} y={174} size={15} weight={600}>
        Read data 1
      </T>
      <T x={1054} y={212} size={16} mono weight={700} fill={ON}>
        {val(fmt, cy?.rd1)}
      </T>
      <T x={1054} y={454} size={15} weight={600}>
        Read data 2
      </T>
      <T x={1054} y={492} size={16} mono weight={700} fill={ON}>
        {val(fmt, cy?.rd2)}
      </T>
      <T x={20} y={300} size={15} weight={600}>
        Write register
      </T>
      <T x={20} y={322} size={15} mono>
        {wr === undefined ? '—' : `$${RN[wr]} (${wr})`}
      </T>
      <W d={P([20, 340], [250, 340])} v={wr === undefined ? undefined : 1} />
      <Zoom to={{ k: 'dec', port: 'w' }} go={go} label="Decoder 5→32">
        <rect x={250} y={290} width={90} height={190} rx={10} fill="#fff" stroke="#7c6f6c" strokeWidth={2.2} />
        <text x={295} y={378} fontSize={14} textAnchor="middle" fill={INK}>
          Decoder
        </text>
        <text x={295} y={398} fontSize={14} textAnchor="middle" fill={INK}>
          5→32
        </text>
      </Zoom>
      {wr !== undefined && <W d={P([340, 420], [360, 420], [360, cellY(wr) + 35], [cellX(wr), cellY(wr) + 35])} v={rw ? 1 : 0} />}
      <T x={20} y={560} size={15} weight={600}>
        Write data
      </T>
      <T x={20} y={582} size={15} mono>
        {val(fmt, cy?.wd)}
      </T>
      <T x={20} y={640} size={15} weight={700} fill={ORANGE}>
        RegWrite = {rw}
      </T>
      <W d={P([140, 650], [295, 650], [295, 480])} v={rw} ctrl />
      <Note y={690}>{''}</Note>
    </>
  );
}

/** Rows of AND gates over true / complement rails, the way a decoder or PLA is drawn. */
function Pla({
  x0,
  y0,
  rowH,
  names,
  bits,
  rows,
  gate,
  outX,
}: {
  x0: number;
  y0: number;
  rowH: number;
  names: string[];
  bits: Bit[];
  rows: { label: string; pattern: string; extra?: string }[];
  gate: { w: number; h: number };
  outX: number;
}) {
  const RS = 34;
  const n = bits.length;
  const bottom = y0 + 30 + (rows.length - 1) * rowH + 12;
  const gx = x0 + n * 2 * RS + 10;
  return (
    <g>
      {bits.map((b, j) => {
        const xt = x0 + j * 2 * RS;
        const xc = xt + RS;
        return (
          <g key={j}>
            <text x={xt} y={y0 - 34} fontSize={13} textAnchor="middle" fill={MUTED}>
              {names[j]}
            </text>
            <V x={xt} y={y0 - 16} v={b} size={14} />
            <W d={P([xt, y0 - 10], [xt, bottom])} v={b} />
            <W d={P([xt, y0 - 4], [xc, y0 - 4], [xc, y0])} v={b} />
            <path d={`M${xc - 7},${y0}L${xc + 7},${y0}L${xc},${y0 + 11}Z`} fill="#fff" stroke="#7c6f6c" strokeWidth={1.6} />
            <circle cx={xc} cy={y0 + 14} r={3} fill="#fff" stroke="#7c6f6c" strokeWidth={1.6} />
            <W d={P([xc, y0 + 17], [xc, bottom])} v={NOT(b)} />
          </g>
        );
      })}
      {rows.map((r, i) => {
        const y = y0 + 30 + i * rowH;
        const taps = r.pattern.split('').map((ch, j) => (ch === '1' ? { x: x0 + j * 2 * RS, v: bits[j] } : { x: x0 + j * 2 * RS + RS, v: NOT(bits[j]) }));
        const out = AND(...taps.map((t) => t.v));
        return (
          <g key={i}>
            <path d={P([x0 - 12, y], [gx + 4, y])} stroke="#d9cfca" strokeWidth={1.4} fill="none" />
            {taps.map((t, j) => (
              <circle key={j} cx={t.x} cy={y} r={4} fill={wcol(t.v)} />
            ))}
            <Gate k="and" x={gx} y={y - gate.h / 2} h={gate.h} w={gate.w} v={out} />
            <W d={P([gx + gate.w, y], [outX - 8, y])} v={out} />
            <text x={outX} y={y + 5} fontSize={Math.min(15, rowH - 4)} fontWeight={out === 1 ? 800 : 500} fill={out === 1 ? ON : INK}>
              {r.label}
              {r.extra && <tspan fill={out === 1 ? ON : MUTED}>{r.extra}</tspan>}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DecView({ cy, fmt, regs, s, port }: Ctx & { port: 'r1' | 'r2' | 'w' }) {
  const f = cy?.ir === undefined ? null : fields(cy.ir);
  const n = port === 'w' ? cy?.wr : port === 'r1' ? f?.rs : f?.rt;
  const bits = [4, 3, 2, 1, 0].map((i) => bitOf(n, i));
  const rw = cy?.ctrl.RegWrite;
  const regVal = (k: number) => (k === 0 ? 0 : (s?.changes.find((x) => x.k === RN[k])?.o ?? regs?.[k]));
  return (
    <>
      <Pla
        x0={110}
        y0={70}
        rowH={19.6}
        names={['b4', 'b3', 'b2', 'b1', 'b0']}
        bits={bits}
        gate={{ w: 30, h: 15 }}
        outX={500}
        rows={Array.from({ length: 32 }, (_, k) => ({ label: `${k} $${RN[k]}`, pattern: k.toString(2).padStart(5, '0') }))}
      />
      <T x={680} y={90} size={20} weight={700}>
        {port === 'w' ? 'Write register' : `Read register ${port === 'r1' ? 1 : 2}`} = {n === undefined ? '—' : `${bin(n, 5)} (${n})`}
      </T>
      <T x={680} y={130} size={17}>
        decoder 5 → 32: แต่ละแถวคือ AND 5 อินพุต
      </T>
      <T x={680} y={158} size={17}>
        ต่อกับบิตตรง (จุดบนเส้นซ้าย) หรือบิตกลับ (เส้นหลัง NOT)
      </T>
      <T x={680} y={186} size={17}>
        ตามเลขแถว — จึงมีแถวเดียวที่ได้ 1
      </T>
      {port === 'w' ? (
        <>
          <T x={680} y={250} size={18} weight={600} fill={ORANGE}>
            RegWrite = {rw ?? '—'}
          </T>
          <T x={680} y={280} size={17}>
            เอาต์พุตของแถว AND กับ RegWrite อีกชั้น
          </T>
          <T x={680} y={308} size={17}>
            เป็นสัญญาณ Write ของ register แต่ละตัว
          </T>
          <T x={680} y={350} size={19} weight={700} fill={rw && n ? ON : MUTED}>
            {n === undefined ? '' : rw && n ? `→ เขียน $${RN[n]} = ${val(fmt, cy?.wd)}` : rw && n === 0 ? '→ $zero เขียนไม่ได้' : '→ RegWrite = 0 ไม่มี register ใดถูกเขียน'}
          </T>
        </>
      ) : (
        <>
          <T x={680} y={250} size={17}>
            ฝั่งอ่าน: Read data แต่ละบิต = OR ของ (แถว k AND บิตของ register k)
          </T>
          <T x={680} y={278} size={17}>
            คือ mux 32 → 1 ที่ใช้ decoder นี้เป็นตัวเลือก
          </T>
          <T x={680} y={330} size={19} weight={700} fill={ON}>
            {n === undefined ? '' : `→ $${RN[n]} = ${val(fmt, regVal(n))}`}
          </T>
        </>
      )}
    </>
  );
}

function MemView({ cy, s, fmt, peek }: Ctx) {
  const a = cy?.memAddr;
  const rd = cy?.ctrl.MemRead ?? 0;
  const wr = cy?.ctrl.MemWrite ?? 0;
  const base = a === undefined ? undefined : a & ~3;
  const write = wr ? s?.mem[0] : undefined;
  return (
    <>
      <W d={P([440, 70], [440, 110])} v={rd} ctrl />
      <T x={440} y={60} anchor="middle" fill={ORANGE} weight={700}>
        MemRead = {rd}
      </T>
      <W d={P([780, 70], [780, 110])} v={wr} ctrl />
      <T x={780} y={60} anchor="middle" fill={ORANGE} weight={700}>
        MemWrite = {wr}
      </T>
      <T x={24} y={300} weight={600}>
        Address
      </T>
      <T x={24} y={326} mono size={18}>
        {addr(a)}
      </T>
      <W d={P([24, 340], [300, 340])} v={a === undefined ? undefined : 1} />
      <rect x={300} y={140} width={60} height={410} rx={10} fill="#fff" stroke="#7c6f6c" strokeWidth={2} />
      <text x={330} y={350} fontSize={14} textAnchor="middle" fill={INK} transform="rotate(-90 330 345)">
        ถอด address
      </text>
      <rect x={380} y={110} width={480} height={460} rx={12} fill="#fff" stroke="#7c6f6c" strokeWidth={2} />
      {base !== undefined &&
        [-8, -4, 0, 4, 8].map((d, i) => {
          const ad = (base + d) >>> 0;
          const y = 140 + i * 84;
          const on = d === 0;
          const v = on && cy?.memData !== undefined ? cy.memData : peek?.(ad);
          return (
            <g key={d}>
              <W d={P([360, y + 34], [380, y + 34])} v={on ? 1 : 0} />
              <rect x={396} y={y} width={448} height={68} rx={8} fill={on ? '#f6dcd8' : '#faf7f5'} stroke={on ? ON : '#e6dcd7'} strokeWidth={on ? 2.2 : 1} />
              <text x={412} y={y + 42} fontSize={17} fontFamily="var(--mono)" fill={MUTED}>
                {addr(ad)}
              </text>
              <text x={828} y={y + 42} fontSize={18} fontFamily="var(--mono)" textAnchor="end" fontWeight={on ? 700 : 500} fill={on ? ON : INK}>
                {on && write ? `${fmt(write.o)} → ${fmt(write.n)}` : v === undefined ? '—' : fmt(v)}
              </text>
            </g>
          );
        })}
      <W d={P([860, 342], [1000, 342])} v={rd ? 1 : 0} />
      <T x={1012} y={334} weight={600}>
        MemData
      </T>
      <T x={1012} y={362} mono size={18} weight={700} fill={rd ? ON : MUTED}>
        {rd ? val(fmt, cy?.memData) : '—'}
      </T>
      <T x={24} y={612} weight={600}>
        Write data = {val(fmt, cy?.rd2)}
      </T>
      <W d={P([24, 624], [620, 624], [620, 570])} v={wr ? 1 : 0} />
      <Note>
        รูปนี้ใช้ memory ก้อนเดียวทั้งคำสั่งและข้อมูล — IorD เลือกว่า address มาจาก PC (fetch) หรือ ALUOut (lw / sw)
      </Note>
    </>
  );
}

const FIELD_BG: [hi: number, lo: number, fill: string][] = [
  [31, 26, '#f2d6d2'],
  [25, 21, '#f6e7cf'],
  [20, 16, '#e6efd9'],
  [15, 11, '#dde9f2'],
  [10, 6, '#ece4f2'],
  [5, 0, '#f2e0ea'],
];

function IrView({ cy, go }: Ctx) {
  const w = cy?.ir ?? (cy?.ctrl.IRWrite ? cy.memData : undefined);
  const incoming = cy?.ir === undefined && w !== undefined;
  const f = w === undefined ? null : fields(w);
  const name = w === undefined ? '' : (opOf(w)?.name ?? '?');
  const x = (i: number) => col(i);
  const rows: [hi: number, lo: number, text: string][] = [
    [31, 26, `[31–26] → Main control: Op = ${bin(f?.op, 6)}${f ? ` (${f.op === 0 ? 'R-type' : name})` : ''}`],
    [25, 21, `[25–21] → Read register 1: ${f ? `$${RN[f.rs]} (${f.rs})` : '—'}`],
    [20, 16, `[20–16] → Read register 2 และ mux RegDst (0): ${f ? `$${RN[f.rt]}` : '—'}`],
    [15, 11, `[15–11] → mux RegDst (1): ${f ? `$${RN[f.rd]}` : '—'}`],
    [15, 0, `[15–0] → Sign extend: ${f ? `0x${hex(f.uimm).slice(4)} (${f.imm})` : '—'}`],
    [25, 0, `[25–0] → Shift left 2 (jump): ${f ? `0x${f.target.toString(16).toUpperCase()}` : '—'}`],
    [5, 0, `[5–0] → ALU control: funct = ${bin(f?.funct, 6)}`],
  ];
  return (
    <>
      <T x={24} y={48} size={19} weight={600}>
        {w === undefined ? 'IR ยังถือคำสั่งก่อนหน้า' : `${incoming ? 'กำลังเขียนลง IR: ' : 'IR = '}0x${hex(w)} · ${name}`}
      </T>
      <Zoom to={{ k: 'reg', id: 'ir' }} go={go} label="IR (flip-flop 32 ตัว)">
        {Array.from({ length: 32 }, (_, i) => {
          const bg = FIELD_BG.find(([hi, lo]) => i <= hi && i >= lo)![2];
          return (
            <g key={i}>
              <text x={x(i)} y={98} fontSize={11} textAnchor="middle" fill={MUTED}>
                {i}
              </text>
              <rect x={x(i) - 17} y={110} width={34} height={44} fill={bg} stroke="#fff" strokeWidth={2} />
              <text x={x(i)} y={140} fontSize={17} textAnchor="middle" fontFamily="var(--mono)" fontWeight={700} fill={bitOf(w, i) === 1 ? ON : MUTED}>
                {bitOf(w, i) ?? '?'}
              </text>
            </g>
          );
        })}
      </Zoom>
      {rows.map(([hi, lo, text], i) => {
        const y = 210 + i * 64;
        const x0 = x(hi) - 15;
        const x1 = x(lo) + 15;
        const right = x0 > 640;
        return (
          <g key={i}>
            <path d={P([x0, y - 14], [x0, y], [x1, y], [x1, y - 14])} fill="none" stroke={w === undefined ? UNK : ON} strokeWidth={2.4} />
            <T x={right ? x1 : x0} y={y + 26} anchor={right ? 'end' : 'start'} size={16}>
              {text}
            </T>
          </g>
        );
      })}
      <Note>IR แค่แยกสาย: บิตแต่ละช่วงต่อไปยังส่วนต่าง ๆ พร้อมกัน · คลิกแถวบิตเพื่อดู flip-flop ที่เก็บคำสั่ง</Note>
    </>
  );
}

function SextView({ cy }: Ctx) {
  const imm = cy?.ir === undefined ? undefined : cy.ir & 0xffff;
  const out = cy?.ext;
  const zero = cy?.ir !== undefined && !!opOf(cy.ir)?.unsigned;
  const s = zero ? 0 : bitOf(imm, 15);
  return (
    <>
      <T x={col(15) - 17} y={88} size={16} weight={600}>
        เข้า 16 บิต (Instruction [15–0]) = {imm === undefined ? '—' : `0x${imm.toString(16).toUpperCase().padStart(4, '0')}`}
      </T>
      {Array.from({ length: 16 }, (_, i) => (
        <g key={i}>
          <rect x={col(i) - 15} y={110} width={30} height={40} rx={4} fill={i === 15 ? '#f2d6d2' : '#faf7f5'} stroke="#cfc4bf" />
          <V x={col(i)} y={137} v={bitOf(imm, i)} size={15} />
          <W d={P([col(i), 150], [col(i), 500])} v={bitOf(imm, i)} />
        </g>
      ))}
      {zero ? (
        <>
          <T x={col(31) - 15} y={320} size={16} weight={700}>
            0
          </T>
          <W d={P([col(31) + 2, 330], [col(16), 330])} v={0} />
        </>
      ) : (
        <W d={P([col(15), 330], [col(31), 330])} v={s} />
      )}
      {!zero && <Dot x={col(15)} y={330} v={s} />}
      {Array.from({ length: 16 }, (_, k) => (
        <g key={k}>
          <W d={P([col(k + 16), 330], [col(k + 16), 500])} v={s} />
          <Dot x={col(k + 16)} y={330} v={s} />
        </g>
      ))}
      {Array.from({ length: 32 }, (_, i) => (
        <g key={i}>
          <rect x={col(i) - 15} y={500} width={30} height={40} rx={4} fill={i > 15 ? '#f2d6d2' : '#faf7f5'} stroke="#cfc4bf" />
          <V x={col(i)} y={527} v={bitOf(out, i)} size={15} />
          <text x={col(i)} y={560} fontSize={11} textAnchor="middle" fill={MUTED}>
            {i}
          </text>
        </g>
      ))}
      <T x={24} y={610} size={19} mono>
        ออก 32 บิต = {out === undefined ? '—' : `0x${hex(out)} (${out})`}
      </T>
      <Note y={660}>
        {zero
          ? 'andi / ori / xori เติม 0 ด้านบน (zero-extend) แทนการขยายเครื่องหมาย'
          : 'Sign extend ไม่มีเกตเลย — แค่แยกสายบิต 15 (บิตเครื่องหมาย) ไปเป็นบิต 16–31 ทั้งหมด'}
      </Note>
      <Note>ค่าลบจึงยังเป็นค่าลบเท่าเดิมเมื่อขยายเป็น 32 บิต</Note>
    </>
  );
}

function Sl2View({ cy, id }: Ctx & { id: 'b' | 'j' }) {
  const jump = id === 'j';
  const input = cy?.ir === undefined ? undefined : jump ? cy.ir & 0x3ffffff : cy.ext;
  const width = jump ? 26 : 32;
  const out = jump ? cy?.jump : cy?.extSh;
  return (
    <>
      <T x={24} y={70} size={16} weight={600}>
        {jump ? 'เข้า: Instruction [25–0] และ PC [31–28]' : 'เข้า: ผลจาก Sign extend'}
      </T>
      {Array.from({ length: width }, (_, i) => {
        const v = bitOf(input, i);
        return (
          <g key={i}>
            <rect x={col(i) - 15} y={110} width={30} height={40} rx={4} fill="#faf7f5" stroke="#cfc4bf" />
            <V x={col(i)} y={137} v={v} size={15} />
            {i + 2 < 32 ? <W d={P([col(i), 150], [col(i), 290], [col(i + 2), 360], [col(i + 2), 500])} v={v} /> : <W d={P([col(i), 150], [col(i), 230])} v={v} />}
            {i + 2 >= 32 && (
              <text x={col(i)} y={250} fontSize={18} textAnchor="middle" fill={MUTED}>
                ×
              </text>
            )}
          </g>
        );
      })}
      {jump &&
        [31, 30, 29, 28].map((i) => (
          <g key={i}>
            <rect x={col(i) - 15} y={110} width={30} height={40} rx={4} fill="#e6efd9" stroke="#cfc4bf" />
            <V x={col(i)} y={137} v={bitOf(cy?.pc, i)} size={15} />
            <W d={P([col(i), 150], [col(i), 500])} v={bitOf(cy?.pc, i)} />
          </g>
        ))}
      {[1, 0].map((i) => (
        <g key={i}>
          <text x={col(i)} y={440} fontSize={16} textAnchor="middle" fill={MUTED} fontWeight={700}>
            0
          </text>
          <W d={P([col(i), 450], [col(i), 500])} v={0} />
        </g>
      ))}
      {Array.from({ length: 32 }, (_, i) => (
        <g key={i}>
          <rect x={col(i) - 15} y={500} width={30} height={40} rx={4} fill={jump && i >= 28 ? '#e6efd9' : '#faf7f5'} stroke="#cfc4bf" />
          <V x={col(i)} y={527} v={bitOf(out, i)} size={15} />
          <text x={col(i)} y={560} fontSize={11} textAnchor="middle" fill={MUTED}>
            {i}
          </text>
        </g>
      ))}
      <T x={24} y={610} size={19} mono>
        ออก = {out === undefined ? '—' : `0x${hex(out)}`}
      </T>
      <Note>
        {jump
          ? 'เลื่อน 26 บิตไปซ้าย 2 ได้ 28 บิต แล้วต่อด้านบนด้วย PC [31–28] (สีเขียว) เป็น Jump address — ไม่มีเกต มีแต่สาย'
          : 'เลื่อนซ้าย 2 บิต = คูณ 4 (offset นับเป็นคำสั่ง แต่ address นับเป็น byte) — แค่เดินสายเยื้องไป 2 ช่อง ไม่มีเกต'}
      </Note>
    </>
  );
}

const ALU_TABLE: [aluOp: string, funct: string, op: string, test: (o: number, f: number) => boolean][] = [
  ['00', 'xxxxxx', '010 add', (o) => o === 0],
  ['x1', 'xxxxxx', '110 sub', (o) => (o & 1) === 1],
  ['1x', '100000', '010 add', (o, f) => o === 2 && f === 32],
  ['1x', '100010', '110 sub', (o, f) => o === 2 && f === 34],
  ['1x', '100100', '000 and', (o, f) => o === 2 && f === 36],
  ['1x', '100101', '001 or', (o, f) => o === 2 && f === 37],
  ['1x', '101010', '111 slt', (o, f) => o === 2 && f === 42],
];

function AluCtlView({ cy }: Ctx) {
  const op = cy?.ctrl.ALUOp;
  const a1 = bitOf(op, 1);
  const a0 = bitOf(op, 0);
  const funct = cy?.ir === undefined ? undefined : cy.ir & 63;
  const F = (i: number) => bitOf(funct, i);
  const g1 = AND(a1, F(1));
  const o2 = OR(a0, g1);
  const n1 = NOT(a1);
  const n2 = NOT(F(2));
  const o1 = OR(n1, n2);
  const g4 = OR(F(3), F(0));
  const o0 = AND(a1, g4);
  const rails: [string, number, Bit][] = [
    ['ALUOp1', 150, a1],
    ['ALUOp0', 210, a0],
    ['F3', 280, F(3)],
    ['F2', 330, F(2)],
    ['F1', 380, F(1)],
    ['F0', 430, F(0)],
  ];
  const fn = cy?.fn;
  return (
    <>
      {rails.map(([n, x, v]) => (
        <g key={n}>
          <text x={x} y={46} fontSize={14} textAnchor="middle" fill={n.startsWith('A') ? ORANGE : MUTED} fontWeight={600}>
            {n}
          </text>
          <V x={x} y={70} v={v} />
          <W d={P([x, 80], [x, 560])} v={v} />
        </g>
      ))}
      <W d={P([150, 170], [530, 170])} v={a1} />
      <W d={P([380, 190], [530, 190])} v={F(1)} />
      <Gate k="and" x={520} y={150} h={60} v={g1} />
      <W d={P([210, 120], [730, 120])} v={a0} />
      <W d={P([584, 180], [660, 180], [660, 140], [730, 140])} v={g1} />
      <Gate k="or" x={720} y={100} h={60} v={o2} />
      <W d={P([150, 300], [522, 300])} v={a1} />
      <Gate k="not" x={520} y={280} h={40} v={n1} />
      <W d={P([330, 370], [522, 370])} v={F(2)} />
      <Gate k="not" x={520} y={350} h={40} v={n2} />
      <W d={P([570, 300], [650, 300], [650, 325], [730, 325])} v={n1} />
      <W d={P([570, 370], [650, 370], [650, 345], [730, 345])} v={n2} />
      <Gate k="or" x={720} y={305} h={60} v={o1} />
      <W d={P([280, 490], [530, 490])} v={F(3)} />
      <W d={P([430, 510], [530, 510])} v={F(0)} />
      <Gate k="or" x={520} y={470} h={60} v={g4} />
      <W d={P([150, 460], [730, 460])} v={a1} />
      <W d={P([584, 500], [660, 500], [660, 480], [730, 480])} v={g4} />
      <Gate k="and" x={720} y={440} h={60} v={o0} />
      {[
        [150, 170, a1],
        [210, 120, a0],
        [380, 190, F(1)],
        [150, 300, a1],
        [330, 370, F(2)],
        [280, 490, F(3)],
        [430, 510, F(0)],
        [150, 460, a1],
      ].map(([x, y, v], i) => (
        <Dot key={i} x={x as number} y={y as number} v={v as Bit} />
      ))}
      {[
        [130, 'Operation2 (Bnegate)', o2],
        [335, 'Operation1', o1],
        [470, 'Operation0', o0],
      ].map(([y, n, v]) => (
        <g key={n as string}>
          <W d={P([784, y as number], [860, y as number])} v={v as Bit} />
          <T x={870} y={(y as number) + 6} size={17} weight={600}>
            {n as string} = {(v as Bit) ?? '—'}
          </T>
        </g>
      ))}
      <T x={880} y={560} size={15} weight={700}>
        ALUOp · funct → Operation
      </T>
      {ALU_TABLE.map(([o, f, r, test], i) => {
        const on = op !== undefined && funct !== undefined && test(op, funct);
        return (
          <g key={i}>
            {on && <rect x={872} y={571 + i * 20} width={380} height={20} rx={4} fill="#f6dcd8" />}
            <text x={880} y={586 + i * 20} fontSize={14} fontFamily="var(--mono)" fill={on ? ON : INK} fontWeight={on ? 700 : 400}>
              {o} {f} → {r}
            </text>
          </g>
        );
      })}
      <T x={24} y={630} size={18} weight={600}>
        ALU จะทำ: {fn ? `${fn.name}${fn.basic ? '' : ' (วงจรเพิ่ม)'}` : '—'}
      </T>
      <Note y={666}>
        {op === 3
          ? 'ALUOp = 11 เป็นส่วนเสริมสำหรับ I-type (addi, andi, ori, slti) — เลือกการทำงานจาก opcode แทน funct'
          : fn && fn.name === 'nor'
            ? 'nor ต้องใช้ Ainvert = 1 ด้วย (เส้นที่ 4 ไม่ได้วาดไว้ในวงจรนี้)'
            : fn && !fn.basic
              ? `funct นี้ (${fn.name}) ไม่อยู่ในตาราง — ใช้วงจรเพิ่มแทน ALU`
              : 'วงจรนี้ใช้แค่ F3–F0 เพราะคำสั่ง R-type ที่รองรับมี F5 F4 = 10 เสมอ'}
      </Note>
      <Note>สามเส้นทางขวาคือ Operation ที่ส่งไปทุกบิตของ ALU · ตารางขวาล่างคือแถวที่ตรงกับ cycle นี้</Note>
    </>
  );
}

const FSM_POS: Record<number, [number, number]> = {
  0: [150, 92],
  1: [430, 92],
  2: [110, 290],
  3: [60, 460],
  5: [200, 460],
  4: [60, 630],
  6: [300, 290],
  7: [300, 460],
  10: [450, 290],
  11: [450, 460],
  8: [600, 290],
  9: [730, 290],
  12: [860, 290],
};
const FSM_SHORT: Record<number, string> = {
  0: 'Fetch',
  1: 'Decode',
  2: 'MemAddr',
  3: 'MemRead',
  4: 'MemWB',
  5: 'MemWrite',
  6: 'Execute',
  7: 'R-WB',
  8: 'Branch',
  9: 'Jump',
  10: 'I-Exec',
  11: 'I-WB',
  12: 'JR',
};

function CtrlView({ cy, s, go }: Ctx) {
  const path = s ? statesFor(s) : [];
  const cur = cy?.state;
  const R = 34;
  const edgeOn = (a: number, b: number) => path.some((x, i) => x === a && path[i + 1] === b);
  return (
    <>
      <defs>
        <marker id="lz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10Z" fill="#9a8d8a" />
        </marker>
        <marker id="lz-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10Z" fill="var(--m)" />
        </marker>
      </defs>
      {EDGES.map(([a, b, when]) => {
        const [x1, y1] = FSM_POS[a];
        const [x2, y2] = FSM_POS[b];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const on = edgeOn(a, b);
        return (
          <g key={`${a}-${b}`}>
            <path
              d={P([x1 + ux * R, y1 + uy * R], [x2 - ux * (R + 2), y2 - uy * (R + 2)])}
              stroke={on ? ON : '#b5a8a4'}
              strokeWidth={on ? 3 : 1.6}
              markerEnd={`url(#${on ? 'lz-arrow-on' : 'lz-arrow'})`}
            />
            {when && (
              <text x={x2 - ux * (R + 34)} y={y2 - uy * (R + 34) - 4} fontSize={12} textAnchor="middle" fill={on ? ON : MUTED} fontWeight={on ? 700 : 400}>
                {when}
              </text>
            )}
          </g>
        );
      })}
      {Object.entries(FSM_POS).map(([k, [x, y]]) => {
        const n = +k;
        const now = n === cur;
        const seen = path.includes(n);
        const terminal = !EDGES.some(([a]) => a === n) && n !== 0;
        return (
          <g key={k}>
            <title>{`state ${n}: ${STATES[n].name}`}</title>
            <circle cx={x} cy={y} r={R} fill={now ? 'var(--m)' : seen ? '#f9ecea' : '#fff'} stroke={seen ? ON : '#b5a8a4'} strokeWidth={seen ? 2.6 : 1.6} strokeDasharray={STATES[n].extra ? '5 4' : undefined} />
            <text x={x} y={y + 8} fontSize={22} fontWeight={700} textAnchor="middle" fill={now ? '#fff' : INK}>
              {n}
            </text>
            <text x={x} y={y + R + 18} fontSize={13} textAnchor="middle" fill={seen ? ON : MUTED} fontWeight={seen ? 700 : 400}>
              {FSM_SHORT[n]}
              {terminal ? ' → 0' : ''}
            </text>
          </g>
        );
      })}
      <path d={P([150 - R, 92], [40, 92])} stroke="#b5a8a4" strokeWidth={1.6} markerStart="url(#lz-arrow)" />
      <text x={40} y={80} fontSize={12} fill={MUTED}>
        start
      </text>
      <Zoom to={{ k: 'opdec' }} go={go} label="ถอด opcode">
        <rect x={560} y={40} width={250} height={60} rx={12} fill="#fff" stroke="#7c6f6c" strokeWidth={2} />
        <text x={685} y={66} fontSize={15} textAnchor="middle" fill={INK} fontWeight={600}>
          ถอด opcode (Op[5–0]) ›
        </text>
        <text x={685} y={88} fontSize={13} textAnchor="middle" fill={MUTED}>
          {cy?.ir === undefined ? 'รอ IR' : `Op = ${bin(cy.ir >>> 26, 6)}`}
        </text>
      </Zoom>
      <path d={P([560, 75], [464, 85])} stroke="#b5a8a4" strokeDasharray="5 4" strokeWidth={1.6} />
      <T x={930} y={52} size={17} weight={700}>
        {cur === undefined ? 'สัญญาณควบคุม' : `state ${cur}: ${STATES[cur].name}`}
      </T>
      {CTRL.map((k, i) => {
        const v = cy?.ctrl[k as keyof Ctrl];
        const y = 90 + i * 40;
        return (
          <g key={k}>
            <rect x={926} y={y - 26} width={330} height={34} rx={8} fill={v ? '#fbe9d9' : '#faf7f5'} />
            <text x={940} y={y - 3} fontSize={16} fill={v ? '#b4520c' : MUTED} fontWeight={v ? 700 : 500}>
              {k}
            </text>
            <text x={1240} y={y - 3} fontSize={17} fill={v ? '#b4520c' : MUTED} fontWeight={700} textAnchor="end" fontFamily="var(--mono)">
              {v === undefined ? '—' : k === 'PCSource' || k === 'ALUOp' || k === 'ALUSrcB' ? bin(v, 2) : v}
            </text>
          </g>
        );
      })}
      <Note>Main control คือ FSM: state register + วงจรเลือก state ถัดไปจาก opcode · วงกลมแดง = cycle นี้ · ขอบแดง = state ที่คำสั่งนี้ผ่าน · เส้นประ = state เสริม</Note>
    </>
  );
}

const OP_ROWS: [string, string, number][] = [
  ['R-type', '000000', 6],
  ['lw', '100011', 2],
  ['sw', '101011', 2],
  ['beq', '000100', 8],
  ['j', '000010', 9],
  ['jal', '000011', 9],
  ['bne', '000101', 8],
  ['addi', '001000', 10],
  ['addiu', '001001', 10],
  ['slti', '001010', 10],
  ['andi', '001100', 10],
  ['ori', '001101', 10],
  ['lui', '001111', 10],
];

function OpdecView({ cy }: Ctx) {
  const op = cy?.ir === undefined ? undefined : cy.ir >>> 26;
  const bits = [5, 4, 3, 2, 1, 0].map((i) => bitOf(op, i));
  const hit = OP_ROWS.find(([, p]) => op !== undefined && parseInt(p, 2) === op);
  return (
    <>
      <Pla
        x0={90}
        y0={80}
        rowH={44}
        names={['Op5', 'Op4', 'Op3', 'Op2', 'Op1', 'Op0']}
        bits={bits}
        gate={{ w: 48, h: 30 }}
        outX={590}
        rows={OP_ROWS.map(([n, p, st]) => ({ label: `${n} `, pattern: p, extra: `→ state ${st}` }))}
      />
      <T x={800} y={110} size={20} weight={700}>
        Op = {bin(op, 6)}
      </T>
      <T x={800} y={150} size={17}>
        แต่ละแถวเป็น AND 6 อินพุตที่จำ opcode หนึ่งตัว
      </T>
      <T x={800} y={178} size={17}>
        แถวที่ได้ 1 บอก FSM ว่าหลัง state 1 จะไปไหน
      </T>
      <T x={800} y={230} size={19} weight={700} fill={ON}>
        {op === undefined ? '' : hit ? `→ ${hit[0]} · ไป state ${hit[2]}` : '→ ไม่อยู่ในตารางนี้'}
      </T>
      <Note>แถว jal, bne และ I-type เป็นส่วนเสริม — FSM ในหนังสือรู้จักแค่ R-type, lw, sw, beq, j</Note>
    </>
  );
}

function PcenView({ cy }: Ctx) {
  const pwc = cy?.ctrl.PCWriteCond;
  const pw = cy?.ctrl.PCWrite;
  const cond = cy?.cond;
  const g = AND(pwc, cond);
  const en = OR(g, pw);
  return (
    <>
      <T x={30} y={180} weight={700} fill={ORANGE}>
        PCWriteCond = {pwc ?? '—'}
      </T>
      <W d={P([30, 190], [300, 190], [300, 237], [430, 237])} v={pwc} ctrl />
      <T x={30} y={290} weight={700}>
        Zero = {cy?.zero ?? '—'}
        {cy?.cond !== cy?.zero ? ` (เงื่อนไขของคำสั่งนี้ = ${cond})` : ''}
      </T>
      <W d={P([30, 300], [340, 300], [340, 263], [430, 263])} v={cond} />
      <Gate k="and" x={420} y={210} h={80} w={100} v={g} />
      <W d={P([520, 250], [600, 250], [600, 327], [710, 327])} v={g} />
      <V x={560} y={242} v={g} />
      <T x={30} y={440} weight={700} fill={ORANGE}>
        PCWrite = {pw ?? '—'}
      </T>
      <W d={P([30, 450], [600, 450], [600, 353], [710, 353])} v={pw} ctrl />
      <Gate k="or" x={700} y={300} h={80} w={100} v={en} />
      <W d={P([800, 340], [960, 340])} v={en} />
      <T x={975} y={347} size={20} weight={700}>
        เขียน PC = {en ?? '—'}
      </T>
      <T x={24} y={600} size={18}>
        PC ถูกเขียนเมื่อ PCWrite = 1 (ทุก fetch และ jump)
      </T>
      <T x={24} y={632} size={18}>
        หรือเมื่อ PCWriteCond = 1 และ Zero = 1 (beq ที่ค่าเท่ากัน)
      </T>
      <Note>สองเกตนี้คือเกตสีส้มมุมซ้ายบนของ datapath</Note>
    </>
  );
}
