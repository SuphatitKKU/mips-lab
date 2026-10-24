import { FUNCT, ISA_PROFILE, OPCODE, REGISTER_INDEX } from './isa';

export interface Instruction {
  address: number;
  line: number;
  source: string;
  op: string;
  args: string[];
  word: number;
}
export interface Program { instructions: Instruction[]; labels: Record<string, number>; data: { address: number; value: number }[] }
export class AssemblyError extends Error {
  constructor(message: string, public line: number) { super(`Line ${line}: ${message}`); this.name = 'AssemblyError'; }
}
type Draft = Omit<Instruction, 'word'>;
const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const signed16 = (n: number, line: number) => { if (n < -32768 || n > 32767) throw new AssemblyError('immediate outside signed 16-bit range', line); return n & 0xffff; };
const unsigned16 = (n: number, line: number) => { if (n < 0 || n > 65535) throw new AssemblyError('immediate outside unsigned 16-bit range', line); return n; };
const reg = (s: string, line: number) => { const n = REGISTER_INDEX[s.toLowerCase()]; if (n === undefined) throw new AssemblyError(`unknown register ${s}`, line); return n; };
const number = (s: string, line: number) => { const n = /^[-+]?0x[\da-f]+$/i.test(s) ? Number.parseInt(s, 16) : /^[-+]?\d+$/.test(s) ? Number(s) : NaN; if (!Number.isSafeInteger(n)) throw new AssemblyError(`invalid number ${s}`, line); return n; };
const need = (a: string[], n: number, line: number) => { if (a.length !== n) throw new AssemblyError(`expected ${n} operand(s), got ${a.length}`, line); };
const rWord = (rs: number, rt: number, rd: number, sh: number, fn: number) => ((rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | fn) >>> 0;
const iWord = (op: number, rs: number, rt: number, imm: number) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff)) >>> 0;

function expand(op: string, args: string[], line: number): { op: string; args: string[] }[] {
  const one = (o: string, a: string[]) => [{ op: o, args: a }];
  switch (op) {
    case 'nop': need(args, 0, line); return one('sll', ['$zero', '$zero', '0']);
    case 'move': need(args, 2, line); return one('addu', [args[0], args[1], '$zero']);
    case 'b': need(args, 1, line); return one('beq', ['$zero', '$zero', args[0]]);
    case 'li': {
      need(args, 2, line); const n = number(args[1], line);
      if (n < -2147483648 || n > 0xffffffff) throw new AssemblyError('li value outside 32-bit range', line);
      if (n >= -32768 && n <= 32767) return one('addiu', [args[0], '$zero', String(n)]);
      const u = n >>> 0;
      return [{ op: 'lui', args: [args[0], String(u >>> 16)] }, { op: 'ori', args: [args[0], args[0], String(u & 0xffff)] }];
    }
    case 'la': {
      need(args, 2, line);
      return [{ op: 'lui', args: [args[0], `%hi(${args[1]})`] }, { op: 'ori', args: [args[0], args[0], `%lo(${args[1]})`] }];
    }
    case 'blt': case 'bgt': case 'ble': case 'bge': {
      need(args, 3, line);
      const [a, b, target] = args;
      const flipped = op === 'bgt' || op === 'ble';
      return [{ op: 'slt', args: ['$at', flipped ? b : a, flipped ? a : b] }, { op: op === 'blt' || op === 'bgt' ? 'bne' : 'beq', args: ['$at', '$zero', target] }];
    }
    default: return one(op, args);
  }
}

