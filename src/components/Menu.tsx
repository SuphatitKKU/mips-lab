// A "⋯" button that opens a small list of less-used actions and on/off options,
// so a toolbar can show only its main buttons.

import { useEffect, useRef, useState } from 'react';
import { Icon, ICON } from './Icon';

export interface MenuItem {
  label: string;
  /** an action (closes the menu) — or, with `checked`, an on/off option (stays open) */
  onSelect: () => void;
  checked?: boolean;
  icon?: { d: string; filled?: boolean };
  /** keyboard shortcut shown on the right */
  hint?: string;
  disabled?: boolean;
}

export function Menu({ label, items, up = false }: { label: string; items: MenuItem[]; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={box} className="menu">
      <button type="button" className="btn btn-ghost btn-round" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon d={ICON.more} size={20} stroke={3} />
      </button>
      {open && (
        <div role="menu" aria-label={label} className={`menu-pop${up ? ' up' : ''}`}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked == null ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              disabled={it.disabled}
              onClick={() => {
                it.onSelect();
                if (it.checked == null) setOpen(false);
              }}
            >
              <span className="menu-ico">
                {it.checked != null ? it.checked && <Icon d={ICON.check} size={16} stroke={2.6} /> : it.icon && <Icon d={it.icon.d} filled={it.icon.filled} size={15} />}
              </span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <kbd>{it.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
