// Helpers for writing longer Z80 programs on the board page: a list of the
// program's labels to jump to, how much of the 8 KB EPROM the program takes,
// the project bar (.asm / .json import and export, examples) and the serial terminal.

import { useEffect, useRef, useState } from 'react';
import type { Board } from '../lib/z80/board';
import { EXAMPLES } from '../lib/z80/examples';
import { Icon, ICON } from './Icon';
import { Menu } from './Menu';
import { Modal } from './Modal';
import { usePopup } from './Popup';

// ---------- labels ----------

export interface AsmLabel {
  name: string;
  line: number;
}

/** "LOOP:" or "PORT EQU 01h" at the start of a line, in program order. */
export function labelsOf(code: string): AsmLabel[] {
  const out: AsmLabel[] = [];
  code.split('\n').forEach((l, i) => {
    const m = /^([A-Za-z_][\w]*)(:|\s+EQU\b)/i.exec(l);
    if (m) out.push({ name: m[1], line: i + 1 });
  });
  return out;
}

/** Jump list for the side of a big editor. */
export function LabelList({ code, onJump }: { code: string; onJump: (line: number) => void }) {
  const labels = labelsOf(code);
  return (
    <nav aria-label="label ในโปรแกรม" className="asm-outline">
      <b>Label</b>
      {labels.length === 0 && <span>ยังไม่มี label</span>}
      {labels.map((l) => (
        <button key={`${l.name}-${l.line}`} type="button" onClick={() => onJump(l.line)}>
          <span>{l.name}</span>
          <i>{l.line}</i>
        </button>
      ))}
    </nav>
  );
}

// ---------- the editor's toolbar ----------

const ROM_BYTES = 8192;

/** Expand to full screen; then how full the EPROM is. */
export function CodeToolbar({ onExpand, romSize }: { onExpand: () => void; romSize: number | null }) {
  return (
    <div className="code-tools">
      <button type="button" className="btn btn-soft" onClick={onExpand} title="ขยายช่องโค้ดเต็มจอ">
        <Icon d={ICON.expand} size={14} />
        ขยาย
      </button>
      {romSize != null && <RomUsage size={romSize} />}
    </div>
  );
}

export function RomUsage({ size }: { size: number }) {
  return (
    <span className="rom-usage" title="ขนาดโปรแกรมเทียบกับ EPROM 2764 (8 KB)">
      <span>
        ใช้ <b>{size.toLocaleString()}</b> / {ROM_BYTES.toLocaleString()} ไบต์
      </span>
      <i>
        <i style={{ width: `${Math.max(1, Math.min(100, (size / ROM_BYTES) * 100))}%` }} />
      </i>
    </span>
  );
}

// ---------- projects ----------

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFile = (name: string) => name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'z80';

