// The trainer's serial terminal, on a page of its own (opened from the Z80
// board's "เปิด terminal"). It follows the first board tab that answers, shows
// that tab's TxD log, and sends typed bytes back to it; the emulator itself
// never leaves the board tab. See components/termLink.ts for the messages.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, ICON } from '../components/Icon';
import { SerialTerminal } from '../components/Z80Tools';
import { HELLO_MS, LOST_MS, newTabId, openLink, type TermState } from '../components/termLink';

type Status = 'looking' | 'live' | 'lost' | 'unsupported';

const STATUS: Record<Status, string> = {
  looking: 'กำลังเชื่อมต่อกับหน้าบอร์ด Z80…',
  live: 'เชื่อมต่อกับหน้าบอร์ด Z80 อยู่',
  lost: 'ขาดการเชื่อมต่อ — หน้าบอร์ด Z80 ถูกปิดหรือรีโหลด',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับ terminal แยกแท็บ — ลองใช้ Chrome, Edge หรือ Firefox รุ่นใหม่',
};

export function Z80Terminal() {
  const me = useMemo(newTabId, []);
  const [status, setStatus] = useState<Status>('looking');
  const [st, setSt] = useState<{ from: string; s: TermState | null } | null>(null);
  const boardId = useRef<string | null>(null);
  const seenAt = useRef(0);
  const link = useRef<ReturnType<typeof openLink>>(null);

  useEffect(() => {
    document.title = 'Serial terminal · Z80';
    const l = openLink((m) => {
      if (m.k === 'state') {
        if (boardId.current && m.from !== boardId.current) return; // another board tab; stay with ours
        boardId.current = m.from;
        seenAt.current = Date.now();
        setSt({ from: m.from, s: m.s });
        setStatus('live');
      } else if (m.k === 'bye' && m.from === boardId.current) {
        boardId.current = null;
        setStatus('lost');
      }
    });
    link.current = l;
    if (!l) {
      setStatus('unsupported');
      return;
    }
    const hello = () => l.post({ k: 'hello', from: me, to: boardId.current });
    hello();
    const t = setInterval(() => {
      if (boardId.current && Date.now() - seenAt.current > LOST_MS) {
        boardId.current = null;
        setStatus('lost');
      }
      hello();
    }, HELLO_MS);
    const bye = () => l.post({ k: 'bye', from: me });
    window.addEventListener('pagehide', bye);
    return () => {
      bye();
      clearInterval(t);
      window.removeEventListener('pagehide', bye);
      l.close();
      link.current = null;
    };
  }, [me]);

  const live = status === 'live';
  const s = st?.s;
  return (
    <div className="term-page">
      <header className="term-page-bar">
        <span className="term-page-logo" aria-hidden>
          <Icon d={ICON.chip} size={18} color="#fff" />
        </span>
        <b>Z80 · Serial terminal</b>
        <span className={`term-link ${live ? 'on' : status === 'looking' ? 'wait' : 'off'}`} role="status">
          <i />
          {live && s === null ? 'หน้าบอร์ดไม่มีบอร์ด Z80 สำเร็จ (8251A) — วางบอร์ดสำเร็จก่อน' : STATUS[status]}
        </span>
        {!live && status !== 'unsupported' && (
          <span className="term-page-actions">
            <a className="btn btn-secondary" href="/z80" target="_blank" rel="opener">
              เปิดหน้าบอร์ด
            </a>
          </span>
        )}
      </header>
      {st && s ? (
        <SerialTerminal
          run={`${st.from}:${s.run}`}
          tx={s.tx}
          txDropped={s.txDropped}
          rxOn={live && s.rxOn}
          pending={s.pending}
          running={s.running}
          onSend={(bytes) => link.current?.post({ k: 'send', from: me, to: st.from, bytes })}
        />
      ) : (
        <div className="card term-wait">
          <Icon d={status === 'looking' ? ICON.info : ICON.alert} size={22} color="var(--muted)" />
          <span>
            {status === 'looking'
              ? 'terminal นี้ใช้กับโปรแกรมที่รันอยู่ในหน้าบอร์ด Z80 — เปิดหน้าบอร์ดค้างไว้ในอีกแท็บหนึ่ง'
              : live
                ? 'terminal ใช้กับ 8251A ในบอร์ด Z80 สำเร็จ — วางบอร์ดสำเร็จบนหน้าบอร์ดก่อน'
                : STATUS[status]}
          </span>
        </div>
      )}
    </div>
  );
}
