// Guided tour: dims the page, slides a spotlight from one part to the next and
// explains each in a small card. Starts by itself the first time a page is
// opened; the "?" button in the menu (or the mipslab:tour event) replays it.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { useAuth } from "../auth";
import { trapTab, visibleEl } from "./focus";
import {
  AUTO_TOURS,
  FALLBACK_TOUR,
  TOURS,
  tourKey,
  type TourStep,
} from "./tours";

export const TOUR_EVENT = "mipslab:tour";
const SEEN = "mipslab.tour.";
const PAD = 8;

const seen = (key: string) => {
  try {
    return localStorage.getItem(SEEN + key) === "1";
  } catch {
    return true; // no storage: don't keep popping up
  }
};
const markSeen = (key: string) => {
  try {
    localStorage.setItem(SEEN + key, "1");
  } catch {
    /* ignore */
  }
};

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour() {
  const { pathname, search } = useLocation();
  const { loggedIn, user } = useAuth();
  const key = tourKey(pathname, search);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [tip, setTip] = useState<{
    top: number;
    left: number;
    arrow: number;
    below: boolean;
  } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const started = useRef(false);
  const activeKey = useRef<string | null>(null);

  const start = useCallback(() => {
    if (!key) return;
    const context = document.querySelector('[data-tour-page="login"]')
      ? "login"
      : document.querySelector('[data-tour-page="class-join"]')
        ? "class-join"
        : document.querySelector('[data-tour-page="landing"]')
          ? "landing"
          : key;
    const live = (TOURS[context] ?? FALLBACK_TOUR).filter((s) =>
      visibleEl(s.target),
    );
    const fallback = FALLBACK_TOUR.filter((s) => visibleEl(s.target));
    if (!live.length && !fallback.length) return;
    opener.current = document.activeElement as HTMLElement | null;
    activeKey.current = context;
    started.current = true;
    setBox(null);
    setTip(null);
    setSteps(live.length ? live : fallback);
    setI(0);
  }, [key]);

  const close = useCallback(() => {
    if (activeKey.current) markSeen(activeKey.current);
    setSteps(null);
    setBox(null);
    setTip(null);
    opener.current?.focus();
  }, [key]);

  // first visit to a page: wait for it to load, then start
  useEffect(() => {
    setSteps(null);
    setBox(null);
    setTip(null);
    started.current = false;
    if (
      !key ||
      !loggedIn ||
      user?.needsClass ||
      !AUTO_TOURS.has(key) ||
      seen(key)
    )
      return;
    const t = setTimeout(() => {
      if (!started.current) start();
    }, 900);
    return () => clearTimeout(t);
  }, [key, start, loggedIn, user?.needsClass]);

  // the ? button
  useEffect(() => {
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [start]);

  const step = steps?.[i];

  // bring the target into view, then follow it on scroll / resize
  useEffect(() => {
    if (!step) return;
    const el = visibleEl(step.target);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      const top = Math.max(4, r.top - PAD);
      const left = Math.max(4, r.left - PAD);
      setBox({
        top,
        left,
        width: Math.min(innerWidth - 4, r.right + PAD) - left,
        height: Math.min(innerHeight - 4, r.bottom + PAD) - top,
      });
    };
    measure();
    const t = setTimeout(measure, 350); // after any smooth scroll settles
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // put the card below the spotlight, else above, else over its bottom edge
  useLayoutEffect(() => {
    const card = tipRef.current;
    if (!box || !card) return;
    const h = card.offsetHeight;
    const w = card.offsetWidth;
    const gap = 14;
    let below = true;
    let top = box.top + box.height + gap;
    if (top + h > innerHeight - 8) {
      if (box.top - gap - h >= 8) {
        top = box.top - gap - h;
        below = false;
      } else
        top = Math.max(
          8,
          Math.min(innerHeight - h - 8, box.top + box.height - h - gap),
        );
    }
    const cx = box.left + box.width / 2;
    const left = Math.max(12, Math.min(innerWidth - w - 12, cx - w / 2));
    setTip({
      top,
      left,
      arrow: Math.max(18, Math.min(w - 18, cx - left)),
      below,
    });
  }, [box, i]);

  // keys belong to the tour while it's open
  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        trapTab(e, tipRef.current);
        e.stopPropagation();
        return;
      }
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter")
        i < steps.length - 1 ? setI(i + 1) : close();
      else if (e.key === "ArrowLeft") setI(Math.max(0, i - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [steps, i, close]);

  if (!steps || !step) return null;
  const last = i === steps.length - 1;

  return createPortal(
    <div
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-label="แนะนำการใช้งาน"
    >
      <div className="tour-catch" onClick={close} />
      {box && <div className="tour-spot" style={box} />}
      <div
        ref={tipRef}
        key={i}
        className={`tour-tip${tip && !tip.below ? " above" : ""}`}
        style={tip ? { top: tip.top, left: tip.left } : { top: -9999, left: 0 }}
      >
        {tip && <span className="tour-arrow" style={{ left: tip.arrow }} />}
        <span className="tour-count">
          {i + 1} / {steps.length}
        </span>
        <b>{step.title}</b>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={close}>
            ข้าม
          </button>
          <span className="tour-dots" aria-hidden="true">
            {steps.map((_, k) => (
              <i key={k} className={k === i ? "on" : undefined} />
            ))}
          </span>
          {i > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: 36, padding: "0 14px", fontSize: 14 }}
              onClick={() => setI(i - 1)}
            >
              ย้อน
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 36, padding: "0 16px", fontSize: 14 }}
            onClick={() => (last ? close() : setI(i + 1))}
            autoFocus
          >
            {last ? "เข้าใจแล้ว" : "ถัดไป"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
