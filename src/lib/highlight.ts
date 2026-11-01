import { M, M_DEEP, M_MID, MUTED } from './tokens';

export type Lang = 'c' | 'mips' | 'z80';
export interface Seg {
  t: string;
  color: string;
  w: number;
}

type Role = 'kw' | 'num' | 'label' | 'op' | 'reg' | 'comment' | 'dir';
const STYLE: Record<Role, [string, number]> = {
  kw: [M, 600],
  num: [M_MID, 400],
  label: ['inherit', 700],
  op: ['inherit', 600],
  reg: [M, 400],
  comment: [MUTED, 400],
  dir: [M_DEEP, 600],
};

const C_RE =
  /(\/\/.*$|\/\*.*?\*\/)|(\b(?:int|void|char|unsigned|const|for|while|do|if|else|return|break|continue)\b)|(\b(?:0x[0-9a-fA-F]+|\d+)\b|'\\?.')/g;
const MIPS_RE = /(#.*$)|(^\s*[A-Za-z_.][\w.]*:)|(\.[a-z]+\b)|(\$\w+)|(-?\b(?:0x[0-9a-fA-F]+|\d+)\b)/g;
const Z80_RE = /(;.*$)|(^\s*[A-Za-z_]\w*:)|(\b[0-9][0-9A-Fa-f]*[hH]\b|\b\d+\b)/g;

/** Tokenises one line of source into coloured segments (C / MIPS / Z80). */
export function highlight(src: string, lang: Lang): Seg[] {
  const re = new RegExp(lang === 'c' ? C_RE : lang === 'z80' ? Z80_RE : MIPS_RE);
  const roles: Role[] =
    lang === 'c' ? ['comment', 'kw', 'num'] : lang === 'z80' ? ['comment', 'label', 'num'] : ['comment', 'label', 'dir', 'reg', 'num'];
  const out: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (t: string) => {
    if (!t) return;
    // the first word of a MIPS / Z80 statement is the mnemonic
    if (lang !== 'c' && !out.some((s) => s.w === 600 && s.color === 'inherit')) {
      const mm = /^(\s*)([A-Za-z]+)/.exec(t);
      const before = out.map((s) => s.t).join('');
      if (mm && /^\s*([A-Za-z_.][\w.]*:)?\s*$/.test(before)) {
        if (mm[1]) out.push({ t: mm[1], color: 'inherit', w: 400 });
        out.push({ t: mm[2], color: 'inherit', w: 600 });
        t = t.slice(mm[0].length);
      }
    }
    if (t) out.push({ t, color: 'inherit', w: 400 });
  };
  while ((m = re.exec(src))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    plain(src.slice(last, m.index));
    const g = m.slice(1).findIndex((x) => x != null);
    const [color, w] = STYLE[roles[g]];
    out.push({ t: m[0], color, w });
    last = m.index + m[0].length;
  }
  plain(src.slice(last));
  return out;
}

export interface RichPart {
  t: string;
  kind: 'text' | 'code' | 'bold';
}

/** Parses `inline code` and **bold** markers in Thai prose. */
export function rich(str: string): RichPart[] {
  return str
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((p) => {
      if (p[0] === '`') return { t: p.slice(1, -1), kind: 'code' as const };
      if (p.startsWith('**')) return { t: p.slice(2, -2), kind: 'bold' as const };
      return { t: p, kind: 'text' as const };
    });
}
