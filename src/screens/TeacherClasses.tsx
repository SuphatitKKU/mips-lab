// Teacher page: classes (one section in one academic term). The teacher creates a
// class, hands out its join code, and closes it when the term is over.

import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { Icon, ICON } from '../components/Icon';
import { Modal } from '../components/Modal';
import { usePopup } from '../components/Popup';
import { termOf, termText, type ClassInfo } from '../lib/terms';
import { AssignModal } from './TeacherInsights';

export interface ClassRow extends ClassInfo {
  students: number;
  /** listed by the teacher, waiting for their first sign-in */
  pending: number;
  /** problems assigned to the class */
  assigned: number;
}

interface RosterResult {
  moved: string[];
  already: number;
  pending: number;
  invalid: string[];
}

export type ExportKind = 'csv' | 'docx' | 'pdf';
/** Provided by the teacher page: downloads one class's scores. */
export const ClassExport = createContext<(classId: number, kind: ExportKind) => Promise<void>>(async () => undefined);

/**
 * Deleting a class wipes its students' scores for good, so a class with students
 * can only be deleted after its scores were downloaded (Excel / Word / PDF) in the
 * same dialog. Returns [ask, dialog]: render `dialog`, call `ask` to start.
 */
function useDeleteClass(): [(c: ClassInfo & { students?: number }, onDeleted: (id: number) => void) => Promise<boolean>, ReactNode] {
  const popup = usePopup();
  const exportClass = useContext(ClassExport);
  const [req, setReq] = useState<{ c: ClassInfo & { students?: number }; onDeleted: (id: number) => void; resolve: (ok: boolean) => void } | null>(null);
  const [saved, setSaved] = useState<ExportKind | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (c: ClassInfo, onDeleted: (id: number) => void) => {
    const label = `${c.name} · ${termText(c)}`;
    try {
      const r = await api<{ wiped: number }>(`/teacher/classes/${c.id}`, { method: 'DELETE' });
      onDeleted(c.id);
      popup.toast(r.wiped ? `ลบห้อง ${label} แล้ว — ล้างข้อมูลนักศึกษา ${r.wiped} คน` : `ลบห้อง ${label} แล้ว`, 'ok');
      return true;
    } catch (e) {
      popup.toast((e as ApiError).message, 'err');
      return false;
    }
  };

  const ask = async (c: ClassInfo & { students?: number }, onDeleted: (id: number) => void) => {
    if (!c.students) {
      const ok = await popup.confirm({ title: `ลบห้อง ${c.name} · ${termText(c)}?`, body: 'ห้องนี้ไม่มีนักศึกษา ลบแล้วกู้คืนไม่ได้', ok: 'ลบห้อง' });
      return ok ? remove(c, onDeleted) : false;
    }
    setSaved(null);
    return new Promise<boolean>((resolve) => setReq({ c, onDeleted, resolve }));
  };

  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };

  const download = async (kind: ExportKind) => {
    if (!req) return;
    setBusy(true);
    try {
      await exportClass(req.c.id, kind);
      setSaved(kind);
    } catch {
      popup.toast('ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง', 'err');
    } finally {
      setBusy(false);
    }
  };

  const dialog = req && (
    <Modal
      title={`ลบห้อง ${req.c.name} · ${termText(req.c)}`}
      onClose={() => close(false)}
      focusKey={saved ?? 'start'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" style={{ height: 44 }} onClick={() => close(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 44, padding: '0 22px', background: saved ? 'var(--err)' : undefined }}
            disabled={!saved || busy}
            aria-busy={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await remove(req.c, req.onDeleted);
              setBusy(false);
              if (ok) close(true);
            }}
          >
            ลบห้องและล้างข้อมูล {req.c.students} คน
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2, flex: 'none' }} />
          <span>
            นักศึกษา <b>{req.c.students} คน</b>ในห้องนี้จะถูก<b>ล้างคะแนนและโจทย์ที่ทำทั้งหมด</b> แล้วต้องใส่รหัสห้องใหม่ (บัญชียังอยู่) — กู้คืนจากหน้าเว็บไม่ได้
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b style={{ fontWeight: 600 }}>1. ดาวน์โหลดคะแนนของห้องนี้เก็บไว้ก่อน</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['csv', 'docx', 'pdf'] as ExportKind[]).map((k) => (
              <button key={k} type="button" className="btn btn-secondary" style={{ height: 42, gap: 8 }} onClick={() => download(k)} disabled={busy}>
                <Icon d={saved === k ? ICON.check : ICON.download} size={16} />
                {k === 'csv' ? 'Excel' : k === 'docx' ? 'Word' : 'PDF'}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 13, color: saved ? 'var(--ok-deep)' : 'var(--muted)' }}>
            {saved ? '✓ ดาวน์โหลดแล้ว — ตรวจว่าไฟล์เปิดได้ก่อนลบ' : 'ปุ่มลบจะกดได้หลังดาวน์โหลดอย่างน้อยหนึ่งไฟล์'}
          </span>
        </div>
        <b style={{ fontWeight: 600, color: saved ? undefined : 'var(--muted)' }}>2. กด "ลบห้องและล้างข้อมูล"</b>
      </div>
    </Modal>
  );

  return [ask, dialog];
}

