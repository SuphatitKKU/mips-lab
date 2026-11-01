// Realistic top-view drawings of the Z80 lab parts (DIP chips, LEDs, tactile
// switch, 7-segment, screw terminal, crystal oscillator, resistors, sensors and
// sensor modules). Every model is drawn unrotated in PART_INFO's w × h; the
// board rotates it with a transform.

import { KIT_PORTS, kitPinX, resCode, type PartType } from '../lib/z80/board';
import type { ModLook } from '../lib/z80/modules';

export interface ModelState {
  /** top marking on chips / frequency on the oscillator */
  marking?: string;
  /** small second line on chips */
  sub?: string;
  /** which LEDs / segments are lit (bit order: LED 0–7, or a–g then dp) */
  lit?: boolean[];
  /** brightness of each lit LED / segment, 0–1 */
  level?: number[];
  pressed?: boolean;
  /** resistance, for the colour bands */
  val?: number;
  /** knob or trimpot position, 0–1 */
  pos?: number;
  /** switch contacts touching (reed, tilt) */
  closed?: boolean;
  /** a module's indicator LED */
  active?: boolean;
  /** how a catalogue module looks */
  look?: ModLook;
}

const MONO = "'JetBrains Mono', monospace";
const DIP_PINS: Partial<Record<PartType, number>> = { CPU: 20, ROM: 14, RAM: 14, '138': 8, '574': 10, '244': 10, RN: 8, ADC: 10, UART: 14 }; // pins per side

/** Gradients shared by every model; render once inside an <svg> that stays on the page. */
export function PartDefs() {
  return (
    <>
      <linearGradient id="pm-chip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3d3636" />
        <stop offset="1" stopColor="#1e1a1a" />
      </linearGradient>
      <linearGradient id="pm-ceramic" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5e5653" />
        <stop offset="1" stopColor="#3a3432" />
      </linearGradient>
      <linearGradient id="pm-pin" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#9c948f" />
        <stop offset="0.5" stopColor="#ece8e5" />
        <stop offset="1" stopColor="#9c948f" />
      </linearGradient>
      <linearGradient id="pm-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f3f0ee" />
        <stop offset="1" stopColor="#b3aaa5" />
      </linearGradient>
      <linearGradient id="pm-can" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f6f3f1" />
        <stop offset="0.55" stopColor="#c9c1bc" />
        <stop offset="1" stopColor="#e9e4e1" />
      </linearGradient>
      <radialGradient id="pm-quartz" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#b9b4bf" />
        <stop offset="1" stopColor="#3c3941" />
      </radialGradient>
      <radialGradient id="pm-led-on" cx="0.4" cy="0.35" r="0.65">
        <stop offset="0" stopColor="#ffe1db" />
        <stop offset="0.35" stopColor="#ff5a47" />
        <stop offset="1" stopColor="#c0261c" />
      </radialGradient>
      <radialGradient id="pm-led-off" cx="0.4" cy="0.35" r="0.65">
        <stop offset="0" stopColor="#9e4a43" />
        <stop offset="1" stopColor="#4e1714" />
      </radialGradient>
      <radialGradient id="pm-glow">
        <stop offset="0" stopColor="#ff4d3d" stopOpacity="0.6" />
        <stop offset="1" stopColor="#ff4d3d" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pm-cap" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#c05a53" />
        <stop offset="1" stopColor="#6e1414" />
      </radialGradient>
      <linearGradient id="pm-resistor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#efdcbc" />
        <stop offset="1" stopColor="#c9ad83" />
      </linearGradient>
      <linearGradient id="pm-pcb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2d5aa8" />
        <stop offset="1" stopColor="#1d3f7c" />
      </linearGradient>
      <linearGradient id="pm-pcb-green" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2f7a4a" />
        <stop offset="1" stopColor="#1f5634" />
      </linearGradient>
      <radialGradient id="pm-dome" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#d9d4d0" />
      </radialGradient>
      <linearGradient id="pm-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e8f3f6" stopOpacity="0.95" />
        <stop offset="1" stopColor="#b7d3dc" stopOpacity="0.85" />
      </linearGradient>
    </>
  );
}

export function PartModel({ type, w, h, ...s }: { type: PartType; w: number; h: number } & ModelState) {
  switch (type) {
    case 'LED':
      return <LedBar w={w} h={h} lit={s.lit} level={s.level} />;
    case '7SG':
      return <SevenSeg w={w} h={h} lit={s.lit} level={s.level} />;
    case 'BTN':
      return <Tactile w={w} h={h} pressed={!!s.pressed} />;
    case '5V':
      return <Terminal w={w} h={h} />;
    case 'CLK':
      return <Oscillator w={w} h={h} marking={s.marking} />;
    case 'Ω':
      return <Resistor w={w} h={h} val={s.val ?? 10000} />;
    case 'POT':
      return <Pot w={w} h={h} pos={s.pos ?? 0.5} />;
    case 'LDR':
      return <Ldr w={w} h={h} />;
    case 'NTC':
      return <Ntc w={w} h={h} />;
    case 'LM35':
      return <To92 w={w} h={h} />;
    case 'PIR':
      return <Pir w={w} h={h} active={!!s.active} />;
    case 'IR':
    case 'LDM':
      return <Module w={w} h={h} kind={type} pos={s.pos ?? 0.5} active={!!s.active} />;
    case 'REED':
      return <Reed w={w} h={h} closed={!!s.closed} />;
    case 'TILT':
      return <Tilt w={w} h={h} closed={!!s.closed} />;
    case 'RFID':
      return <Rfid w={w} h={h} active={!!s.active} />;
    case 'KIT':
      return <Trainer w={w} h={h} lit={s.lit} />;
    case 'HALL':
      return <To92 w={w} h={h} marking="3144" />;
    case 'TCH':
      return <TouchPad w={w} h={h} active={!!s.active} />;
    case 'SND':
    case 'VIB':
    case 'FLM':
    case 'H2O':
    case 'GAS':
      return <DigitalModule w={w} h={h} kind={type} active={!!s.active} />;
    case 'MODS':
      return <CatalogSwitch w={w} h={h} look={s.look} closed={!!s.active} />;
    case 'MODI':
    case 'MODA':
    case 'MODO':
      return <CatalogModule w={w} h={h} look={s.look} active={!!s.active} />;
    case 'MOD2':
    case 'MOD3':
    case 'MOD4':
      return <CatalogModule w={w} h={h} look={s.look} active={!!s.active} pins={Number(type[3]) + 2} />;
    default:
      return <Dip w={w} h={h} pins={DIP_PINS[type] ?? 8} eprom={type === 'ROM'} marking={s.marking} sub={s.sub} />;
  }
}

