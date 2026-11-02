import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { FILL, Icon, ICON } from '../components/Icon';
import { ErrorBox, PageHeader } from '../components/ui';

const TOOLS: [title: string, body: string, to: string, icon: keyof typeof ICON][] = [
  ['แปลงโค้ด C ⇄ MIPS', 'เขียน C แล้วดู assembly ที่ได้ หรือวาง MIPS แล้วแปลงกลับเป็น C', '/code?mode=convert', 'convert'],
  ['รันทีละคำสั่ง', 'กดถัดไปหรือย้อนกลับ แล้วดูว่า register ตัวไหนเปลี่ยน และเปลี่ยนเพราะอะไร', '/code?mode=run', 'sim'],
  ['โจทย์ฝึก', 'เรียงจากง่ายไปยาก ตรวจอัตโนมัติ มีเฉลยอธิบายทุกข้อ', '/problems', 'problems'],
  ['ต่อบอร์ด Z80', 'ลากชิปและ LED มาต่อสายบน breadboard แล้วรันโปรแกรมจริง', '/z80', 'z80'],
];

const RING_C = 2 * Math.PI * 34;

export interface MeStats {
  user: { name: string; initials: string; section: string };
  points: number;
  passed: number;
  total: number;
  streak: number;
  rank: number | null;
  rankDelta: number | null;
  continue: { id: number; title: string; passed: number; total: number; failing: string | null } | null;
  next: { id: number; title: string } | null;
}

