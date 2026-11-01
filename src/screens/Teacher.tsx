import { useMemo, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError, useApi } from '../api';
import { useAuth, type Me, type Role } from '../auth';
import { Icon, ICON } from '../components/Icon';
import { usePopup } from '../components/Popup';
import { ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { RoleChip } from './Settings';

interface UserRow extends Me {
  id: number;
  points: number;
  passed: number;
  lastActive: number | null;
}
interface Data {
  sections: string[];
  users: UserRow[];
}

// name, id, section, [role], passed, points, last active, edit
const colsFor = (withRole: boolean) => `minmax(200px, 1.6fr) 130px 100px ${withRole ? '96px ' : ''}64px 76px 110px 44px`;
const PAGE = 50;

type SortKey = 'name' | 'studentId' | 'section' | 'passed' | 'points' | 'lastActive';
const SORT_LABEL: Record<SortKey, string> = { name: 'ชื่อ', studentId: 'รหัส', section: 'กลุ่ม', passed: 'ผ่าน', points: 'คะแนน', lastActive: 'ใช้งานล่าสุด' };
const NUMERIC: SortKey[] = ['passed', 'points', 'lastActive'];

function SortHead({ k, sort, onSort, right }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (k: SortKey) => void; right?: boolean }) {
  const on = sort?.key === k;
  const dirText = on ? (sort.dir === 1 ? 'น้อยไปมาก' : 'มากไปน้อย') : '';
  return (
    <span style={right ? { textAlign: 'right' } : undefined}>
      <button type="button" className="th-sort" data-on={on || undefined} onClick={() => onSort(k)} aria-label={`เรียงตาม${SORT_LABEL[k]}${on ? ` (${dirText})` : ''}`}>
        {SORT_LABEL[k]}
        {on && <Icon d={sort.dir === 1 ? ICON.sortUp : ICON.sortDown} size={13} stroke={2.4} />}
      </button>
    </span>
  );
}
const num = { fontFamily: 'var(--mono)', fontSize: 14, textAlign: 'right' } as const;

