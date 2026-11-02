import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { DueChip, dueState } from '../components/DueChip';
import { Icon, ICON } from '../components/Icon';
import { ErrorBox, LevelChip, PageHeader, Skeleton } from '../components/ui';
import { M, OK } from '../lib/tokens';

export type Status = 'done' | 'doing' | 'todo';

export interface ProblemSummary {
  id: number;
  title: string;
  sub: string;
  level: string;
  topic: string;
  kind: string;
  points: number;
  status: Status;
  passed?: number;
  total?: number;
  /** deadline when the teacher assigned it to this student's class */
  dueAt: number | null;
  solvedAt: number | null;
}

function StatusIcon({ st }: { st: Status }) {
  if (st === 'done')
    return (
      <svg width="28" height="28" viewBox="0 0 28 28" aria-label="ผ่านแล้ว">
        <circle cx="14" cy="14" r="13" fill={OK} />
        <path d="M8.5 14.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (st === 'doing')
    return (
      <svg width="28" height="28" viewBox="0 0 28 28" aria-label="กำลังทำ">
        <circle cx="14" cy="14" r="12" fill="#fff" stroke={M} strokeWidth="2.5" />
        <path d="M14 6a8 8 0 0 1 0 16z" fill={M} />
      </svg>
    );
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-label="ยังไม่ทำ">
      <circle cx="14" cy="14" r="12" fill="none" stroke="#e0d6d1" strokeWidth="2.5" />
    </svg>
  );
}

const PAGE = 10;
const ST_FILTERS: [Status | 'all', string][] = [
  ['all', 'ทั้งหมด'],
  ['todo', 'ยังไม่ทำ'],
  ['doing', 'กำลังทำ'],
  ['done', 'ผ่านแล้ว'],
];

export function Problems() {
  const { data, error, loading, reload } = useApi<{ topics: string[]; problems: ProblemSummary[] }>('/problems');
  const [topic, setTopic] = useState('ทั้งหมด');
  const [st, setSt] = useState<Status | 'all' | 'assigned'>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const q = query.trim().toLowerCase();
  const all = data?.problems ?? [];
  const list = all.filter(
    (p) =>
      (topic === 'ทั้งหมด' || p.topic === topic) &&
      (st === 'all' || (st === 'assigned' ? p.dueAt != null : p.status === st)) &&
      (!q || `${p.id} ${p.title} ${p.sub}`.toLowerCase().includes(q)),
  );
  const passed = all.filter((p) => p.status === 'done').length;
  const total = all.length;
  const filtered = topic !== 'ทั้งหมด' || st !== 'all' || !!q;
  // assigned work, soonest deadline first; done ones drop to the end
  const work = all
    .filter((p) => p.dueAt != null)
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.dueAt! - b.dueAt!);
  const onTime = work.filter((p) => dueState(p.dueAt!, p.solvedAt) === 'ontime').length;

  return (
    <>
      <PageHeader title="โจทย์ฝึก">
        <label className="search-pill">
          <Icon d={ICON.search} size={18} color="var(--muted)" />
          <input
            type="search"
            aria-label="ค้นหาโจทย์"
            placeholder="ค้นหาโจทย์"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
        </label>
      </PageHeader>

      <main className="main">
        {error && <ErrorBox error={error} onRetry={reload} />}
        <section
          aria-label="ความคืบหน้า"
          className="card"
          style={{ padding: '22px 26px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 28px' }}
        >
          <span style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
            ผ่านแล้ว{' '}
            <b style={{ fontFamily: 'var(--head)', fontWeight: 500, fontSize: 26, color: 'var(--m)' }}>{passed}</b> จาก{' '}
            {total} ข้อ
          </span>
          <div style={{ flex: '1 1 280px', height: 12, borderRadius: 99, background: 'var(--soft)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${total ? ((passed / total) * 100).toFixed(1) : 0}%`,
                height: '100%',
                borderRadius: 99,
                background: 'var(--m)',
              }}
            />
          </div>
        </section>

        {work.length > 0 && (
          <section aria-label="งานที่ได้รับมอบหมาย" className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 18, flex: 1 }}>งานที่ได้รับมอบหมาย</h2>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>
                ส่งตรงเวลา <b style={{ color: 'var(--ok-deep)' }}>{onTime}</b> / {work.length} ข้อ
              </span>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {work.map((p) => (
                <li key={p.id}>
                  <Link to={`/problems/${p.id}`} className="prob-row" style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'flex', flex: 'none' }}>
                      <StatusIcon st={p.status} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
                      {p.id}. {p.title}
                    </span>
                    <DueChip dueAt={p.dueAt!} solvedAt={p.solvedAt} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="หัวข้อ" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
            {['ทั้งหมด', ...(data?.topics ?? [])].map((t) => (
              <button
                key={t}
                className="topic"
                aria-pressed={topic === t}
                onClick={() => {
                  setTopic(t);
                  setShown(PAGE);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <select
            aria-label="สถานะ"
            className="select-pill"
            value={st}
            onChange={(e) => {
              setSt(e.target.value as Status | 'all' | 'assigned');
              setShown(PAGE);
            }}
          >
            {ST_FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            {work.length > 0 && <option value="assigned">งานที่มอบหมาย</option>}
          </select>
        </div>

        <section aria-label="รายการโจทย์" className="card" style={{ padding: 10 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '12px 16px 8px',
              fontSize: 13,
              color: 'var(--muted)',
              whiteSpace: 'nowrap',
              gap: 12,
            }}
          >
            <span>{filtered ? `${list.length} ข้อที่ตรงกัน` : `${total} ข้อ · เรียงตามบทเรียน`}</span>
            <span>คะแนน</span>
          </div>
          {loading && !data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
              <Skeleton h={56} />
              <Skeleton h={56} />
              <Skeleton h={56} />
            </div>
          )}
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {list.slice(0, shown).map((p) => {
              const doing = p.status === 'doing';
              const sub = doing ? `${p.topic} · ยังไม่ถูก — ทำต่อ` : p.sub;
              return (
                <li key={p.id}>
                  <Link to={`/problems/${p.id}`} className="prob-row" style={{ background: doing ? 'var(--m-row)' : 'transparent' }}>
                    <span style={{ display: 'flex', flex: 'none' }}>
                      <StatusIcon st={p.status} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>
                        {p.id}. {p.title}
                      </span>
                      <span style={{ fontSize: 14, color: doing ? 'var(--m)' : 'var(--muted)' }}>{sub}</span>
                    </span>
                    {p.dueAt != null && <DueChip dueAt={p.dueAt} solvedAt={p.solvedAt} />}
                    <LevelChip lv={p.level} />
                    <span
                      style={{
                        flex: 'none',
                        width: 56,
                        textAlign: 'right',
                        fontFamily: 'var(--mono)',
                        fontSize: 15,
                        fontWeight: 600,
                        color: 'var(--m)',
                      }}
                    >
                      +{p.points}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {data && list.length === 0 && (
            <div style={{ padding: '24px 16px', color: 'var(--muted)' }}>ไม่พบโจทย์ที่ตรงกับตัวกรอง</div>
          )}
          {list.length > shown && (
            <div style={{ padding: '12px 16px 10px' }}>
              <button className="btn btn-soft" onClick={() => setShown((s) => s + PAGE)}>
                แสดงอีก {Math.min(PAGE, list.length - shown)} ข้อ
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