/** Name, import and export the board + program (the page itself keeps the work on screen between visits). */
export function ProjectBar({
  name,
  onName,
  board,
  code,
  onOpen,
  fresh,
}: {
  name: string;
  onName: (n: string) => void;
  board: Board;
  code: string;
  onOpen: (p: { board: Board; code: string }) => void;
  /** what "โปรเจกต์ใหม่" starts from */
  fresh: { board: Board; code: string };
}) {
  const popup = usePopup();
  const fileIn = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // nothing to lose when the screen still holds a fresh board or an untouched example
  const untouched = () => !code.trim() || [fresh, ...EXAMPLES].some((p) => p.code === code && JSON.stringify(p.board) === JSON.stringify(board));
  const leave = async () =>
    untouched() ||
    (await popup.confirm({ title: 'แทนที่งานบนจอ?', body: 'บอร์ดและโค้ดตอนนี้จะถูกแทนที่ — กด “ดาวน์โหลด” เก็บไว้ก่อนถ้ายังต้องใช้', ok: 'แทนที่' }));
  /** .json = whole project (board + program), anything else = program only */
  const upload = async (f: File) => {
    let text: string;
    try {
      text = await f.text();
    } catch {
      return popup.toast('อ่านไฟล์ไม่ได้', 'err');
    }
    if (!(await leave())) return;
    if (/\.json$/i.test(f.name)) {
      try {
        const p = JSON.parse(text) as { name?: string; board?: Board; code?: string };
        if (!p.board || !Array.isArray(p.board.parts) || typeof p.code !== 'string') throw new Error();
        onName(p.name ?? f.name.replace(/\.json$/i, ''));
        onOpen({ board: p.board, code: p.code });
        popup.toast(`อัปโหลด ${f.name} แล้ว — แก้ต่อได้เลย`, 'ok');
      } catch {
        popup.toast('ไฟล์นี้ไม่ใช่โปรเจกต์บอร์ด Z80', 'err');
      }
      return;
    }
    if (!name.trim()) onName(f.name.replace(/\.[^.]+$/, ''));
    onOpen({ board, code: text });
    popup.toast(`อัปโหลดโค้ดจาก ${f.name} แล้ว (บอร์ดเดิมยังอยู่)`, 'ok');
  };

  return (
    <section aria-label="โปรเจกต์" className="card proj-bar">
      <span className="proj-label">โปรเจกต์</span>
      <input aria-label="ชื่อโปรเจกต์ (ใช้เป็นชื่อไฟล์ตอนดาวน์โหลด)" className="input" placeholder="ตั้งชื่อโปรเจกต์" value={name} maxLength={60} onChange={(e) => onName(e.target.value)} />
      <button type="button" className="btn btn-secondary" style={{ height: 38, gap: 6 }} onClick={() => setUploading(true)} title="เปิดไฟล์โปรเจกต์ (.json) หรือไฟล์โค้ด (.asm)">
        <Icon d={ICON.upload} size={15} />
        อัปโหลด
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ height: 38, gap: 6 }}
        onClick={() => download(`${safeFile(name)}.json`, JSON.stringify({ name, board, code }, null, 1), 'application/json')}
        title="ดาวน์โหลดบอร์ดและโค้ดเป็นไฟล์ .json ไว้อัปโหลดกลับมาทำต่อ"
      >
        <Icon d={ICON.download} size={15} />
        ดาวน์โหลด
      </button>
      <Menu
        label="ตัวเลือกโปรเจกต์"
        items={[
          ...EXAMPLES.map((ex) => ({
            label: `ตัวอย่าง: ${ex.name}`,
            onSelect: async () => {
              if (!(await leave())) return;
              onName(`ตัวอย่าง · ${ex.name}`);
              onOpen(ex);
              popup.toast(ex.desc);
            },
          })),
          {
            label: 'โปรเจกต์ใหม่',
            onSelect: async () => {
              if (!(await leave())) return;
              onName('');
              onOpen(fresh);
            },
          },
          { label: 'ดาวน์โหลดเฉพาะโค้ด (.asm)', onSelect: () => download(`${safeFile(name)}.asm`, code, 'text/plain') },
        ]}
      />
      <input
        ref={fileIn}
        type="file"
        accept=".json,.asm,.z80,.txt,application/json,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setUploading(false);
          void upload(f);
        }}
      />
      {uploading && (
        <Modal
          title="อัปโหลด"
          onClose={() => setUploading(false)}
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setUploading(false)}>
              ยกเลิก
            </button>
          }
        >
          <div className="upload-pop">
            <span>อัปโหลดได้ 2 แบบ</span>
            <div className="upload-kinds">
              <div>
                <b>.json</b>
                <span>
                  <b>ทั้งโปรเจกต์</b> — อุปกรณ์ สายที่ต่อ และโค้ด · ไฟล์ที่ได้จากปุ่ม “ดาวน์โหลด”
                </span>
              </div>
              <div>
                <b>.asm</b>
                <span>
                  <b>โค้ดอย่างเดียว</b> — ใส่ลงช่องโปรแกรม บอร์ดบนจอไม่เปลี่ยน · รับ .z80 และ .txt ด้วย
                </span>
              </div>
            </div>
            <div
              className={`upload-drop${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (!f) return;
                setUploading(false);
                void upload(f);
              }}
            >
              <Icon d={ICON.upload} size={26} />
              <span>ลากไฟล์มาวางตรงนี้</span>
              <button type="button" className="btn btn-primary" onClick={() => fileIn.current?.click()}>
                เลือกไฟล์
              </button>
            </div>
            <span className="upload-note">ถ้ามีงานบนจออยู่ จะถามก่อนแทนที่</span>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- serial terminal ----------

/** Bytes as terminal text: CR, LF or CR LF start a line, backspace rubs out, other control bytes show as ‹hex›. */
export function termText(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d) {
      out += '\n';
      if (bytes[i + 1] === 0x0a) i++;
    } else if (b === 0x0a) out += '\n';
    else if (b === 0x08) out = out.slice(0, -1);
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `‹${b.toString(16).toUpperCase().padStart(2, '0')}›`;
  }
  return out;
}

const hexByte = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
/** bytes per line in the HEX view */
const HEX_ROW = 16;

/**
 * What the program sent on the trainer's 8251A, and a prompt line to type bytes back in.
 * `tx` is the TxD log of power-on number `run` (a new run starts a fresh screen);
 * `txDropped` counts bytes trimmed off its front; `pending` is how many typed bytes are still on the wire.
 * It fills the terminal tab (/z80/terminal), its only home.
 */
export function SerialTerminal({
  run,
  tx,
  txDropped,
  rxOn,
  pending,
  running,
  onSend,
}: {
  run: number | string;
  tx: number[];
  txDropped: number;
  rxOn: boolean;
  pending: number;
  running: boolean;
  onSend: (bytes: number[]) => void;
}) {
  const [hex, setHex] = useState(false);
  const [echo, setEcho] = useState(false);
  const [cr, setCr] = useState(true);
  const [line, setLine] = useState('');
  /** first byte shown, counted from the start of the run (moves on with ล้าง) */
  const [from, setFrom] = useState(0);
  /** what was typed, and how many TxD bytes had arrived by then, for local echo */
  const [sent, setSent] = useState<{ at: number; bytes: number[] }[]>([]);
  const box = useRef<HTMLPreElement>(null);
  const total = txDropped + tx.length;

  // a fresh program run starts a fresh screen
  useEffect(() => {
    setFrom(0);
    setSent([]);
  }, [run]);

  // the screen as runs of program output and (with echo on) what was typed, in the order they happened
  const start = Math.max(from, txDropped);
  const runs: { echo: boolean; bytes: number[] }[] = [];
  let at = start;
  for (const s of sent) {
    if (s.at < start) continue;
    if (s.at > at) runs.push({ echo: false, bytes: tx.slice(at - txDropped, s.at - txDropped) });
    at = Math.max(at, s.at);
    if (echo) runs.push({ echo: true, bytes: s.bytes });
  }
  if (total > at) runs.push({ echo: false, bytes: tx.slice(at - txDropped) });
  const empty = !runs.some((r) => r.bytes.length);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [total, sent.length, echo, hex]);

  const send = () => {
    const bytes = [...line].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x3f));
    if (cr) bytes.push(0x0d);
    if (!bytes.length) return;
    onSend(bytes);
    setSent((s) => [...s.slice(-200), { at: total, bytes }]);
    setLine('');
  };

  // HEX: 16 bytes a line, typed bytes marked the same way as in text
  const hexRows: { echo: boolean; b: number }[][] = [];
  if (hex)
    for (const r of runs)
      for (const b of r.bytes) {
        const row = hexRows.at(-1);
        if (row && row.length < HEX_ROW) row.push({ echo: r.echo, b });
        else hexRows.push([{ echo: r.echo, b }]);
      }

  return (
    <section aria-label="Serial terminal" className="card term">
      <div className="term-head">
        <div className="term-title">
          <b>Serial terminal</b>
          <span>8251A · พอร์ต 06h ข้อมูล · 07h คำสั่ง/สถานะ</span>
        </div>
        <span className={`term-rx${rxOn ? ' on' : ''}`}>
          <i />
          {rxOn ? 'ตัวรับของ Z80 เปิดอยู่' : 'ตัวรับของ Z80 ยังปิด'}
        </span>
        <div className="term-tools">
          <button type="button" className="term-toggle" aria-pressed={echo} onClick={() => setEcho((v) => !v)} title="แสดงสิ่งที่พิมพ์ส่งไปบนจอด้วย (ปิดไว้ถ้าโปรแกรมพิมพ์ตัวที่รับกลับมาเอง)">
            Local echo
          </button>
          <button type="button" className="term-toggle" aria-pressed={hex} onClick={() => setHex((v) => !v)} title="แสดงเป็นเลขฐานสิบหกทีละไบต์">
            HEX
          </button>
          <button type="button" className="term-toggle" onClick={() => setFrom(total)} disabled={empty}>
            ล้างจอ
          </button>
        </div>
      </div>

      <div className={`term-screen${rxOn ? '' : ' off'}`}>
        <pre ref={box} className="term-out" aria-live="polite" aria-label="ข้อมูลที่ Z80 ส่งออกทาง TxD">
          {empty ? (
            <span className="term-empty">ยังไม่มีข้อมูล — ให้โปรแกรมส่งไบต์ด้วย OUT (06h),A</span>
          ) : hex ? (
            hexRows.map((row, i) => (
              <span key={i} className="term-hexrow">
                <span className="term-addr">{hexByte(((i * HEX_ROW) >> 8) & 0xff) + hexByte(i * HEX_ROW)}</span>
                {row.map((x, k) => (
                  <span key={k} className={x.echo ? 'term-echo' : undefined}>
                    {hexByte(x.b)}
                  </span>
                ))}
                {'\n'}
              </span>
            ))
          ) : (
            runs.map((r, i) =>
              r.echo ? (
                <span key={i} className="term-echo">
                  {termText(r.bytes)}
                </span>
              ) : (
                termText(r.bytes)
              ),
            )
          )}
          {rxOn && !hex && <span className="term-cursor" aria-hidden />}
        </pre>
        <form
          className="term-in"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <span className="term-prompt" aria-hidden>
            ›
          </span>
          <input
            aria-label="ข้อความที่จะส่งเข้า Z80 ทาง RxD"
            placeholder={rxOn ? 'พิมพ์แล้วกด Enter' : 'ตัวรับยังปิด'}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            disabled={!rxOn}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="term-cr" aria-pressed={cr} onClick={() => setCr((v) => !v)} title={cr ? 'ต่อท้ายด้วย Enter (0Dh) — กดเพื่อปิด' : 'ไม่ต่อท้าย Enter — กดเพื่อเปิด'}>
            ↵ 0Dh
          </button>
          <button type="submit" className="btn btn-primary term-send" disabled={!rxOn || (!line && !cr)}>
            ส่ง
          </button>
        </form>
      </div>

      {pending > 0 && (
        <span className="term-note" role="status">
          กำลังส่ง {pending} ไบต์ทาง RxD (9600 baud){running ? '…' : ' · จะเข้า Z80 เมื่อกด “เริ่มจำลอง”'}
        </span>
      )}
      {!rxOn && (
        <span className="term-note">
          ก่อนรับได้ โปรแกรมต้องตั้งโหมด <code>OUT (07h) ← 4Eh</code> แล้วเปิดตัวรับ/ตัวส่ง <code>OUT (07h) ← 15h</code>
        </span>
      )}
    </section>
  );
}
