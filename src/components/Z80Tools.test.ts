import { describe, expect, it } from 'vitest';
import { labelsOf } from './Z80Tools';

describe('Z80 code tools', () => {
  it('finds labels and EQU names with their lines', () => {
    expect(labelsOf('PORT EQU 01h\nSTART:  LD A, 1\n        NOP\nLOOP: JR LOOP')).toEqual([
      { name: 'PORT', line: 1 },
      { name: 'START', line: 2 },
      { name: 'LOOP', line: 4 },
    ]);
  });
});
