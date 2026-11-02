// Flags pairs of students whose passing code for the same problem is nearly identical.
// Code is reduced to tokens (comments, spacing and case dropped; label and variable
// names replaced by a placeholder so renaming doesn't hide a copy), then compared as
// sets of 4-token runs (Jaccard). Very short answers are skipped: easy problems
// naturally converge on the same few lines.

/** Instruction / keyword words kept as-is; any other identifier becomes "id". */
const KEEP = new Set(
  (
    // MIPS
    'add addi addiu addu and andi beq bne bgez bgtz blez bltz j jal jr lb lbu lh lhu lui lw nor or ori sb sh sll sllv slt slti sltiu sltu sra srl srlv sub subu sw xor xori mult multu div divu mfhi mflo move li la nop syscall b beqz bnez blt bgt ble bge neg not mul ' +
    // Z80
    'ld push pop ex exx inc dec adc sbc cp cpl daa neg rla rlca rra rrca rl rlc rr rrc sla sra srl bit set res jp jr djnz call ret reti retn rst halt di ei im in out ' +
    // C
    'int char short long unsigned signed void if else for while do return break continue switch case default sizeof const static'
  ).split(/\s+/),
);

export function tokens(code: string): string[] {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // C block comments
    .replace(/\/\/.*$/gm, ' ') // C line comments
    .replace(/[#;].*$/gm, ' ') // MIPS (#) and Z80 (;) comments
    .toLowerCase();
  const out: string[] = [];
  for (const t of stripped.match(/\$?[a-z_][\w.]*|0x[0-9a-f]+|\d+|[^\s\w]/g) ?? []) {
    if (/^\$/.test(t)) out.push(t); // registers ($t0) keep their name
    else if (/^[a-z_]/.test(t)) out.push(KEEP.has(t) ? t : 'id');
    else out.push(t);
  }
  return out;
}

function shingles(t: string[], k = 4): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + k <= t.length; i++) s.add(t.slice(i, i + k).join(' '));
  return s;
}

export function similarity(a: string, b: string): number {
  const x = shingles(tokens(a));
  const y = shingles(tokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const s of x) if (y.has(s)) both++;
  return both / (x.size + y.size - both);
}

export interface Entry {
  userId: number;
  problemId: number;
  code: string;
}

export interface Pair {
  problemId: number;
  a: number;
  b: number;
  similarity: number;
}

/** Pairs at or above threshold, most similar first. Answers under minTokens tokens are ignored. */
export function findSimilar(entries: Entry[], threshold = 0.85, minTokens = 25): Pair[] {
  const byProblem = new Map<number, { userId: number; sh: Set<string> }[]>();
  for (const e of entries) {
    const t = tokens(e.code);
    if (t.length < minTokens) continue;
    const list = byProblem.get(e.problemId) ?? [];
    list.push({ userId: e.userId, sh: shingles(t) });
    byProblem.set(e.problemId, list);
  }
  const out: Pair[] = [];
  for (const [problemId, list] of byProblem)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i].sh;
        const y = list[j].sh;
        let both = 0;
        for (const s of x) if (y.has(s)) both++;
        const sim = both / (x.size + y.size - both);
        if (sim >= threshold) out.push({ problemId, a: list[i].userId, b: list[j].userId, similarity: sim });
      }
  return out.sort((p, q) => q.similarity - p.similarity);
}