/** Small preview for the parts list. */
export function PartThumb({ type, w, h, look }: { type: PartType; w: number; h: number; look?: ModLook }) {
  return (
    <svg width={40} height={30} viewBox={`-3 -3 ${w + 6} ${h + 6}`} aria-hidden="true" style={{ flex: 'none' }}>
      <PartModel type={type} w={w} h={h} look={look} marking={type === 'CLK' ? 'OSC' : type === 'ADC' ? 'ADC0804' : type === 'UART' ? '8251A' : undefined} />
    </svg>
  );
}

function Dip({ w, h, pins, eprom, marking, sub }: { w: number; h: number; pins: number; eprom: boolean; marking?: string; sub?: string }) {
  const leg = 7;
  const bx = 3;
  const bw = w - 6;
  const bh = h - leg * 2;
  const pitch = (bw - 16) / (pins - 1);
  const notch = Math.min(6, bh / 5);
  const win = eprom ? { x: bx + 22, w: Math.min(40, bw * 0.2), y: leg + 6, h: bh - 12 } : null;
  const tx = win ? (win.x + win.w + bx + bw) / 2 : w / 2;
  const big = bh >= 40;
  const two = !!sub && bh >= 26;
  return (
    <>
      {Array.from({ length: pins }, (_, i) => {
        const x = bx + 8 + i * pitch - 2.5;
        return (
          <g key={i} fill="url(#pm-pin)" stroke="#857c77" strokeWidth={0.5}>
            <rect x={x} y={0} width={5} height={leg + 2} rx={1} />
            <rect x={x} y={h - leg - 2} width={5} height={leg + 2} rx={1} />
          </g>
        );
      })}
      <rect x={bx} y={leg} width={bw} height={bh} rx={3} fill={eprom ? 'url(#pm-ceramic)' : 'url(#pm-chip)'} />
      <rect x={bx + 1} y={leg + 1} width={bw - 2} height={2} rx={1} fill="#fff" opacity={0.08} />
      <path d={`M${bx} ${h / 2 - notch}A${notch} ${notch} 0 0 1 ${bx} ${h / 2 + notch}Z`} fill="#120f0f" />
      <circle cx={bx + notch + 9} cy={leg + bh - 7} r={2.2} fill="#0d0b0b" opacity={0.8} />
      {win && (
        <>
          <rect x={win.x - 3} y={win.y - 3} width={win.w + 6} height={win.h + 6} rx={7} fill="#2a2525" />
          <rect x={win.x} y={win.y} width={win.w} height={win.h} rx={5} fill="url(#pm-quartz)" />
          <rect x={win.x + win.w / 2 - 6} y={win.y + win.h / 2 - 5} width={12} height={10} rx={1} fill="#8f8a6a" opacity={0.7} />
          <ellipse cx={win.x + win.w * 0.3} cy={win.y + win.h * 0.3} rx={win.w * 0.18} ry={win.h * 0.12} fill="#fff" opacity={0.35} />
        </>
      )}
      {marking && (
        <text x={tx} y={h / 2 + (two ? -1 : 4)} textAnchor="middle" fontFamily={MONO} fontSize={big ? 13 : 10} fontWeight={600} fill="#e9e3df" letterSpacing={0.6}>
          {marking}
        </text>
      )}
      {two && (
        <text x={tx} y={h / 2 + (big ? 13 : 9)} textAnchor="middle" fontFamily={MONO} fontSize={big ? 9 : 8} fill="#a99e9a">
          {sub}
        </text>
      )}
    </>
  );
}

/** Opacity of a lit LED: dim LEDs still read as on. */
const glow = (level?: number[], i = 0) => 0.3 + 0.7 * Math.min(1, level?.[i] ?? 1);

function LedBar({ w, h, lit, level }: { w: number; h: number; lit?: boolean[]; level?: number[] }) {
  const pitch = (w - 22) / 7;
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} fill="url(#pm-pin)" stroke="#857c77" strokeWidth={0.5}>
          <rect x={11 + i * pitch - 2.5} y={0} width={5} height={9} rx={1} />
          <rect x={11 + i * pitch - 2.5} y={h - 9} width={5} height={9} rx={1} />
        </g>
      ))}
      <rect x={3} y={7} width={w - 6} height={h - 14} rx={2} fill="#2b2525" />
      <rect x={4} y={8} width={w - 8} height={2} rx={1} fill="#fff" opacity={0.07} />
      {Array.from({ length: 8 }, (_, i) => {
        const on = !!lit?.[i];
        const x = 11 + i * pitch;
        return (
          <g key={i}>
            <title>{`LED ${i}${on ? ' · ติด' : ''}`}</title>
            {on && <rect x={x - 9} y={9} width={18} height={h - 18} rx={6} fill="url(#pm-glow)" opacity={glow(level, i)} />}
            <rect x={x - 4.5} y={13} width={9} height={h - 26} rx={1.5} fill="#4e1714" stroke="#3a1210" strokeWidth={0.8} />
            {on && <rect x={x - 4.5} y={13} width={9} height={h - 26} rx={1.5} fill="#ff5a47" stroke="#ffb3a8" strokeWidth={0.8} opacity={glow(level, i)} />}
            <rect x={x - 3} y={15} width={2} height={h - 30} rx={1} fill="#fff" opacity={on ? 0.55 : 0.12} />
          </g>
        );
      })}
    </>
  );
}

