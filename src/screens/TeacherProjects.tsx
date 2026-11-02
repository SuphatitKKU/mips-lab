// Teacher page: Z80 board projects. Set a project for a class, see who handed in,
// open a hand-in on the board, grade it, download it or the scores.

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { dueText } from '../components/DueChip';
import { Icon, ICON } from '../components/Icon';
import { usePopup } from '../components/Popup';
import { Skeleton } from '../components/ui';
import { classLabel } from '../lib/terms';
import type { ClassRow } from './TeacherClasses';

interface ProjectRow {
  id: number;
  classId: number;
  title: string;
  detail: string;
  dueAt: number | null;
  classLabel: string;
  students: number;
  submitted: number;
  graded: number;
}
interface Hand {
  id: number;
  name: string;
  note: string;
  submittedAt: number;
  late: boolean;
  score: number | null;
  feedback: string | null;
  gradedAt: number | null;
}
interface SubRow {
  user: { id: number; name: string; studentId: string };
  submission: Hand | null;
}

/** ms ⇄ "2026-11-09T23:59" for datetime-local */
const toLocal = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const safe = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'z80';
function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ProjectsPanel({ classes, version }: { classes: ClassRow[]; version: number }) {
  const [list, setList] = useState<ProjectRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);

  useEffect(() => {
    let live = true;
    api<{ projects: ProjectRow[] }>('/teacher/projects')
      .then((d) => live && setList(d.projects))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [version, n]);

  const open = classes.filter((c) => !c.archived);
  return (
    <section aria-label="งานโปรเจกต์บอร์ด Z80" className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon d={ICON.z80} size={20} color="var(--m)" />
            งานโปรเจกต์บอร์ด Z80
          </h2>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>สั่งงานให้ห้อง นักศึกษากด “ส่งให้อาจารย์” ที่หน้าบอร์ด Z80 แล้วเปิดดูวงจร รันโค้ด และให้คะแนนได้ที่นี่</span>
        </div>
        <button type="button" className="btn btn-primary" style={{ height: 44, gap: 8 }} onClick={() => setCreating(true)} disabled={creating || !open.length} title={open.length ? '' : 'สร้างห้องก่อน'}>
          <Icon d={ICON.z80} size={18} />
          สั่งงานใหม่
        </button>
      </div>

      {creating && (
        <ProjectForm
          classes={open}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {!list && <Skeleton h={80} />}
      {list && !list.length && !creating && <span style={{ fontSize: 14, color: 'var(--muted)' }}>ยังไม่มีงานโปรเจกต์ — กด “สั่งงานใหม่”</span>}
      {list?.map((p) =>
        editing === p.id ? (
          <ProjectForm
            key={p.id}
            classes={open}
            initial={p}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        ) : (
          <ProjectLine key={p.id} p={p} open={openId === p.id} onToggle={() => setOpenId((x) => (x === p.id ? null : p.id))} onEdit={() => setEditing(p.id)} onChanged={reload} version={version} />
        ),
      )}
    </section>
  );
}

function ProjectLine({ p, open, onToggle, onEdit, onChanged, version }: { p: ProjectRow; open: boolean; onToggle: () => void; onEdit: () => void; onChanged: () => void; version: number }) {
  const popup = usePopup();
  const overdue = p.dueAt != null && Date.now() > p.dueAt;
  const remove = async () => {
    if (
      !(await popup.confirm({
        title: `ลบงาน “${p.title}”?`,
        body: p.submitted ? `งานที่นักศึกษาส่งมาแล้ว ${p.submitted} ชิ้นจะถูกลบด้วย กู้คืนไม่ได้ — ดาวน์โหลดคะแนนเก็บไว้ก่อนถ้ายังต้องใช้` : 'ยังไม่มีใครส่ง ลบแล้วกู้คืนไม่ได้',
        ok: 'ลบงาน',
      }))
    )
      return;
    try {
      await api(`/teacher/projects/${p.id}`, { method: 'DELETE' });
      popup.toast(`ลบงาน “${p.title}” แล้ว`, 'ok');
      onChanged();
    } catch (e) {
      popup.toast((e as ApiError).message, 'err');
    }
  };
  const small = { height: 34, fontSize: 14, padding: '0 12px' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 16, background: 'var(--soft)' }}>
        <span style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <b style={{ fontWeight: 600 }}>{p.title}</b>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            {p.classLabel} · {p.dueAt ? `กำหนดส่ง ${dueText(p.dueAt)} น.${overdue ? ' (เลยแล้ว)' : ''}` : 'ไม่มีกำหนดส่ง'}
          </span>
        </span>
        <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
          ส่งแล้ว <b>{p.submitted}</b>/{p.students} · ตรวจแล้ว <b>{p.graded}</b>
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="btn btn-ghost" style={small} onClick={onToggle} aria-expanded={open}>
            {open ? 'ซ่อน' : 'ดูงานที่ส่ง'}
          </button>
          <button type="button" className="btn btn-ghost btn-round" style={{ width: 34, height: 34, padding: 0 }} onClick={onEdit} aria-label={`แก้ไขงาน ${p.title}`} title="แก้ไข">
            <Icon d={ICON.edit} size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-round" style={{ width: 34, height: 34, padding: 0, color: 'var(--err)' }} onClick={remove} aria-label={`ลบงาน ${p.title}`} title="ลบงาน">
            <Icon d={ICON.trash} size={16} />
          </button>
        </span>
      </div>
      {open && <Submissions p={p} version={version} onGraded={onChanged} />}
    </div>
  );
}

