// Teacher page extras: one student's progress, per-problem stats for the filtered
// students, nearly identical code, the action history, and assigning problems.

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, useApi } from '../api';
import { DueChip, dueText } from '../components/DueChip';
import { Icon, ICON } from '../components/Icon';
import { Modal } from '../components/Modal';
import { usePopup } from '../components/Popup';
import { LevelChip, Skeleton } from '../components/ui';
import { termText, type ClassInfo } from '../lib/terms';

const when = (t: number) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- one student ----------

interface ProblemProgress {
  id: number;
  title: string;
  level: string;
  status: 'done' | 'doing' | 'todo';
  points: number | null;
  solvedAt: number | null;
  firstTry: boolean;
  attempts: number;
  last: { passed: number; total: number; at: number } | null;
  dueAt: number | null;
}

export function ProgressModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { data, error } = useApi<{ user: { name: string; studentId: string; section: string }; problems: ProblemProgress[] }>(`/teacher/users/${userId}/progress`);
  const ps = data?.problems ?? [];
  const done = ps.filter((p) => p.status === 'done').length;
  const stuck = ps.filter((p) => p.status === 'doing');
  return (
    <Modal wide title={data ? `${data.user.name} · ${data.user.studentId}` : 'ความคืบหน้า'} onClose={onClose}>
      {error && <div className="notice err">{error.message}</div>}
      {!data && !error && <Skeleton h={300} />}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>
            {data.user.section || 'ยังไม่เข้าห้อง'} · ผ่าน <b style={{ color: 'var(--ok-deep)' }}>{done}</b>/{ps.length} ข้อ
            {stuck.length > 0 && (
              <>
                {' '}
                · ค้างอยู่ <b style={{ color: 'var(--m)' }}>{stuck.length}</b> ข้อ ({stuck.map((p) => `#${p.id}`).join(', ')})
              </>
            )}
          </span>
          <div style={{ overflowX: 'auto' }}>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>ข้อ</th>
                  <th>ระดับ</th>
                  <th>สถานะ</th>
                  <th style={{ textAlign: 'right' }}>ลองรัน/ส่ง</th>
                  <th style={{ textAlign: 'right' }}>คะแนน</th>
                  <th>กำหนดส่ง</th>
                </tr>
              </thead>
              <tbody>
                {ps.map((p) => (
                  <tr key={p.id}>
                    <td style={{ minWidth: 220 }}>
                      <b style={{ fontWeight: 600 }}>{p.id}.</b> {p.title}
                    </td>
                    <td>
                      <LevelChip lv={p.level} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {p.status === 'done' ? (
                        <span style={{ color: 'var(--ok-deep)' }}>
                          ✓ ผ่าน {p.solvedAt ? when(p.solvedAt) : ''}
                          {p.firstTry ? ' · ครั้งแรก' : ''}
                        </span>
                      ) : p.status === 'doing' ? (
                        <span style={{ color: 'var(--m)' }}>{p.last ? `กำลังทำ · ผ่าน ${p.last.passed}/${p.last.total} เคส` : 'มีโค้ดร่าง'}</span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>ยังไม่เริ่ม</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{p.attempts || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{p.points ?? '—'}</td>
                    <td>{p.dueAt ? <DueChip dueAt={p.dueAt} solvedAt={p.solvedAt} /> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- per-problem stats ----------

interface ProblemStat {
  id: number;
  title: string;
  level: string;
  attempted: number;
  solved: number;
}

/** How the students on screen are doing, problem by problem. Refetches when `version` changes (live updates). */
export function StatsPanel({ ids, version }: { ids: number[]; version: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ students: number; problems: ProblemStat[] } | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ students: number; problems: ProblemStat[] }>('/teacher/stats', { body: { ids } })
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, version]);
  const hardest = useMemo(() => (data ? [...data.problems].filter((p) => p.attempted > 0).sort((a, b) => a.solved / a.attempted - b.solved / b.attempted)[0] : null), [data]);

  return (
    <section aria-label="สถิติรายข้อ" className="card" style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" className="panel-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon d={ICON.board} size={19} color="var(--m)" />
        <span style={{ flex: 1 }}>
          <b style={{ fontFamily: 'var(--head)', fontWeight: 500, fontSize: 18 }}>สถิติรายข้อ</b>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>ผ่านกี่คน ลองกี่คน — ตามนักศึกษาที่กรองอยู่ ({ids.length} คน)</span>
        </span>
        <Icon d={open ? ICON.sortUp : ICON.sortDown} size={16} />
      </button>
      {open && !data && <Skeleton h={200} />}
      {open && data && (
        <>
          {hardest && hardest.attempted >= 3 && hardest.solved / hardest.attempted < 0.5 && (
            <div className="notice warn">
              <Icon d={ICON.bulb} size={18} style={{ marginTop: 2 }} />
              <span>
                ข้อ {hardest.id}. {hardest.title} ผ่านแค่ {Math.round((hardest.solved / hardest.attempted) * 100)}% ของคนที่ลองทำ — อาจต้องอธิบายเพิ่มในคาบ
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--ok)' }} /> ผ่าน
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--ms)' }} /> ลองแล้วยังไม่ผ่าน
            </span>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.problems.map((p) => {
              const n = data.students || 1;
              return (
                <li key={p.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 260px) 1fr 92px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>
                    {p.id}. {p.title}
                  </span>
                  <span style={{ display: 'flex', height: 12, borderRadius: 99, background: 'var(--soft)', overflow: 'hidden' }} aria-hidden="true">
                    <i style={{ width: `${(p.solved / n) * 100}%`, background: 'var(--ok)' }} />
                    <i style={{ width: `${((p.attempted - p.solved) / n) * 100}%`, background: 'var(--ms)' }} />
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right' }} aria-label={`ผ่าน ${p.solved} ลอง ${p.attempted} จาก ${data.students} คน`}>
                    {p.solved}/{p.attempted}/{data.students}
                  </span>
                </li>
              );
            })}
          </ol>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>ตัวเลข = ผ่าน / ลองแล้ว / นักศึกษาทั้งหมด</span>
        </>
      )}
    </section>
  );
}

// ---------- similar code ----------

interface Pair {
  problem: { id: number; title: string };
  a: { id: number; name: string; studentId: string; code: string };
  b: { id: number; name: string; studentId: string; code: string };
  similarity: number;
}

export function SimilarPanel({ ids }: { ids: number[] }) {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<Pair | null>(null);
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      setPairs((await api<{ pairs: Pair[] }>('/teacher/similar', { body: { ids } })).pairs);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="ตรวจโค้ดคล้ายกัน" className="card" style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Icon d={ICON.eye} size={19} color="var(--m)" />
        <span style={{ flex: '1 1 240px' }}>
          <b style={{ fontFamily: 'var(--head)', fontWeight: 500, fontSize: 18 }}>ตรวจโค้ดคล้ายกัน</b>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>
            หาคู่ที่ส่งโค้ดเกือบเหมือนกัน (≥ 85%) ในข้อเดียวกัน — เปลี่ยนชื่อ label/ตัวแปร หรือเว้นวรรคต่างกันก็ยังจับได้ · ข้อสั้นมากถูกข้าม
          </span>
        </span>
        <button type="button" className="btn btn-secondary" style={{ height: 40 }} onClick={run} disabled={busy || ids.length < 2} aria-busy={busy}>
          {pairs ? 'ตรวจอีกครั้ง' : `ตรวจ ${ids.length} คน`}
        </button>
      </div>
      {err && <div className="notice err">{err}</div>}
      {pairs && !pairs.length && <div className="notice ok">ไม่พบโค้ดที่คล้ายกันผิดปกติ</div>}
      {pairs && pairs.length > 0 && (
        <>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            พบ {pairs.length} คู่ · ความคล้ายสูงไม่ได้แปลว่าลอกเสมอ (โจทย์ง่ายมักเขียนออกมาคล้ายกัน) — เปิดดูโค้ดก่อนตัดสิน
          </span>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pairs.map((p, i) => (
              <li key={i}>
                <button type="button" className="prob-row" style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '10px 12px' }} onClick={() => setView(p)}>
                  <span className="chip" style={{ background: p.similarity >= 0.95 ? 'var(--err-bg)' : 'var(--warn-bg)', color: p.similarity >= 0.95 ? 'var(--err-deep)' : 'var(--warn-deep)' }}>
                    {Math.round(p.similarity * 100)}%
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>{p.a.name}</b> ↔ <b style={{ fontWeight: 600 }}>{p.b.name}</b>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>
                      ข้อ {p.problem.id}. {p.problem.title}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--m)' }}>ดูโค้ด</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {view && (
        <Modal wide title={`ข้อ ${view.problem.id} · คล้ายกัน ${Math.round(view.similarity * 100)}%`} onClose={() => setView(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {[view.a, view.b].map((s) => (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>
                  {s.name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontFamily: 'var(--mono)', fontSize: 13 }}>{s.studentId}</span>
                </b>
                <pre className="code-compare">{s.code}</pre>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- history ----------

export function AuditPanel({ version }: { version: number }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ at: number; actor: string; action: string; detail: string }[] | null>(null);
  useEffect(() => {
    if (!open) return;
    api<{ log: { at: number; actor: string; action: string; detail: string }[] }>('/teacher/audit')
      .then((d) => setLog(d.log))
      .catch(() => undefined);
  }, [open, version]);
  return (
    <section aria-label="ประวัติการทำงาน" className="card" style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button type="button" className="panel-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon d={ICON.edit} size={19} color="var(--m)" />
        <span style={{ flex: 1 }}>
          <b style={{ fontFamily: 'var(--head)', fontWeight: 500, fontSize: 18 }}>ประวัติการทำงานของอาจารย์</b>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>ใครสร้าง/ลบห้อง แก้ข้อมูล หรือมอบหมายโจทย์ เมื่อไร (100 รายการล่าสุด)</span>
        </span>
        <Icon d={open ? ICON.sortUp : ICON.sortDown} size={16} />
      </button>
      {open && !log && <Skeleton h={120} />}
      {open && log && !log.length && <span style={{ color: 'var(--muted)', fontSize: 14 }}>ยังไม่มีประวัติ</span>}
      {open && log && log.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ผู้ทำ</th>
                <th>การกระทำ</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 13 }}>{when(r.at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.actor}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: r.action === 'ลบห้อง' ? 'var(--err-deep)' : undefined }}>{r.action}</td>
                  <td>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- assigning problems ----------

interface ProblemItem {
  id: number;
  title: string;
  level: string;
  topic: string;
}

/** "2026-11-09T23:59" (datetime-local) ⇄ ms, local time */
const toLocal = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const weekFromNow = () => {
  const d = new Date(Date.now() + 7 * 86400000);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
};

export function AssignModal({ cls, onClose, onSaved }: { cls: ClassInfo; onClose: () => void; onSaved: (count: number) => void }) {
  const popup = usePopup();
  const problems = useApi<{ problems: ProblemItem[] }>('/problems');
  const current = useApi<{ assignments: { problemId: number; dueAt: number }[] }>(`/teacher/classes/${cls.id}/assignments`);
  const [due, setDue] = useState<Map<number, string> | null>(null);
  const [all, setAll] = useState(toLocal(weekFromNow()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (current.data && !due) setDue(new Map(current.data.assignments.map((a) => [a.problemId, toLocal(a.dueAt)])));
  }, [current.data, due]);

  const toggle = (id: number) =>
    setDue((m) => {
      const n = new Map(m ?? []);
      if (n.has(id)) n.delete(id);
      else n.set(id, all);
      return n;
    });

  const save = async () => {
    if (!due) return;
    const list = [...due].map(([problemId, v]) => ({ problemId, dueAt: new Date(v).getTime() }));
    if (list.some((a) => !Number.isFinite(a.dueAt))) return setErr('ใส่กำหนดส่งให้ครบทุกข้อที่เลือก');
    setBusy(true);
    setErr('');
    try {
      await api(`/teacher/classes/${cls.id}/assignments`, { method: 'PUT', body: { assignments: list } });
      popup.toast(list.length ? `มอบหมาย ${list.length} ข้อให้ ${cls.name} แล้ว` : `ล้างงานที่มอบหมายของ ${cls.name} แล้ว`, 'ok');
      onSaved(list.length);
      onClose();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={`มอบหมายโจทย์ · ${cls.name} · ${termText(cls)}`}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--muted)' }}>เลือกแล้ว {due?.size ?? 0} ข้อ</span>
          <button type="button" className="btn btn-ghost" style={{ height: 44 }} onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-primary" style={{ height: 44, padding: '0 24px' }} onClick={save} disabled={busy || !due} aria-busy={busy}>
            บันทึก
          </button>
        </>
      }
    >
      {(!problems.data || !due) && <Skeleton h={300} />}
      {problems.data && due && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>
              กำหนดส่งเริ่มต้น (ใช้กับข้อที่ติ๊กเพิ่ม)
              <input className="input" type="datetime-local" value={all} onChange={(e) => setAll(e.target.value)} />
            </label>
            <button type="button" className="btn btn-soft" style={{ height: 48 }} disabled={!due.size} onClick={() => setDue(new Map([...due.keys()].map((k) => [k, all])))}>
              ใช้วันนี้กับทุกข้อที่เลือก
            </button>
          </div>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>นักศึกษาเห็นงานพร้อมกำหนดส่งในหน้าโจทย์ · ส่งผ่านก่อนเวลา = "ตรงเวลา" (คะแนนปกติยังได้แม้ส่งช้า)</span>
          {err && <div className="notice err">{err}</div>}
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {problems.data.problems.map((p) => {
              const on = due.has(p.id);
              return (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 12, background: on ? 'var(--m-row)' : 'transparent' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px', cursor: 'pointer', minWidth: 0 }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ width: 18, height: 18, accentColor: 'var(--m)' }} />
                    <span style={{ minWidth: 0 }}>
                      <b style={{ fontWeight: 600 }}>{p.id}.</b> {p.title}
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{p.topic}</span>
                    </span>
                  </label>
                  <LevelChip lv={p.level} />
                  {on && (
                    <input
                      className="input"
                      type="datetime-local"
                      aria-label={`กำหนดส่งข้อ ${p.id}`}
                      value={due.get(p.id)}
                      onChange={(e) => setDue(new Map(due).set(p.id, e.target.value))}
                      style={{ height: 40, width: 220, fontSize: 14 }}
                    />
                  )}
                  {on && due.get(p.id) && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{dueText(new Date(due.get(p.id)!).getTime())}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Modal>
  );
}
