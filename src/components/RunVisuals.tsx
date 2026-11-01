// Picture-first views for the run mode: what the last instruction did as a
// flow (inputs → operation → results), the register file as labelled boxes,
// memory as a column of numbered drawers, and the history as a timeline.

import type { ReactNode } from 'react';
import { hex, type StepInfo } from '../lib/mips/cpu';
import type { RegName } from '../lib/mips/isa';

/** Big numbers (addresses) read better in hex; everyday numbers in decimal. */
export const smart = (v: number) => (v > 0xfffff || v < -0xfffff ? '0x' + hex(v) : String(v));

const OPS: Record<string, [sym: string, word: string]> = {
  add: ['+', 'บวก'], addu: ['+', 'บวก'], addi: ['+', 'บวก'], addiu: ['+', 'บวก'],
  sub: ['−', 'ลบ'], subu: ['−', 'ลบ'],
  slt: ['<', 'น้อยกว่าไหม'], sltu: ['<', 'น้อยกว่าไหม'], slti: ['<', 'น้อยกว่าไหม'], sltiu: ['<', 'น้อยกว่าไหม'],
  and: ['&', 'AND ทีละบิต'], andi: ['&', 'AND ทีละบิต'], or: ['|', 'OR ทีละบิต'], ori: ['|', 'OR ทีละบิต'],
  xor: ['^', 'XOR ทีละบิต'], xori: ['^', 'XOR ทีละบิต'], nor: ['~|', 'NOR ทีละบิต'],
  sll: ['«', 'เลื่อนบิตซ้าย'], sllv: ['«', 'เลื่อนบิตซ้าย'], srl: ['»', 'เลื่อนบิตขวา'], srlv: ['»', 'เลื่อนบิตขวา'], sra: ['»', 'เลื่อนขวาคงเครื่องหมาย'], srav: ['»', 'เลื่อนขวาคงเครื่องหมาย'],
  lui: ['«16', 'ใส่ไว้ 16 บิตบน'],
  lw: ['อ่าน', 'อ่านจาก memory'], lh: ['อ่าน', 'อ่านจาก memory'], lhu: ['อ่าน', 'อ่านจาก memory'], lb: ['อ่าน', 'อ่านจาก memory'], lbu: ['อ่าน', 'อ่านจาก memory'],
  sw: ['เขียน', 'เขียนลง memory'], sh: ['เขียน', 'เขียนลง memory'], sb: ['เขียน', 'เขียนลง memory'],
  beq: ['=?', 'เท่ากันไหม'], bne: ['≠?', 'ไม่เท่ากันไหม'], bltz: ['<0?', 'ติดลบไหม'], bgez: ['≥0?', 'ไม่ติดลบไหม'], blez: ['≤0?', 'ไม่เกิน 0 ไหม'], bgtz: ['>0?', 'มากกว่า 0 ไหม'],
  j: ['↷', 'กระโดด'], jal: ['↷', 'เรียกฟังก์ชัน'], jr: ['↩', 'กระโดดตาม register'], jalr: ['↷', 'เรียกฟังก์ชัน'],
  mult: ['×', 'คูณ'], multu: ['×', 'คูณ'], div: ['÷', 'หาร'], divu: ['÷', 'หาร'],
  mfhi: ['HI', 'คัดลอกจาก HI'], mflo: ['LO', 'คัดลอกจาก LO'], mthi: ['HI', 'ใส่ลง HI'], mtlo: ['LO', 'ใส่ลง LO'],
  syscall: ['OS', 'เรียกระบบ'],
};

interface FlowNode {
  label: string;
  value: string;
  old?: string;
  kind: 'reg' | 'num' | 'mem' | 'pc';
}

function Node({ n, out }: { n: FlowNode; out?: boolean }) {
  return (
    <div className={`flow-node ${n.kind}${out ? ' out' : ''}`}>
      <span className="flow-label">{n.label}</span>
      <span className="flow-value">{n.value}</span>
    </div>
  );
}

