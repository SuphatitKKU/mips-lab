import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Icon, ICON } from '../components/Icon';
import { ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { INK, M, M_DEEP, M_LINE, M_MID, MT } from '../lib/tokens';

const MEDAL: [bg: string, fg: string][] = [[M, '#fff'], [M_MID, '#fff'], [M_LINE, M_DEEP]];
/** podium block heights for 1st, 2nd, 3rd */
const BLOCK = [136, 104, 80];
/** gold / silver / bronze: [face, rim] — the only non-brand colours, so a medal reads as a medal */
const METAL: Record<number, [string, string]> = { 1: ['#f6c945', '#c9961a'], 2: ['#e3e6ea', '#9fa6b0'], 3: ['#e6a467', '#a9662c'] };

/** A Kahoot-style medal on a ribbon, with the place on its face. */
function Medal({ rank, size }: { rank: number; size: number }) {
  const [face, rim] = METAL[rank] ?? METAL[3];
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 40 50" aria-label={`อันดับ ${rank}`}>
      <path d="M10 0h8l6 16h-8z" fill="#fff" opacity=".85" />
      <path d="M30 0h-8l-6 16h8z" fill="#fff" opacity=".6" />
      <circle cx="20" cy="31" r="17" fill={rim} />
      <circle cx="20" cy="31" r="13.5" fill={face} />
      <text x="20" y="37" textAnchor="middle" fontFamily="Mitr, sans-serif" fontSize="17" fontWeight="600" fill={rank === 2 ? '#5d636b' : '#6b3d0a'}>
        {rank}
      </text>
    </svg>
  );
}

const Trophy = () => (
  <svg className="pod-trophy" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
    <path d="M12 5h20v9a10 10 0 0 1-20 0z" fill="#f6c945" stroke="#c9961a" strokeWidth="2" />
    <path d="M12 8H6a6 6 0 0 0 7 9M32 8h6a6 6 0 0 1-7 9" fill="none" stroke="#c9961a" strokeWidth="2.5" />
    <path d="M19 24h6v7h-6z" fill="#c9961a" />
    <path d="M13 31h18l2 8H11z" fill={M} />
    <path d="M18 9l1.3 2.7 3 .4-2.2 2 .6 3-2.7-1.5-2.7 1.5.6-3-2.2-2 3-.4z" fill="#fff" opacity=".8" transform="translate(4 0)" />
  </svg>
);

/** confetti pieces: left %, delay ms, colour */
const CONFETTI: [number, number, string][] = [
  [6, 0, M], [14, 260, '#f6c945'], [23, 120, 'var(--m-mid)'], [31, 380, '#e3e6ea'], [39, 60, M], [46, 300, '#f6c945'], [54, 180, 'var(--m-line)'],
  [61, 20, M], [69, 340, '#e6a467'], [76, 140, 'var(--m-mid)'], [84, 420, '#f6c945'], [92, 80, M], [97, 240, 'var(--m-line)'],
];
const COLS = '56px minmax(0, 1fr) 80px 100px';
const mono = { fontFamily: 'var(--mono)', fontSize: 14, textAlign: 'right' } as const;
const PERIODS = [
  ['week', 'สัปดาห์นี้'],
  ['month', 'เดือนนี้'],
  ['all', 'ตลอดกาล'],
] as const;

interface Row {
  rank: number;
  name: string;
  initials: string;
  passed: number;
  points: number;
  me: boolean;
}
interface Board {
  section: string;
  rows: Row[];
  me: {
    rank: number;
    points: number;
    passed: number;
    /** the rank just above you, when there is one */
    next: { rank: number; gap: number; points: number } | null;
    total: number;
    streak: number;
    /** Monday → Sunday of this week: days with any attempt */
    week: boolean[];
    /** places gained (+) or lost (−) since the previous week / month / 7 days */
    rankDelta: number | null;
    problem: { id: number; title: string; points: number } | null;
  } | null;
}

const SINCE = { week: 'จากสัปดาห์ก่อน', month: 'จากเดือนก่อน', all: 'จาก 7 วันก่อน' } as const;
const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const today = (new Date().getDay() + 6) % 7;
const TOP_ROWS = 10;