const TERMS: [number, string][] = [
  [1, 'ภาค 1'],
  [2, 'ภาค 2'],
  [3, 'ภาคเรียนพิเศษ'],
];

/** Classes grouped by academic year, newest first (the server already sorts them). */
export function byYear<T extends { year: number }>(list: T[]): [number, T[]][] {
  const out = new Map<number, T[]>();
  for (const c of list) out.set(c.year, [...(out.get(c.year) ?? []), c]);
  return [...out];
}

export function ClassesPanel({
  classes,
  unassigned,
  onSaved,
  onDeleted,
  onRoster,
  onShow,
}: {
  classes: ClassRow[];
  /** students not in any class right now */
  unassigned: number;
  onSaved: (c: ClassRow) => void;
  onDeleted: (id: number) => void;
  /** a roster was added: students may have moved, reload the list */
  onRoster: () => void;
  /** filter the student list (filter value as used by the teacher page) */
  onShow: (filter: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const closed = classes.filter((c) => c.archived).length;
  const list = classes.filter((c) => showClosed || !c.archived);

  return (
    <section aria-label="ห้องเรียน" className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ fontSize: 19 }}>ห้องเรียน</h2>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>สร้างห้องแยกตามกลุ่มและภาคเรียน แล้วแจกรหัสเข้าห้องให้นักศึกษาใส่ตอนเข้าใช้ครั้งแรก</span>
        </div>
        {closed > 0 && (
          <button type="button" className="btn btn-ghost" style={{ height: 40 }} onClick={() => setShowClosed((v) => !v)} aria-pressed={showClosed}>
            {showClosed ? 'ซ่อนห้องที่ปิดแล้ว' : `แสดงห้องที่ปิดแล้ว (${closed})`}
          </button>
        )}
        <button type="button" className="btn btn-primary" style={{ height: 44, gap: 8 }} onClick={() => setCreating(true)} disabled={creating}>
          <Icon d={ICON.users} size={18} />
          สร้างห้อง
        </button>
      </div>

      {unassigned > 0 && (
        <div className="notice warn" style={{ alignItems: 'center' }}>
          <Icon d={ICON.alert} size={18} />
          <span style={{ flex: 1 }}>นักศึกษา {unassigned} คนยังไม่ได้เข้าห้อง</span>
          <button type="button" className="btn btn-ghost" style={{ height: 34, fontSize: 14 }} onClick={() => onShow('none')}>
            ดูรายชื่อ
          </button>
        </div>
      )}

      {creating && (
        <ClassForm
          title="สร้างห้องใหม่"
          onDeleted={onDeleted}
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            onSaved(c);
            setCreating(false);
          }}
        />
      )}

      {!classes.length && !creating && <span style={{ color: 'var(--muted)', fontSize: 14 }}>ยังไม่มีห้อง — กด "สร้างห้อง" เพื่อเริ่ม</span>}

      {byYear(list).map(([year, rows]) => (
        <div key={year} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--head)', fontSize: 15, fontWeight: 500 }}>ปีการศึกษา {year}</span>
            <button type="button" className="btn btn-ghost" style={{ height: 30, fontSize: 13, padding: '0 10px' }} onClick={() => onShow(`y:${year}`)}>
              ดูนักศึกษาทั้งปี
            </button>
          </div>
          {rows.map((c) =>
            editing === c.id ? (
              <ClassForm
                key={c.id}
                title={`แก้ไข ${c.name}`}
                initial={c}
                onDeleted={onDeleted}
                onCancel={() => setEditing(null)}
                onSaved={(u) => {
                  onSaved(u);
                  setEditing(null);
                }}
              />
            ) : (
              <ClassLine key={c.id} c={c} onSaved={onSaved} onDeleted={onDeleted} onRoster={onRoster} onEdit={() => setEditing(c.id)} onShow={() => onShow(`c:${c.id}`)} />
            ),
          )}
        </div>
      ))}
    </section>
  );
}