const Arrow = () => (
  <svg className="flow-arrow" width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">
    <path d="M2 8h20M16 2l7 6-7 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The last instruction as a picture: values in → operation → what changed. */
export function StepFlow({ step, labelAt }: { step: StepInfo; labelAt: (addr: number) => string }) {
  const [sym, word] = OPS[step.name] ?? [step.name, step.name];
  const mem = step.kind === 'load' || step.kind === 'store';
  const inputs: FlowNode[] = step.reads.map((r) => ({ kind: 'reg', label: '$' + r.k, value: smart(r.v) }));
  if (step.imm != null && step.kind !== 'branch')
    inputs.push({ kind: 'num', label: mem ? 'offset' : step.kind === 'shift' ? 'เลื่อนกี่บิต' : 'ค่าคงที่', value: String(step.imm) });

  const outputs: FlowNode[] = [
    ...step.changes.map((x) => ({
      kind: 'reg' as const,
      label: x.k === 'hi' || x.k === 'lo' ? x.k.toUpperCase() : '$' + x.k,
      value: smart(x.n),
      old: smart(x.o),
    })),
    ...step.mem.map((m) => ({ kind: 'mem' as const, label: `memory 0x${hex(m.addr)}`, value: smart(m.n), old: smart(m.o) })),
  ];
  if (step.kind === 'branch' || step.kind === 'jump' || step.kind === 'jr')
    outputs.push({ kind: 'pc', label: step.jump ? 'กระโดดไปที่' : 'ไม่กระโดด', value: step.jump ? labelAt(step.pcNew) : 'คำสั่งถัดไป' });
  const middle = step.memRead ? { kind: 'mem' as const, label: `memory 0x${hex(step.memRead.addr)}`, value: smart(step.memRead.v) } : null;

  return (
    <div className="flow" role="img" aria-label={`${step.ins.basic}: ${word}`}>
      <div className="flow-col">
        <span className="flow-cap">ค่าที่อ่าน</span>
        {inputs.length ? inputs.map((n, i) => <Node key={i} n={n} />) : <span className="flow-none">ไม่ได้อ่านค่า</span>}
      </div>
      <Arrow />
      <div className="flow-op">
        <span className="flow-sym">{sym}</span>
        <span className="flow-word">{word}</span>
      </div>
      {middle && (
        <>
          <Arrow />
          <div className="flow-col">
            <span className="flow-cap">ได้จาก memory</span>
            <Node n={middle} />
          </div>
        </>
      )}
      <Arrow />
      <div className="flow-col">
        <span className="flow-cap">ผลลัพธ์</span>
        {outputs.length ? outputs.map((n, i) => <Node key={i} n={n} out />) : <span className="flow-none">ไม่มีค่าเปลี่ยน</span>}
      </div>
    </div>
  );
}

// ---------- "what is this?" banners ----------

export function Explainer({ art, title, children }: { art: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="explain">
      <span className="explain-art" aria-hidden="true">
        {art}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <b>{title}</b>
        <span>{children}</span>
      </div>
    </div>
  );
}

/** a CPU chip holding a grid of little boxes */
export const RegArt = (
  <svg width="64" height="52" viewBox="0 0 64 52">
    {[10, 22, 34, 46].map((x) => (
      <g key={x} stroke="#b5a8a4" strokeWidth="2" strokeLinecap="round">
        <path d={`M${x} 2v5M${x} 45v5`} />
      </g>
    ))}
    <rect x="5" y="7" width="54" height="38" rx="7" fill="#2a1f1f" />
    {[0, 1, 2, 3].map((i) =>
      [0, 1].map((j) => <rect key={`${i}${j}`} x={11 + i * 11.5} y={13 + j * 14} width="9" height="11" rx="2" fill={i === 1 && j === 0 ? '#ff5a47' : '#5a4d4f'} />),
    )}
  </svg>
);

/** a cabinet of numbered drawers */
export const MemArt = (
  <svg width="64" height="52" viewBox="0 0 64 52">
    <rect x="12" y="2" width="40" height="48" rx="5" fill="#f2d6d2" stroke="#8a1c1c" strokeWidth="2" />
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <rect x="17" y={7 + i * 10.5} width="30" height="8" rx="2" fill={i === 2 ? '#8a1c1c' : '#fff'} />
        <text x="20" y={13.2 + i * 10.5} fontSize="5.5" fontFamily="monospace" fill={i === 2 ? '#fff' : '#8a1c1c'}>
          {`${(i * 4).toString(16)}`}
        </text>
      </g>
    ))}
  </svg>
);

/** a vertical timeline */
export const HistArt = (
  <svg width="64" height="52" viewBox="0 0 64 52">
    <path d="M14 6v40" stroke="#e6c3be" strokeWidth="3" strokeLinecap="round" />
    {[8, 24, 40].map((y, i) => (
      <g key={y}>
        <circle cx="14" cy={y} r="5" fill={i === 2 ? '#8a1c1c' : '#f2d6d2'} stroke="#8a1c1c" strokeWidth="1.5" />
        <rect x="24" y={y - 3} width={i === 2 ? 32 : 24} height="6" rx="3" fill={i === 2 ? '#8a1c1c' : '#d9cfca'} />
      </g>
    ))}
  </svg>
);

// ---------- registers ----------

export const ROLE: Partial<Record<RegName, string>> = {
  zero: 'ค่า 0 เสมอ',
  at: 'assembler ใช้',
  v0: 'ค่าที่คืน',
  v1: 'ค่าที่คืน',
  a0: 'ค่าที่ส่งเข้า',
  a1: 'ค่าที่ส่งเข้า',
  a2: 'ค่าที่ส่งเข้า',
  a3: 'ค่าที่ส่งเข้า',
  gp: 'ตัวแปร global',
  sp: 'ยอด stack',
  fp: 'frame',
  ra: 'ที่อยู่ให้กลับ',
  k0: 'ระบบ',
  k1: 'ระบบ',
};
export const roleOf = (k: RegName) => ROLE[k] ?? (k.startsWith('t') ? 'ชั่วคราว' : k.startsWith('s') ? 'เก็บข้ามฟังก์ชัน' : '');
