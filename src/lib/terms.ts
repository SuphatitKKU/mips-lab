// Thai academic terms, shared by the server and the pages.
// Year is Buddhist Era (พ.ศ.). Term 1 ≈ Jun–Oct, term 2 ≈ Nov–Mar, term 3 = ภาคเรียนพิเศษ (special/summer) ≈ Apr–May.

export interface ClassInfo {
  id: number;
  name: string;
  year: number;
  term: number;
  code: string;
  archived: boolean;
}

/** The academic term a date falls in. */
export function termOf(t: number | Date = Date.now()): { year: number; term: number } {
  const d = new Date(t);
  const m = d.getMonth(); // 0 = Jan
  const be = d.getFullYear() + 543;
  if (m >= 5 && m <= 9) return { year: be, term: 1 };
  if (m >= 10) return { year: be, term: 2 };
  if (m <= 2) return { year: be - 1, term: 2 };
  return { year: be - 1, term: 3 };
}

/** "1/2569", "2/2569", or "พิเศษ/2569" for the special term (3). Keep in sync with sectionSql on the server. */
export const termText = (c: { year: number; term: number }) => `${c.term === 3 ? 'พิเศษ' : c.term}/${c.year}`;

/** "SEC 1 · 2/2569" */
export const classLabel = (c: { name: string; year: number; term: number }) => `${c.name} · ${termText(c)}`;

/** Join codes skip look-alike characters (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
