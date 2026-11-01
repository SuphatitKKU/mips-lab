import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, useApi } from '../api';
import { CodeEditor } from '../components/CodeEditor';
import { FILL, Icon, ICON } from '../components/Icon';
import { Modal } from '../components/Modal';
import { usePopup } from '../components/Popup';
import { useAuth } from '../auth';
import { ErrorBox, LevelChip, PageHeader, Rich, Skeleton } from '../components/ui';
import type { MipsTest, PublicProblem, Z80Test } from '../data/problems';
import { runOnce, type CustomRun, type GradeResult } from '../lib/grader';
import { MT } from '../lib/tokens';

const h3 = { fontSize: 16 } as const;
const regBadge = {
  minWidth: 52,
  height: 30,
  padding: '0 8px',
  flex: 'none',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--mono)',
  fontWeight: 600,
  fontSize: 13,
} as const;

interface ProblemResp {
  problem: PublicProblem;
  draft: string | null;
  status: string;
  solved: { points: number } | null;
  revealed: boolean;
  potential: { points: number; firstTry: boolean; revealed: boolean };
  base: number;
  bonus: number;
  last: { kind: string; result: RunResult } | null;
  prev: number | null;
  next: number | null;
}

type RunResult = GradeResult & { kind: 'test' | 'submit'; pass: boolean; awarded: number | null; alreadySolved: boolean };

const LANG = { mips: 'mips', c: 'c', z80: 'z80' } as const;
const LANG_NAME = { mips: 'MIPS', c: 'C', z80: 'Z80' } as const;