const SEGS = 'abcdefg';

function SevenSeg({ w, h, lit, level }: { w: number; h: number; lit?: boolean[]; level?: number[] }) {
  const on = SEGS.split('').filter((_, i) => lit?.[i]).join('');
  const t = 5;
  const L = 15;
  const R = w - 15;
  const T = 18;
  const B = h - 18;
  const Mi = h / 2;
  const hz = (x1: number, x2: number, y: number) =>
    `${x1},${y} ${x1 + t / 2},${y - t / 2} ${x2 - t / 2},${y - t / 2} ${x2},${y} ${x2 - t / 2},${y + t / 2} ${x1 + t / 2},${y + t / 2}`;
  const vt = (x: number, y1: number, y2: number) =>
    `${x},${y1} ${x + t / 2},${y1 + t / 2} ${x + t / 2},${y2 - t / 2} ${x},${y2} ${x - t / 2},${y2 - t / 2} ${x - t / 2},${y1 + t / 2}`;
  const segs: Record<string, string> = {
    a: hz(L + 2, R - 2, T),
    b: vt(R, T + 2, Mi - 2),
    c: vt(R, Mi + 2, B - 2),
    d: hz(L + 2, R - 2, B),
    e: vt(L, Mi + 2, B - 2),
    f: vt(L, T + 2, Mi - 2),
    g: hz(L + 2, R - 2, Mi),
  };
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const x = 8 + i * ((w - 16) / 4) - 2;
        return (
          <g key={i} fill="url(#pm-pin)">
            <rect x={x} y={0} width={4} height={7} rx={1} />
            <rect x={x} y={h - 7} width={4} height={7} rx={1} />
          </g>
        );
      })}
      <rect x={2} y={5} width={w - 4} height={h - 10} rx={3} fill="#1c1818" />
      <rect x={6} y={9} width={w - 12} height={h - 18} rx={2} fill="#131010" />
      {Object.entries(segs).map(([k, pts]) => (
        <g key={k}>
          <polygon points={pts} fill="#352828" />
          {on.includes(k) && <polygon points={pts} fill="#ff4d3d" stroke="#ff4d3d" strokeOpacity={0.35} strokeWidth={3} opacity={glow(level, SEGS.indexOf(k))} />}
        </g>
      ))}
      <circle cx={R + 6} cy={B + 1} r={2.4} fill={lit?.[7] ? '#ff4d3d' : '#352828'} />
    </>
  );
}

function Tactile({ w, h, pressed }: { w: number; h: number; pressed: boolean }) {
  const s = Math.min(w, h) - 12;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return (
    <>
      {[y + 4, y + s - 8].map((ly) => (
        <g key={ly} fill="url(#pm-pin)">
          <rect x={x - 7} y={ly} width={8} height={4} rx={1} />
          <rect x={x + s - 1} y={ly} width={8} height={4} rx={1} />
        </g>
      ))}
      <rect x={x} y={y} width={s} height={s} rx={3} fill="url(#pm-metal)" stroke="#8f8682" strokeWidth={0.8} />
      {[
        [x + 4, y + 4],
        [x + s - 4, y + 4],
        [x + 4, y + s - 4],
        [x + s - 4, y + s - 4],
      ].map(([px, py]) => (
        <circle key={`${px}-${py}`} cx={px} cy={py} r={1.6} fill="#6b625e" />
      ))}
      <circle cx={cx} cy={cy} r={s * 0.36} fill="#2a2424" />
      <circle cx={cx} cy={cy + (pressed ? 0.8 : 0)} r={s * (pressed ? 0.27 : 0.31)} fill={pressed ? '#5a1010' : 'url(#pm-cap)'} />
      {!pressed && <ellipse cx={cx - 2.5} cy={cy - 3} rx={3} ry={1.8} fill="#fff" opacity={0.35} />}
    </>
  );
}

function Terminal({ w, h }: { w: number; h: number }) {
  const screws: [number, string, string][] = [
    [w * 0.27, '+5V', '#f2d6d2'],
    [w * 0.73, 'GND', '#cfc4bf'],
  ];
  return (
    <>
      <rect x={0} y={1} width={w} height={h - 2} rx={3} fill="#3a3232" />
      <rect x={0} y={1} width={w} height={5} rx={2} fill="#fff" opacity={0.07} />
      <path d={`M${w / 2} 4V${h - 4}`} stroke="#241f1f" strokeWidth={1.5} />
      {screws.map(([sx, label, col]) => (
        <g key={label}>
          <circle cx={sx} cy={14} r={8} fill="#241f1f" />
          <circle cx={sx} cy={14} r={6.5} fill="url(#pm-metal)" stroke="#7a716d" strokeWidth={0.6} />
          <path d={`M${sx - 4} ${18}L${sx + 4} ${10}`} stroke="#5d5552" strokeWidth={1.8} strokeLinecap="round" />
          <text x={sx} y={h - 5} textAnchor="middle" fontFamily={MONO} fontSize={7.5} fontWeight={700} fill={col}>
            {label}
          </text>
        </g>
      ))}
    </>
  );
}

