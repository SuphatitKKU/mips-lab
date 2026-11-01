import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, useApi } from '../api';
import { FILL, Icon, ICON } from '../components/Icon';
import { CodeLine, ErrorBox, PageHeader, Skeleton } from '../components/ui';
import type { Answer as AnswerData } from '../data/problems';
import type { Lang } from '../lib/highlight';
import { M, M_DEEP, MS, MT } from '../lib/tokens';
import type { SimHandoff } from './Code';

const PANEL: Record<Lang, { label: string; bg: string; fg: string }> = {
  c: { label: 'C', bg: MT, fg: M },
  mips: { label: 'MIPS', bg: MS, fg: M_DEEP },
  z80: { label: 'Z80', bg: '#f1ece9', fg: 'var(--ink)' },
};

interface AnswerResp {
  id: number;
  title: string;
  kind: 'mips' | 'c' | 'z80';
  fn: string;
  answer: AnswerData;
  sample: (number | number[])[];
  solved: boolean;
  revealedBeforeSolve: boolean;
  half: number;
  base: number;
}

export function Answer() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, error, reload } = useApi<AnswerResp>(`/problems/${id}/answer`);
  const back = { label: data ? `${data.id}. ${data.title}` : 'กลับไปที่โจทย์', to: `/problems/${id}` };

  if (error instanceof ApiError && error.body.locked) {
    return (
      <>
        <PageHeader title="เฉลย" back={back} />
        <main className="main">
          <section className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
            <span style={{ width: 52, height: 52, borderRadius: 16, background: MS, color: M_DEEP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon d={ICON.lock} size={26} />
            </span>
            <h2 style={{ fontSize: 22 }}>เฉลยยังล็อกอยู่</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.75 }}>
              ดูเฉลยได้หลังจากส่งคำตอบผ่านทุกเคสแล้ว — ลองกด “ทดสอบ” แล้วดูว่าเคสไหนยังไม่ผ่าน
            </p>
            <div>
              <Link to={`/problems/${id}`} className="btn btn-primary">
                กลับไปทำโจทย์
              </Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (error)
    return (
      <>
        <PageHeader title="เฉลย" back={back} />
        <main className="main">
          <ErrorBox error={error} onRetry={reload} />
        </main>
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader title="เฉลย" back={back} />
        <main className="main">
          <Skeleton h={160} />
          <Skeleton h={320} />
        </main>
      </>
    );

  const a = data.answer;
  const asm = a.code.find((c) => c.lang === 'mips');
  const cSrc = a.code.find((c) => c.lang === 'c');
  const z80 = a.code.find((c) => c.lang === 'z80');
  const runIt = () => {
    const state: SimHandoff = asm
      ? { source: asm.lines.join('\n'), lang: 'mips', entry: data.fn, args: data.sample, title: `เฉลย: ${data.title}` }
      : { source: cSrc!.lines.join('\n'), lang: 'c', entry: data.fn, args: data.sample, title: `เฉลย: ${data.title}` };
    navigate('/code?mode=run', { state });
  };

  return (
    <>
      <PageHeader title="เฉลย" back={back}>
        {z80 ? (
          <Link to={`/z80?problem=${id}&answer=1`} className="btn btn-secondary" style={{ padding: '0 18px' }}>
            <Icon d={FILL.play} filled size={14} />
            รันบนบอร์ด Z80
          </Link>
        ) : (
          <button className="btn btn-secondary" style={{ padding: '0 18px' }} onClick={runIt}>
            <Icon d={FILL.play} filled size={14} />
            รันทีละขั้น
          </button>
        )}
        <Link to={`/problems/${id}`} className="btn btn-primary" style={{ padding: '0 18px' }}>
          กลับไปที่โจทย์
        </Link>
      </PageHeader>

      <main className="main">
        {!data.solved && (
          <div className="notice warn" style={{ alignItems: 'center' }}>
            <Icon d={ICON.lock} size={18} />
            <span>
              เปิดเฉลยแล้ว — ถ้าส่งผ่านหลังจากนี้จะได้ <b>{data.half}</b> จาก {data.base} pts
            </span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 20 }}>
          {a.code.map((pn) => {
            const st = PANEL[pn.lang];
            return (
              <section key={pn.lang} aria-label={`เฉลยภาษา ${st.label}`} className="card" style={{ minWidth: 0 }}>
                <div style={{ padding: '18px 20px 8px' }}>
                  <span
                    style={{ height: 34, padding: '0 12px', borderRadius: 11, display: 'inline-flex', alignItems: 'center', fontFamily: "'Mitr', sans-serif", fontWeight: 600, fontSize: 14, background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="code" style={{ padding: '4px 10px 16px', overflowX: 'auto' }}>
                  {pn.lines.map((t, i) => (
                    <CodeLine key={i} no={i + 1} src={t} lang={pn.lang} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