export function Solve() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { isTeacher } = useAuth();
  const { data, error, reload } = useApi<ProblemResp>(`/problems/${id}`);
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'submit' | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runSeq, setRunSeq] = useState(0); // remounts the result panel so its animations replay
  const [showRes, setShowRes] = useState(false); // the results popup
  const [auto, setAuto] = useState(false); // the submit was started by a full test pass
  const popup = usePopup();
  const loadedFor = useRef<number | null>(null);

  // load the draft (or starter) once per problem
  useEffect(() => {
    if (!data || data.problem.id !== id || loadedFor.current === id) return;
    loadedFor.current = id;
    setCode(data.draft ?? data.problem.starter);
    setRun(data.last?.result ?? null);
    setSaved('saved');
  }, [data, id]);

  // autosave 800 ms after the last keystroke
  useEffect(() => {
    if (code == null || saved !== 'dirty') return;
    const t = setTimeout(() => {
      setSaved('saving');
      api(`/problems/${id}/draft`, { method: 'PUT', body: { code } })
        .then(() => setSaved((s) => (s === 'saving' ? 'saved' : s)))
        .catch(() => {
          setSaved('error');
          popup.toast('บันทึกโค้ดไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต', 'err');
        });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, saved, id]);

  const p = data?.problem;

  const go = async (kind: 'test' | 'submit') => {
    if (code == null) return;
    setBusy(kind);
    setRunErr(null);
    setAuto(false);
    setShowRes(true);
    try {
      let [r] = await Promise.all([api<RunResult>(`/problems/${id}/${kind}`, { body: { code } }), new Promise((ok) => setTimeout(ok, 600))]);
      // every case passed → submit straight away
      if (kind === 'test' && r.pass) {
        setAuto(true);
        setBusy('submit');
        [r] = await Promise.all([api<RunResult>(`/problems/${id}/submit`, { body: { code } }), new Promise((ok) => setTimeout(ok, 600))]);
        kind = 'submit';
      }
      setRun(r);
      setRunSeq((n) => n + 1);
      setSaved('saved');
      if (kind === 'submit' && r.pass) reload();
      announce(r);
    } catch (e) {
      setShowRes(false);
      setRunErr((e as ApiError).message);
      popup.toast((e as ApiError).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  const announce = (r: RunResult) => {
    if (r.kind !== 'submit' || !r.pass || r.awarded == null) setShowRes(true);
    else {
      setShowRes(false);
      const next = data?.next;
      popup.celebrate({
        title: 'ถูก!',
        points: r.awarded,
        body: 'คำตอบถูกต้อง',
        next: next != null ? { label: 'ข้อถัดไป', go: () => navigate(`/problems/${next}`) } : undefined,
      });
    }
  };

  // Ctrl/⌘+Enter runs the sample tests (never submits — a failed submit costs the first-try bonus)
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (!busy) void goRef.current('test');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  if (error) {
    return (
      <>
        <PageHeader title="โจทย์" back={{ label: 'โจทย์ฝึก', to: '/problems' }} />
        <main className="main">
          <ErrorBox error={error} onRetry={reload} />
        </main>
      </>
    );
  }
  if (!p || code == null) {
    return (
      <>
        <PageHeader title="กำลังโหลด…" back={{ label: 'โจทย์ฝึก', to: '/problems' }} />
        <main className="main">
          <div className="solve-grid">
            <Skeleton h={420} />
            <Skeleton h={420} />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`${p.id}. ${p.title}`} back={{ label: 'โจทย์ฝึก', to: '/problems' }}>
        {data.solved || isTeacher ? (
          <Link to={`/problems/${id}/answer`} className="btn btn-ghost" data-tour="answer">
            ดูเฉลย
          </Link>
        ) : (
          <button type="button" className="btn btn-ghost" disabled title="ดูเฉลยได้หลังส่งผ่านข้อนี้แล้ว" data-tour="answer" style={{ gap: 6 }}>
            <Icon d={ICON.lock} size={15} />
            ดูเฉลย
          </button>
        )}
        <button className="btn btn-secondary hide-narrow" style={{ padding: '0 18px' }} disabled={!!busy} aria-busy={busy === 'test'} onClick={() => go('test')} title="ทดสอบ (Ctrl+Enter)" data-tour="test">
          {busy !== 'test' && <Icon d={FILL.play} filled size={14} />}
          {busy === 'test' ? 'กำลังทดสอบ…' : 'ทดสอบ'}
        </button>
        <button className="btn btn-primary hide-narrow" style={{ padding: '0 22px' }} disabled={!!busy} aria-busy={busy === 'submit'} onClick={() => go('submit')} data-tour="submit">
          {busy === 'submit' ? 'กำลังตรวจ…' : 'ส่งคำตอบ'}
        </button>
      </PageHeader>

      <main className="main">
        {data.solved && (
          <div className="card solved-banner" role="status">
            <span className="solved-mark" aria-hidden="true">
              <Icon d={ICON.check} size={18} stroke={3} />
            </span>
            <span className="solved-text">
              <b>ผ่านข้อนี้แล้ว</b>
              <span>ส่งใหม่ได้ แต่คะแนนไม่เพิ่ม</span>
            </span>
            <span className="solved-pts">+{data.solved.points} pts</span>
          </div>
        )}
        <div className="solve-grid">
          <section aria-label="โจทย์" className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <LevelChip lv={p.level} />
                <span className="chip chip-soft">{p.topic}</span>
                <span className="chip chip-soft" style={{ fontFamily: 'var(--mono)' }}>
                  {data.base} pts
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.75 }}>
                <Rich text={p.statement} />
              </p>
            </div>

            {p.given && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={h3}>โค้ด MIPS ที่ให้มา</h3>
                <CodeEditor value={p.given.join('\n')} lang="mips" readOnly label="โค้ด MIPS ที่ให้มา" minLines={1} />
              </div>
            )}

            {p.params.length + p.returns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={h3}>{p.kind === 'z80' ? 'ผลลัพธ์ที่ต้องได้' : 'รับ–ส่งค่าผ่าน register'}</h3>
                <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[...p.params.map(([r, n, d]) => [r, `${n} — ${d}`, false] as const), ...p.returns.map(([r, d]) => [r, d, true] as const)].map(
                    ([r, d, out]) => (
                      <div key={r + d} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <dt style={{ ...regBadge, background: out ? 'var(--ms)' : MT, color: out ? 'var(--m-deep)' : 'var(--m)' }}>{r}</dt>
                        <dd style={{ margin: 0 }}>{d}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={h3}>Output ที่ต้องการ</h3>
              <ol className="cases">
                {caseRows(p).map(([input, want], i) => (
                  <li key={i}>
                    <span className="case-in">{input}</span>
                    <span className="case-to" aria-hidden="true">→</span>
                    <b className="case-want">{want}</b>
                  </li>
                ))}
              </ol>
            </div>

            {checkRows(p).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={h3}>เงื่อนไขที่ตรวจด้วย</h3>
                <ul className="checks">
                  {checkRows(p).map((t) => (
                    <li key={t}>
                      <Rich text={t} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
              {data.prev != null && (
                <Link to={`/problems/${data.prev}`} className="btn btn-soft">
                  ← ข้อ {data.prev}
                </Link>
              )}
              {data.next != null && (
                <Link to={`/problems/${data.next}`} className="btn btn-soft" style={{ marginLeft: 'auto' }}>
                  ข้อ {data.next} →
                </Link>
              )}
            </div>
          </section>

          <section aria-label="คำตอบของคุณ" className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '18px 20px 8px' }}>
              <span style={{ fontFamily: 'var(--head)', fontSize: 17, fontWeight: 500 }}>คำตอบของคุณ · {LANG_NAME[p.kind]}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--muted)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: saved === 'saved' ? 'var(--line-no)' : saved === 'error' ? 'var(--err)' : 'var(--m-mid)',
                    }}
                  />
                  {saved === 'saved' ? 'บันทึกแล้ว' : saved === 'error' ? 'บันทึกไม่สำเร็จ' : 'กำลังบันทึก…'}
                </span>
                <button
                  className="btn btn-soft"
                  style={{ height: 30, padding: '0 12px', fontSize: 13 }}
                  onClick={async () => {
                    const ok = await popup.confirm({ title: 'ล้างโค้ด?', body: 'โค้ดจะกลับเป็นแบบเริ่มต้นของโจทย์ และบันทึกทับของเดิม', ok: 'ล้างโค้ด' });
                    if (!ok) return;
                    setCode(p.starter);
                    setSaved('dirty');
                    popup.toast('ล้างโค้ดกลับเป็นแบบเริ่มต้นแล้ว');
                  }}
                >
                  เริ่มใหม่
                </button>
              </span>
            </div>
            <div style={{ padding: '4px 12px 12px', flex: 1 }}>
              <CodeEditor
                value={code}
                onChange={(v) => {
                  setCode(v);
                  setSaved('dirty');
                }}
                lang={LANG[p.kind]}
                label={`คำตอบภาษา ${LANG_NAME[p.kind]}`}
                minLines={16}
                style={{ maxHeight: 560 }}
              />
            </div>
            <TryRun key={p.id} p={p} code={code} />
            <div style={{ margin: '0 12px 12px', borderRadius: 18, background: 'var(--page)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {runErr ? (
                <div className="notice err" style={{ flex: 1 }}>
                  {runErr}
                </div>
              ) : !run ? (
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>กด “ทดสอบ” เพื่อรันกับเคสตัวอย่าง หรือ “ส่งคำตอบ” เพื่อตรวจทุกเคส · ผลจะขึ้นเป็นหน้าต่าง</span>
              ) : (
                <>
                  <ResultSummary run={run} />
                  <button type="button" className="btn btn-soft" style={{ height: 36, marginLeft: 'auto' }} onClick={() => setShowRes(true)}>
                    ดูผลล่าสุด
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
        <div className="solve-bar only-narrow">
          <span role="status" style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--muted)' }}>
            {run ? (
              <button
                type="button"
                onClick={() => setShowRes(true)}
                style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, cursor: 'pointer', color: run.pass ? 'var(--ok-deep)' : 'var(--err-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                {run.pass ? '✓ ถูก' : '✗ ไม่ถูก'}
              </button>
            ) : (
              'ยังไม่ได้ทดสอบ'
            )}
          </span>
          <button className="btn btn-secondary" style={{ padding: '0 16px' }} disabled={!!busy} aria-busy={busy === 'test'} onClick={() => go('test')} data-tour="test">
            {busy !== 'test' && <Icon d={FILL.play} filled size={14} />}
            {busy === 'test' ? 'กำลังทดสอบ…' : 'ทดสอบ'}
          </button>
          <button className="btn btn-primary" style={{ padding: '0 18px' }} disabled={!!busy} aria-busy={busy === 'submit'} onClick={() => go('submit')} data-tour="submit">
            {busy === 'submit' ? 'กำลังตรวจ…' : 'ส่งคำตอบ'}
          </button>
        </div>
      </main>

      {showRes && (busy || run) && (
        <Modal
          wide
          focusKey={busy ? 'loading' : runSeq}
          title={busy || !run ? (busy === 'submit' ? 'ส่งคำตอบ' : 'ทดสอบ') : run.kind === 'submit' ? 'ผลตรวจคำตอบ' : 'ผลทดสอบ'}
          onClose={() => setShowRes(false)}
          footer={
            busy || !run ? undefined : run.pass ? (
              <>
                <button className="btn btn-secondary" onClick={() => setShowRes(false)}>
                  ปิด
                </button>
                <Link to={`/problems/${id}/answer`} className="btn btn-secondary">
                  ดูเฉลย
                </Link>
                {data.next != null && (
                  <Link to={`/problems/${data.next}`} className="btn btn-primary">
                    ข้อถัดไป →
                  </Link>
                )}
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setShowRes(false)}>
                กลับไปแก้โค้ด
              </button>
            )
          }
        >
          {busy || !run ? (
            <RunLoading kind={busy ?? 'test'} auto={auto} />
          ) : (
            <ResultBody key={runSeq} run={run} />
          )}
        </Modal>
      )}
    </>
  );
}

/** The popup while the server runs the code: the app's chip logo, a line of text and a sliding bar. */
function RunLoading({ kind, auto }: { kind: 'test' | 'submit'; auto: boolean }) {
  return (
    <div role="status" aria-live="polite" className="run-loading">
      <span className="run-chip" aria-hidden="true">
        <Icon d={ICON.chip} size={30} />
      </span>
      <b className="run-title">{kind === 'test' ? 'กำลังทดสอบโค้ด' : 'กำลังตรวจคำตอบ'}</b>
      <span className="run-sub">
        {kind === 'test' ? 'รันโค้ดของคุณแล้วเทียบผลลัพธ์กับที่ต้องได้' : auto ? 'ผลลัพธ์ถูกทุกเคส · กำลังส่งคำตอบ' : 'เทียบผลลัพธ์กับที่ต้องได้ทุกเคส'}
      </span>
      <span className="run-bar" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}

/** One line under the editor: how the last run went (the details live in the popup). */
function ResultSummary({ run }: { run: RunResult }) {
  return (
    <span role="status" style={{ fontSize: 15 }}>
      {run.kind === 'submit' ? 'ผลตรวจล่าสุด' : 'ผลทดสอบล่าสุด'}:{' '}
      <b style={{ color: run.pass ? 'var(--ok-deep)' : 'var(--err-deep)' }}>{run.pass ? 'ถูก' : 'ไม่ถูก'}</b>
    </span>
  );
}

/** The last run: only whether the answer is right — no per-case input / expected / got. */
function ResultBody({ run }: { run: RunResult }) {
  return (
    <div className="res-head">
      <span className={`res-icon ${run.pass ? 'ok' : 'bad'}`} aria-hidden="true">
        <Icon d={run.pass ? ICON.check : ICON.x} size={26} stroke={3} />
      </span>
      <div className="res-head-text">
        <b className={run.pass ? 'ok' : undefined}>{run.pass ? 'ถูก' : 'ไม่ถูก'}</b>
        {run.pass && run.awarded != null && <span>+{run.awarded} pts</span>}
      </div>
    </div>
  );
}

/** "5", "-3", "0x1F" → number; "3, 1, 2" → array, when the parameter takes one. */
function parseArg(text: string, array: boolean): number | number[] | null {
  const one = (t: string) => (/^-?(0x[0-9a-f]+|\d+)$/i.test(t) ? (t.startsWith('-') ? -Number(t.slice(1)) : Number(t)) : NaN);
  if (array) {
    const parts = text.split(/[\s,]+/).filter(Boolean).map(one);
    return parts.some(Number.isNaN) ? null : parts;
  }
  const v = one(text.trim());
  return Number.isNaN(v) ? null : v;
}

const num = (v: number) => String(v).replace('-', '−');
const hexOut = (v: number) => v.toString(16).toUpperCase().padStart(2, '0') + 'h';

/** Every case the grader runs, as "input" → "what must come out" — nothing is hidden from the student. */
function caseRows(p: PublicProblem): [input: string, want: string][] {
  if (p.kind === 'z80')
    return (p.tests as Z80Test[]).map((t) => [t.note, t.outs.map(hexOut).join(' → ') + (t.minGap ? ` (ห่างกัน ≥ ${t.minGap.toLocaleString()} T-states)` : '')]);
  return (p.tests as MipsTest[]).map((t) => {
    const input = t.args.map((v, i) => `${p.params[i]?.[1] ?? 'a' + i} = ${Array.isArray(v) ? `[${v.map(num).join(', ')}]` : num(v)}`).join(', ');
    const regs = Object.entries(t.expect);
    const want = [
      ...(regs.length === 1 && !t.expectArr ? [num(regs[0][1])] : regs.map(([r, v]) => `$${r} = ${num(v)}`)),
      ...(t.expectArr ? [`${p.params[0][1]} = [${t.expectArr.map(num).join(', ')}]`] : []),
    ];
    return [input || '(ไม่มี)', want.join(', ')];
  });
}

/** Everything besides the cases that the grader checks (see lib/grader.ts), so no rule is a surprise. */
function checkRows(p: PublicProblem): string[] {
  const out: string[] = [];
  if (p.rules) out.push(p.rules);
  out.push(...p.mustUse);
  if (p.allowedRegs && !p.rules) out.push(`เขียนค่าลงได้เฉพาะ ${p.allowedRegs.join(', ')}`);
  return out;
}

type Outputs = CustomRun['outputs'];

/**
 * Starting text for each parameter box: the input in the problem's example ("a = 2, b = 3 → 5",
 * "arr = [1, 2, 3, 4] → …"), so the first run matches what the statement shows. A length `n` the
 * example leaves out is the array's length; anything else falls back to the first test.
 */
function exampleTexts(p: PublicProblem, sample: (number | number[])[]): string[] {
  const given = new Map<string, string>();
  for (const [, name, v] of p.example.split('→')[0].replace(/−/g, '-').matchAll(/(\w+)\s*=\s*(\[[^\]]*\]|-?\d+)/g)) given.set(name, v.replace(/^\[|\]$/g, ''));
  const arr = [...given.values()].find((v) => v.includes(','));
  return p.params.map(([, name], i) => {
    const v = given.get(name);
    if (v != null) return v;
    if (name === 'n' && arr) return String(arr.split(',').length);
    const s = sample[i];
    return s == null ? '0' : Array.isArray(s) ? s.join(', ') : String(s);
  });
}

/**
 * Runs the answer once on input the student types and shows what it produced, then asks the server
 * what the answer key gives for the same input and says whether they match — no grading, nothing recorded.
 */
function TryRun({ p, code }: { p: PublicProblem; code: string }) {
  const sample = (p.tests[0] as MipsTest | undefined)?.args ?? [];
  const isArr = p.params.map((_, i) => Array.isArray(sample[i]));
  const [texts, setTexts] = useState(() => exampleTexts(p, sample));
  const [out, setOut] = useState<CustomRun | null>(null);
  // undefined = still asking the server; null = no answer key to compare with
  const [expected, setExpected] = useState<Outputs | null | undefined>(undefined);
  const [seq, setSeq] = useState(0);
  const latest = useRef(0);
  const parsed = texts.map((t, i) => parseArg(t, isArr[i]));
  const bad = parsed.findIndex((v) => v == null);

  const go = () => {
    if (bad >= 0) return;
    const args = parsed as (number | number[])[];
    const r = runOnce(p, code, args);
    const n = ++latest.current;
    setOut(r);
    setSeq(n);
    if (r.errors.length) return;
    setExpected(undefined);
    api<{ expected: Outputs | null }>(`/problems/${p.id}/try`, { body: { args: p.kind === 'z80' ? [] : args } })
      .then((x) => n === latest.current && setExpected(x.expected))
      .catch(() => n === latest.current && setExpected(null));
  };

  // a function that never returned has no result to show
  const ended = !!out && out.ok;
  const match = ended && !out.msg && !!expected && expected.length === out.outputs.length && expected.every(([k, v], i) => out.outputs[i][0] === k && out.outputs[i][1] === v);

  return (
    <form
      aria-label="ลองรันด้วยค่าของคุณ"
      className="try-run"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <span style={{ fontFamily: 'var(--head)', fontWeight: 500 }}>ลองรันด้วยค่าของคุณ</span>
        {p.params.map(([reg, name], i) => (
          <label key={reg} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 14 }} title={`${reg}${isArr[i] ? ' (address ของอาร์เรย์)' : ''}`}>
            {name} =
            <input
              className="input"
              value={texts[i]}
              aria-invalid={parsed[i] == null}
              onChange={(e) => setTexts((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={isArr[i] ? '3, 1, 2' : '0'}
              style={{ width: isArr[i] ? 150 : 80, height: 36, padding: '0 10px', fontFamily: 'var(--mono)', fontSize: 14 }}
            />
          </label>
        ))}
        {p.kind === 'z80' && <span style={{ fontSize: 13, color: 'var(--muted)' }}>ดูค่าที่ OUT ไปพอร์ต {(p.port ?? 0).toString(16).toUpperCase().padStart(2, '0')}h</span>}
        <button type="submit" className="btn btn-secondary" style={{ height: 36, padding: '0 14px', gap: 6, marginLeft: 'auto' }} disabled={bad >= 0}>
          <Icon d={FILL.play} filled size={12} />
          รัน
        </button>
      </div>
      {bad >= 0 && <span style={{ fontSize: 13, color: 'var(--err-deep)' }}>{p.params[bad][1]}: ใส่ตัวเลข{isArr[bad] ? ' คั่นด้วยจุลภาค เช่น 3, 1, 2' : ' เช่น 5, -3 หรือ 0x1F'}</span>}
      {out && (
        <div key={seq} className="try-out" role="status">
          {out.errors.length > 0 ? (
            <div className="notice err">
              <b>ไม่ถูก</b>
            </div>
          ) : (
            <>
              <div className="try-row">
                <dl>
                  {out.outputs.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{ended ? v : '—'}</dd>
                    </div>
                  ))}
                </dl>
                {expected === undefined && ended && !out.msg ? (
                  <span className="try-verdict wait">กำลังเทียบ…</span>
                ) : expected === null && ended && !out.msg ? (
                  <span className="try-verdict wait">{out.cost}</span>
                ) : (
                  <span className={`try-verdict ${match ? 'ok' : 'bad'}`}>
                    <i aria-hidden="true">
                      <Icon d={match ? ICON.check : ICON.x} size={12} stroke={3.2} />
                    </i>
                    {match ? 'ตรงตามโจทย์' : 'ไม่ตรงตามโจทย์'}
                  </span>
                )}
              </div>
              {out.printed && (
                <pre style={{ margin: 0, padding: '8px 12px', borderRadius: 10, background: '#fff', fontFamily: 'var(--mono)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {out.printed}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