function Oscillator({ w, h, marking }: { w: number; h: number; marking?: string }) {
  return (
    <>
      {[
        [10, h - 4],
        [w - 10, h - 4],
        [w - 10, 0],
        [10, 0],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 2} y={y} width={4} height={4} rx={1} fill="url(#pm-pin)" />
      ))}
      {/* full-size DIP-14 can: three round corners, the pin-1 corner square */}
      <path
        d={`M3 ${h - 3}V9a6 6 0 0 1 6-6H${w - 9}a6 6 0 0 1 6 6V${h - 9}a6 6 0 0 1-6 6Z`}
        fill="url(#pm-can)"
        stroke="#9a918d"
        strokeWidth={1}
      />
      <rect x={8} y={7} width={w - 16} height={h - 14} rx={4} fill="none" stroke="#fff" strokeOpacity={0.55} />
      <circle cx={11} cy={h - 10} r={1.8} fill="#6b625e" />
      <text x={w / 2} y={h / 2 + (h > 40 ? 0 : 4)} textAnchor="middle" fontFamily={MONO} fontSize={11} fontWeight={700} fill="#4a3b3b">
        {marking ?? ''}
      </text>
      {h > 40 && (
        <text x={w / 2} y={h / 2 + 11} textAnchor="middle" fontFamily={MONO} fontSize={7.5} fill="#75686a" letterSpacing={0.8}>
          XTAL OSC
        </text>
      )}
    </>
  );
}

const BAND = ['#1a1a1a', '#7a4a1e', '#c62828', '#e8742a', '#e6c229', '#3a8a3a', '#2f5fb3', '#7b3fa0', '#8a8a8a', '#f4f4f4'];

function Resistor({ w, h, val }: { w: number; h: number; val: number }) {
  const cy = h / 2;
  const l = 10; // body start
  const r = w - 10; // body end
  const bulge = 7; // half height at the ends
  const waist = 5.5; // half height in the middle
  const k = (r - l) / 4;
  const body = `M${l + 3} ${cy - bulge}H${l + k - 1}C${l + k + 1} ${cy - bulge} ${l + k + 1} ${cy - waist} ${l + k + 3} ${cy - waist}H${r - k - 3}C${r - k - 1} ${cy - waist} ${r - k - 1} ${cy - bulge} ${r - k + 1} ${cy - bulge}H${r - 3}Q${r} ${cy - bulge} ${r} ${cy}Q${r} ${cy + bulge} ${r - 3} ${cy + bulge}H${r - k + 1}C${r - k - 1} ${cy + bulge} ${r - k - 1} ${cy + waist} ${r - k - 3} ${cy + waist}H${l + k + 3}C${l + k + 1} ${cy + waist} ${l + k + 1} ${cy + bulge} ${l + k - 1} ${cy + bulge}H${l + 3}Q${l} ${cy + bulge} ${l} ${cy}Q${l} ${cy - bulge} ${l + 3} ${cy - bulge}Z`;
  // two digits, multiplier, ±5 % gold — e.g. 330 Ω = orange orange brown gold
  const [d1, d2, e] = resCode(val).split('').map(Number);
  const bands: [number, number, string][] = [
    [l + k * 0.45, bulge, BAND[d1]],
    [l + k * 1.55, waist, BAND[d2]],
    [l + k * 2.2, waist, BAND[e]],
    [r - k * 0.45, bulge, '#b8964a'],
  ];
  return (
    <>
      <path d={`M0 ${cy}H${w}`} stroke="url(#pm-pin)" strokeWidth={2.2} />
      <path d={`M0 ${cy}H${w}`} stroke="#a8a19d" strokeWidth={2.2} opacity={0.6} />
      <path d={body} fill="url(#pm-resistor)" stroke="#b39a74" strokeWidth={0.6} />
      {bands.map(([x, hh, c], i) => (
        <rect key={i} x={x - 1.6} y={cy - hh + 0.4} width={3.2} height={hh * 2 - 0.8} fill={c} />
      ))}
      <rect x={l + 3} y={cy - waist + 1} width={r - l - 6} height={1.6} rx={0.8} fill="#fff" opacity={0.35} />
    </>
  );
}

/** Header pins along the bottom edge, matching the board's pin positions. */
function Header({ w, h, n }: { w: number; h: number; n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={w / 2 + (i - (n - 1) / 2) * 12 - 2} y={h - 7} width={4} height={7} rx={1} fill="url(#pm-pin)" />
      ))}
    </>
  );
}

function Leads({ w, h }: { w: number; h: number }) {
  return <path d={`M0 ${h / 2}H${w}`} stroke="#a8a19d" strokeWidth={2.2} />;
}

