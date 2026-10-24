import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';

const mips = StreamLanguage.define({
  token(stream) {
    if (stream.match(/[#;].*/)) return 'comment';
    if (stream.sol() && stream.match(/[\w.]+:/)) return 'labelName';
    if (stream.match(/\$[\w]+/)) return 'variableName';
    if (stream.match(/(?:-?0x[\da-fA-F]+|-?\d+)/)) return 'number';
    if (stream.match(/[\w.]+/)) return 'keyword';
    stream.next(); return null;
  },
});

export function CodeEditor({ value, onChange, onLineClick, selectedLine, language = 'mips', readOnly = false, height = 350 }: {
  value: string; onChange?: (value: string) => void; onLineClick?: (line: number) => void; selectedLine?: number; language?: 'mips' | 'c'; readOnly?: boolean; height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callback = useRef(onChange); callback.current = onChange;
  const lineCallback = useRef(onLineClick); lineCallback.current = onLineClick;
  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLine(), drawSelection(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle), language === 'c' ? cpp() : mips,
      EditorView.theme({ '&': { height: `${height}px`, fontSize: '14px' }, '.cm-scroller': { overflow: 'auto', fontFamily: '"Noto Sans Mono", Consolas, monospace' }, '.cm-content': { padding: '12px 0' }, '.cm-line': { lineHeight: '2.15' }, '.cm-gutters': { background: '#fff', color: '#868c98', borderRight: '0', paddingLeft: '10px' }, '.cm-activeLine': { background: '#eef9c9' }, '.cm-activeLineGutter': { background: '#eef9c9' } }),
      EditorView.updateListener.of(update => { if (update.docChanged) callback.current?.(update.state.doc.toString()); }),
      EditorView.domEventHandlers({ click: (event, editor) => { const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY }); if (pos !== null) lineCallback.current?.(editor.state.doc.lineAt(pos).number); } }),
      EditorState.readOnly.of(readOnly),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    return () => { view.current?.destroy(); view.current = null; };
  }, [language, readOnly, height]);
  useEffect(() => {
    const editor = view.current; if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !selectedLine || selectedLine > editor.state.doc.lines) return;
    editor.dispatch({ selection: { anchor: editor.state.doc.line(selectedLine).from } });
  }, [selectedLine]);
  return <div className="code-editor" ref={host} />;
}
