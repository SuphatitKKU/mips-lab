import type { JudgeFn, JudgeResult, Reg } from '@lab/contracts';
import { AssemblyError, assemble } from './assembler';
import { MipsError, Simulator } from './simulator';

export const judge: JudgeFn = (asmSource, tests) => {
  const result: JudgeResult = { passed: 0, total: tests.length, failures: [] };
  let program;
  try { program = assemble(asmSource); }
  catch (error) {
    result.error = { code: 'Syntax', message: error instanceof Error ? error.message : String(error), line: error instanceof AssemblyError ? error.line : undefined };
    return result;
  }
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const sim = new Simulator(program, test.input);
    try { sim.run(); }
    catch (error) {
      result.error = error instanceof MipsError ? { code: error.code, message: error.message, line: error.line } : { code: 'Syntax', message: String(error) };
      break;
    }
    const misses = Object.entries(test.expected).filter(([reg, expected]) => sim.getRegister(reg as Reg) !== (expected! | 0));
    if (misses.length === 0) result.passed++;
    for (const [reg, expected] of misses) result.failures.push({ case: i + 1, reg: reg as Reg, expected: expected! | 0, got: sim.getRegister(reg as Reg) });
  }
  return result;
};