function Pot({ w, h, pos }: { w: number; h: number; pos: number }) {
  const cx = w / 2;
  const cy = (h - 7) / 2 + 1;
  const r = Math.min(w, h - 7) / 2 - 2;
  // the knob turns through 270°, 0 % at lower left
  const a = ((-225 + 270 * pos) * Math.PI) / 180;
  return (
    <>
      <Header w={w} h={h} n={3} />
      <rect x={2} y={1} width={w - 4} height={h - 8} rx={4} fill="#2f5fb3" />
      <circle cx={cx} cy={cy} r={r} fill="#e9e3df" stroke="#9a918d" />
      <circle cx={cx} cy={cy} r={r - 4} fill="#f7f4f2" />
      <path d={`M${cx} ${cy}L${cx + Math.cos(a) * (r - 2)} ${cy + Math.sin(a) * (r - 2)}`} stroke="#6e1414" strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

function Ldr({ w, h }: { w: number; h: number }) {
  const cx = w / 2;
  const cy = h / 2;
  const r = h / 2 - 1;
  return (
    <>
      <Leads w={w} h={h} />
      <circle cx={cx} cy={cy} r={r} fill="#f1e6cf" stroke="#b39a74" />
      <path
        d={`M${cx - r + 4} ${cy - 5}H${cx + r - 5}V${cy - 1.5}H${cx - r + 5}V${cy + 2}H${cx + r - 5}V${cy + 5.5}H${cx - r + 4}`}
        fill="none"
        stroke="#c0542b"
        strokeWidth={1.4}
      />
    </>
  );
}

function Ntc({ w, h }: { w: number; h: number }) {
  return (
    <>
      <Leads w={w} h={h} />
      <ellipse cx={w / 2} cy={h / 2} rx={9} ry={h / 2 - 2} fill="#2b4a7a" stroke="#1b3157" />
      <ellipse cx={w / 2 - 3} cy={h / 2 - 4} rx={3} ry={2} fill="#fff" opacity={0.35} />
    </>
  );
}

function To92({ w, h, marking = 'LM35' }: { w: number; h: number; marking?: string }) {
  const bh = h - 9;
  return (
    <>
      <Header w={w} h={h} n={3} />
      <path d={`M4 ${bh}V${bh * 0.45}A${w / 2 - 4} ${bh * 0.45} 0 0 1 ${w - 4} ${bh * 0.45}V${bh}Z`} fill="#1e1a1a" />
      <text x={w / 2} y={bh * 0.72} textAnchor="middle" fontFamily={MONO} fontSize={8} fontWeight={700} fill="#d9d1cc">
        {marking}
      </text>
    </>
  );
}

function Pir({ w, h, active }: { w: number; h: number; active: boolean }) {
  const r = Math.min(w, h - 9) / 2 - 3;
  return (
    <>
      <Header w={w} h={h} n={3} />
      <rect x={1} y={1} width={w - 2} height={h - 8} rx={4} fill="url(#pm-pcb-green)" />
      <circle cx={w / 2} cy={(h - 7) / 2} r={r} fill="url(#pm-dome)" stroke={active ? '#ff5a47' : '#bdb5b0'} strokeWidth={active ? 2.5 : 1} />
      {[0.35, 0.6, 0.85].map((k) => (
        <circle key={k} cx={w / 2} cy={(h - 7) / 2} r={r * k} fill="none" stroke="#cfc8c3" strokeWidth={0.6} />
      ))}
    </>
  );
}

/** IR obstacle module and light-sensor module: blue PCB, trimpot, indicator LED, the sensing element at the right. */
function Module({ w, h, kind, pos, active }: { w: number; h: number; kind: 'IR' | 'LDM'; pos: number; active: boolean }) {
  const bh = h - 8;
  const a = ((-225 + 270 * pos) * Math.PI) / 180;
  const tx = 22;
  const ty = bh / 2;
  return (
    <>
      <Header w={w} h={h} n={kind === 'LDM' ? 4 : 3} />
      <rect x={1} y={1} width={w - 2} height={bh} rx={3} fill="url(#pm-pcb)" />
      {/* trimpot */}
      <rect x={tx - 8} y={ty - 8} width={16} height={16} rx={2} fill="#3d6fd1" stroke="#9fb9ec" strokeWidth={0.6} />
      <circle cx={tx} cy={ty} r={5} fill="#f2efe9" />
      <path d={`M${tx} ${ty}L${tx + Math.cos(a) * 4.5} ${ty + Math.sin(a) * 4.5}`} stroke="#2b2525" strokeWidth={1.6} strokeLinecap="round" />
      {/* indicator */}
      <circle cx={40} cy={8} r={3} fill={active ? '#4dff7a' : '#1e5a32'} />
      {active && <circle cx={40} cy={8} r={6} fill="#4dff7a" opacity={0.3} />}
      {kind === 'IR' ? (
        <>
          <circle cx={w - 22} cy={ty} r={6} fill="#e9eef2" stroke="#9aa4ab" />
          <circle cx={w - 9} cy={ty} r={6} fill="#1e1a1a" stroke="#555" />
        </>
      ) : (
        <>
          <circle cx={w - 13} cy={ty} r={9} fill="#f1e6cf" stroke="#b39a74" />
          <path d={`M${w - 19} ${ty - 3}H${w - 8}V${ty}H${w - 18}V${ty + 3}H${w - 8}`} fill="none" stroke="#c0542b" strokeWidth={1.2} />
        </>
      )}
    </>
  );
}

function Reed({ w, h, closed }: { w: number; h: number; closed: boolean }) {
  const cy = h / 2;
  return (
    <>
      <Leads w={w} h={h} />
      <rect x={10} y={cy - 7} width={w - 20} height={14} rx={7} fill="url(#pm-glass)" stroke="#9fbcc6" />
      <path d={`M10 ${cy}H${w / 2 + 3}`} stroke="#6b625e" strokeWidth={2} />
      <path d={`M${w - 10} ${cy}H${w / 2 + 1}L${w / 2 - 3} ${closed ? cy : cy - 4}`} fill="none" stroke="#6b625e" strokeWidth={2} />
    </>
  );
}

function Tilt({ w, h, closed }: { w: number; h: number; closed: boolean }) {
  const cy = h / 2;
  return (
    <>
      <Leads w={w} h={h} />
      <rect x={12} y={2} width={w - 24} height={h - 4} rx={5} fill="#2b2525" />
      <circle cx={closed ? w / 2 - 6 : w / 2 + 6} cy={cy} r={4} fill="url(#pm-metal)" />
    </>
  );
}

/** RDM6300: small PCB with the 125 kHz antenna coil; the LED blinks while a card's number goes out. */
function Rfid({ w, h, active }: { w: number; h: number; active: boolean }) {
  const bh = h - 8;
  return (
    <>
      <Header w={w} h={h} n={3} />
      <rect x={1} y={1} width={w - 2} height={bh} rx={3} fill="url(#pm-pcb-green)" />
      {[0, 4, 8].map((k) => (
        <rect key={k} x={w - 46 + k} y={5 + k} width={40 - k * 2} height={bh - 10 - k * 2} rx={6} fill="none" stroke="#c98a3a" strokeWidth={1.6} />
      ))}
      <rect x={8} y={8} width={22} height={14} rx={1.5} fill="#1e1a1a" />
      <text x={19} y={bh - 6} textAnchor="middle" fontFamily={MONO} fontSize={7} fontWeight={700} fill="#d8eadc">
        RFID
      </text>
      <circle cx={38} cy={bh - 9} r={3} fill={active ? '#4dff7a' : '#1e5a32'} />
      {active && <circle cx={38} cy={bh - 9} r={7} fill="#4dff7a" opacity={0.3} />}
    </>
  );
}

/**
 * The Z80 trainer: a green PCB with its CPU, EPROM, RAM and glue chips soldered
 * on, a status LED over every port bit, and header pins along the bottom edge
 * (OUT 01h, OUT 02h, IN 03h, then +5V and GND).
 */
function Trainer({ w, h, lit }: { w: number; h: number; lit?: boolean[] }) {
  const pcbH = h - 6;
  const chip = (x: number, y: number, cw: number, ch: number, label: string, key: string) => (
    <g key={key}>
      <rect x={x} y={y} width={cw} height={ch} rx={2} fill="url(#pm-chip)" />
      <text x={x + cw / 2} y={y + ch / 2 + 3} textAnchor="middle" fontFamily={MONO} fontSize={8} fontWeight={600} fill="#e9e3df">
        {label}
      </text>
    </g>
  );
  const groupX = (g: number) => [kitPinX(1 + g * 8) - 8, kitPinX(8 + g * 8) + 8] as const;
  return (
    <>
      <rect x={0} y={0} width={w} height={pcbH} rx={8} fill="url(#pm-pcb-green)" />
      <rect x={3} y={3} width={w - 6} height={pcbH - 6} rx={6} fill="none" stroke="#7fbf94" strokeOpacity={0.35} />
      {/* the circuit the students don't wire */}
      {chip(14, 12, 128, 26, 'Z80 CPU', 'cpu')}
      {chip(152, 12, 74, 26, '2764 ROM', 'rom')}
      {chip(236, 12, 74, 26, '6264 RAM', 'ram')}
      {chip(320, 12, 40, 26, "'138", 'd1')}
      {chip(366, 12, 40, 26, "'574", 'l1')}
      <rect x={414} y={12} width={22} height={26} rx={3} fill="url(#pm-can)" />
      <text x={w - 12} y={30} textAnchor="end" fontFamily={MONO} fontSize={9} fontWeight={700} fill="#d8eedd" letterSpacing={0.5}>
        Z80
      </text>
      <text x={14} y={52} fontFamily={MONO} fontSize={8} fill="#bfe0c9" letterSpacing={0.4}>
        Z80 TRAINER · CPU / ROM / RAM / CLK ต่อไว้แล้ว
      </text>
      {KIT_PORTS.map(({ port, dir }, g) => {
        const [x0, x1] = groupX(g);
        return (
          <g key={port}>
            <text x={(x0 + x1) / 2} y={66} textAnchor="middle" fontFamily={MONO} fontSize={10} fontWeight={700} fill="#fff">
              {dir === 'out' ? 'OUT' : 'IN'} {port.toString(16).padStart(2, '0').toUpperCase()}h
            </text>
            {Array.from({ length: 8 }, (_, i) => {
              const x = kitPinX(1 + g * 8 + i);
              const on = !!lit?.[g * 8 + i];
              return (
                <g key={i}>
                  <circle cx={x} cy={78} r={3.6} fill={on ? (dir === 'out' ? 'url(#pm-led-on)' : '#f6c945') : '#173d24'} stroke="#0f2c19" strokeWidth={0.6} />
                  <text x={x} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#bfe0c9">
                    {i}
                  </text>
                </g>
              );
            })}
            <rect x={x0} y={pcbH - 11} width={x1 - x0} height={10} rx={2} fill="#141111" />
          </g>
        );
      })}
      <text x={(kitPinX(25) + kitPinX(26)) / 2} y={66} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight={700} fill="#fff">
        POWER
      </text>
      <text x={kitPinX(27)} y={66} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight={700} fill="#fff">
        ADC
      </text>
      <text x={kitPinX(27)} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#bfe0c9">
        AIN
      </text>
      <rect x={kitPinX(27) - 8} y={pcbH - 11} width={16} height={10} rx={2} fill="#141111" />
      <text x={(kitPinX(28) + kitPinX(29)) / 2} y={66} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight={700} fill="#fff">
        UART
      </text>
      <text x={kitPinX(28)} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#bfe0c9">
        RXD
      </text>
      <text x={kitPinX(29)} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#bfe0c9">
        TXD
      </text>
      <rect x={kitPinX(28) - 8} y={pcbH - 11} width={kitPinX(29) - kitPinX(28) + 16} height={10} rx={2} fill="#141111" />
      <text x={kitPinX(25)} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#ffb3a8">
        +5V
      </text>
      <text x={kitPinX(26)} y={91} textAnchor="middle" fontFamily={MONO} fontSize={6.5} fill="#bfe0c9">
        GND
      </text>
      <rect x={kitPinX(25) - 8} y={pcbH - 11} width={kitPinX(26) - kitPinX(25) + 16} height={10} rx={2} fill="#141111" />
      {Array.from({ length: 29 }, (_, k) => (
        <rect key={k} x={kitPinX(k + 1) - 2.5} y={pcbH - 9} width={5} height={h - pcbH + 9} rx={1} fill="url(#pm-pin)" />
      ))}
    </>
  );
}

/** Sound, vibration, flame, water and gas modules: blue PCB, indicator LED, the sensing element at the right. */
function DigitalModule({ w, h, kind, active }: { w: number; h: number; kind: 'SND' | 'VIB' | 'FLM' | 'H2O' | 'GAS'; active: boolean }) {
  const bh = h - 8;
  const cy = bh / 2;
  const trim = kind === 'SND' || kind === 'GAS';
  return (
    <>
      <Header w={w} h={h} n={3} />
      <rect x={1} y={1} width={w - 2} height={bh} rx={3} fill="url(#pm-pcb)" />
      {trim && (
        <>
          <rect x={6} y={cy - 7} width={14} height={14} rx={2} fill="#3d6fd1" stroke="#9fb9ec" strokeWidth={0.6} />
          <circle cx={13} cy={cy} r={4.5} fill="#f2efe9" />
        </>
      )}
      <circle cx={trim ? 30 : 12} cy={8} r={3} fill={active ? '#4dff7a' : '#1e5a32'} />
      {active && <circle cx={trim ? 30 : 12} cy={8} r={6} fill="#4dff7a" opacity={0.3} />}
      {kind === 'SND' && (
        <>
          <circle cx={w - 16} cy={cy} r={11} fill="#c9c4c0" stroke="#8f8884" />
          <circle cx={w - 16} cy={cy} r={7.5} fill="#2b2525" />
          {[-3, 0, 3].flatMap((dx) => [-3, 0, 3].map((dy) => <circle key={`${dx},${dy}`} cx={w - 16 + dx} cy={cy + dy} r={0.8} fill="#6b6461" />))}
        </>
      )}
      {kind === 'VIB' && (
        <>
          <rect x={w - 34} y={cy - 5} width={26} height={10} rx={5} fill="url(#pm-metal)" stroke="#8f8884" />
          <path d={`M${w - 30} ${cy}h18`} stroke="#8f8884" strokeWidth={1} strokeDasharray="2 1.5" />
        </>
      )}
      {kind === 'FLM' && (
        <>
          <circle cx={w - 14} cy={cy} r={7} fill="#141111" stroke="#4a4442" />
          <ellipse cx={w - 16} cy={cy - 2} rx={2.2} ry={1.4} fill="#fff" opacity={0.35} />
          {active && <path d={`M${w - 14} ${cy - 15}c4 4 4 7 0 9c-4 -2 -4 -5 0 -9z`} fill="#ff8a3d" />}
        </>
      )}
      {kind === 'H2O' && (
        <g fill="none" stroke={active ? '#7fd3ff' : '#e7c46a'} strokeWidth={1.4}>
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${w - 38} ${cy - 10 + i * 6.5}H${w - 6}`} />
          ))}
          <path d={`M${w - 38} ${cy - 10}V${cy + 9.5}M${w - 6} ${cy - 3.5}V${cy + 3}`} />
        </g>
      )}
      {kind === 'GAS' && (
        <>
          <circle cx={w - 17} cy={cy} r={13} fill="url(#pm-metal)" stroke="#8f8884" />
          <circle cx={w - 17} cy={cy} r={9} fill="none" stroke="#a49c97" strokeWidth={0.8} strokeDasharray="1.5 1.5" />
          <circle cx={w - 17} cy={cy} r={5} fill={active ? '#ffb38a' : '#d9d3cf'} />
        </>
      )}
    </>
  );
}

/** TTP223 touch pad: a small red board with a round pad. */
function TouchPad({ w, h, active }: { w: number; h: number; active: boolean }) {
  const bh = h - 8;
  return (
    <>
      <Header w={w} h={h} n={3} />
      <rect x={1} y={1} width={w - 2} height={bh} rx={4} fill="#b3261e" />
      <circle cx={w / 2} cy={bh / 2 + 2} r={13} fill={active ? '#f6c945' : '#e2b04a'} stroke="#7a1712" strokeWidth={1.2} />
      <circle cx={w / 2} cy={bh / 2 + 2} r={8} fill="none" stroke="#7a1712" strokeWidth={0.8} opacity={0.5} />
      <circle cx={w - 8} cy={7} r={2.4} fill={active ? '#ff5a47' : '#5e1210'} />
    </>
  );
}

const PCB: Record<ModLook['pcb'], string> = { blue: '#2d5aa8', green: '#2f7a4a', red: '#b3261e', black: '#2b2626', purple: '#5b3a8c' };

/** The sensing or working part of a catalogue module, centred at (cx, cy). */
function ModPart({ part, cx, cy, active }: { part: ModLook['part']; cx: number; cy: number; active: boolean }) {
  switch (part) {
    case 'mesh':
      return (
        <>
          <circle cx={cx} cy={cy} r={13} fill="url(#pm-metal)" stroke="#8f8884" />
          <circle cx={cx} cy={cy} r={9} fill="none" stroke="#a49c97" strokeWidth={0.8} strokeDasharray="1.5 1.5" />
          <circle cx={cx} cy={cy} r={4.5} fill={active ? '#ffb38a' : '#d9d3cf'} />
        </>
      );
    case 'lens':
      return (
        <>
          <circle cx={cx - 6} cy={cy} r={5.5} fill="#e9eef2" stroke="#9aa4ab" />
          <circle cx={cx + 7} cy={cy} r={5.5} fill="#1e1a1a" stroke="#555" />
        </>
      );
    case 'slot':
      return (
        <>
          <rect x={cx - 12} y={cy - 11} width={9} height={22} rx={1.5} fill="#1e1a1a" />
          <rect x={cx + 3} y={cy - 11} width={9} height={22} rx={1.5} fill="#1e1a1a" />
          {active && <rect x={cx - 3} y={cy - 9} width={6} height={18} fill="#e9e3df" opacity={0.85} />}
        </>
      );
    case 'probe':
      return <path d={`M${cx - 8} ${cy - 12}v24M${cx + 8} ${cy - 12}v24`} stroke="#d9b45c" strokeWidth={4} strokeLinecap="round" />;
    case 'pad':
      return (
        <g fill="none" stroke="#e7c46a" strokeWidth={1.3}>
          <rect x={cx - 14} y={cy - 11} width={28} height={22} rx={3} fill={active ? '#ffe6a8' : 'none'} />
          <path d={`M${cx - 10} ${cy - 6}H${cx + 10}M${cx - 10} ${cy}H${cx + 10}M${cx - 10} ${cy + 6}H${cx + 10}`} />
        </g>
      );
    case 'chip':
      return (
        <>
          <rect x={cx - 11} y={cy - 8} width={22} height={16} rx={1.5} fill="url(#pm-chip)" />
          <path d={`M${cx - 8} ${cy - 10}v2M${cx - 3} ${cy - 10}v2M${cx + 2} ${cy - 10}v2M${cx + 7} ${cy - 10}v2M${cx - 8} ${cy + 8}v2M${cx - 3} ${cy + 8}v2M${cx + 2} ${cy + 8}v2M${cx + 7} ${cy + 8}v2`} stroke="#bdb5b0" strokeWidth={1.4} />
        </>
      );
    case 'disc':
      return (
        <>
          <circle cx={cx} cy={cy} r={12} fill="#c9a24a" stroke="#8a6d2a" />
          <circle cx={cx} cy={cy} r={7.5} fill={active ? '#fff2c2' : '#e8e2d6'} />
        </>
      );
    case 'can':
      return (
        <>
          <circle cx={cx} cy={cy} r={10} fill="#1e1a1a" stroke="#4a4442" />
          <circle cx={cx} cy={cy} r={3} fill={active ? '#ff5a47' : '#3a3432'} />
        </>
      );
    case 'coil':
      return (
        <>
          <rect x={cx - 15} y={cy - 11} width={30} height={22} rx={2} fill={active ? '#4d8fe8' : '#2f6fd1'} stroke="#9fb9ec" strokeWidth={0.6} />
          <path d={`M${cx - 10} ${cy - 4}h20M${cx - 10} ${cy + 1}h20M${cx - 10} ${cy + 6}h14`} stroke="#d6e3fb" strokeWidth={0.9} />
        </>
      );
    case 'cyl':
      return (
        <>
          <rect x={cx - 16} y={cy - 7} width={32} height={14} rx={3} fill="url(#pm-metal)" stroke="#8f8884" />
          <path d={`M${cx - 10} ${cy - 7}v14M${cx - 4} ${cy - 7}v14M${cx + 2} ${cy - 7}v14`} stroke="#a49c97" strokeWidth={0.8} />
          <circle cx={cx + 12} cy={cy} r={2.5} fill={active ? '#ff5a47' : '#5e5653'} />
        </>
      );
    case 'led':
      return (
        <>
          <circle cx={cx} cy={cy} r={9} fill={active ? 'url(#pm-led-on)' : '#e9e3df'} stroke="#9aa4ab" />
          {active && <circle cx={cx} cy={cy} r={14} fill="url(#pm-glow)" />}
        </>
      );
    case 'motor':
      return (
        <>
          <circle cx={cx} cy={cy} r={12} fill="url(#pm-metal)" stroke="#8f8884" />
          <path d={`M${cx} ${cy - 9}L${cx + 3} ${cy}L${cx} ${cy + 9}L${cx - 3} ${cy}Z`} fill="#5e5653" className={active ? 'pm-spin' : undefined} />
        </>
      );
    case 'lever':
      return (
        <>
          <rect x={cx - 13} y={cy - 6} width={26} height={12} rx={2} fill="#1e1a1a" />
          <rect x={active ? cx + 2 : cx - 9} y={cy - 4} width={7} height={8} rx={1.5} fill="#e9e3df" />
        </>
      );
    case 'button':
      return (
        <>
          <circle cx={cx} cy={cy} r={11} fill="#1e1a1a" />
          <circle cx={cx} cy={cy} r={active ? 6.5 : 8} fill="#c62828" />
        </>
      );
    default: // dome
      return (
        <>
          <rect x={cx - 7} y={cy - 9} width={14} height={18} rx={3} fill="#1e1a1a" />
          <circle cx={cx} cy={cy - 2} r={4} fill="#3a3432" />
        </>
      );
  }
}

/** A catalogue module on a coloured board: marking at the left, indicator LED, its part at the right. */
function CatalogModule({ w, h, look, active, pins = 3 }: { w: number; h: number; look?: ModLook; active: boolean; pins?: number }) {
  const bh = h - 8;
  return (
    <>
      <Header w={w} h={h} n={pins} />
      <rect x={1} y={1} width={w - 2} height={bh} rx={3} fill={PCB[look?.pcb ?? 'blue']} />
      <circle cx={9} cy={8} r={2.6} fill={active ? '#4dff7a' : '#1e3a2a'} />
      {active && <circle cx={9} cy={8} r={5.5} fill="#4dff7a" opacity={0.3} />}
      <text x={5} y={bh - 6} fontFamily={MONO} fontSize={7} fontWeight={700} fill="#f4efec" textLength={look && look.tag.length > 7 ? 44 : undefined} lengthAdjust="spacingAndGlyphs">
        {look?.tag ?? 'MODULE'}
      </text>
      <ModPart part={look?.part ?? 'chip'} cx={w - 20} cy={bh / 2} active={active} />
    </>
  );
}

/** A two-lead switch from the catalogue. */
function CatalogSwitch({ w, h, look, closed }: { w: number; h: number; look?: ModLook; closed: boolean }) {
  const cy = h / 2;
  return (
    <>
      <Leads w={w} h={h} />
      <rect x={10} y={1} width={w - 20} height={h - 2} rx={4} fill="#2b2626" />
      <ModPart part={look?.part ?? 'lever'} cx={w / 2 - 6} cy={cy} active={closed} />
      <text x={w - 13} y={cy + 3} textAnchor="end" fontFamily={MONO} fontSize={6} fontWeight={700} fill="#d9d1cc">
        {(look?.tag ?? '').slice(0, 6)}
      </text>
    </>
  );
}