/** Solved / total as a white ring on the maroon card. */
function Ring({ value, max }: { value: number; max: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const f = max ? Math.min(1, value / max) : 0;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 26 26)" className="lb-ring" />
      <path d="M19 26.5l4.5 4.5 9-9.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A gold flame for the streak; grey when it has gone out. */
function Flame({ lit }: { lit: boolean }) {
  return (
    <svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true" className={lit ? 'lb-flame' : undefined} style={{ flex: 'none' }}>
      <defs>
        <linearGradient id="lb-flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#e8892a" />
        </linearGradient>
      </defs>
      <path d="M20 2c3 8 16 13 16 28a16 16 0 0 1-32 0c0-8 5-13 8-16 0 5 2 8 5 8 0-9-2-14 3-20z" fill={lit ? 'url(#lb-flame)' : 'rgba(255,255,255,.25)'} />
      <path d="M20 26c2 4 7 6 7 12a7 7 0 0 1-14 0c0-4 3-6 4-8 1 2 2 3 3 3 0-3-1-5 0-7z" fill={lit ? '#fff3c4' : 'rgba(255,255,255,.2)'} />
    </svg>
  );
}

export function Leaderboard() {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [scope, setScope] = useState<'section' | 'all'>('section');
  const { data, error, loading, reload } = useApi<Board>(`/leaderboard?period=${period}&scope=${scope}`);

  const rows = data?.rows ?? [];
  const top3 = rows.slice(0, 3);
  const meRow = rows.find((r) => r.me);
  const table: (Row | null)[] = rows.slice(3, TOP_ROWS);
  if (meRow && rows.indexOf(meRow) >= TOP_ROWS) table.push(null, meRow);
  const me = data?.me;
  const bar = me?.next ? Math.max(4, Math.min(100, (me.points / me.next.points) * 100)) : 100;

  return (
    <>
      <PageHeader title="อันดับ">
        <Segmented label="ช่วงเวลา" value={period} onChange={setPeriod} options={PERIODS.map(([value, label]) => ({ value, label }))} />
        <select aria-label="กลุ่ม" className="select-pill" value={scope} onChange={(e) => setScope(e.target.value as 'section' | 'all')}>
          <option value="section">กลุ่มของฉัน{data?.section ? ` · ${data.section}` : ''}</option>
          <option value="all">ทุกคน</option>
        </select>
      </PageHeader>

      <main className="main">
        {error && <ErrorBox error={error} onRetry={reload} />}
        {/* switching period / group keeps the old board up, dimmed, until the new one arrives */}
        <div aria-busy={loading} className={loading && data ? 'is-stale' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            <section aria-label="อันดับของคุณ" className="lb-me">
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="lb-label">อันดับของคุณ</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: "'Mitr', sans-serif", fontSize: 72, fontWeight: 500, lineHeight: 1 }}>{me ? `#${me.rank}` : '—'}</span>
                    {me?.rankDelta != null && me.rankDelta !== 0 && (
                      <span className="lb-delta" title={SINCE[period]}>
                        <Icon d={me.rankDelta > 0 ? ICON.sortUp : ICON.sortDown} size={14} stroke={2.6} />
                        {Math.abs(me.rankDelta)}
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span className="lb-label">คะแนน</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 600, lineHeight: 1.2 }}>{me ? me.points.toLocaleString() : '–'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 16 }}>
                  {me?.next ? (
                    <>
                      ห่างอันดับ {me.next.rank} อยู่ <b>{me.next.gap} pts</b>
                    </>
                  ) : me ? (
                    'คุณอยู่อันดับหนึ่ง!'
                  ) : (
                    'ส่งโจทย์ผ่านเพื่อเริ่มสะสมคะแนน'
                  )}
                </span>
                <div className="lb-bar">
                  <i style={{ width: `${bar}%` }} />
                </div>
              </div>

              {me && (
                <div className="lb-tiles">
                  <div className="lb-tile">
                    <Ring value={me.passed} max={me.total} />
                    <span className="lb-tile-text">
                      <b>
                        {me.passed}
                        <small>/{me.total}</small>
                      </b>
                      <span>ข้อที่ผ่าน</span>
                    </span>
                  </div>
                  <div className="lb-tile streak">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Flame lit={me.streak > 0} />
                      <span className="lb-tile-text">
                        <b>{me.streak}</b>
                        <span>วันติด</span>
                      </span>
                    </span>
                    <ol className="lb-week" aria-label="วันที่ทำโจทย์สัปดาห์นี้">
                      {WEEKDAYS.map((d, i) => (
                        <li key={d} className={`${me.week[i] ? 'on' : ''}${i === today ? ' today' : ''}`} title={me.week[i] ? `${d}: ทำโจทย์แล้ว` : d}>
                          <i />
                          {d}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}

              {me &&
                (me.problem ? (
                  <Link to={`/problems/${me.problem.id}`} className="lb-go">
                    ทำข้อ {me.problem.id} ต่อ · +{me.problem.points} pts
                    <Icon d={ICON.arrowRight} size={18} stroke={2.4} />
                  </Link>
                ) : (
                  <span className="lb-go done">ทำครบทุกข้อแล้ว</span>
                ))}
            </section>

            {/* sports-day podium: 2nd · 1st · 3rd, each standing on a block as tall as their place */}
            <section aria-label="3 อันดับแรก" className="card podium">
              {top3.length > 0 && (
                <div className="confetti" aria-hidden="true">
                  {CONFETTI.map(([left, delay, color], k) => (
                    <i key={k} style={{ left: `${left}%`, background: color, animationDelay: `${600 + delay}ms` }} />
                  ))}
                </div>
              )}
              {[1, 0, 2].map((i) => {
                const r = top3[i];
                return (
                  <div key={i} className="pod-col">
                    {r ? (
                      <div className="pod-person" style={{ animationDelay: `${(2 - i) * 150 + 350}ms` }}>
                        {i === 0 && <Trophy />}
                        <span className={`pod-avatar${r.me ? ' me' : ''}${i === 0 ? ' first' : ''}`}>{r.initials}</span>
                        <b className="pod-name">{r.me ? `${r.name} (คุณ)` : r.name}</b>
                        <span className="pod-pts">{r.points.toLocaleString()} pts</span>
                      </div>
                    ) : (
                      !data && <Skeleton h={96} />
                    )}
                    <div className="pod-block" style={{ height: BLOCK[i], background: MEDAL[i][0], color: MEDAL[i][1], animationDelay: `${(2 - i) * 150}ms` }}>
                      <Medal rank={r ? r.rank : i + 1} size={i === 0 ? 40 : 34} />
                      {r && <span className="pod-passed">ผ่าน {r.passed} ข้อ</span>}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>

          <section aria-label="ตารางอันดับ" className="card" style={{ padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px 8px', fontSize: 13, color: 'var(--muted)' }}>
              <span>อันดับ</span>
              <span>ชื่อ</span>
              <span style={{ textAlign: 'right' }}>ผ่าน</span>
              <span style={{ textAlign: 'right' }}>คะแนน</span>
            </div>
            {data && rows.length <= 3 && <div style={{ padding: '12px 16px', color: 'var(--muted)' }}>ยังไม่มีอันดับอื่นในช่วงนี้</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {table.map((r, k) =>
                r ? (
                  <div
                    key={k}
                    style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 16, background: r.me ? MT : 'transparent' }}
                  >
                    <span style={{ fontFamily: "'Mitr', sans-serif", fontSize: 17, fontWeight: 500, color: r.me ? M : 'var(--muted)' }}>{r.rank}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span
                        style={{
                          width: 36,
                          height: 36,
                          flex: 'none',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          fontWeight: 700,
                          background: r.me ? M : 'var(--soft)',
                          color: r.me ? '#fff' : INK,
                        }}
                      >
                        {r.initials}
                      </span>
                      <span style={{ fontWeight: r.me ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.me ? `${r.name} (คุณ)` : r.name}
                      </span>
                    </span>
                    <span style={mono}>{r.passed}</span>
                    <span style={{ ...mono, fontWeight: 600 }}>{r.points.toLocaleString()}</span>
                  </div>
                ) : (
                  <div key={k} aria-hidden="true" style={{ padding: '4px 16px', color: 'var(--tertiary)', fontFamily: "'Mitr', sans-serif" }}>
                    ···
                  </div>
                ),
              )}
            </div>
          </section>

        </div>
      </main>
    </>
  );
}