function ClassLine({
  c,
  onSaved,
  onDeleted,
  onRoster,
  onEdit,
  onShow,
}: {
  c: ClassRow;
  onSaved: (c: ClassRow) => void;
  onDeleted: (id: number) => void;
  onRoster: () => void;
  onEdit: () => void;
  onShow: () => void;
}) {
  const popup = usePopup();
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const patch = async (body: object, done: string) => {
    setBusy(true);
    try {
      const r = await api<{ class: ClassRow }>(`/teacher/classes/${c.id}`, { method: 'PATCH', body });
      onSaved({ ...c, ...r.class });
      popup.toast(done, 'ok');
    } catch (e) {
      popup.toast((e as ApiError).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.code);
      popup.toast(`คัดลอกรหัส ${c.code} แล้ว`, 'ok');
    } catch {
      popup.toast('คัดลอกไม่ได้ — เลือกรหัสแล้วคัดลอกเอง', 'err');
    }
  };

  const newCode = async () => {
    if (!(await popup.confirm({ title: 'สุ่มรหัสใหม่?', body: `รหัส ${c.code} จะใช้ไม่ได้อีก นักศึกษาที่อยู่ในห้องแล้วไม่ได้รับผลกระทบ`, ok: 'สุ่มรหัสใหม่' }))) return;
    void patch({ newCode: true }, 'สุ่มรหัสใหม่แล้ว');
  };

  const toggleClosed = async () => {
    if (!c.archived && !(await popup.confirm({ title: `ปิดห้อง ${c.name} · ${termText(c)}?`, body: 'นักศึกษาจะใส่รหัสเข้าห้องนี้ไม่ได้ รายชื่อและคะแนนยังอยู่ เปิดใหม่ได้ภายหลัง', ok: 'ปิดห้อง' })))
      return;
    void patch({ archived: !c.archived }, c.archived ? 'เปิดห้องอีกครั้งแล้ว' : 'ปิดห้องแล้ว');
  };

  const [deleteClass, deleteDialog] = useDeleteClass();
  const remove = async () => {
    setBusy(true);
    if (!(await deleteClass(c, onDeleted))) setBusy(false);
  };

  const small = { height: 34, fontSize: 14, padding: '0 12px' } as const;
  return (
    <>
    <div
      aria-busy={busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        padding: '12px 16px',
        borderRadius: 16,
        background: 'var(--soft)',
        opacity: c.archived ? 0.65 : 1,
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 140, flex: '1 1 160px' }}>
        <b style={{ fontWeight: 600 }}>{c.name}</b>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          ภาคเรียน {termText(c)} · {c.students} คน{c.pending ? ` · รอล็อกอิน ${c.pending} คน` : ''}{c.assigned ? ` · งาน ${c.assigned} ข้อ` : ''}{c.archived ? ' · ปิดแล้ว' : ''}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          title="รหัสเข้าห้อง"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '.16em',
            padding: '4px 12px',
            borderRadius: 10,
            background: 'var(--page)',
            textDecoration: c.archived ? 'line-through' : undefined,
            userSelect: 'all',
          }}
        >
          {c.code}
        </span>
        <button type="button" className="btn btn-ghost" style={small} onClick={copy} disabled={c.archived}>
          คัดลอก
        </button>
      </span>
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" style={small} onClick={onShow}>
          ดูรายชื่อ
        </button>
        <button type="button" className="btn btn-ghost" style={small} onClick={() => setAssigning(true)}>
          มอบหมายโจทย์
        </button>
        <button type="button" className="btn btn-ghost" style={small} onClick={() => setListing((v) => !v)} disabled={c.archived} aria-expanded={listing}>
          เพิ่มรายชื่อ
        </button>
        <button type="button" className="btn btn-ghost btn-round" style={{ width: 34, height: 34, padding: 0 }} onClick={onEdit} aria-label={`แก้ไข ${c.name}`} title="แก้ไข">
          <Icon d={ICON.edit} size={16} />
        </button>
        <button type="button" className="btn btn-ghost btn-round" style={{ width: 34, height: 34, padding: 0 }} onClick={newCode} disabled={busy || c.archived} aria-label="สุ่มรหัสใหม่" title="สุ่มรหัสใหม่">
          <Icon d={ICON.rotate} size={16} />
        </button>
        <button type="button" className="btn btn-ghost" style={small} onClick={toggleClosed} disabled={busy}>
          {c.archived ? 'เปิดห้องอีกครั้ง' : 'ปิดห้อง'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-round"
          style={{ width: 34, height: 34, padding: 0, color: 'var(--err)' }}
          onClick={remove}
          disabled={busy}
          aria-label={`ลบห้อง ${c.name}`}
          title="ลบห้อง"
        >
          <Icon d={ICON.trash} size={16} />
        </button>
      </span>
    </div>
    {deleteDialog}
    {assigning && <AssignModal cls={c} onClose={() => setAssigning(false)} onSaved={(n) => (onSaved({ ...c, assigned: n }), onRoster())} />}
    {listing && (
      <RosterForm
        c={c}
        onClose={() => setListing(false)}
        onAdded={(r) => {
          onSaved({ ...c, pending: c.pending + r.pending, students: c.students + r.moved.length });
          onRoster();
        }}
      />
    )}
    </>
  );
}