function encode(d: Draft, labels: Record<string, number>): number {
  const { op, args: a, line, address } = d;
  const imm = (s: string, signed = true) => {
    const relocation = /^%(hi|lo)\((\w+)\)$/.exec(s);
    if (relocation) {
      if (!has(labels, relocation[2])) throw new AssemblyError(`unknown label ${relocation[2]}`, line);
      const value = labels[relocation[2]] >>> 0;
      return relocation[1] === 'hi' ? value >>> 16 : value & 0xffff;
    }
    return (signed ? signed16 : unsigned16)(number(s, line), line);
  };
  const branch = (s: string) => {
    if (!has(labels, s)) return imm(s);
    const delta = labels[s] - (address + 4);
    if (delta % 4) throw new AssemblyError('unaligned branch target', line);
    return signed16(delta / 4, line);
  };
  if (has(FUNCT, op)) {
    const fn = FUNCT[op as keyof typeof FUNCT];
    if (['add','addu','sub','subu','and','or','xor','nor','slt','sltu'].includes(op)) { need(a, 3, line); return rWord(reg(a[1], line), reg(a[2], line), reg(a[0], line), 0, fn); }
    if (['sll','srl','sra'].includes(op)) { need(a, 3, line); const sh = number(a[2], line); if (sh < 0 || sh > 31) throw new AssemblyError('shift amount must be 0–31', line); return rWord(0, reg(a[1], line), reg(a[0], line), sh, fn); }
    if (['sllv','srlv','srav'].includes(op)) { need(a, 3, line); return rWord(reg(a[2], line), reg(a[1], line), reg(a[0], line), 0, fn); }
    if (['mult','multu','div','divu'].includes(op)) { need(a, 2, line); return rWord(reg(a[0], line), reg(a[1], line), 0, 0, fn); }
    if (['mfhi','mflo'].includes(op)) { need(a, 1, line); return rWord(0, 0, reg(a[0], line), 0, fn); }
    if (op === 'jr') { need(a, 1, line); return rWord(reg(a[0], line), 0, 0, 0, fn); }
    if (op === 'jalr') { if (a.length < 1 || a.length > 2) throw new AssemblyError('jalr expects rs or rd, rs', line); return rWord(reg(a.at(-1)!, line), 0, a.length === 2 ? reg(a[0], line) : 31, 0, fn); }
    if (op === 'syscall') { need(a, 0, line); return rWord(0, 0, 0, 0, fn); }
  }
  if (!has(OPCODE, op)) throw new AssemblyError(`unsupported instruction ${op}`, line);
  const code = OPCODE[op as keyof typeof OPCODE];
  if (op === 'j' || op === 'jal') {
    need(a, 1, line); const target = has(labels, a[0]) ? labels[a[0]] : number(a[0], line);
    if (target % 4) throw new AssemblyError('unaligned jump target', line);
    if ((target >>> 28) !== ((address + 4) >>> 28)) throw new AssemblyError('jump target outside current 256 MB region', line);
    return ((code << 26) | ((target >>> 2) & 0x3ffffff)) >>> 0;
  }
  if (op === 'mfc0') { need(a, 2, line); const cop = number(a[1].replace(/^\$/, ''), line); if (cop < 0 || cop > 31) throw new AssemblyError('CP0 register must be 0–31', line); return ((code << 26) | (reg(a[0], line) << 16) | (cop << 11)) >>> 0; }
  if (op === 'lui') { need(a, 2, line); return iWord(code, 0, reg(a[0], line), imm(a[1], false)); }
  if (['beq','bne'].includes(op)) { need(a, 3, line); return iWord(code, reg(a[0], line), reg(a[1], line), branch(a[2])); }
  if (['blez','bgtz'].includes(op)) { need(a, 2, line); return iWord(code, reg(a[0], line), 0, branch(a[1])); }
  if (['lb','lh','lw','lbu','lhu','sb','sh','sw','ll','sc'].includes(op)) {
    need(a, 2, line); const m = /^(.+)\((\$[\w]+)\)$/.exec(a[1]);
    if (!m) throw new AssemblyError('memory operand must be offset($register)', line);
    return iWord(code, reg(m[2], line), reg(a[0], line), imm(m[1]));
  }
  need(a, 3, line);
  return iWord(code, reg(a[1], line), reg(a[0], line), imm(a[2], !['andi','ori','xori'].includes(op)));
}

export function assemble(source: string): Program {
  const labels: Record<string, number> = Object.create(null);
  const drafts: Draft[] = [];
  let address = ISA_PROFILE.textBase;
  let dataAddress: number = ISA_PROFILE.dataBase;
  let section: 'text' | 'data' = 'text';
  const data: Program['data'] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let s = raw.replace(/[#;].*$/, '').trim();
    if (!s) return;
    if (s === '.text' || s === '.data') { section = s.slice(1) as 'text' | 'data'; return; }
    if (/^\.globl\s+\w+$/.test(s)) return;
    while (true) {
      const m = /^([A-Za-z_]\w*):/.exec(s);
      if (!m) break;
      if (has(labels, m[1])) throw new AssemblyError(`duplicate label ${m[1]}`, line);
      labels[m[1]] = section === 'text' ? address : dataAddress;
      s = s.slice(m[0].length).trim();
    }
    if (!s) return;
    const m = /^([\w.]+)(?:\s+(.*))?$/.exec(s);
    if (!m) throw new AssemblyError('invalid instruction', line);
    const op = m[1].toLowerCase();
    const args = m[2] ? m[2].split(',').map(x => x.trim()).filter(Boolean) : [];
    if (args.some(a => !a)) throw new AssemblyError('empty operand', line);
    if (section === 'data') {
      const width = op === '.byte' ? 1 : op === '.half' ? 2 : op === '.word' ? 4 : 0;
      if (op === '.space') {
        need(args, 1, line); const count = number(args[0], line);
        if (count < 0 || count > 1_000_000) throw new AssemblyError('.space size outside 0–1000000', line);
        dataAddress += count; return;
      }
      if (!width) throw new AssemblyError(`unsupported data directive ${op}`, line);
      if (!args.length) throw new AssemblyError(`${op} needs at least one value`, line);
      for (const arg of args) {
        if (dataAddress % width) throw new AssemblyError(`${op} address is not aligned`, line);
        const value = number(arg, line);
        const min = width === 4 ? -2147483648 : -(2 ** (width * 8 - 1));
        const max = width === 4 ? 0xffffffff : 2 ** (width * 8) - 1;
        if (value < min || value > max) throw new AssemblyError(`${op} value outside range`, line);
        for (let b = 0; b < width; b++) {
          const shift = 8 * (ISA_PROFILE.endian === 'little' ? b : width - 1 - b);
          data.push({ address: dataAddress++, value: (value >>> shift) & 255 });
        }
      }
      return;
    }
    for (const item of expand(op, args, line)) { drafts.push({ address, line, source: raw.trim(), ...item }); address += 4; }
  });
  return { labels, data, instructions: drafts.map(d => ({ ...d, word: encode(d, labels) })) };
}

export function fields(word: number) {
  const opcode = word >>> 26;
  return { format: opcode === 0 ? 'R' : opcode === 2 || opcode === 3 ? 'J' : 'I',
    opcode, rs: (word >>> 21) & 31, rt: (word >>> 16) & 31, rd: (word >>> 11) & 31,
    shamt: (word >>> 6) & 31, funct: word & 63, immediate: word & 0xffff, address: word & 0x3ffffff,
    binary: word.toString(2).padStart(32, '0'), hex: `0x${word.toString(16).padStart(8, '0')}` };
}
