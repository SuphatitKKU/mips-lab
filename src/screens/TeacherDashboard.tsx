import { DataTable } from "../components/DataTable";
import { ClassesPanel, type ClassRow } from "./TeacherClasses";
import { StatsPanel, AuditPanel, ProgressModal } from "./TeacherInsights";
import { ProjectsPanel } from "./TeacherProjects";
import {
  exportDocx,
  exportPdf,
  type ExportInfo,
} from "../components/exportList";
import { classLabel } from "../lib/terms";
import { useEffect, useState, type FormEvent, type CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError, useApi } from "../api";
import { useAuth, type Me } from "../auth";
import { CodeEditor } from "../components/CodeEditor";
import { ErrorBox, PageHeader, Segmented } from "../components/ui";
import { usePopup } from "../components/Popup";
import type { Problem } from "../data/problems";
import type { GradeResult } from "../lib/grader";
interface Student extends Me {
  id: number;
  points: number;
  passed: number;
  lastActive: number | null;
  active: boolean;
  year: number | null;
  yearOverride: number | null;
  entryYear: number | null;
  assigned: number;
  onTime: number;
}
interface Item {
  problem: Problem;
  published: boolean;
  section: string;
  dueAt: number | null;
}
interface Overview {
  classes: ClassRow[];
  academicYear: number;
  students: Student[];
  problems: {
    id: number;
    title: string;
    published: number;
    section: string;
    due_at: number | null;
    attempted: number;
    solved: number;
  }[];
}
interface Report {
  user: Student;
  solves: { problem_id: number; points: number; solved_at: number }[];
  attempts: {
    id: number;
    problem_id: number;
    kind: string;
    passed: number;
    total: number;
    code: string;
    created_at: number;
    result: GradeResult;
  }[];
}
const stack: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
    gap: 16,
  },
  card: CSSProperties = { ...stack, padding: 24 };
const date = (t: number | null) =>
  t
    ? new Date(t).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const message = (e: unknown) => (e as ApiError).message;