function Submissions({ p, version, onGraded }: { p: ProjectRow; version: number; onGraded: () => void }) {
  const popup = usePopup();
  const [rows, setRows] = useState<SubRow[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ rows: SubRow[] }>(`/teacher/projects/${p.id}/submissions`)
      .then((d) => live && setRows(d.rows))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [p.id, version]);

  const downloadJson = async (r: SubRow) => {
    try {
      const { submission: s } = await api<{ submission: { name: string; board: unknown; code: string } }>(`/teacher/submissions/${r.submission!.id}`);
      save(`${safe(r.user.studentId)}_${safe(s.name)}.json`, new Blob([JSON.stringify({ name: s.name, board: s.board, code: s.code }, null, 1)], { type: 'application/json' }));
    } catch (e) {
      popup.toast((e as ApiError).message, 'err');
    }
  };

  const exportScores = () => {
    if (!rows) return;
    const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = rows.map((r, i) =>
      [
        String(i + 1),
        `="${r.user.studentId}"`,
        q(r.user.name),
        r.submission ? (r.submission.late ? 'ส่งช้า' : 'ส่งแล้ว') : 'ยังไม่ส่ง',
        r.submission ? q(dueText(r.submission.submittedAt)) : '',
        r.submission?.score != null ? String(r.submission.score) : '',
        q(r.submission?.feedback ?? ''),
      ].join(','),
    );
    const csv = '﻿' + ['ลำดับ,รหัสนักศึกษา,ชื่อ–นามสกุล,สถานะ,ส่งเมื่อ,คะแนน,ความเห็น', ...lines].join('\r\n') + '\r\n';
    save(`คะแนนโปรเจกต์_${safe(p.title)}_${safe(p.classLabel)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  };

  if (!rows) return <Skeleton h={100} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px 4px' }}>
      {p.detail && <span style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--body-alt)' }}>{p.detail}</span>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" style={{ height: 36, gap: 6, fontSize: 14 }} onClick={exportScores}>
          <Icon d={ICON.download} size={15} />
          คะแนนงานนี้ (Excel)
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="mini-table">
          <thead>
            <tr>
              <th>นักศึกษา</th>
              <th>สถานะ</th>
              <th>งานที่ส่ง</th>
              <th>คะแนน / ความเห็น</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user.id}>
                <td style={{ minWidth: 180 }}>
                  <b style={{ fontWeight: 600 }}>{r.user.name}</b>
                  <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{r.user.studentId}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.submission ? (
                    <span style={{ color: r.submission.late ? 'var(--warn-deep)' : 'var(--ok-deep)' }}>
                      {r.submission.late ? 'ส่งช้า' : 'ส่งแล้ว'} · {dueText(r.submission.submittedAt)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>ยังไม่ส่ง</span>
                  )}
                </td>
                <td style={{ minWidth: 200 }}>
                  {r.submission ? (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span>
                        “{r.submission.name}”{r.submission.note ? <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>💬 {r.submission.note}</span> : null}
                      </span>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Link to={`/z80?submission=${r.submission.id}`} target="_blank" className="btn btn-secondary" style={{ height: 32, fontSize: 13, gap: 6 }}>
                          <Icon d={ICON.external} size={14} />
                          เปิดบนบอร์ด
                        </Link>
                        <button type="button" className="btn btn-ghost" style={{ height: 32, fontSize: 13, gap: 6 }} onClick={() => downloadJson(r)}>
                          <Icon d={ICON.download} size={14} />
                          .json
                        </button>
                      </span>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ minWidth: 260 }}>{r.submission ? <GradeForm hand={r.submission} onSaved={(h) => (setRows((rs) => rs!.map((x) => (x.user.id === r.user.id ? { ...x, submission: h } : x))), onGraded())} /> : '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--muted)' }}>
                  ห้องนี้ยังไม่มีนักศึกษา
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GradeForm({ hand, onSaved }: { hand: Hand; onSaved: (h: Hand) => void }) {
  const popup = usePopup();
  const [score, setScore] = useState(hand.score == null ? '' : String(hand.score));
  const [feedback, setFeedback] = useState(hand.feedback ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = score !== (hand.score == null ? '' : String(hand.score)) || feedback !== (hand.feedback ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ submission: Hand }>(`/teacher/submissions/${hand.id}`, { method: 'PATCH', body: { score: score.trim() === '' ? null : Number(score), feedback } });
      onSaved({ ...hand, ...r.submission });
      popup.toast('บันทึกคะแนนแล้ว — นักศึกษาเห็นคะแนนและความเห็นในหน้าส่งงาน', 'ok');
    } catch (err) {
      popup.toast((err as ApiError).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" aria-label="คะแนน" value={score} onChange={(e) => setScore(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="คะแนน" style={{ height: 34, width: 76, fontSize: 14, background: 'var(--page)' }} />
      <input className="input" aria-label="ความเห็นถึงนักศึกษา" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} placeholder="ความเห็น (ไม่บังคับ)" style={{ height: 34, flex: '1 1 140px', fontSize: 14, background: 'var(--page)' }} />
      <button type="submit" className="btn btn-primary" style={{ height: 34, fontSize: 13, padding: '0 14px' }} disabled={busy || !dirty} aria-busy={busy}>
        บันทึก
      </button>
      {hand.gradedAt && !dirty && <span style={{ fontSize: 12, color: 'var(--ok-deep)' }}>✓ ตรวจแล้ว</span>}
    </form>
  );
}

function ProjectForm({ classes, initial, onCancel, onSaved }: { classes: ClassRow[]; initial?: ProjectRow; onCancel: () => void; onSaved: () => void }) {
  const popup = usePopup();
  const [classId, setClassId] = useState(initial ? String(initial.classId) : classes.length === 1 ? String(classes[0].id) : '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const [due, setDue] = useState(initial?.dueAt ? toLocal(initial.dueAt) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = { classId: Number(classId), title, detail, dueAt: due ? new Date(due).getTime() : null };
      if (initial) await api(`/teacher/projects/${initial.id}`, { method: 'PATCH', body });
      else await api('/teacher/projects', { body });
      popup.toast(initial ? `บันทึกงาน “${title.trim()}” แล้ว` : `สั่งงาน “${title.trim()}” แล้ว — นักศึกษาเห็นในหน้าบอร์ด Z80`, 'ok');
      onSaved();
    } catch (e2) {
      setErr((e2 as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const small = { height: 42, background: 'var(--page)' } as const;
  return (
    <form onSubmit={submit} aria-label={initial ? 'แก้ไขงานโปรเจกต์' : 'สั่งงานโปรเจกต์ใหม่'} style={{ padding: 16, borderRadius: 16, background: 'var(--m-row)', boxShadow: 'inset 0 0 0 1.5px var(--m-line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b style={{ fontWeight: 600 }}>{initial ? `แก้ไขงาน “${initial.title}”` : 'สั่งงานโปรเจกต์ใหม่'}</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="field">
          ห้อง
          <select className="input" style={small} value={classId} onChange={(e) => setClassId(e.target.value)} required disabled={!!initial}>
            <option value="" disabled>
              เลือกห้อง
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          ชื่องาน
          <input className="input" style={small} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="เช่น ไฟวิ่ง 8 ดวง + ปุ่มหยุด" required autoFocus />
        </label>
        <label className="field">
          กำหนดส่ง (ไม่บังคับ)
          <input className="input" style={small} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <label className="field">
        รายละเอียด / เงื่อนไข (ไม่บังคับ)
        <textarea className="input" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={4000} placeholder="สิ่งที่วงจรต้องทำ อุปกรณ์ที่ต้องใช้ เกณฑ์ให้คะแนน" style={{ height: 'auto', padding: '10px 14px', background: 'var(--page)', resize: 'vertical' }} />
      </label>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>นักศึกษาส่งใหม่ทับได้จนกว่าอาจารย์จะให้คะแนน · ส่งหลังกำหนดยังส่งได้ แต่ขึ้นว่า “ส่งช้า”</span>
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ height: 40 }} onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="btn btn-primary" style={{ height: 40, padding: '0 22px' }} disabled={busy} aria-busy={busy}>
          {initial ? 'บันทึก' : 'สั่งงาน'}
        </button>
      </div>
    </form>
  );
}
