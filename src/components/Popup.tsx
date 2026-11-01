// App-wide popups: toasts for quick feedback, a confirm dialog that replaces
// window.confirm, and a celebration when a submission passes every test.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { trapTab } from './focus';
import { Icon, ICON } from './Icon';

export type ToastKind = 'ok' | 'err' | 'info';

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  ok?: string;
  cancel?: string;
}

interface CelebrateOpts {
  title: string;
  body?: ReactNode;
  points?: number | null;
  next?: { label: string; go: () => void };
}

interface Popups {
  toast: (text: ReactNode, kind?: ToastKind) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  celebrate: (o: CelebrateOpts) => void;
}

interface Toast {
  id: number;
  kind: ToastKind;
  text: ReactNode;
  leaving: boolean;
}

type Dialog = { type: 'confirm'; o: ConfirmOpts; done: (ok: boolean) => void } | { type: 'celebrate'; o: CelebrateOpts };

const Ctx = createContext<Popups | null>(null);
const OUT_MS = 180; // matches the exit animations in styles.css
const TOAST_ICON = { ok: ICON.check, err: ICON.alert, info: ICON.info };

export function PopupProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [closing, setClosing] = useState(false);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), OUT_MS);
  }, []);

  const toast = useCallback(
    (text: ReactNode, kind: ToastKind = 'info') => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { id, kind, text, leaving: false }]);
      setTimeout(() => dismiss(id), kind === 'err' ? 5000 : 3200);
    },
    [dismiss],
  );

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((done) => setDialog({ type: 'confirm', o, done })), []);
  const celebrate = useCallback((o: CelebrateOpts) => setDialog({ type: 'celebrate', o }), []);
  const api = useMemo(() => ({ toast, confirm, celebrate }), [toast, confirm, celebrate]);

  const close = useCallback(
    (ok: boolean) => {
      if (!dialog || closing) return;
      if (dialog.type === 'confirm') dialog.done(ok);
      setClosing(true);
      setTimeout(() => {
        setDialog(null);
        setClosing(false);
      }, OUT_MS);
    },
    [dialog, closing],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} type="button" className={`toast ${t.kind}${t.leaving ? ' leaving' : ''}`} onClick={() => dismiss(t.id)} title="ปิด">
            <span className="toast-icon">
              <Icon d={TOAST_ICON[t.kind]} size={16} stroke={2.6} />
            </span>
            <span>{t.text}</span>
          </button>
        ))}
      </div>
      {dialog && <DialogView dialog={dialog} closing={closing} close={close} />}
    </Ctx.Provider>
  );
}

export function usePopup() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePopup must be used inside PopupProvider');
  return ctx;
}

function DialogView({ dialog, closing, close }: { dialog: Dialog; closing: boolean; close: (ok: boolean) => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  // focus the safe/main button, give focus back to whatever opened the dialog, Esc cancels
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? closeRef.current(false) : trapTab(e, backdrop.current));
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div ref={backdrop} className={`dialog-backdrop${closing ? ' leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      {dialog.type === 'confirm' ? (
        <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
          <h2 id="dlg-title" style={{ fontSize: 22 }}>
            {dialog.o.title}
          </h2>
          {dialog.o.body && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--body-alt)' }}>{dialog.o.body}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button ref={primary} className="btn btn-secondary" onClick={() => close(false)}>
              {dialog.o.cancel ?? 'ยกเลิก'}
            </button>
            <button className="btn btn-primary" onClick={() => close(true)}>
              {dialog.o.ok ?? 'ตกลง'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog celebrate" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          <span className="burst" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ '--a': `${(360 / 14) * i}deg`, '--d': `${70 + (i % 3) * 22}px` } as CSSProperties} />
            ))}
            <span className="burst-check">
              <Icon d={ICON.check} size={40} stroke={3} />
            </span>
          </span>
          <h2 id="dlg-title" style={{ fontSize: 26 }}>
            {dialog.o.title}
          </h2>
          {dialog.o.points != null && (
            <span className="celebrate-pts">
              +<CountUp to={dialog.o.points} /> pts
            </span>
          )}
          {dialog.o.body && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--body-alt)' }}>{dialog.o.body}</p>}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            <button className={dialog.o.next ? 'btn btn-secondary' : 'btn btn-primary'} ref={dialog.o.next ? undefined : primary} onClick={() => close(false)}>
              ปิด
            </button>
            {dialog.o.next && (
              <button
                ref={primary}
                className="btn btn-primary"
                onClick={() => {
                  close(true);
                  dialog.o.next!.go();
                }}
              >
                {dialog.o.next.label}
                <Icon d={ICON.arrowRight} size={16} stroke={2.4} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CountUp({ to, ms = 700 }: { to: number; ms?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setN(to);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{n}</>;
}
