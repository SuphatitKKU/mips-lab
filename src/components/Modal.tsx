// A page-owned popup (unlike the app-wide confirm/celebrate in Popup.tsx): the page decides what goes
// inside and when it's open. Esc / backdrop click close it, Tab stays inside, focus returns afterwards.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { trapTab } from './focus';
import { Icon, ICON } from './Icon';

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** buttons pinned under the scrolling body */
  footer?: ReactNode;
  wide?: boolean;
  /** extra class on the card (e.g. "shake") */
  className?: string;
  /** change it when the content is swapped (e.g. loading → result) to move focus to the new main action */
  focusKey?: string | number;
}

export function Modal({ title, onClose, children, footer, wide, className, focusKey }: ModalProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // runs before the focus effect below, so `before` is still whatever opened the popup
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? closeRef.current() : trapTab(e, backdrop.current));
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  // focus the main action in the footer, else the close button
  useEffect(() => {
    const q = (sel: string) => card.current?.querySelector<HTMLElement>(sel);
    (q('.modal-foot .btn-primary') ?? q('.modal-foot .btn') ?? q('.modal-x'))?.focus();
  }, [focusKey]);

  // rendered at the top of the page so a transformed or clipped ancestor can't trap the fixed backdrop
  return createPortal(
    <div ref={backdrop} className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={card} className={`dialog modal${wide ? ' wide' : ''}${className ? ' ' + className : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title" style={{ fontSize: 20, flex: 1, minWidth: 0 }}>
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-round modal-x" aria-label="ปิด" title="ปิด (Esc)" onClick={onClose}>
            <Icon d={ICON.x} size={18} stroke={2.4} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