export function Teacher() {
  const { isTeacher } = useAuth(),
    popup = usePopup(),
    data = useApi<Overview>(isTeacher ? "/teacher/overview" : null),
    bank = useApi<{ problems: Item[] }>(isTeacher ? "/teacher/problems" : null);
  const [tab, setTab] = useState("classes"),
    [classFilter, setClassFilter] = useState(""),
    [roleFilter, setRoleFilter] = useState("student"),
    [year, setYear] = useState(""),
    [editing, setEditing] = useState<Student | null>(null),
    [adding, setAdding] = useState(false),
    [teacher, setTeacher] = useState(false),
    [problem, setProblem] = useState<Item | null>(null),
    [newProblem, setNewProblem] = useState(false),
    [report, setReport] = useState<number | null>(null),
    [version, setVersion] = useState(0),
    [refreshError, setRefreshError] = useState("");
  useEffect(() => {
    setVersion((v) => v + 1);
  }, [data.data]);
  useEffect(() => {
    if (!isTeacher) return;
    let live = true,
      inFlight = false;
    const update = async () => {
      if (
        document.visibilityState !== "visible" ||
        editing ||
        adding ||
        problem ||
        newProblem ||
        inFlight
      )
        return;
      inFlight = true;
      try {
        const d = await api<Overview>("/teacher/overview");
        if (live) {
          data.setData(d);
          setRefreshError("");
        }
      } catch (e) {
        if (live) setRefreshError(message(e));
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [isTeacher, editing, adding, problem, newProblem]);
  if (!isTeacher) return <Navigate to="/" replace />;
  const students = (data.data?.students ?? []).filter(
      (u) => u.role === "student",
    ),
    rows = (data.data?.students ?? []).filter(
      (u) =>
        (!year || String(u.year) === year) &&
        (!roleFilter || u.role === roleFilter) &&
        (!classFilter ||
          (classFilter === "none"
            ? u.classId == null
            : String(u.classId) === classFilter)),
    );
  const refresh = () => {
    data.reload();
    bank.reload();
  };
  return (
    <>
      <PageHeader
        title="ห้องอาจารย์"
        sub="ห้องเรียน งานมอบหมาย และคะแนน · อัปเดตทุก 15 วินาที"
      >
        <button className="btn btn-secondary" onClick={refresh}>
          รีเฟรชข้อมูล
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setAdding(true);
            setTeacher(false);
            setTab("students");
          }}
        >
          เพิ่มนักศึกษา
        </button>
      </PageHeader>
      <main className="main" style={{ gap: 24 }}>
        {data.error && <ErrorBox error={data.error} onRetry={refresh} />}
        {refreshError && (
          <ErrorBox
            error={{ message: `ข้อมูลล่าสุดอัปเดตไม่สำเร็จ: ${refreshError}` }}
            onRetry={() => {
              setRefreshError("");
              refresh();
            }}
          />
        )}
        <div className="teacher-stats" style={grid}>
          {[
            ["นักศึกษาทั้งหมด", students.length],
            [
              "เข้าใช้ใน 7 วัน",
              students.filter(
                (u) => (u.lastActive ?? 0) > Date.now() - 7 * 86400000,
              ).length,
            ],
            [
              "คะแนนเฉลี่ย",
              students.length
                ? (
                    students.reduce((a, u) => a + u.points, 0) / students.length
                  ).toFixed(1)
                : "0",
            ],
            [
              "โจทย์เผยแพร่",
              data.data?.problems.filter((p) => p.published).length ?? 0,
            ],
          ].map(([label, value]) => (
            <div className="card" style={card} key={label}>
              <span style={{ color: "var(--muted)" }}>{label}</span>
              <strong style={{ fontSize: 32, fontFamily: "var(--mono)" }}>
                {data.loading ? "…" : value}
              </strong>
            </div>
          ))}
        </div>
        <div className="classroom-tabs">
          <Segmented
            label="จัดการห้องเรียน"
            value={tab}
            onChange={setTab}
            options={[
              { value: "classes", label: "ห้องเรียน" },
              { value: "overview", label: "ภาพรวม" },
              { value: "projects", label: "โปรเจกต์ Z80" },
              { value: "students", label: "นักศึกษาและคะแนน" },
              { value: "problems", label: "จัดการโจทย์" },
            ]}
          />
        </div>
        {tab === "classes" && (
          <>
            <ClassesPanel
              classes={data.data?.classes ?? []}
              unassigned={students.filter((u) => u.classId == null).length}
              onSaved={refresh}
              onDeleted={refresh}
              onRoster={refresh}
              onShow={(filter) => {
                setClassFilter(
                  filter === "none" ? "none" : filter.replace("c:", ""),
                );
                setTab("students");
              }}
            />
          </>
        )}
        {tab === "projects" && (
          <ProjectsPanel classes={data.data?.classes ?? []} version={version} />
        )}
        {tab === "overview" && (
          <>
            <section className="card" style={card}>
              <h2>ปีการศึกษา {data.data?.academicYear ?? "…"}</h2>
              <p>
                คำนวณชั้นปีจากเลข 2 หลักแรกของรหัส เช่น 66 → เข้า พ.ศ. 2566
                เป็นชั้นปีตามรุ่น อาจารย์แก้ชั้นปีรายคนได้
              </p>
              <form
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "end",
                  flexWrap: "wrap",
                }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get("year");
                  try {
                    await api("/teacher/settings", {
                      method: "PUT",
                      body: { academicYear: Number(value) },
                    });
                    refresh();
                    popup.toast("อัปเดตปีการศึกษาแล้ว", "ok");
                  } catch (e) {
                    popup.toast(message(e), "err");
                  }
                }}
              >
                <label className="field">
                  ปีการศึกษา (พ.ศ.)
                  <input
                    className="input"
                    name="year"
                    type="number"
                    min="2500"
                    max="2700"
                    key={data.data?.academicYear}
                    defaultValue={data.data?.academicYear}
                    required
                  />
                </label>
                <button className="btn btn-primary">บันทึก</button>
              </form>
            </section>
            <section className="card" style={card}>
              <h2>ผลการทำโจทย์</h2>
              <DataTable
                label="ผลการทำโจทย์"
                rows={data.data?.problems ?? []}
                rowKey={(p) => p.id}
                loading={data.loading}
                searchLabel="ค้นหาโจทย์"
                filename="exercise-results.csv"
                columns={[
                  { id: "id", title: "ข้อ", value: (p) => p.id, numeric: true },
                  {
                    id: "title",
                    title: "โจทย์",
                    value: (p) => p.title,
                    cell: (p) => <strong>{p.title}</strong>,
                  },
                  {
                    id: "section",
                    title: "กลุ่ม",
                    value: (p) => p.section || "ทุกกลุ่ม",
                  },
                  {
                    id: "status",
                    title: "สถานะ",
                    value: (p) => (p.published ? "เผยแพร่" : "ฉบับร่าง"),
                    cell: (p) => (
                      <span className={`dt-badge ${p.published ? "live" : ""}`}>
                        {p.published ? "เผยแพร่" : "ฉบับร่าง"}
                      </span>
                    ),
                  },
                  {
                    id: "attempted",
                    title: "เริ่มทำ",
                    value: (p) => p.attempted,
                    numeric: true,
                  },
                  {
                    id: "solved",
                    title: "ผ่าน",
                    value: (p) => p.solved,
                    numeric: true,
                  },
                  {
                    id: "due",
                    title: "กำหนดส่ง",
                    value: (p) => p.due_at,
                    exportValue: (p) => date(p.due_at),
                    cell: (p) => date(p.due_at),
                  },
                ]}
              />
            </section>
            <StatsPanel
              ids={rows.filter((u) => u.role === "student").map((u) => u.id)}
              version={version}
            />
            <AuditPanel version={version} />
          </>
        )}
        {tab === "students" && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <select
                className="input"
                aria-label="กรองห้องเรียน"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={{ width: 240 }}
              >
                <option value="">ทุกห้องเรียน</option>
                <option value="none">ยังไม่ได้เข้าห้อง</option>
                {data.data?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c)}
                    {c.archived ? " · ปิดแล้ว" : ""}
                  </option>
                ))}
              </select>
              <select
                className="input"
                aria-label="กรองบทบาท"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                style={{ width: 160 }}
              >
                <option value="student">นักศึกษา</option>
                <option value="teacher">อาจารย์</option>
                <option value="">ทุกบทบาท</option>
              </select>
              <select
                className="input"
                aria-label="กรองชั้นปี"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                style={{ width: 160 }}
              >
                <option value="">ทุกชั้นปี</option>
                {[
                  ...new Set(
                    students
                      .map((u) => u.year)
                      .filter((y): y is number => y !== null),
                  ),
                ]
                  .sort((a, b) => a - b)
                  .map((y) => (
                    <option key={y} value={y}>
                      ชั้นปี {y}
                    </option>
                  ))}
              </select>
              <button
                className="btn btn-soft"
                onClick={() => {
                  setEditing(null);
                  setAdding(true);
                  setTeacher(true);
                }}
              >
                เพิ่มอาจารย์
              </button>
            </div>
            {(adding || editing) && (
              <AccountForm
                key={editing?.id ?? (teacher ? "teacher" : "new")}
                user={editing}
                classes={data.data?.classes ?? []}
                teacher={editing ? editing.role === "teacher" : teacher}
                onCancel={() => {
                  setEditing(null);
                  setAdding(false);
                }}
                onSaved={() => {
                  setEditing(null);
                  setAdding(false);
                  refresh();
                }}
              />
            )}
            <section className="card" style={card}>
              <h2>รายชื่อและคะแนน · {rows.length} คน</h2>
              <DataTable
                label="รายชื่อและคะแนน"
                rows={rows}
                rowKey={(u) => u.id}
                loading={data.loading}
                searchLabel="ค้นหานักศึกษา"
                filename="student-scores.csv"
                defaultSort={{ id: "studentId", desc: false }}
                empty="ยังไม่มีนักศึกษาในกลุ่มนี้"
                extraActions={(filtered) => {
                  const info: ExportInfo = {
                    title: classFilter
                      ? (data.data?.classes.find(
                          (c) => String(c.id) === classFilter,
                        )?.name ?? "รายชื่อที่กรอง")
                      : "รายชื่อนักศึกษา",
                    totalProblems: data.data?.problems.length ?? 0,
                    rows: filtered.filter((u) => u.role === "student"),
                  };
                  const download = async (kind: "docx" | "pdf") => {
                    try {
                      if (kind === "docx") await exportDocx(info);
                      else await exportPdf(info);
                    } catch (e) {
                      popup.toast(message(e), "err");
                    }
                  };
                  return (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary dt-export"
                        disabled={!info.rows.length}
                        onClick={() => download("docx")}
                      >
                        Word
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary dt-export"
                        disabled={!info.rows.length}
                        onClick={() => download("pdf")}
                      >
                        PDF
                      </button>
                    </>
                  );
                }}
                columns={[
                  {
                    id: "name",
                    title: "ชื่อ–นามสกุล",
                    value: (u) => u.name,
                    cell: (u) => (
                      <div className="dt-person">
                        <span className="dt-avatar">{u.initials}</span>
                        <span>
                          <strong>{u.name}</strong>
                          <small>{u.studentId}</small>
                        </span>
                      </div>
                    ),
                  },
                  {
                    id: "studentId",
                    title: "รหัสนักศึกษา",
                    value: (u) => u.studentId,
                  },
                  {
                    id: "section",
                    title: "ห้องเรียน",
                    value: (u) =>
                      u.role === "teacher"
                        ? "อาจารย์"
                        : u.section || "ยังไม่ได้เข้าห้อง",
                  },
                  {
                    id: "year",
                    title: "ชั้นปี",
                    value: (u) => (u.role === "teacher" ? null : u.year),
                    numeric: true,
                  },
                  {
                    id: "points",
                    title: "คะแนน",
                    value: (u) => u.points,
                    numeric: true,
                    cell: (u) => (
                      <strong className="dt-score">
                        {u.points.toLocaleString("th-TH")}
                      </strong>
                    ),
                  },
                  {
                    id: "passed",
                    title: "ผ่าน",
                    value: (u) => u.passed,
                    numeric: true,
                  },
                  {
                    id: "onTime",
                    title: "งานตรงเวลา",
                    value: (u) => u.onTime,
                    numeric: true,
                    cell: (u) =>
                      u.assigned ? `${u.onTime}/${u.assigned}` : "—",
                  },
                  {
                    id: "active",
                    title: "บัญชี",
                    value: (u) => (u.active ? "เปิดใช้งาน" : "ปิดบัญชี"),
                    cell: (u) => (
                      <span className={`dt-badge ${u.active ? "live" : ""}`}>
                        {u.active ? "เปิดใช้งาน" : "ปิดบัญชี"}
                      </span>
                    ),
                  },
                  {
                    id: "lastActive",
                    title: "ใช้งานล่าสุด",
                    value: (u) => u.lastActive,
                    exportValue: (u) => date(u.lastActive),
                    cell: (u) => date(u.lastActive),
                  },
                  {
                    id: "actions",
                    title: "จัดการ",
                    value: () => "",
                    sortable: false,
                    exportable: false,
                    cell: (u) => (
                      <div className="dt-actions">
                        <button
                          className="btn btn-soft"
                          onClick={() => {
                            setEditing(u);
                            setAdding(false);
                          }}
                        >
                          แก้ไข
                        </button>
                        {u.role === "student" && (
                          <button
                            className="btn btn-ghost"
                            onClick={() => setReport(u.id)}
                          >
                            ดูผลรายคน
                          </button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </section>
            {report !== null && (
              <StudentReport id={report} onClose={() => setReport(null)} />
            )}
          </>
        )}
        {tab === "problems" && (
          <>
            {bank.error && (
              <ErrorBox error={bank.error} onRetry={bank.reload} />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "center",
              }}
            >
              <p>
                ฉบับร่างเห็นเฉพาะอาจารย์
                เลือกเผยแพร่เมื่อต้องการให้นักศึกษาทำโจทย์
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setProblem(null);
                  setNewProblem(true);
                }}
              >
                สร้างโจทย์
              </button>
            </div>
            {(newProblem || problem) && (
              <ProblemEditor
                key={problem?.problem.id ?? "new"}
                item={problem}
                sections={[
                  ...new Set(data.data?.classes.map((c) => c.name) ?? []),
                ]}
                onCancel={() => {
                  setNewProblem(false);
                  setProblem(null);
                }}
                onSaved={() => {
                  setNewProblem(false);
                  setProblem(null);
                  refresh();
                }}
              />
            )}
            <div style={grid} data-tour="problem-bank">
              {bank.data?.problems.map((item) => (
                <section className="card" style={card} key={item.problem.id}>
                  <span className="chip chip-soft">
                    {item.problem.kind.toUpperCase()} ·{" "}
                    {item.published ? "เผยแพร่" : "ฉบับร่าง"}
                  </span>
                  <h3>
                    #{item.problem.id} {item.problem.title}
                  </h3>
                  <span>
                    {item.section || "ทุกกลุ่ม"} · {item.problem.tests.length}{" "}
                    เคส
                  </span>
                  <button
                    className="btn btn-soft"
                    onClick={() => {
                      setProblem(item);
                      setNewProblem(false);
                    }}
                  >
                    แก้ไขโจทย์
                  </button>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
function AccountForm({
  classes,
  user,
  teacher,
  onSaved,
  onCancel,
}: {
  classes: ClassRow[];
  user: Student | null;
  teacher: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    popup = usePopup();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget),
      body: Record<string, unknown> = {
        name: f.get("name"),
        studentId: f.get("studentId"),
        ...(teacher
          ? {}
          : { classId: f.get("classId") ? Number(f.get("classId")) : null }),
      };
    if (f.get("password")) body.password = f.get("password");
    if (user) {
      body.active = f.get("active") === "on";
      body.yearOverride = f.get("year") ? Number(f.get("year")) : null;
    }
    try {
      await api(
        user
          ? `/teacher/users/${user.id}`
          : teacher
            ? "/teacher/teachers"
            : "/teacher/students",
        { method: user ? "PATCH" : "POST", body },
      );
      popup.toast("บันทึกบัญชีแล้ว", "ok");
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="card" style={card}>
      <h2>
        {user ? "แก้ไขบัญชี" : teacher ? "เพิ่มอาจารย์" : "เพิ่มนักศึกษา"}
      </h2>
      <div style={grid}>
        <label className="field">
          ชื่อ–นามสกุล
          <input
            className="input"
            name="name"
            defaultValue={user?.name}
            maxLength={80}
            required
          />
        </label>
        <label className="field">
          {teacher ? "ชื่อผู้ใช้" : "รหัสนักศึกษา"}
          <input
            className="input"
            name="studentId"
            defaultValue={user?.studentId}
            required
            pattern={teacher ? "[a-z0-9._\\-]{3,32}" : "[0-9]{9,12}(-[0-9])?"}
          />
        </label>
        {!teacher && (
          <>
            <label className="field">
              ห้องเรียน
              <select
                className="input"
                name="classId"
                defaultValue={user?.classId ?? ""}
              >
                <option value="">ยังไม่จัดห้อง</option>
                {classes
                  .filter((c) => !c.archived || c.id === user?.classId)
                  .map((c) => (
                    <option key={c.id} value={c.id} disabled={c.archived}>
                      {classLabel(c)}
                      {c.archived ? " · ปิดแล้ว" : ""}
                    </option>
                  ))}
              </select>
            </label>
            {user && (
              <label className="field">
                ชั้นปี (ว่าง = คำนวณจากรหัส)
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="20"
                  name="year"
                  defaultValue={user.yearOverride ?? ""}
                />
              </label>
            )}
          </>
        )}
        <label className="field">
          {user ? "รหัสผ่านใหม่ (เว้นว่างได้)" : "รหัสผ่านเริ่มต้น"}
          <input
            className="input"
            type="password"
            name="password"
            minLength={10}
            maxLength={128}
            required={!user}
            autoComplete="new-password"
          />
        </label>
      </div>
      {user && (
        <label>
          <input type="checkbox" name="active" defaultChecked={user.active} />{" "}
          เปิดใช้งานบัญชี
        </label>
      )}
      <p>
        แจ้งรหัสผ่านเป็นการส่วนตัว เจ้าของบัญชีเปลี่ยนรหัสผ่านได้ที่หน้าตั้งค่า
      </p>
      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          ยกเลิก
        </button>
        <button disabled={busy} className="btn btn-primary">
          {busy ? "กำลังบันทึก…" : "บันทึกบัญชี"}
        </button>
      </div>
    </form>
  );
}
const initial: Problem = {
  id: 0,
  title: "",
  sub: "",
  statement: "",
  kind: "c",
  level: "ง่าย",
  topic: "โจทย์อาจารย์",
  fn: "add",
  params: [
    ["a0", "a", "จำนวนเต็ม"],
    ["a1", "b", "จำนวนเต็ม"],
  ],
  returns: [["v0", "ผลรวม"]],
  starter: "int add(int a, int b) { return 0; }",
  tests: [
    { args: [2, 3], expect: { v0: 5 } },
    { args: [-4, 9], expect: { v0: 5 }, hidden: true },
  ],
  answer: {
    code: [{ lang: "c", lines: ["int add(int a, int b) { return a + b; }"] }],
  },
  hints: [],
  example: "",
  customPoints: 10,
};
function ProblemEditor({
  item,
  sections,
  onSaved,
  onCancel,
}: {
  item: Item | null;
  sections: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<Problem>(item?.problem ?? initial),
    [published, setPublished] = useState(item?.published ?? false),
    [section, setSection] = useState(item?.section ?? ""),
    [due, setDue] = useState(
      item?.dueAt
        ? new Date(item.dueAt + 7 * 3600000).toISOString().slice(0, 16)
        : "",
    ),
    [answer, setAnswer] = useState(
      (item?.problem ?? initial).answer.code
        .find((c) => c.lang === (item?.problem ?? initial).kind)
        ?.lines.join("\n") ?? "",
    ),
    [params, setParams] = useState(
      JSON.stringify((item?.problem ?? initial).params),
    ),
    [tests, setTests] = useState(
      JSON.stringify((item?.problem ?? initial).tests, null, 2),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    popup = usePopup();
  const patch = (key: keyof Problem, value: unknown) =>
    setP((x) => ({ ...x, [key]: value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const problem = {
        ...p,
        params: JSON.parse(params),
        tests: JSON.parse(tests),
        answer: { code: [{ lang: p.kind, lines: answer.split("\n") }] },
      };
      await api(
        item ? `/teacher/problems/${item.problem.id}` : "/teacher/problems",
        {
          method: item ? "PUT" : "POST",
          body: {
            problem,
            published,
            section,
            dueAt: due ? new Date(due + ":00+07:00").getTime() : null,
          },
        },
      );
      popup.toast("ตรวจเฉลยและบันทึกโจทย์แล้ว", "ok");
      onSaved();
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "รูปแบบ JSON ของพารามิเตอร์หรือเคสทดสอบไม่ถูกต้อง"
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="card" style={card}>
      <h2>{item ? `แก้ไขโจทย์ #${p.id}` : "สร้างโจทย์ใหม่"}</h2>
      <div style={grid}>
        <label className="field">
          ชื่อโจทย์
          <input
            className="input"
            value={p.title}
            onChange={(e) => patch("title", e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label className="field">
          ภาษา
          <select
            className="input"
            value={p.kind}
            onChange={(e) => {
              patch("kind", e.target.value);
              if (e.target.value === "z80") {
                setParams("[]");
                patch("port", 1);
                setTests(
                  JSON.stringify(
                    [
                      { note: "ไฟแรก", outs: [1] },
                      { note: "ลำดับไฟ", outs: [1, 2, 4, 8], hidden: true },
                    ],
                    null,
                    2,
                  ),
                );
              }
            }}
          >
            <option value="c">C</option>
            <option value="mips">MIPS</option>
            <option value="z80">Z80</option>
          </select>
        </label>
        <label className="field">
          ระดับ
          <select
            className="input"
            value={p.level}
            onChange={(e) => patch("level", e.target.value)}
          >
            {["ง่าย", "กลาง", "ยาก"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          คะแนนพื้นฐาน
          <input
            className="input"
            type="number"
            min="1"
            max="1000"
            value={p.customPoints ?? { ง่าย: 10, กลาง: 20, ยาก: 40 }[p.level]}
            onChange={(e) => patch("customPoints", Number(e.target.value))}
            required
          />
        </label>
        <label className="field">
          ชื่อฟังก์ชัน / label เริ่มต้น
          <input
            className="input"
            value={p.fn}
            onChange={(e) => patch("fn", e.target.value)}
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            required
          />
        </label>
        <label className="field">
          หัวข้อ
          <input
            className="input"
            value={p.topic}
            onChange={(e) => patch("topic", e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="field">
          กลุ่มที่เห็นโจทย์
          <input
            className="input"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            list="problem-sections"
            maxLength={40}
            placeholder="ว่าง = ทุกกลุ่ม"
          />
          <datalist id="problem-sections">
            {sections.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </datalist>
        </label>
        <label className="field">
          กำหนดส่ง (เวลาไทย · เว้นว่างได้)
          <input
            className="input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        {p.kind === "z80" && (
          <label className="field">
            พอร์ต OUT (0–255)
            <input
              className="input"
              type="number"
              min="0"
              max="255"
              value={p.port ?? 1}
              onChange={(e) => patch("port", Number(e.target.value))}
            />
          </label>
        )}
      </div>
      <label className="field">
        คำอธิบายโจทย์
        <textarea
          className="input"
          rows={4}
          value={p.statement}
          onChange={(e) => patch("statement", e.target.value)}
          maxLength={16000}
          required
        />
      </label>
      <label className="field">
        คำใบ้ (หนึ่งข้อต่อบรรทัด)
        <textarea
          className="input"
          rows={2}
          value={p.hints.join("\n")}
          onChange={(e) => patch("hints", e.target.value.split("\n"))}
        />
      </label>
      <details>
        <summary>แก้พารามิเตอร์ (a0 ถึง a3)</summary>
        <p>รูปแบบ [register, ชื่อ, คำอธิบาย] ไม่เกิน 4 ตัว</p>
        <textarea
          className="input"
          aria-label="พารามิเตอร์ JSON"
          value={params}
          onChange={(e) => setParams(e.target.value)}
          rows={3}
        />
      </details>
      <div style={grid}>
        <section style={stack}>
          <h3>โค้ดเริ่มต้นของนักศึกษา</h3>
          <CodeEditor
            label="โค้ดเริ่มต้น"
            lang={p.kind}
            value={p.starter}
            onChange={(v) => patch("starter", v)}
          />
        </section>
        <section style={stack}>
          <h3>เฉลยสำหรับตรวจคำตอบ</h3>
          <CodeEditor
            label="เฉลย"
            lang={p.kind}
            value={answer}
            onChange={setAnswer}
          />
        </section>
      </div>
      <section style={stack}>
        <h3>เคสทดสอบ</h3>
        <p>
          C/MIPS: args คือค่ารับเข้า, expect คือ register ผลลัพธ์ เช่น v0 ·
          อาร์เรย์ใช้ [1,2,3] ใน args และ expectArr เมื่อตรวจค่าอาร์เรย์ · Z80:
          note, outs และ minGap · hidden: true ซ่อนข้อมูลเคสจากนักศึกษา
        </p>
        <textarea
          className="input"
          aria-label="เคสทดสอบ JSON"
          style={{ fontFamily: "var(--mono)", minHeight: 220 }}
          value={tests}
          onChange={(e) => setTests(e.target.value)}
        />
      </section>
      <label>
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
        />{" "}
        เผยแพร่ให้นักศึกษา
      </label>
      <p>
        เฉลยต้องผ่านทุกเคสก่อนบันทึก เมื่อมีผู้ทำแล้วจะล็อกเคส ภาษา และคะแนน
        ผ่านครั้งแรกได้โบนัส 5 คะแนน
      </p>
      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          ยกเลิก
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "กำลังตรวจเฉลย…" : "ตรวจเฉลยและบันทึก"}
        </button>
      </div>
    </form>
  );
}
function StudentReport({ id, onClose }: { id: number; onClose: () => void }) {
  const [showProgress, setShowProgress] = useState(false);
  const { data, error, reload } = useApi<Report>(`/teacher/users/${id}/report`);
  return (
    <section className="card" style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2>ผลรายคน · {data?.user.name ?? "กำลังโหลด…"}</h2>
        <button
          className="btn btn-secondary"
          onClick={() => setShowProgress(true)}
        >
          ความคืบหน้ารายข้อ
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          ปิด
        </button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      <p>
        ผ่าน {data?.solves.length ?? 0} ข้อ · คะแนนรวม{" "}
        {data?.solves.reduce((a, s) => a + s.points, 0) ?? 0} ·
        ประวัติล่าสุดไม่เกิน 200 ครั้ง
      </p>
      <DataTable
        label="คะแนนรายข้อ"
        rows={data?.solves ?? []}
        rowKey={(s) => s.problem_id}
        loading={!data && !error}
        filename={`student-${id}-scores.csv`}
        columns={[
          {
            id: "problem",
            title: "โจทย์",
            value: (s) => s.problem_id,
            numeric: true,
          },
          {
            id: "points",
            title: "คะแนน",
            value: (s) => s.points,
            numeric: true,
          },
          {
            id: "solvedAt",
            title: "ผ่านเมื่อ",
            value: (s) => s.solved_at,
            exportValue: (s) => date(s.solved_at),
            cell: (s) => date(s.solved_at),
          },
        ]}
      />
      {data?.attempts.map((a) => (
        <details key={a.id} className="card" style={{ padding: 16 }}>
          <summary>
            #{a.problem_id} · {a.kind === "submit" ? "ส่งคำตอบ" : "ทดสอบ"} ·
            ผ่าน {a.passed}/{a.total} · {date(a.created_at)}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {a.code}
          </pre>
          {a.result.errors.map((e, i) => (
            <p key={i}>
              บรรทัด {e.line}: {e.msg}
            </p>
          ))}
          {a.result.results.map((r, i) => (
            <p key={i}>
              เคส {i + 1} {r.hidden ? "(ซ่อน)" : ""} ·{" "}
              {r.ok ? "ผ่าน" : "ไม่ผ่าน"} {r.msg ?? ""}
            </p>
          ))}
        </details>
      ))}
      {data && !data.attempts.length && <p>ยังไม่มีประวัติทำโจทย์</p>}
      {showProgress && (
        <ProgressModal userId={id} onClose={() => setShowProgress(false)} />
      )}
    </section>
  );
}
