import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { highlight, type Lang } from '../lib/highlight';
import { Segs } from './ui';

export interface LineMark {
  bg: string;
  title?: string;
}

interface Props {
  value: string;
  onChange?: (v: string) => void;
  lang: Lang;
  /** 1-based line → background */
  marks?: Map<number, LineMark>;
  onLineClick?: (line: number) => void;
  readOnly?: boolean;
  label: string;
  minLines?: number;
  style?: CSSProperties;
  /** scroll to `line` and put the caret there; bump `n` to jump again to the same line */
  goto?: { line: number; n: number };
}

const LH = 26;
const PAD = 10;

/** Plain textarea over a syntax-highlighted copy, with line numbers and per-line marks. */
export function CodeEditor({ value, onChange, lang, marks, onLineClick, readOnly, label, minLines = 8, style, goto }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const lines = value.split('\n');
  const rows = Math.max(lines.length, minLines);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Tab' && !e.shiftKey && !readOnly) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t } = el;
      const next = value.slice(0, s) + '    ' + value.slice(t);
      onChange?.(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    } else if (e.key === 'Enter' && !readOnly) {
      // keep the current line's indentation
      e.preventDefault();
      const s = el.selectionStart;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^\s*/.exec(value.slice(lineStart, s))![0];
      const next = value.slice(0, s) + '\n' + indent + value.slice(el.selectionEnd);
      onChange?.(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 1 + indent.length, s + 1 + indent.length));
    }
  };

  const lineFromEvent = (y: number) => Math.floor((y - PAD) / LH) + 1;

  useEffect(() => {
    if (!goto) return;
    const el = box.current;
    if (el) el.scrollTop = Math.max(0, PAD + (goto.line - 1) * LH - el.clientHeight / 3);
    const t = ta.current;
    if (!t) return;
    const at = value.split('\n').slice(0, goto.line - 1).reduce((n, l) => n + l.length + 1, 0);
    t.focus({ preventScroll: true });
    t.setSelectionRange(at, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goto?.n]);

  return (
    <div ref={box} className="editor" style={style}>
      <div className="editor-gutter" aria-hidden="true" style={{ paddingTop: PAD, paddingBottom: PAD }}>
        {Array.from({ length: rows }, (_, i) => {
          const mk = marks?.get(i + 1);
          return (
            <div
              key={i}
              title={mk?.title}
              style={{ height: LH, color: mk?.title ? 'var(--m)' : undefined, fontWeight: mk?.title ? 700 : undefined }}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
      <div className="editor-body">
        <div style={{ position: 'relative', minWidth: 'max-content', minHeight: rows * LH + 2 * PAD }}>
          <pre aria-hidden="true" className="editor-pre" style={{ padding: PAD, lineHeight: LH + 'px' }}>
            {Array.from({ length: rows }, (_, i) => {
              const mk = marks?.get(i + 1);
              return (
                <div key={i} style={{ height: LH, background: mk?.bg, margin: '0 -10px', padding: '0 10px', borderRadius: 8 }}>
                  <Segs segs={highlight(lines[i] ?? '', lang)} />
                  {'​'}
                </div>
              );
            })}
          </pre>
          <textarea
            ref={ta}
            aria-label={label}
            className="editor-ta"
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKey}
            // the textarea is always as big as its text, so it must never scroll itself — if it does
            // (for a frame while it grows) the typed text slides away from the highlighted copy underneath
            onScroll={(e) => {
              e.currentTarget.scrollTop = 0;
              e.currentTarget.scrollLeft = 0;
            }}
            onClick={(e) => {
              if (!onLineClick) return;
              const r = e.currentTarget.getBoundingClientRect();
              onLineClick(lineFromEvent(e.clientY - r.top));
            }}
            style={{ padding: PAD, lineHeight: LH + 'px', cursor: readOnly && onLineClick ? 'pointer' : undefined }}
          />
        </div>
      </div>
    </div>
  );
}