function ago(t: number | null): string {
  if (!t) return '—';
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return 'วันนี้';
  if (d === 1) return 'เมื่อวาน';
  if (d < 30) return `${d} วันก่อน`;
  return new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export function Teacher() {
  const { isTeacher } = useAuth();
  const { data, error, reload, setData } = useApi<Data>(isTeacher ? '/teacher/users' : null);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [role, setRole] = useState<'all' | Role>('student');
  const [editing, setEditing] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.users ?? []).filter(
      (u) =>
        (role === 'all' || u.role === role) &&
        (!section || u.section === section) &&
        (!needle || [u.name, u.studentId, u.email ?? ''].some((s) => s.toLowerCase().includes(needle))),
    );
    if (!sort) return list;
    const val = (u: UserRow) => (NUMERIC.includes(sort.key) ? (u[sort.key] as number | null) ?? 0 : String(u[sort.key] ?? ''));
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th')) * sort.dir;
    });
  }, [data, q, section, role, sort]);

  // numbers start biggest-first, text A→Z; clicking the same column again flips it
  const onSort = (k: SortKey) => setSort((s) => (s?.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: NUMERIC.includes(k) ? -1 : 1 }));
  // the role column only says something when both roles are listed
  const withRole = role === 'all';
  const COLS = colsFor(withRole);

  if (!isTeacher) return <Navigate to="/" replace />;

  const students = data?.users.filter((u) => u.role === 'student') ?? [];
  const weekAgo = Date.now() - 7 * 86400000;
  const stats: [string, string | number][] = [
    ['นักศึกษา', students.length],
    ['อาจารย์', (data?.users.length ?? 0) - students.length],
    ['เข้าใช้ 7 วันนี้', students.filter((u) => (u.lastActive ?? 0) >= weekAgo).length],
    ['ผ่านเฉลี่ย (ข้อ)', students.length ? (students.reduce((s, u) => s + u.passed, 0) / students.length).toFixed(1) : '0'],
  ];

  const onSaved = (u: UserRow) => {
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : d));
    setEditing(null);
  };

  return (
    <>
      <PageHeader title="อาจารย์" sub="ดูความคืบหน้านักศึกษา จัดกลุ่มเรียน และจัดการบัญชีอาจารย์">
        <button className="btn btn-primary" style={{ height: 44, gap: 8 }} onClick={() => setAdding(true)} disabled={adding}>
          <Icon d={ICON.user} size={18} />
          เพิ่มอาจารย์
        </button>
      </PageHeader>
      <main className="main">
        {error && <ErrorBox error={error} onRetry={reload} />}

        <section aria-label="สรุป" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
          {stats.map(([label, value]) => (
            <div key={label} className="card" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>{label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 600 }}>{data ? value : '…'}</span>
            </div>
          ))}
        </section>

        <section aria-label="ตัวกรอง" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="search-pill" style={{ flex: '1 1 240px' }}>
            <Icon d={ICON.search} size={18} color="var(--muted)" />
            <input
              type="search"
              aria-label="ค้นหา"
              placeholder="ค้นหาชื่อ รหัส หรืออีเมล"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
            />
          </label>
          <select
            aria-label="กลุ่มเรียน"
            className="select-pill"
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setShown(PAGE);
            }}
          >
            <option value="">ทุกกลุ่ม</option>
            {data?.sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Segmented
            label="บทบาท"
            value={role}
            onChange={(r) => {
              setRole(r);
              setShown(PAGE);
            }}
            options={[
              { value: 'student', label: 'นักศึกษา' },
              { value: 'teacher', label: 'อาจารย์' },
              { value: 'all', label: 'ทั้งหมด' },
            ]}
          />
        </section>

        {adding && (
          <AddTeacher
            onCancel={() => setAdding(false)}
            onAdded={(u) => {
              setData((d) => (d ? { ...d, users: [u, ...d.users] } : d));
              setAdding(false);
              setRole('teacher');
            }}
          />
        )}

        <section aria-label="รายชื่อ" className="card" style={{ padding: 10, overflowX: 'auto' }}>
          <div style={{ minWidth: withRole ? 900 : 792 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px 8px', fontSize: 13, color: 'var(--muted)' }}>
              <SortHead k="name" sort={sort} onSort={onSort} />
              <SortHead k="studentId" sort={sort} onSort={onSort} />
              <SortHead k="section" sort={sort} onSort={onSort} />
              {withRole && <span>บทบาท</span>}
              <SortHead k="passed" sort={sort} onSort={onSort} right />
              <SortHead k="points" sort={sort} onSort={onSort} right />
              <SortHead k="lastActive" sort={sort} onSort={onSort} />
              <span />
            </div>
            {!data && !error && <Skeleton h={240} />}
            {data && !rows.length && <div style={{ padding: '12px 16px', color: 'var(--muted)' }}>ไม่พบรายชื่อที่ตรงกับตัวกรอง</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.slice(0, shown).map((u) =>
                editing === u.id ? (
                  <EditRow key={u.id} u={u} sections={data?.sections ?? []} onCancel={() => setEditing(null)} onSaved={onSaved} />
                ) : (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 16 }}>
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
                          background: 'var(--soft)',
                        }}
                      >
                        {u.initials}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email ?? 'ยังไม่ผูก Google'}</span>
                      </span>
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.studentId}>
                      {u.studentId}
                    </span>
                    <span style={{ fontSize: 14 }}>{u.section || '—'}</span>
                    {withRole && (
                      <span>
                        <RoleChip role={u.role} />
                      </span>
                    )}
                    <span style={num}>{u.passed}</span>
                    <span style={{ ...num, fontWeight: 600 }}>{u.points.toLocaleString()}</span>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{ago(u.lastActive)}</span>
                    <button className="btn btn-ghost btn-round" aria-label={`แก้ไข ${u.name}`} title="แก้ไข" onClick={() => setEditing(u.id)} style={{ width: 36, height: 36, padding: 0 }}>
                      <Icon d={ICON.edit} size={17} />
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
          {rows.length > shown && (
            <div style={{ padding: '12px 16px 10px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--muted)' }}>
              <button className="btn btn-soft" onClick={() => setShown((n) => n + PAGE)}>
                แสดงอีก {Math.min(PAGE, rows.length - shown)} คน
              </button>
              แสดง {shown} จาก {rows.length} คน
            </div>
          )}
        </section>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--muted)' }}>
          นักศึกษาเข้าด้วย Google (ระบบสร้างบัญชีให้เอง) · อาจารย์เข้าด้วยชื่อผู้ใช้และรหัสผ่าน · อาจารย์ไม่อยู่ในกระดานอันดับ และเปิดดูเฉลยได้ทุกข้อ (นักศึกษาดูได้หลังส่งผ่านข้อนั้นแล้ว)
        </p>
      </main>
    </>
  );
}

