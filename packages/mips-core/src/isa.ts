import { REG_NAMES } from '@lab/contracts';

// Classroom profile: MARS default (no delay slot, little endian).
// Change this single profile only after agreeing with the instructor.
export const ISA_PROFILE = {
  textBase: 0x00400000,
  dataBase: 0x10000000,
  gp: 0x10008000,
  sp: 0x7ffffffc,
  delaySlot: false,
  endian: 'little' as 'little' | 'big',
} as const;

export const REGISTER_NAMES = REG_NAMES;
export const REGISTER_INDEX: Record<string, number> = Object.fromEntries(
  REG_NAMES.flatMap((name, i) => [[name, i], [`$${i}`, i]]),
);
REGISTER_INDEX.$s8 = 30;

export const OPCODE = {
  addi: 0x08, addiu: 0x09, andi: 0x0c, ori: 0x0d, xori: 0x0e,
  slti: 0x0a, sltiu: 0x0b, lui: 0x0f,
  beq: 0x04, bne: 0x05, blez: 0x06, bgtz: 0x07,
  j: 0x02, jal: 0x03,
  lb: 0x20, lh: 0x21, lw: 0x23, lbu: 0x24, lhu: 0x25,
  sb: 0x28, sh: 0x29, sw: 0x2b, ll: 0x30, sc: 0x38,
  mfc0: 0x10,
} as const;

export const FUNCT = {
  add: 0x20, addu: 0x21, sub: 0x22, subu: 0x23,
  and: 0x24, or: 0x25, xor: 0x26, nor: 0x27,
  slt: 0x2a, sltu: 0x2b,
  sll: 0x00, srl: 0x02, sra: 0x03,
  sllv: 0x04, srlv: 0x06, srav: 0x07,
  jr: 0x08, jalr: 0x09, syscall: 0x0c,
  mfhi: 0x10, mflo: 0x12, mult: 0x18, multu: 0x19,
  div: 0x1a, divu: 0x1b,
} as const;

export const SUPPORTED_INSTRUCTIONS = [
  ...Object.keys(OPCODE), ...Object.keys(FUNCT),
  'li', 'la', 'move', 'blt', 'bgt', 'ble', 'bge', 'b', 'nop',
] as const;
