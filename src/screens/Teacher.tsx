import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError, useApi } from '../api';
import { useAuth, type Me, type Role } from '../auth';
import { Icon, ICON } from '../components/Icon';
import { usePopup } from '../components/Popup';
import { ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { exportCsv, exportDocx, exportPdf, type ExportInfo, type ExportRow } from '../components/exportList';
import { useLive, type LiveStatus } from '../components/live';
import { classLabel } from '../lib/terms';
import { RoleChip } from './Settings';
import { byYear, ClassesPanel, ClassExport, type ClassRow, type ExportKind } from './TeacherClasses';
import { AuditPanel, ProgressModal, StatsPanel } from './TeacherInsights';
import { ProjectsPanel } from './TeacherProjects';

interface UserRow extends Me {
  id: number;
  points: number;
  passed: number;
  lastActive: number | null;
  /** problems assigned to their class / solved by the deadline */
  assigned: number;
  onTime: number;
}
interface Data {
  classes: ClassRow[];
  users: UserRow[];
  totalProblems: number;
}

// name, id, section, [role], passed, points, last active, edit
// name, id, section, [role], passed, assignments on time, points, last active, edit
const colsFor = (withRole: boolean) => `minmax(200px, 1.6fr) 130px 150px ${withRole ? '96px ' : ''}64px 64px 76px 110px 44px`;
const PAGE = 50;

type SortKey = 'name' | 'studentId' | 'section' | 'passed' | 'onTime' | 'points' | 'lastActive';
const SORT_LABEL: Record<SortKey, string> = { name: 'ชื่อ', studentId: 'รหัส', section: 'ห้อง', passed: 'ผ่าน', onTime: 'งาน', points: 'คะแนน', lastActive: 'ใช้งานล่าสุด' };
const NUMERIC: SortKey[] = ['passed', 'onTime', 'points', 'lastActive'];

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
  // live: the server nudges over WebSocket when students do something; re-fetch quietly
  // (no loading state, so rows being edited stay put). One request at a time, one queued.
  const fetching = useRef(false);
  const queued = useRef(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // bumps on every live refresh so the open panels (stats, history) refetch too
  const [version, setVersion] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const refresh = useRef(() => {});
  refresh.current = () => {
    if (fetching.current) {
      queued.current = true;
      return;
    }
    fetching.current = true;
    api<Data>('/teacher/users')
      .then((d) => {
        setData(d);
        setUpdatedAt(Date.now());
        setVersion((v) => v + 1);
      })
      .catch(() => undefined)
      .finally(() => {
        fetching.current = false;
        if (queued.current) {
          queued.current = false;
          refresh.current();
        }
      });
  };
  const live = useLive(isTeacher, () => refresh.current());
  const [q, setQ] = useState('');
  // '' everyone · 'none' no class · 'y:2569' a whole academic year · 'c:3' one class
  const [klass, setKlass] = useState('');
  const [role, setRole] = useState<'all' | Role>('student');
  const [editing, setEditing] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);

  const inClass = useMemo(() => {
    const yearOf = new Map((data?.classes ?? []).map((c) => [c.id, c.year]));
    return (u: UserRow) => {
      if (!klass) return true;
      if (u.role !== 'student') return false;
      if (klass === 'none') return u.classId == null;
      const n = Number(klass.slice(2));
      return klass.startsWith('y:') ? u.classId != null && yearOf.get(u.classId) === n : u.classId === n;
    };
  }, [data, klass]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.users ?? []).filter(
      (u) =>
        (role === 'all' || u.role === role) &&
        inClass(u) &&
        (!needle || [u.name, u.studentId, u.email ?? ''].some((s) => s.toLowerCase().includes(needle))),
    );
    if (!sort) return list;
    const val = (u: UserRow) => (NUMERIC.includes(sort.key) ? (u[sort.key] as number | null) ?? 0 : String(u[sort.key] ?? ''));
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th')) * sort.dir;
    });
  }, [data, q, inClass, role, sort]);

  // numbers start biggest-first, text A→Z; clicking the same column again flips it
  const onSort = (k: SortKey) => setSort((s) => (s?.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: NUMERIC.includes(k) ? -1 : 1 }));
  // the role column only says something when both roles are listed
  const withRole = role === 'all';
  const COLS = colsFor(withRole);

  if (!isTeacher) return <Navigate to="/" replace />;

  const toExport = (list: UserRow[]): ExportRow[] =>
    list
      .filter((u) => u.role === 'student')
      .sort((a, b) => a.studentId.localeCompare(b.studentId, 'th', { numeric: true }))
      .map((u) => ({ studentId: u.studentId, name: u.name, section: u.section, passed: u.passed, points: u.points, onTime: u.onTime, assigned: u.assigned }));

  /** One class's scores (the delete dialog asks for this before wiping them). */
  const exportClass = async (classId: number, kind: ExportKind) => {
    const cls = data?.classes.find((c) => c.id === classId);
    const info: ExportInfo = { title: cls ? classLabel(cls) : 'ห้องเรียน', totalProblems: data?.totalProblems ?? 0, rows: toExport((data?.users ?? []).filter((u) => u.classId === classId)) };
    await (kind === 'csv' ? Promise.resolve(exportCsv(info)) : kind === 'docx' ? exportDocx(info) : exportPdf(info));
  };

  /** Students on screen right now (for the stats panel). */
  const shownStudentIds = rows.filter((u) => u.role === 'student').map((u) => u.id);

  /** What's on screen (students only, current filters), ordered by student id, for Excel / Word / PDF. */
  const exportInfo = (): ExportInfo => {
    const cls = klass.startsWith('c:') ? data?.classes.find((c) => c.id === Number(klass.slice(2))) : undefined;
    const title = !klass ? 'ทุกห้อง' : klass === 'none' ? 'ยังไม่ได้เข้าห้อง' : klass.startsWith('y:') ? `ปีการศึกษา ${klass.slice(2)}` : cls ? classLabel(cls) : 'ห้องเรียน';
    return {
      title,
      note: q.trim() ? `ค้นหา: "${q.trim()}"` : undefined,
      totalProblems: data?.totalProblems ?? 0,
      rows: toExport(rows),
    };
  };

  // the summary follows the class filter
  const allStudents = data?.users.filter((u) => u.role === 'student') ?? [];
  const students = allStudents.filter(inClass);
  const weekAgo = Date.now() - 7 * 86400000;
  const stats: [string, string | number][] = [
    ['นักศึกษา', students.length],
    ['อาจารย์', (data?.users.length ?? 0) - allStudents.length],
    ['เข้าใช้ 7 วันนี้', students.filter((u) => (u.lastActive ?? 0) >= weekAgo).length],
    ['ผ่านเฉลี่ย (ข้อ)', students.length ? (students.reduce((s, u) => s + u.passed, 0) / students.length).toFixed(1) : '0'],
  ];

  const showClass = (f: string) => {
    setKlass(f);
    setRole('student');
    setShown(PAGE);
    document.getElementById('teacher-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onClassSaved = (c: ClassRow) =>
    setData((d) => {
      if (!d) return d;
      const known = d.classes.some((x) => x.id === c.id);
      const classes = known ? d.classes.map((x) => (x.id === c.id ? c : x)) : [c, ...d.classes];
      classes.sort((a, b) => b.year - a.year || b.term - a.term || a.name.localeCompare(b.name, 'th'));
      // a renamed class changes the label shown on its students
      const users = d.users.map((u) => (u.classId === c.id ? { ...u, section: classLabel(c) } : u));
      return { ...d, classes, users };
    });

  const onClassDeleted = (id: number) => {
    setData((d) =>
      d && {
        ...d,
        classes: d.classes.filter((c) => c.id !== id),
        users: d.users.map((u) =>
          // the server wiped their work along with the class
          u.classId === id ? { ...u, classId: null, needsClass: true, section: '', points: 0, passed: 0, lastActive: null } : u,
        ),
      },
    );
    // a filter pointing at the deleted class would show nothing
    if (klass === `c:${id}`) setKlass('');
  };

  const onSaved = (u: UserRow) => {
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : d));
    setEditing(null);
  };

  return (
    <>
      <PageHeader title="อาจารย์" sub="ดูความคืบหน้านักศึกษา จัดห้องเรียนแยกตามภาคเรียน และจัดการบัญชีอาจารย์">
        <LiveBadge status={live} updatedAt={updatedAt} />
        <button className="btn btn-primary" style={{ height: 44, gap: 8 }} onClick={() => setAdding(true)} disabled={adding}>
          <Icon d={ICON.user} size={18} />
          เพิ่มอาจารย์
        </button>
      </PageHeader>
      <main className="main">
        {error && <ErrorBox error={error} onRetry={reload} />}

        {data && (
          <ClassExport.Provider value={exportClass}>
            <ClassesPanel classes={data.classes} unassigned={allStudents.filter((u) => u.classId == null).length} onSaved={onClassSaved} onDeleted={onClassDeleted} onRoster={reload} onShow={showClass} />
          </ClassExport.Provider>
        )}

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
            aria-label="ห้องเรียน"
            className="select-pill"
            value={klass}
            onChange={(e) => {
              setKlass(e.target.value);
              setShown(PAGE);
            }}
          >
            <option value="">ทุกห้อง</option>
            <option value="none">ยังไม่ได้เข้าห้อง</option>
            {byYear(data?.classes ?? []).map(([year, cs]) => (
              <optgroup key={year} label={`ปีการศึกษา ${year}`}>
                <option value={`y:${year}`}>ทั้งปี {year}</option>
                {cs.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>
                    {classLabel(c)}
                    {c.archived ? ' (ปิดแล้ว)' : ''}
                  </option>
                ))}
              </optgroup>
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
          <ExportButtons get={exportInfo} disabled={!data} />
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

        <section id="teacher-list" aria-label="รายชื่อ" className="card" style={{ padding: 10, overflowX: 'auto' }}>
          <div style={{ minWidth: withRole ? 1020 : 912 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px 8px', fontSize: 13, color: 'var(--muted)' }}>
              <SortHead k="name" sort={sort} onSort={onSort} />
              <SortHead k="studentId" sort={sort} onSort={onSort} />
              <SortHead k="section" sort={sort} onSort={onSort} />
              {withRole && <span>บทบาท</span>}
              <SortHead k="passed" sort={sort} onSort={onSort} right />
              <SortHead k="onTime" sort={sort} onSort={onSort} right />
              <SortHead k="points" sort={sort} onSort={onSort} right />
              <SortHead k="lastActive" sort={sort} onSort={onSort} />
              <span />
            </div>
            {!data && !error && <Skeleton h={240} />}
            {data && !rows.length && <div style={{ padding: '12px 16px', color: 'var(--muted)' }}>ไม่พบรายชื่อที่ตรงกับตัวกรอง</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.slice(0, shown).map((u) =>
                editing === u.id ? (
                  <EditRow key={u.id} u={u} classes={data?.classes ?? []} onCancel={() => setEditing(null)} onSaved={onSaved} />
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
                        {u.role === 'student' ? (
                          <button type="button" className="name-link" onClick={() => setViewing(u.id)} title="ดูความคืบหน้ารายข้อ">
                            {u.name}
                          </button>
                        ) : (
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email ?? 'ยังไม่ผูก Google'}</span>
                      </span>
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.studentId}>
                      {u.studentId}
                    </span>
                    <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.section}>
                      {u.section || (u.role === 'student' ? <span style={{ color: 'var(--muted)' }}>ยังไม่เข้าห้อง</span> : '—')}
                    </span>
                    {withRole && (
                      <span>
                        <RoleChip role={u.role} />
                      </span>
                    )}
                    <span style={num}>{u.passed}</span>
                    <span style={{ ...num, color: u.assigned && u.onTime < u.assigned ? 'var(--warn-deep)' : undefined }} title={u.assigned ? `ส่งตรงเวลา ${u.onTime} จาก ${u.assigned} ข้อที่มอบหมาย` : 'ห้องนี้ยังไม่มีงานที่มอบหมาย'}>
                      {u.assigned ? `${u.onTime}/${u.assigned}` : '—'}
                    </span>
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

        {data && <ProjectsPanel classes={data.classes} version={version} />}
        <StatsPanel ids={shownStudentIds} version={version} />
        <AuditPanel version={version} />
        {viewing != null && <ProgressModal userId={viewing} onClose={() => setViewing(null)} />}

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--muted)' }}>
          นักศึกษาเข้าด้วย Google (ระบบสร้างบัญชีให้เอง) แล้วใส่รหัสเข้าห้อง · เปิดห้องเทอมใหม่ได้เมื่อลบห้องเทอมก่อนแล้ว และการลบห้องจะล้างคะแนนและโจทย์ของนักศึกษาในห้องนั้น (คนลงซ้ำเริ่มใหม่จากศูนย์) · อาจารย์เข้าด้วยชื่อผู้ใช้และรหัสผ่าน · อาจารย์ไม่อยู่ในกระดานอันดับ และเปิดดูเฉลยได้ทุกข้อ (นักศึกษาดูได้หลังส่งผ่านข้อนั้นแล้ว)
        </p>
      </main>
    </>
  );
}

/** Excel / Word / PDF of the list as filtered on screen. */
function ExportButtons({ get, disabled }: { get: () => ExportInfo; disabled: boolean }) {
  const popup = usePopup();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const run = async (kind: ExportKind) => {
    const info = get();
    if (!info.rows.length) return popup.toast('ไม่มีนักศึกษาในรายการนี้ — ลองเปลี่ยนตัวกรอง', 'info');
    setBusy(kind);
    try {
      if (kind === 'csv') {
        exportCsv(info);
        popup.toast(`ดาวน์โหลดไฟล์ Excel แล้ว (${info.rows.length} คน)`, 'ok');
      } else if (kind === 'docx') {
        await exportDocx(info);
        popup.toast(`ดาวน์โหลดไฟล์ Word แล้ว (${info.rows.length} คน)`, 'ok');
      } else await exportPdf(info);
    } catch {
      popup.toast('ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง', 'err');
    } finally {
      setBusy(null);
    }
  };
  const btn = { height: 44, gap: 8 } as const;
  return (
    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="ส่งออกรายชื่อ">
      <button type="button" className="btn btn-secondary" style={btn} onClick={() => run('csv')} disabled={disabled || !!busy} aria-busy={busy === 'csv'} title="ไฟล์ .csv เปิดด้วย Excel / Google Sheets ได้">
        <Icon d={ICON.download} size={17} />
        Excel
      </button>
      <button type="button" className="btn btn-secondary" style={btn} onClick={() => run('docx')} disabled={disabled || !!busy} aria-busy={busy === 'docx'} title="ไฟล์ Word ตามตัวกรองที่เลือก">
        <Icon d={ICON.download} size={17} />
        Word
      </button>
      <button type="button" className="btn btn-secondary" style={btn} onClick={() => run('pdf')} disabled={disabled || !!busy} aria-busy={busy === 'pdf'} title="เปิดหน้าพิมพ์ แล้วเลือก 'บันทึกเป็น PDF'">
        <Icon d={ICON.download} size={17} />
        PDF
      </button>
    </span>
  );
}

/** "สด" while the WebSocket is up; tells the teacher when it's reconnecting. */
function LiveBadge({ status, updatedAt }: { status: LiveStatus; updatedAt: number | null }) {
  const on = status === 'live';
  const label = on ? 'สด' : status === 'offline' ? 'ขาดการเชื่อมต่อ — กำลังต่อใหม่' : 'กำลังเชื่อมต่อ…';
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString('th-TH') : null;
  return (
    <span
      className="stat-pill"
      role="status"
      title={on ? `รายชื่ออัปเดตเองทันทีที่นักศึกษาทำอะไร${time ? ` · ล่าสุด ${time}` : ''}` : 'รายชื่อจะไม่อัปเดตเองจนกว่าจะเชื่อมต่อได้'}
      style={{ gap: 8, fontSize: 14 }}
    >
      <span
        aria-hidden="true"
        className={on ? 'live-dot' : undefined}
        style={{ width: 9, height: 9, borderRadius: '50%', background: on ? 'var(--ok)' : status === 'offline' ? 'var(--err)' : 'var(--muted)' }}
      />
      {label}
      {on && time && <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{time}</span>}
    </span>
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

function EditRow({ u, classes, onCancel, onSaved }: { u: UserRow; classes: ClassRow[]; onCancel: () => void; onSaved: (u: UserRow) => void }) {
  const popup = usePopup();
  const teacher = u.role === 'teacher';
  const [name, setName] = useState(u.name);
  const [studentId, setStudentId] = useState(u.studentId);
  const [classId, setClassId] = useState(u.classId == null ? '' : String(u.classId));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, string | number | null> = {};
    if (name.trim() !== u.name) body.name = name;
    if (studentId.trim() !== u.studentId) body.studentId = studentId;
    if (!teacher && classId !== (u.classId == null ? '' : String(u.classId))) body.classId = classId ? Number(classId) : null;
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
            ห้องเรียน
            <select className="input" style={small} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— ไม่อยู่ห้องใด —</option>
              {classes
                .filter((c) => !c.archived || c.id === u.classId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c)}
                    {c.archived ? ' (ปิดแล้ว)' : ''}
                  </option>
                ))}
            </select>
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