/** Paste the registrar's list: existing accounts move in now, the rest land here on first sign-in. */
function RosterForm({ c, onClose, onAdded }: { c: ClassRow; onClose: () => void; onAdded: (r: RosterResult) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<RosterResult | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setErr('');
    setBusy(true);
    try {
      const r = await api<RosterResult>(`/teacher/classes/${c.id}/roster`, { body: { text } });
      setResult(r);
      setText('');
      onAdded(r);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} aria-label={`เพิ่มรายชื่อเข้า ${c.name}`} style={{ padding: 16, borderRadius: 16, background: 'var(--m-row)', boxShadow: 'inset 0 0 0 1.5px var(--m-line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b style={{ fontWeight: 600 }}>เพิ่มรายชื่อเข้า {c.name} · {termText(c)}</b>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>
        วางรหัสนักศึกษาหรืออีเมล บรรทัดละคน (คัดลอกคอลัมน์จาก Excel มาวางได้เลย) — คนที่มีบัญชีแล้ว เช่น ลงเรียนซ้ำ จะย้ายเข้าห้องนี้ทันที คนที่ยังไม่มีบัญชีจะเข้าห้องนี้เองตอนล็อกอินครั้งแรก
      </span>
      <textarea
        className="input"
        aria-label="รายชื่อ"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'653040123-4\n653040124-2\nsomchai.j@kkumail.com'}
        spellCheck={false}
        style={{ height: 'auto', padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 14, background: 'var(--page)', resize: 'vertical' }}
      />
      {result && (
        <div role="status" className="notice ok" style={{ flexDirection: 'column', gap: 2 }}>
          <span>
            ย้ายเข้าห้องแล้ว <b>{result.moved.length}</b> คน · รอล็อกอิน <b>{result.pending}</b> คน{result.already ? ` · อยู่ห้องนี้แล้ว ${result.already} คน` : ''}
          </span>
          {result.moved.length > 0 && <span style={{ fontSize: 13 }}>ย้าย: {result.moved.slice(0, 12).join(', ')}{result.moved.length > 12 ? ` และอีก ${result.moved.length - 12} คน` : ''}</span>}
          {result.invalid.length > 0 && <span style={{ fontSize: 13 }}>ข้าม (ไม่ใช่รหัสนักศึกษาหรืออีเมล): {result.invalid.join(', ')}</span>}
        </div>
      )}
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ height: 40 }} onClick={onClose}>
          {result ? 'เสร็จ' : 'ยกเลิก'}
        </button>
        <button type="submit" className="btn btn-primary" style={{ height: 40, padding: '0 22px' }} disabled={busy || !text.trim()} aria-busy={busy}>
          เพิ่มรายชื่อ
        </button>
      </div>
    </form>
  );
}

