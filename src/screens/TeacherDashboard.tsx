import { useState, type FormEvent, type CSSProperties } from "react";
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
}
interface Item {
  problem: Problem;
  published: boolean;
  section: string;
  dueAt: number | null;
}
interface Overview {
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
function exportCsv(rows: Student[]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const csv = [
    [
      "รหัสนักศึกษา",
      "ชื่อ",
      "กลุ่ม",
      "ชั้นปี",
      "ปีที่เข้า",
      "คะแนน",
      "ผ่าน",
      "เปิดบัญชี",
    ],
    ...rows.map((u) => [
      u.studentId,
      u.name,
      u.section,
      u.year,
      u.entryYear,
      u.points,
      u.passed,
      u.active ? "ใช่" : "ไม่",
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "mips-lab-scores.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Teacher() {
  const { isTeacher } = useAuth(),
    popup = usePopup(),
    data = useApi<Overview>(isTeacher ? "/teacher/overview" : null),
    bank = useApi<{ problems: Item[] }>(isTeacher ? "/teacher/problems" : null);
  const [tab, setTab] = useState("overview"),
    [query, setQuery] = useState(""),
    [section, setSection] = useState(""),
    [year, setYear] = useState(""),
    [editing, setEditing] = useState<Student | null>(null),
    [adding, setAdding] = useState(false),
    [teacher, setTeacher] = useState(false),
    [problem, setProblem] = useState<Item | null>(null),
    [newProblem, setNewProblem] = useState(false),
    [report, setReport] = useState<number | null>(null);
  if (!isTeacher) return <Navigate to="/" replace />;
  const students = (data.data?.students ?? []).filter(
      (u) => u.role === "student",
    ),
    sections = [
      ...new Set(students.map((u) => u.section).filter(Boolean)),
    ].sort(),
    rows = (data.data?.students ?? []).filter(
      (u) =>
        (!section || u.section === section) &&
        (!year || String(u.year) === year) &&
        [u.name, u.studentId, u.section]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const refresh = () => {
    data.reload();
    bank.reload();
  };
  return (
    <>
      <PageHeader title="ห้องอาจารย์" sub="สร้างโจทย์ ติดตามผล และดูแลนักศึกษา">
        <button
          className="btn btn-secondary"
          onClick={() => exportCsv(rows.filter((u) => u.role === "student"))}
        >
          ส่งออกคะแนน CSV
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
        <Segmented
          label="จัดการห้องเรียน"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "ภาพรวม" },
            { value: "students", label: "นักศึกษาและคะแนน" },
            { value: "problems", label: "จัดการโจทย์" },
          ]}
        />
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
              <div className="teacher-scroll">
                <table className="teacher-table">
                  <thead>
                    <tr>
                      <th>โจทย์</th>
                      <th>กลุ่ม</th>
                      <th>สถานะ</th>
                      <th>เริ่มทำ</th>
                      <th>ผ่าน</th>
                      <th>กำหนดส่ง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data?.problems.map((p) => (
                      <tr key={p.id}>
                        <td>
                          #{p.id} {p.title}
                        </td>
                        <td>{p.section || "ทุกกลุ่ม"}</td>
                        <td>{p.published ? "เผยแพร่" : "ฉบับร่าง"}</td>
                        <td>{p.attempted}</td>
                        <td>{p.solved}</td>
                        <td>{date(p.due_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {tab === "students" && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <input
                className="input"
                aria-label="ค้นหานักศึกษา"
                placeholder="ค้นหาชื่อ รหัส หรือกลุ่ม"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: "1 1 250px" }}
              />
              <select
                className="input"
                aria-label="กรองกลุ่มเรียน"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                style={{ width: 180 }}
              >
                <option value="">ทุกกลุ่ม</option>
                {sections.map((s) => (
                  <option key={s}>{s}</option>
                ))}
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
              <div className="teacher-scroll">
                <table className="teacher-table">
                  <thead>
                    <tr>
                      <th>ชื่อ / รหัส</th>
                      <th>กลุ่ม</th>
                      <th>รุ่น / ชั้นปี</th>
                      <th>คะแนน</th>
                      <th>ผ่าน</th>
                      <th>ใช้งานล่าสุด</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          <br />
                          {u.studentId}{" "}
                          {!u.active && (
                            <span className="chip chip-soft">ปิดบัญชี</span>
                          )}
                        </td>
                        <td>
                          {u.role === "teacher"
                            ? "อาจารย์"
                            : u.section || "ยังไม่จัดกลุ่ม"}
                        </td>
                        <td>
                          {u.role === "teacher"
                            ? "—"
                            : `รุ่น ${u.entryYear ?? "—"} / ปี ${u.year ?? "—"}`}
                        </td>
                        <td>{u.points}</td>
                        <td>{u.passed}</td>
                        <td>{date(u.lastActive)}</td>
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <p>
                    ยังไม่มีรายชื่อที่ตรงกับตัวกรอง
                    เพิ่มนักศึกษาเพื่อเริ่มใช้งาน
                  </p>
                )}
              </div>
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
                sections={sections}
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
            <div style={grid}>
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
  user,
  teacher,
  onSaved,
  onCancel,
}: {
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
        section: f.get("section") ?? "",
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
              กลุ่มเรียน
              <input
                className="input"
                name="section"
                defaultValue={user?.section}
                maxLength={40}
                placeholder="SEC 1"
              />
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
      {data?.solves.map((s) => (
        <span key={s.problem_id}>
          โจทย์ #{s.problem_id} · {s.points} คะแนน · {date(s.solved_at)}
        </span>
      ))}
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
    </section>
  );
}