function AddTeacher({ onCancel, onAdded }: { onCancel: () => void; onAdded: (u: UserRow) => void }) {
  const popup = usePopup();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ user: UserRow }>('/teacher/teachers', { body: { username, name, password } });
      onAdded(r.user);
      popup.toast(`สร้างบัญชี ${r.user.studentId} แล้ว — แจ้งชื่อผู้ใช้และรหัสผ่านให้อาจารย์ท่านนั้น`, 'ok');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} aria-label="เพิ่มอาจารย์" className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 19 }}>เพิ่มบัญชีอาจารย์</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <label className="field">
          ชื่อ–นามสกุล
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          ชื่อผู้ใช้
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="เช่น somchai.j"
            pattern="[a-z0-9._\-]{3,32}"
            title="a–z, 0–9, . _ - ยาว 3–32 ตัว"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          รหัสผ่านเริ่มต้น
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="off" placeholder="อย่างน้อย 8 ตัว" required />
        </label>
      </div>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>อาจารย์เปลี่ยนรหัสผ่านเองได้ที่หน้าตั้งค่าโปรไฟล์หลังเข้าสู่ระบบ</span>
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ height: 44 }} onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="btn btn-primary" style={{ height: 44, padding: '0 24px' }} disabled={busy} aria-busy={busy}>
          สร้างบัญชี
        </button>
      </div>
    </form>
  );
}

function EditRow({ u, sections, onCancel, onSaved }: { u: UserRow; sections: string[]; onCancel: () => void; onSaved: (u: UserRow) => void }) {
  const popup = usePopup();
  const teacher = u.role === 'teacher';
  const [name, setName] = useState(u.name);
  const [studentId, setStudentId] = useState(u.studentId);
  const [section, setSection] = useState(u.section);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = {};
    if (name.trim() !== u.name) body.name = name;
    if (studentId.trim() !== u.studentId) body.studentId = studentId;
    if (!teacher && section.trim() !== u.section) body.section = section;
    if (teacher && password) body.password = password;
    if (!Object.keys(body).length) return onCancel();
    if (body.password && !(await popup.confirm({ title: 'ตั้งรหัสผ่านใหม่?', body: `${u.name} จะถูกออกจากระบบทุกเครื่อง และต้องใช้รหัสผ่านใหม่นี้`, ok: 'ตั้งรหัสผ่าน' }))) return;
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ user: UserRow }>(`/teacher/users/${u.id}`, { method: 'PATCH', body });
      onSaved({ ...u, ...r.user });
      popup.toast(`บันทึก ${r.user.name} แล้ว`, 'ok');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const small = { height: 40, fontSize: 14, background: 'var(--page)' } as const;
  return (
    <form onSubmit={save} aria-label={`แก้ไข ${u.name}`} style={{ padding: 16, borderRadius: 16, background: 'var(--m-row)', boxShadow: 'inset 0 0 0 1.5px var(--m-line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label className="field">
          ชื่อ
          <input className="input" style={small} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          {teacher ? 'ชื่อผู้ใช้' : 'รหัสนักศึกษา'}
          <input className="input" style={small} value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={64} autoCapitalize="none" spellCheck={false} />
        </label>
        {teacher ? (
          <label className="field">
            ตั้งรหัสผ่านใหม่
            <input className="input" style={small} type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="เว้นว่างถ้าไม่เปลี่ยน" minLength={8} autoComplete="off" />
          </label>
        ) : (
          <label className="field">
            กลุ่มเรียน
            <input className="input" style={small} value={section} onChange={(e) => setSection(e.target.value)} list="teacher-sections" maxLength={40} />
            <datalist id="teacher-sections">
              {sections.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
        )}
      </div>
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
          บันทึก
        </button>
      </div>
    </form>
  );
}