function ClassForm({
  title,
  initial,
  onCancel,
  onSaved,
  onDeleted,
}: {
  title: string;
  initial?: ClassRow;
  onCancel: () => void;
  onSaved: (c: ClassRow) => void;
  onDeleted: (id: number) => void;
}) {
  const popup = usePopup();
  // a new class starts with nothing picked: the teacher chooses year and term
  const [name, setName] = useState(initial?.name ?? '');
  const [year, setYear] = useState(initial ? String(initial.year) : '');
  const [term, setTerm] = useState(initial ? String(initial.term) : '');
  // classes from an earlier term that block this one (from the server's 409)
  const [old, setOld] = useState<ClassRow[]>([]);
  const [deleteClass, deleteDialog] = useDeleteClass();
  // 10 years back → 20 ahead (moves with the calendar), plus the class's own year when editing one outside that
  const thisYear = termOf().year;
  const years = Array.from({ length: 31 }, (_, i) => thisYear - 10 + i);
  if (initial && !years.includes(initial.year)) years.unshift(initial.year);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = { name, year: Number(year), term: Number(term) };
      const r = initial
        ? await api<{ class: ClassRow }>(`/teacher/classes/${initial.id}`, { method: 'PATCH', body })
        : await api<{ class: ClassRow }>('/teacher/classes', { body });
      onSaved({ ...initial, ...r.class });
      popup.toast(initial ? `บันทึก ${r.class.name} แล้ว` : `สร้างห้อง ${r.class.name} แล้ว — รหัสเข้าห้อง ${r.class.code}`, 'ok');
    } catch (e) {
      const blocking = (e as ApiError).body?.oldClasses as ClassRow[] | undefined;
      setOld(blocking ?? []);
      setErr(blocking ? '' : (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const small = { height: 42, background: 'var(--page)' } as const;
  return (
    <form onSubmit={save} aria-label={title} style={{ padding: 16, borderRadius: 16, background: 'var(--m-row)', boxShadow: 'inset 0 0 0 1.5px var(--m-line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b style={{ fontWeight: 600 }}>{title}</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label className="field">
          ชื่อห้อง / กลุ่ม
          <input className="input" style={small} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น SEC 1" maxLength={40} required autoFocus />
        </label>
        <label className="field">
          ปีการศึกษา (พ.ศ.)
          <select className="input" style={small} value={year} onChange={(e) => setYear(e.target.value)} required>
            <option value="" disabled>
              เลือกปีการศึกษา
            </option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          ภาคเรียน
          <select className="input" style={small} value={term} onChange={(e) => setTerm(e.target.value)} required>
            <option value="" disabled>
              เลือกภาคเรียน
            </option>
            {TERMS.map(([t, label]) => (
              <option key={t} value={t}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {old.length > 0 && (
        <div role="alert" className="notice warn" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <span style={{ display: 'flex', gap: 8 }}>
            <Icon d={ICON.alert} size={18} style={{ marginTop: 2, flex: 'none' }} />
            <span>
              ยังมีห้องของภาคเรียนก่อนอยู่ — <b>ลบห้องเก่าก่อนจึงจะเปิดห้องใหม่ได้</b> นักศึกษาในห้องเก่าจะถูกล้างคะแนนและโจทย์ แล้วต้องใส่รหัสห้องใหม่
            </span>
          </span>
          {old.map((c) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, background: 'var(--page)' }}>
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 600 }}>{c.name}</b> · ภาคเรียน {termText(c)}
                {c.archived ? ' · ปิดแล้ว' : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 32, fontSize: 14, gap: 6, color: 'var(--err)' }}
                onClick={async () => {
                  if (await deleteClass(c, onDeleted)) setOld((list) => list.filter((x) => x.id !== c.id));
                }}
              >
                <Icon d={ICON.trash} size={15} />
                ลบห้องนี้
              </button>
            </span>
          ))}
          <span style={{ fontSize: 13 }}>ลบครบแล้วกด "{initial ? 'บันทึก' : 'สร้างห้อง'}" อีกครั้ง</span>
        </div>
      )}
      {deleteDialog}
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
          {initial ? 'บันทึก' : 'สร้างห้อง'}
        </button>
      </div>
    </form>
  );
}
