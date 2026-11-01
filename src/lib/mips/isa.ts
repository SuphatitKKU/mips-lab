// MIPS32 instruction set tables shared by the assembler, CPU and decoder.

export const RN = [
  'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra',
] as const;
export type RegName = (typeof RN)[number];

export const TEXT_BASE = 0x00400000;
export const DATA_BASE = 0x10010000;
export const GP_INIT = 0x10008000;
export const SP_INIT = 0x7fffeffc;
/** $ra starts here; `jr $ra` back to it means the function returned to its caller. */
export const RA_EXIT = 0x003ffffc;

/** Operand layout of an instruction as written in assembly. */
export type Syntax =
  | 'd,s,t' // add rd, rs, rt
  | 'd,t,s' // sllv rd, rt, rs
  | 'd,t,h' // sll rd, rt, shamt
  | 's' // jr rs / mthi rs
  | 'd,s' // jalr rd, rs
  | 's,t' // mult rs, rt
  | 'd' // mfhi rd
  | 't,s,i' // addi rt, rs, imm
  | 't,i' // lui rt, imm
  | 't,o(s)' // lw rt, off(rs)
  | 's,t,L' // beq rs, rt, label
  | 's,L' // bgez rs, label
  | 'L' // j label
  | ''; // syscall

export interface OpDef {
  name: string;
  fmt: 'R' | 'I' | 'J';
  op: number;
  funct?: number;
  /** REGIMM branches (bltz/bgez) encode the condition in rt */
  rt?: number;
  syntax: Syntax;
  /** immediate is zero-extended (andi/ori/xori) rather than sign-extended */
  unsigned?: boolean;
}

const R = (name: string, funct: number, syntax: Syntax): OpDef => ({ name, fmt: 'R', op: 0, funct, syntax });
const I = (name: string, op: number, syntax: Syntax, unsigned = false): OpDef => ({ name, fmt: 'I', op, syntax, unsigned });

export const OPS: OpDef[] = [
  R('sll', 0, 'd,t,h'), R('srl', 2, 'd,t,h'), R('sra', 3, 'd,t,h'),
  R('sllv', 4, 'd,t,s'), R('srlv', 6, 'd,t,s'), R('srav', 7, 'd,t,s'),
  R('jr', 8, 's'), R('jalr', 9, 'd,s'), R('syscall', 12, ''), R('break', 13, ''),
  R('mfhi', 16, 'd'), R('mthi', 17, 's'), R('mflo', 18, 'd'), R('mtlo', 19, 's'),
  R('mult', 24, 's,t'), R('multu', 25, 's,t'), R('div', 26, 's,t'), R('divu', 27, 's,t'),
  R('add', 32, 'd,s,t'), R('addu', 33, 'd,s,t'), R('sub', 34, 'd,s,t'), R('subu', 35, 'd,s,t'),
  R('and', 36, 'd,s,t'), R('or', 37, 'd,s,t'), R('xor', 38, 'd,s,t'), R('nor', 39, 'd,s,t'),
  R('slt', 42, 'd,s,t'), R('sltu', 43, 'd,s,t'),
  { name: 'bltz', fmt: 'I', op: 1, rt: 0, syntax: 's,L' },
  { name: 'bgez', fmt: 'I', op: 1, rt: 1, syntax: 's,L' },
  { name: 'j', fmt: 'J', op: 2, syntax: 'L' },
  { name: 'jal', fmt: 'J', op: 3, syntax: 'L' },
  I('beq', 4, 's,t,L'), I('bne', 5, 's,t,L'), I('blez', 6, 's,L'), I('bgtz', 7, 's,L'),
  I('addi', 8, 't,s,i'), I('addiu', 9, 't,s,i'), I('slti', 10, 't,s,i'), I('sltiu', 11, 't,s,i'),
  I('andi', 12, 't,s,i', true), I('ori', 13, 't,s,i', true), I('xori', 14, 't,s,i', true),
  I('lui', 15, 't,i', true),
  I('lb', 32, 't,o(s)'), I('lh', 33, 't,o(s)'), I('lw', 35, 't,o(s)'), I('lbu', 36, 't,o(s)'), I('lhu', 37, 't,o(s)'),
  I('sb', 40, 't,o(s)'), I('sh', 41, 't,o(s)'), I('sw', 43, 't,o(s)'),
  I('ll', 48, 't,o(s)'), I('sc', 56, 't,o(s)'),
];

export const OP_BY_NAME = new Map(OPS.map((o) => [o.name, o]));

export interface Fields {
  op: number;
  rs: number;
  rt: number;
  rd: number;
  shamt: number;
  funct: number;
  /** sign-extended 16-bit immediate */
  imm: number;
  /** zero-extended 16-bit immediate */
  uimm: number;
  target: number;
}

export function fields(word: number): Fields {
  const w = word >>> 0;
  const imm16 = w & 0xffff;
  return {
    op: w >>> 26,
    rs: (w >>> 21) & 31,
    rt: (w >>> 16) & 31,
    rd: (w >>> 11) & 31,
    shamt: (w >>> 6) & 31,
    funct: w & 63,
    imm: imm16 & 0x8000 ? imm16 - 0x10000 : imm16,
    uimm: imm16,
    target: w & 0x3ffffff,
  };
}

/** Finds the instruction definition for a machine word, or null if unknown. */
export function opOf(word: number): OpDef | null {
  const f = fields(word);
  return (
    OPS.find((o) =>
      o.op !== f.op ? false : o.op === 0 ? o.funct === f.funct : o.op === 1 ? o.rt === f.rt : true,
    ) ?? null
  );
}

export const hx = (v: number) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

export interface BinField {
  bits: string;
  label: string;
  width: number;
}

/** Splits a 32-bit instruction into its R/I/J-type fields with readable labels. */
export function decode(word: number): { type: string; fields: BinField[] } {
  const b = (word >>> 0).toString(2).padStart(32, '0');
  const def = opOf(word);
  const op = word >>> 26;
  const F: [number, number, string][] =
    op === 0
      ? [[0, 6, 'op'], [6, 11, 'rs'], [11, 16, 'rt'], [16, 21, 'rd'], [21, 26, 'shamt'], [26, 32, 'funct']]
      : op === 2 || op === 3
        ? [[0, 6, 'op'], [6, 32, 'address']]
        : [[0, 6, 'op'], [6, 11, 'rs'], [11, 16, 'rt'], [16, 32, 'immediate']];
  const type = op === 0 ? 'R-type' : op === 2 || op === 3 ? 'J-type' : 'I-type';
  const out = F.map(([s, e, l]) => {
    const bits = b.slice(s, e);
    const v = parseInt(bits, 2);
    let label = l;
    if (l === 'rs' || l === 'rt' || l === 'rd') label += ' · $' + RN[v];
    else if (l === 'funct') label += ' · ' + (def?.name ?? v);
    else if (l === 'op' && op !== 0) label += ' · ' + (def?.name ?? v);
    else if (l === 'shamt' && v) label += ' · ' + v;
    else if (l === 'immediate') label += ' · ' + (def?.unsigned ? v : v > 32767 ? v - 65536 : v);
    else if (l === 'address') label += ' · 0x' + hx(v * 4);
    return { bits, label, width: e - s };
  });
  return { type, fields: out };
}
