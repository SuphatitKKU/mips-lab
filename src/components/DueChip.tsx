// Deadline badge for an assigned problem: on time / late / overdue / due soon / due on <date>.

const fmt = (t: number) =>
  new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');

export type DueState = 'ontime' | 'late' | 'overdue' | 'soon' | 'open';

export function dueState(dueAt: number, solvedAt: number | null, now = Date.now()): DueState {
  if (solvedAt != null) return solvedAt <= dueAt ? 'ontime' : 'late';
  if (now > dueAt) return 'overdue';
  return dueAt - now < 24 * 3600 * 1000 ? 'soon' : 'open';
}

const LOOK: Record<DueState, { bg: string; fg: string }> = {
  ontime: { bg: 'var(--ok-bg)', fg: 'var(--ok-deep)' },
  late: { bg: 'var(--warn-bg)', fg: 'var(--warn-deep)' },
  overdue: { bg: 'var(--err-bg)', fg: 'var(--err-deep)' },
  soon: { bg: 'var(--warn-bg)', fg: 'var(--warn-deep)' },
  open: { bg: 'var(--soft)', fg: 'var(--body-alt)' },
};

export function DueChip({ dueAt, solvedAt }: { dueAt: number; solvedAt: number | null }) {
  const st = dueState(dueAt, solvedAt);
  const hours = Math.max(1, Math.ceil((dueAt - Date.now()) / 3600000));
  const text =
    st === 'ontime' ? 'ส่งตรงเวลา' : st === 'late' ? 'ส่งช้า' : st === 'overdue' ? 'เลยกำหนด' : st === 'soon' ? `เหลือ ${hours} ชม.` : `ส่งภายใน ${fmt(dueAt)}`;
  return (
    <span className="chip" title={`กำหนดส่ง ${fmt(dueAt)} น.`} style={{ background: LOOK[st].bg, color: LOOK[st].fg }}>
      {text}
    </span>
  );
}

export const dueText = fmt;