export function Home() {
  const { data: me, error } = useApi<MeStats>('/me');
  const passed = me?.passed ?? 0;
  const total = me?.total || 1;
  const cont = me?.continue;
  const heroId = cont?.id ?? me?.next?.id;
  return (
    <>
      <PageHeader title={me ? `สวัสดี, ${me.user.name}` : 'สวัสดี'} sub="ทำโจทย์ที่ค้างไว้ต่อ หรือเลือกเครื่องมือด้านล่าง">
        <span className={`stat-pill streak-pill${me?.streak ? ' lit' : ''}`}>
          <span className="streak-flame">
            <Icon d={FILL.flame} filled size={18} />
          </span>
          ทำต่อเนื่อง <b>{me ? `${me.streak} วัน` : '–'}</b>
        </span>
        <span className="stat-pill pts-pill">
          <Icon d={FILL.star} filled size={16} />
          <b>{me ? me.points.toLocaleString() : '–'}</b> pts
        </span>
      </PageHeader>

      <main className="main home-main" style={{ gap: 32 }}>
        {error && <ErrorBox error={error} />}
        <div className="home-overview">
          <section
            aria-label="ทำต่อจากครั้งก่อน"
            className="home-hero"
          >
            <div className="home-hero-copy">
            <span
              style={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                alignItems: 'center',
                height: 30,
                padding: '0 12px',
                borderRadius: 999,
                background: 'var(--soft)',
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {cont ? `ทำต่อจากครั้งก่อน · โจทย์ #${cont.id}` : me?.next ? `ข้อถัดไป · โจทย์ #${me.next.id}` : 'โจทย์'}
            </span>
            <span style={{ fontFamily: 'var(--head)', fontSize: 32, fontWeight: 500, lineHeight: 1.25 }}>
              {!me ? '…' : heroId == null ? 'เก่งมาก! ผ่านครบทุกข้อแล้ว' : `ทำไปแล้ว ${passed} / ${me.total} ข้อ`}
            </span>
            {me && (
              <div
                role="progressbar"
                aria-label="ความคืบหน้าโจทย์ทั้งหมด"
                aria-valuemin={0}
                aria-valuemax={me.total}
                aria-valuenow={passed}
                style={{ width: '100%', maxWidth: 440, height: 10, borderRadius: 99, background: 'var(--track)', overflow: 'hidden' }}
              >
                <span style={{ display: 'block', height: '100%', width: `${(passed / total) * 100}%`, borderRadius: 99, background: 'var(--m)' }} />
              </div>
            )}
            {(cont ?? me?.next) && (
              <span style={{ fontSize: 17, color: 'var(--body-alt)' }}>
                {(cont ?? me?.next)?.title}
                {cont && cont.total > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: 14 }}> · {cont.passed}/{cont.total} test</span>}
              </span>
            )}
            {cont?.failing && <span style={{ fontSize: 15, color: 'var(--body-alt)' }}>เคสที่ยังไม่ผ่าน: {cont.failing}</span>}
            {heroId != null && (
              <Link
                to={`/problems/${heroId}`}
                className="btn hero-btn-white"
                style={{
                  alignSelf: 'flex-start',
                  gap: 10,
                  height: 50,
                  padding: '0 22px 0 26px',
                  marginTop: 4,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {cont ? 'ทำต่อ' : 'เริ่มทำ'}
                <Icon d={ICON.arrowRight} size={18} stroke={2.4} />
              </Link>
            )}
            </div>
            <div className="hero-chip" aria-hidden="true"><Icon d={ICON.chip} size={76} stroke={1.2} /><span>LEARN. RUN. UNDERSTAND.</span></div>
          </section>

          <div className="home-stats">
            <section
              aria-label="ความคืบหน้า"
              className="card"
              style={{ flex: '1 1 240px', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18 }}
            >
              <svg width="76" height="76" viewBox="0 0 84 84" aria-hidden="true" style={{ flex: 'none' }}>
                <circle cx="42" cy="42" r="34" fill="none" stroke="var(--mt)" strokeWidth="10" />
                {passed > 0 && (
                  <circle
                    cx="42"
                    cy="42"
                    r="34"
                    fill="none"
                    stroke="var(--m)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${((RING_C * passed) / total).toFixed(1)} ${RING_C.toFixed(1)}`}
                    transform="rotate(-90 42 42)"
                  />
                )}
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>ผ่านแล้ว</span>
                <span style={{ fontFamily: 'var(--head)', fontSize: 30, fontWeight: 500, lineHeight: 1.2 }}>
                  {passed}{' '}
                  <span style={{ fontSize: 16, fontFamily: "'Anuphan', sans-serif", fontWeight: 500, color: 'var(--muted)' }}>
                    / {me?.total ?? '–'} ข้อ
                  </span>
                </span>
              </div>
            </section>
            <section
              aria-label="อันดับ"
              className="card"
              style={{ flex: '1 1 240px', padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18 }}
            >
              <span
                style={{
                  width: 56,
                  height: 56,
                  flex: 'none',
                  borderRadius: 18,
                  background: 'var(--mt)',
                  color: 'var(--m)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon d={ICON.trophy} size={28} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>อันดับสัปดาห์นี้</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--head)', fontSize: 30, fontWeight: 500, lineHeight: 1.2 }}>
                    {me?.rank ? `#${me.rank}` : '—'}
                  </span>
                  {!!me?.rankDelta && (
                    <span
                      title="เทียบกับสัปดาห์ที่แล้ว"
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: me.rankDelta > 0 ? 'var(--ok-deep)' : 'var(--muted)',
                        background: me.rankDelta > 0 ? 'var(--ok-bg)' : 'var(--soft)',
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      {me.rankDelta > 0 ? '▲' : '▼'}
                      {Math.abs(me.rankDelta)}
                    </span>
                  )}
                </span>
                <Link to="/leaderboard" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                  ดูอันดับทั้งหมด →
                </Link>
              </div>
            </section>
          </div>
        </div>

        <section aria-label="เครื่องมือ" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="home-section-heading"><div><h2>วันนี้อยากลองอะไร?</h2><p>เลือกเครื่องมือ แล้วเริ่มเรียนรู้ด้วยการลงมือทำ</p></div><span>YOUR WORKSPACE</span></div>
          <div className="tool-grid">
            {TOOLS.map(([title, body, to, icon]) => (
              <Link key={to} to={to} className={`card card-link tool-card tool-${icon}`}>
                <div className="tool-preview" aria-hidden="true"><span className="tool-preview-icon"><Icon d={ICON[icon]} size={34} stroke={1.7} /></span><span className="tool-preview-label">{icon === 'convert' ? 'C ⇄ MIPS' : icon === 'sim' ? 'STEP → RUN' : icon === 'problems' ? 'PRACTICE' : 'Z80 LAB'}</span><span className="tool-open"><Icon d={ICON.arrowRight} size={17} /></span></div>
                <span style={{ fontFamily: 'var(--head)', fontSize: 19, fontWeight: 500, lineHeight: 1.3 }}>{title}</span>
                <span style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--muted)' }}>{body}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
