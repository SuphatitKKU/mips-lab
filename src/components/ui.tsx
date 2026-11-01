import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { highlight, rich, type Lang, type Seg } from '../lib/highlight';
import { Icon, ICON } from './Icon';
import { TOUR_EVENT } from './Tour';

export function Segs({ segs, weight = true }: { segs: Seg[]; weight?: boolean }) {
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} style={{ color: s.color, fontWeight: weight ? s.w : undefined }}>
          {s.t}
        </span>
      ))}
    </>
  );
}

/** Renders prose with `code` and **bold** markers. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {rich(text).map((p, i) =>
        p.kind === 'code' ? (
          <span key={i} className="inline-code">
            {p.t}
          </span>
        ) : p.kind === 'bold' ? (
          <b key={i}>{p.t}</b>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

interface CodeLineProps {
  no?: number;
  src: string;
  lang: Lang;
  bg?: string;
  onClick?: () => void;
  hoverable?: boolean;
  right?: ReactNode;
}
export function CodeLine({ no, src, lang, bg, onClick, hoverable, right }: CodeLineProps) {
  return (
    <div
      className={`code-line${onClick ? ' clickable' : ''}${hoverable && !bg ? ' hoverable' : ''}`}
      style={{ background: bg || 'transparent' }}
      onClick={onClick}
    >
      {no != null && <span className="code-no">{no}</span>}
      <span className="code-text" style={{ flex: right ? 1 : undefined }}>
        <Segs segs={highlight(src, lang)} />
      </span>
      {right}
    </div>
  );
}

interface SegOption<T> {
  value: T;
  label: ReactNode;
  aria?: string;
  disabled?: boolean;
}
interface SegmentedProps<T> {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  role?: 'radiogroup' | 'tablist' | 'toolbar';
  inCard?: boolean;
  btnStyle?: CSSProperties;
}
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  role = 'radiogroup',
  inCard,
  btnStyle,
}: SegmentedProps<T>) {
  const itemRole = role === 'radiogroup' ? 'radio' : role === 'tablist' ? 'tab' : undefined;
  return (
    <div role={role} aria-label={label} className={`seg${inCard ? ' in-card' : ''}`}>
      {options.map((o) => {
        const on = o.value === value;
        const stateAttr =
          role === 'radiogroup'
            ? { 'aria-checked': on }
            : role === 'tablist'
              ? { 'aria-selected': on }
              : { 'aria-pressed': on };
        return (
          <button
            key={String(o.value)}
            type="button"
            role={itemRole}
            {...stateAttr}
            aria-label={o.aria}
            title={o.aria}
            disabled={o.disabled}
            style={btnStyle}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  sub?: string;
  back?: { label: string; to: string };
  children?: ReactNode;
}
/** Sets the browser tab title, e.g. "โจทย์ฝึก · MIPS Lab". */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · MIPS Lab` : 'MIPS Lab';
  }, [title]);
}

export function PageHeader({ title, sub, back, children }: PageHeaderProps) {
  useTitle(title);
  return (
    <div className="page-header">
      <div className="page-header-title">
        {back && (
          <Link to={back.to} className="back-link">
            <Icon d={ICON.chevronLeft} size={16} />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <span style={{ fontSize: 15, color: 'var(--muted)' }}>{sub}</span>}
      </div>
      {children}
      {/* phones have no side rail, so the page-tour button lives here */}
      <button type="button" className="ph-help" data-tour="help" aria-label="แนะนำหน้านี้" title="แนะนำหน้านี้" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}>
        ?
      </button>
    </div>
  );
}

export function LevelChip({ lv }: { lv: string }) {
  const cls = lv === 'ง่าย' ? 'lv-easy' : lv === 'กลาง' ? 'lv-mid' : 'lv-hard';
  return <span className={`chip ${cls}`}>{lv}</span>;
}

export function CheckCircle({ size = 26, color = 'var(--ok)' }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon d={ICON.check} size={14} stroke={3} color="#fff" />
    </span>
  );
}

export function XCircle({ size = 26, bg = 'var(--err)', fg = '#fff', iconSize = 14, stroke = 3 }: {
  size?: number;
  bg?: string;
  fg?: string;
  iconSize?: number;
  stroke?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon d={ICON.x} size={iconSize} stroke={stroke} />
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: { message: string }; onRetry?: () => void }) {
  return (
    <div role="alert" className="notice err" style={{ alignItems: 'center' }}>
      <Icon d={ICON.alert} size={18} />
      <span style={{ flex: 1 }}>{error.message}</span>
      {onRetry && (
        <button className="btn btn-soft" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} aria-hidden="true" />;
}
