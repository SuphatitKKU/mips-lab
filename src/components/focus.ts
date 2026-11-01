// Keeps Tab / Shift+Tab inside an open dialog so focus can't wander to the page behind it.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapTab(e: KeyboardEvent, box: HTMLElement | null) {
  if (e.key !== 'Tab' || !box) return;
  const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = box.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/** First element matching `sel` that is actually laid out (skips copies hidden on this screen size). */
export function visibleEl(sel: string): Element | null {
  return Array.from(document.querySelectorAll(sel)).find((el) => el.getClientRects().length > 0) ?? null;
}
