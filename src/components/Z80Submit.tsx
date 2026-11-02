// Z80 board page: a student hands in the board + program on screen for one of
// their class's projects. Re-handing in replaces the earlier one until the
// teacher has graded it; the teacher's score and comment show here.

import { useState } from 'react';
import type { Board } from '../lib/z80/board';
import { api, ApiError, useApi } from '../api';
import { dueText } from './DueChip';
import { Icon, ICON } from './Icon';
import { Modal } from './Modal';
import { usePopup } from './Popup';

interface Submission {
  id: number;
  name: string;
  note: string;
  submittedAt: number;
  late: boolean;
  score: number | null;
  feedback: string | null;
  gradedAt: number | null;
}
interface MyProject {
  id: number;
  title: string;
  detail: string;
  dueAt: number | null;
  submission: Submission | null;
}

export function SubmitToTeacher({ name, board, code }: { name: string; board: Board; code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" style={{ height: 38, gap: 6 }} onClick={() => setOpen(true)} title="ส่งบอร์ดและโค้ดบนจอให้อาจารย์">
        <Icon d={ICON.upload} size={15} />
        ส่งให้อาจารย์
      </button>
      {open && <SubmitModal name={name} board={board} code={code} onClose={() => setOpen(false)} />}
    </>
  );
}

function status(p: MyProject): { text: string; bg: string; fg: string } {
  const s = p.submission;
  if (s?.gradedAt) return { text: s.score != null ? `ตรวจแล้ว · ${s.score} คะแนน` : 'ตรวจแล้ว', bg: 'var(--ok-bg)', fg: 'var(--ok-deep)' };
  if (s) return { text: s.late ? 'ส่งแล้ว (ช้า)' : 'ส่งแล้ว', bg: s.late ? 'var(--warn-bg)' : 'var(--info-bg)', fg: s.late ? 'var(--warn-deep)' : 'var(--info-deep)' };
  if (p.dueAt && Date.now() > p.dueAt) return { text: 'เลยกำหนด', bg: 'var(--err-bg)', fg: 'var(--err-deep)' };
  return { text: 'ยังไม่ส่ง', bg: 'var(--soft)', fg: 'var(--body-alt)' };
}

function SubmitModal({ name, board, code, onClose }: { name: string; board: Board; code: string; onClose: () => void }) {
  const popup = usePopup();
  const { data, error, setData } = useApi<{ projects: MyProject[] }>('/projects');
  const [pick, setPick] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const projects = data?.projects ?? [];
  const chosen = projects.find((p) => p.id === pick) ?? null;
  const locked = !!chosen?.submission?.gradedAt;
  const empty = !board.parts.length && !code.trim();

  const send = async () => {
    if (!chosen) return setErr('เลือกงานที่จะส่งก่อน');
    if (chosen.submission && !(await popup.confirm({ title: 'ส่งใหม่แทนงานเดิม?', body: `งานที่ส่งไว้เมื่อ ${dueText(chosen.submission.submittedAt)} จะถูกแทนที่ด้วยบอร์ดและโค้ดบนจอตอนนี้`, ok: 'ส่งใหม่' })))
      return;
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ project: MyProject }>(`/projects/${chosen.id}/submit`, { body: { name, board, code, note } });
      setData((d) => (d ? { projects: d.projects.map((p) => (p.id === r.project.id ? r.project : p)) } : d));
      setNote('');
      popup.toast(`ส่ง “${chosen.title}” ให้อาจารย์แล้ว${r.project.submission?.late ? ' (หลังกำหนดส่ง)' : ''}`, 'ok');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="ส่งโปรเจกต์ให้อาจารย์"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>
            ส่ง: {name.trim() || 'ไม่มีชื่อ'} · ชิ้นส่วน {board.parts.length} · สาย {board.wires.length} · โค้ด {code.split('\n').length} บรรทัด
          </span>
          <button type="button" className="btn btn-ghost" style={{ height: 44 }} onClick={onClose}>
            ปิด
          </button>
          <button type="button" className="btn btn-primary" style={{ height: 44, padding: '0 24px' }} onClick={send} disabled={busy || !chosen || locked || empty} aria-busy={busy}>
            {chosen?.submission ? 'ส่งใหม่' : 'ส่งงาน'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="notice err">{error.message}</div>}
        {data && !projects.length && (
          <div className="notice info">
            <Icon d={ICON.info} size={18} style={{ marginTop: 2 }} />
            <span>อาจารย์ยังไม่ได้สั่งงานโปรเจกต์ให้ห้องของคุณ — ดาวน์โหลดไฟล์ .json เก็บไว้ก่อนได้</span>
          </div>
        )}
        {empty && <div className="notice warn">บอร์ดและโค้ดบนจอยังว่างอยู่ — ต่อวงจรหรือเขียนโค้ดก่อนส่ง</div>}
        {projects.length > 0 && <span style={{ fontSize: 14, color: 'var(--muted)' }}>เลือกงาน แล้วกดส่ง — ระบบจะส่งบอร์ด (ชิ้นส่วนและสายไฟ) กับโค้ดที่อยู่บนจอตอนนี้</span>}
        <div role="radiogroup" aria-label="งานโปรเจกต์" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map((p) => {
            const st = status(p);
            const on = pick === p.id;
            return (
              <label
                key={p.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  background: on ? 'var(--m-row)' : 'var(--soft)',
                  boxShadow: on ? 'inset 0 0 0 1.5px var(--m-line)' : undefined,
                }}
              >
                <input type="radio" name="project" checked={on} onChange={() => setPick(p.id)} style={{ marginTop: 4, accentColor: 'var(--m)' }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontWeight: 600 }}>{p.title}</b>
                    <span className="chip" style={{ background: st.bg, color: st.fg }}>
                      {st.text}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {p.dueAt ? `กำหนดส่ง ${dueText(p.dueAt)} น.` : 'ไม่มีกำหนดส่ง'}
                    {p.submission ? ` · ส่งล่าสุด ${dueText(p.submission.submittedAt)} น. (“${p.submission.name}”)` : ''}
                  </span>
                  {p.detail && <span style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{p.detail}</span>}
                  {p.submission?.gradedAt && (
                    <span className="notice ok" style={{ marginTop: 4 }}>
                      <span>
                        <b>
                          อาจารย์ให้ {p.submission.score ?? '—'} คะแนน
                        </b>
                        {p.submission.feedback ? ` — ${p.submission.feedback}` : ''}
                      </span>
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {chosen && !locked && (
          <label className="field">
            ข้อความถึงอาจารย์ (ไม่บังคับ)
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="เช่น ปุ่ม SW2 ต่อที่พอร์ต 02h" style={{ height: 'auto', padding: '10px 14px', resize: 'vertical' }} />
          </label>
        )}
        {locked && <div className="notice info">อาจารย์ตรวจงานนี้แล้ว ส่งใหม่ไม่ได้ — ติดต่ออาจารย์ถ้าต้องการแก้</div>}
        {err && (
          <div role="alert" className="notice err">
            <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
            <span>{err}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
