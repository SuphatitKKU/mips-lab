import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Problem } from '@lab/contracts';
import { compileC, judge } from '../src';

const directory = join(import.meta.dirname, '../../../content/problems/mips');
const files = readdirSync(directory).filter(x => x.endsWith('.json'));
describe('MIPS problem content', () => {
  it('has 15 unique, valid problems with passing Assembly and C solutions', () => {
    expect(files).toHaveLength(15);
    const ids = new Set<string>();
    for (const file of files) {
      const p = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Problem;
      expect(ids.has(p.id), file).toBe(false); ids.add(p.id);
      expect(p.tests.length, file).toBeGreaterThanOrEqual(3);
      const asmResult = judge(p.solution.asm, p.tests);
      expect(asmResult, `${file} assembly`).toMatchObject({ passed: p.tests.length, total: p.tests.length, failures: [] });
      const compiled = compileC(p.solution.c);
      const cResult = judge(compiled.asm, p.tests);
      expect(cResult, `${file} C`).toMatchObject({ passed: p.tests.length, total: p.tests.length, failures: [] });
    }
  });
});
