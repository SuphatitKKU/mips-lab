import { validSubmissionBoard } from "./boardSubmission";
import { Store, type User } from "./store";
import { classLabel, CODE_ALPHABET, termOf } from "../src/lib/terms";

interface ClassRow {
  id: number;
  name: string;
  year: number;
  term: number;
  code: string;
  archived: number;
  students: number;
  pending: number;
  assigned: number;
}
interface Project {
  id: number;
  class_id: number;
  title: string;
  detail: string;
  due_at: number | null;
  created_at: number;
}
interface Submission {
  id: number;
  user_id: number;
  project_id: number;
  name: string;
  board: string;
  code: string;
  note: string;
  submitted_at: number;
  score: number | null;
  feedback: string | null;
  graded_at: number | null;
}
export class ClassroomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ClassroomError(status, message);
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const projectJson = (p: Project) => ({
  id: p.id,
  classId: p.class_id,
  title: p.title,
  detail: p.detail,
  dueAt: p.due_at,
  createdAt: p.created_at,
});
const summary = (s: Submission, due: number | null) => ({
  id: s.id,
  name: s.name,
  note: s.note,
  submittedAt: s.submitted_at,
  late: due !== null && s.submitted_at > due,
  score: s.score,
  feedback: s.feedback,
  gradedAt: s.graded_at,
});
const dateValue = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) fail(400, "วันส่งไม่ถูกต้อง");
  return n;
};
export class Classroom {
  constructor(readonly s: Store) {}
  async classes() {
    return (
      await this.s.all<ClassRow>(`SELECT c.*,
      (SELECT COUNT(*) FROM users WHERE class_id=c.id AND role='student') students,
      (SELECT COUNT(*) FROM roster WHERE class_id=c.id) pending,
      (SELECT COUNT(*) FROM assignments WHERE class_id=c.id) assigned
      FROM classes c ORDER BY year DESC,term DESC,name`)
    ).map((c) => ({ ...c, archived: !!c.archived }));
  }
  async class(id: number, open = false) {
    const c = await this.s.first<ClassRow>(
      "SELECT * FROM classes WHERE id=?",
      id,
    );
    if (!c) throw new ClassroomError(404, "ไม่พบห้องเรียน");
    if (open && c.archived) fail(409, "ห้องเรียนปิดแล้ว");
    return c;
  }
  code() {
    return Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (n) => CODE_ALPHABET[n % CODE_ALPHABET.length],
    ).join("");
  }
  async create(name: string, year: number, term: number) {
    if (
      !name ||
      name.length > 40 ||
      !Number.isInteger(year) ||
      year < 2500 ||
      year > 2700 ||
      ![1, 2, 3].includes(term)
    )
      fail(400, "ชื่อห้อง ปีการศึกษา หรือภาคเรียนไม่ถูกต้อง");
    if (
      await this.s.first(
        "SELECT id FROM classes WHERE name=? AND year=? AND term=?",
        name,
        year,
        term,
      )
    )
      fail(409, "มีห้องชื่อนี้ในภาคเรียนนี้แล้ว");
    for (let i = 0; i < 5; i++) {
      const code = this.code();
      if (await this.s.first("SELECT id FROM classes WHERE code=?", code))
        continue;
      const r = await this.s
        .stmt(
          "INSERT INTO classes(name,year,term,code,created_at) VALUES (?,?,?,?,?)",
          name,
          year,
          term,
          code,
          Date.now(),
        )
        .run();
      return (await this.classes()).find((c) => c.id === r.meta.last_row_id)!;
    }
    throw new ClassroomError(503, "สุ่มรหัสห้องไม่สำเร็จ ลองอีกครั้ง");
  }
  async setClass(uid: number, id: number | null) {
    const c = id === null ? null : await this.class(id, true);
    await this.s
      .stmt(
        "UPDATE users SET class_id=?,section=? WHERE id=? AND role='student'",
        id,
        c?.name ?? "",
        uid,
      )
      .run();
  }
  async legacyClass(section: string) {
    if (!section) return null;
    const { year, term } = termOf();
    const c = await this.s.first<ClassRow>(
      "SELECT * FROM classes WHERE name=? AND year=? AND term=? AND archived=0",
      section,
      year,
      term,
    );
    return c?.id ?? (await this.create(section, year, term)).id;
  }
  async claim(user: User) {
    if (user.role !== "student" || user.class_id !== null) return user;
    const r = await this.s.first<{ class_id: number }>(
      `SELECT r.class_id FROM roster r JOIN classes c ON c.id=r.class_id WHERE c.archived=0 AND (r.ident=? OR r.ident=?) ORDER BY added_at DESC LIMIT 1`,
      user.student_id.replace(/-/g, ""),
      user.email?.toLowerCase() ?? "",
    );
    if (r) {
      await this.setClass(user.id, r.class_id);
      await this.s
        .stmt(
          "DELETE FROM roster WHERE ident=? OR ident=?",
          user.student_id.replace(/-/g, ""),
          user.email?.toLowerCase() ?? "",
        )
        .run();
      return (await this.s.first<User>(
        "SELECT * FROM users WHERE id=?",
        user.id,
      ))!;
    }
    return user;
  }
  async userJson(u: User) {
    const c = u.class_id == null ? null : await this.class(u.class_id);
    return {
      ...this.s.userJson(u, await this.s.year()),
      section: c ? classLabel(c) : u.section,
      classId: u.class_id,
      needsClass:
        u.role === "student" &&
        (!c || !!c.archived || !/^\d{9,12}(?:-\d)?$/.test(u.student_id)),
    };
  }
  async users() {
    const [users, classes] = await Promise.all([
      this.s.users(),
      this.classes(),
    ]);
    const counts = await this.s.all<{
      id: number;
      assigned: number;
      onTime: number;
    }>(`SELECT u.id,
      (SELECT COUNT(*) FROM assignments WHERE class_id=u.class_id) assigned,
      (SELECT COUNT(*) FROM assignments a JOIN solves v ON v.user_id=u.id AND v.problem_id=a.problem_id WHERE a.class_id=u.class_id AND v.solved_at<=a.due_at) onTime FROM users u`);
    const byId = new Map(counts.map((c) => [c.id, c]));
    return users.map((u) => {
      const c = classes.find((c) => c.id === u.classId);
      return {
        ...u,
        section: c ? classLabel(c) : u.section,
        needsClass:
          u.role === "student" &&
          (!c || c.archived || !/^\d{9,12}(?:-\d)?$/.test(u.studentId)),
        ...byId.get(u.id),
      };
    });
  }
  async audit(u: User, action: string, detail: string) {
    await this.s
      .stmt(
        "INSERT INTO audit(at,actor,action,detail) VALUES (?,?,?,?)",
        Date.now(),
        `${u.name} (${u.student_id})`,
        action,
        detail,
      )
      .run();
  }
  async assignments(id: number) {
    return this.s.all<{ problemId: number; dueAt: number }>(
      "SELECT problem_id AS problemId,due_at AS dueAt FROM assignments WHERE class_id=? ORDER BY due_at,problem_id",
      id,
    );
  }
  async progress(u: User) {
    const [rows, status, solves, attempts, due, latest] = await Promise.all([
      this.s.problems(u),
      this.s.status(u.id),
      this.s.all<{
        problem_id: number;
        points: number;
        solved_at: number;
        first_try: number;
      }>("SELECT * FROM solves WHERE user_id=?", u.id),
      this.s.all<{ problem_id: number; n: number }>(
        "SELECT problem_id,COUNT(*) n FROM attempts WHERE user_id=? GROUP BY problem_id",
        u.id,
      ),
      this.assignments(u.class_id ?? -1),
      this.s.all<{
        problem_id: number;
        passed: number;
        total: number;
        created_at: number;
      }>(
        "SELECT a.problem_id,a.passed,a.total,a.created_at FROM attempts a JOIN (SELECT MAX(id) id FROM attempts WHERE user_id=? GROUP BY problem_id) last ON last.id=a.id",
        u.id,
      ),
    ]);
    return rows.map((r) => {
      const p = this.s.parse(r),
        v = solves.find((x) => x.problem_id === r.id),
        last = latest.find((a) => a.problem_id === r.id);
      return {
        id: r.id,
        title: p.title,
        level: p.level,
        status: status.get(r.id)?.st ?? "todo",
        points: v?.points ?? null,
        solvedAt: v?.solved_at ?? null,
        firstTry: !!v?.first_try,
        attempts: attempts.find((a) => a.problem_id === r.id)?.n ?? 0,
        last: last
          ? { passed: last.passed, total: last.total, at: last.created_at }
          : null,
        dueAt: due.find((a) => a.problemId === r.id)?.dueAt ?? r.due_at,
      };
    });
  }
  async projects(uid?: number, classId?: number | null) {
    const rows = await this.s.all<
      Project & {
        name: string;
        year: number;
        term: number;
        students: number;
        submitted: number;
        graded: number;
      }
    >(
      `SELECT p.*,c.name,c.year,c.term,
      (SELECT COUNT(*) FROM users WHERE class_id=p.class_id AND role='student') students,
      (SELECT COUNT(*) FROM submissions WHERE project_id=p.id) submitted,
      (SELECT COUNT(*) FROM submissions WHERE project_id=p.id AND graded_at IS NOT NULL) graded
      FROM projects p JOIN classes c ON c.id=p.class_id ${uid === undefined ? "" : "WHERE p.class_id=?"} ORDER BY p.created_at DESC`,
      ...(uid === undefined ? [] : [classId ?? -1]),
    );
    const mine =
      uid === undefined
        ? []
        : await this.s.all<Submission>(
            "SELECT * FROM submissions WHERE user_id=?",
            uid,
          );
    return rows.map((p) => {
      if (uid === undefined)
        return {
          ...projectJson(p),
          classLabel: classLabel(p),
          students: p.students,
          submitted: p.submitted,
          graded: p.graded,
        };
      const sub = mine.find((s) => s.project_id === p.id);
      return {
        ...projectJson(p),
        submission: sub ? summary(sub, p.due_at) : null,
      };
    });
  }
  async submission(id: number) {
    const row = await this.s.first<
      Submission & {
        due_at: number | null;
        title: string;
        uname: string;
        student_id: string;
      }
    >(
      `SELECT s.*,p.due_at,p.title,u.name uname,u.student_id FROM submissions s JOIN projects p ON p.id=s.project_id JOIN users u ON u.id=s.user_id WHERE s.id=?`,
      id,
    );
    if (!row) throw new ClassroomError(404, "ไม่พบงานที่ส่ง");
    return {
      ...summary(row, row.due_at),
      board: JSON.parse(row.board) as unknown,
      code: row.code,
      project: { id: row.project_id, title: row.title },
      student: { id: row.user_id, name: row.uname, studentId: row.student_id },
    };
  }
  async handle(
    path: string,
    method: string,
    body: Record<string, unknown>,
    u: User,
  ): Promise<Response | null> {
    if (path === "/profile/class" && method === "POST") {
      if (!/^\d{9,12}(?:-\d)?$/.test(u.student_id))
        fail(400, "กรอกรหัสนักศึกษาก่อนเข้าห้องเรียน");
      if (u.role !== "student") fail(403, "สำหรับนักศึกษาเท่านั้น");
      const c = await this.s.first<ClassRow>(
        "SELECT * FROM classes WHERE code=? AND archived=0",
        str(body.code).toUpperCase(),
      );
      if (!c)
        throw new ClassroomError(400, "รหัสห้องไม่ถูกต้องหรือห้องปิดแล้ว");
      await this.setClass(u.id, c.id);
      return json({
        user: await this.userJson({ ...u, class_id: c.id, section: c.name }),
      });
    }
    const studentProject = /^\/projects\/(\d+)\/submit$/.exec(path);
    if (path === "/projects" || studentProject) {
      if (u.role !== "student") fail(403, "สำหรับนักศึกษาเท่านั้น");
      if (
        !/^\d{9,12}(?:-\d)?$/.test(u.student_id) ||
        u.class_id == null ||
        (await this.class(u.class_id)).archived
      )
        return json({ error: "กรุณาเข้าห้องเรียนก่อน", needsClass: true }, 403);
      if (path === "/projects" && method === "GET")
        return json({ projects: await this.projects(u.id, u.class_id) });
      if (studentProject && method === "POST") {
        const id = Number(studentProject[1]),
          p = await this.s.first<Project>(
            "SELECT * FROM projects WHERE id=? AND class_id=?",
            id,
            u.class_id,
          );
        if (!p) throw new ClassroomError(404, "ไม่พบงานนี้ในห้องของคุณ");
        const b = body.board as { parts?: unknown; wires?: unknown } | null;
        if (!validSubmissionBoard(b)) fail(400, "ข้อมูลบอร์ดไม่ถูกต้อง");
        if (
          typeof body.code !== "string" ||
          body.code.length > 200000 ||
          str(body.note).length > 1000
        )
          fail(400, "โค้ดหรือข้อความยาวเกินไป");
        if (!(b!.parts as unknown[]).length && !str(body.code))
          fail(400, "ยังไม่มีบอร์ดหรือโค้ดที่จะส่ง");
        const r = await this.s
          .stmt(
            `INSERT INTO submissions(project_id,user_id,name,board,code,note,submitted_at) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(project_id,user_id) DO UPDATE SET name=excluded.name,board=excluded.board,code=excluded.code,note=excluded.note,submitted_at=excluded.submitted_at WHERE submissions.graded_at IS NULL`,
            id,
            u.id,
            str(body.name).slice(0, 60) || p.title,
            JSON.stringify(b),
            body.code,
            str(body.note),
            Date.now(),
          )
          .run();
        if (!r.meta.changes) fail(409, "อาจารย์ตรวจงานนี้แล้ว ส่งใหม่ไม่ได้");
        return json({
          project: (await this.projects(u.id, u.class_id)).find(
            (p) => p.id === id,
          ),
        });
      }
    }
    if (!path.startsWith("/teacher/")) return null;
    if (u.role !== "teacher") fail(403, "สำหรับอาจารย์เท่านั้น");
    if (path === "/teacher/classes" && method === "GET")
      return json({ classes: await this.classes() });
    if (path === "/teacher/classes" && method === "POST") {
      const c = await this.create(
        str(body.name),
        Number(body.year),
        Number(body.term),
      );
      await this.audit(u, "สร้างห้อง", classLabel(c));
      return json({ class: c }, 201);
    }
    const cm = /^\/teacher\/classes\/(\d+)(?:\/(roster|assignments))?$/.exec(
      path,
    );
    if (cm) {
      const id = Number(cm[1]),
        c = await this.class(id);
      if (cm[2] === "roster" && method === "POST") {
        if (c.archived) fail(409, "ห้องเรียนปิดแล้ว");
        if (typeof body.text !== "string" || body.text.length > 100000)
          fail(400, "รายชื่อไม่ถูกต้องหรือยาวเกินไป");
        const out = {
            moved: [] as string[],
            already: 0,
            pending: 0,
            invalid: [] as string[],
          },
          stmts: D1PreparedStatement[] = [];
        const ids = [
          ...new Set(
            str(body.text)
              .split(/[\s,;]+/)
              .filter(Boolean)
              .map((x) =>
                x.includes("@") ? x.toLowerCase() : x.replace(/-/g, ""),
              ),
          ),
        ];
        if (ids.length > 500) fail(400, "เพิ่มได้ครั้งละไม่เกิน 500 คน");
        const users = await this.s.all<
          Pick<User, "id" | "student_id" | "email" | "class_id">
        >(
          "SELECT id,student_id,email,class_id FROM users WHERE role='student'",
        );
        const byIdent = new Map<string, (typeof users)[number]>();
        users.forEach((user) => {
          byIdent.set(user.student_id.replace(/-/g, ""), user);
          if (user.email) byIdent.set(user.email.toLowerCase(), user);
        });
        const moved = new Set<number>(),
          claimed: string[] = [],
          pending: string[] = [];
        for (const ident of ids) {
          if (!/^\d{9,13}$/.test(ident) && !/^\S+@\S+\.\S+$/.test(ident)) {
            out.invalid.push(ident);
            continue;
          }
          const user = byIdent.get(ident);
          if (user) {
            if (user.class_id === id || moved.has(user.id)) out.already++;
            else {
              moved.add(user.id);
              out.moved.push(user.student_id);
            }
            claimed.push(ident);
          } else pending.push(ident);
        }
        out.pending = pending.length;
        const movedIds = [...moved];
        for (let i = 0; i < movedIds.length; i += 80) {
          const chunk = movedIds.slice(i, i + 80);
          stmts.push(
            this.s.stmt(
              `UPDATE users SET class_id=?,section=? WHERE id IN (${chunk.map(() => "?").join(",")})`,
              id,
              c.name,
              ...chunk,
            ),
          );
        }
        for (let i = 0; i < claimed.length; i += 80) {
          const chunk = claimed.slice(i, i + 80);
          stmts.push(
            this.s.stmt(
              `DELETE FROM roster WHERE ident IN (${chunk.map(() => "?").join(",")})`,
              ...chunk,
            ),
          );
        }
        for (let i = 0; i < pending.length; i += 30) {
          const chunk = pending.slice(i, i + 30);
          stmts.push(
            this.s.stmt(
              `INSERT INTO roster(ident,class_id,added_at) VALUES ${chunk.map(() => "(?,?,?)").join(",")} ON CONFLICT(ident) DO UPDATE SET class_id=excluded.class_id,added_at=excluded.added_at`,
              ...chunk.flatMap((ident) => [ident, id, Date.now()]),
            ),
          );
        }
        if (stmts.length) await this.s.db.batch(stmts);
        await this.audit(
          u,
          "เพิ่มรายชื่อ",
          `${classLabel(c)} · ย้าย ${out.moved.length} รอ ${out.pending}`,
        );
        return json(out);
      }
      if (cm[2] === "assignments") {
        if (method === "GET")
          return json({ assignments: await this.assignments(id) });
        if (method === "PUT") {
          if (c.archived) fail(409, "ห้องเรียนปิดแล้ว");
          if (!Array.isArray(body.assignments) || body.assignments.length > 200)
            fail(400, "รายการงานไม่ถูกต้อง");
          const published = new Set(
            (
              await this.s.all<{ id: number }>(
                "SELECT id FROM problems WHERE published=1",
              )
            ).map((p) => p.id),
          );
          const seen = new Set<number>(),
            values: unknown[][] = [],
            stmts = [
              this.s.stmt("DELETE FROM assignments WHERE class_id=?", id),
            ];
          for (const a of body.assignments as {
            problemId?: unknown;
            dueAt?: unknown;
          }[]) {
            const pid = Number(a?.problemId),
              due = dateValue(a?.dueAt);
            if (!published.has(pid) || !due || seen.has(pid))
              fail(400, "โจทย์ต้องเผยแพร่ มีวันส่ง และไม่ซ้ำกัน");
            seen.add(pid);
            values.push([id, pid, due]);
          }
          for (let i = 0; i < values.length; i += 30) {
            const chunk = values.slice(i, i + 30);
            stmts.push(
              this.s.stmt(
                `INSERT INTO assignments VALUES ${chunk.map(() => "(?,?,?)").join(",")}`,
                ...chunk.flat(),
              ),
            );
          }
          await this.s.db.batch(stmts);
          await this.audit(
            u,
            "มอบหมายโจทย์",
            `${classLabel(c)} · ${seen.size} ข้อ`,
          );
          return json({ assignments: await this.assignments(id) });
        }
      }
      if (!cm[2] && method === "DELETE") {
        const used = await this.s.first(
          "SELECT id FROM users WHERE class_id=? UNION ALL SELECT id FROM projects WHERE class_id=? LIMIT 1",
          id,
          id,
        );
        if (used)
          fail(
            409,
            "ห้องมีนักศึกษาหรืองานโปรเจกต์อยู่ ให้ปิดห้องเพื่อเก็บประวัติและคะแนน",
          );
        await this.s.stmt("DELETE FROM classes WHERE id=?", id).run();
        await this.audit(u, "ลบห้อง", classLabel(c));
        return json({ ok: true, wiped: 0 });
      }
      if (!cm[2] && method === "PATCH") {
        const name = body.name === undefined ? c.name : str(body.name),
          year = body.year === undefined ? c.year : Number(body.year),
          term = body.term === undefined ? c.term : Number(body.term);
        if (
          !name ||
          name.length > 40 ||
          !Number.isInteger(year) ||
          year < 2500 ||
          year > 2700 ||
          ![1, 2, 3].includes(term)
        )
          fail(400, "ข้อมูลห้องไม่ถูกต้อง");
        if (
          await this.s.first(
            "SELECT id FROM classes WHERE name=? AND year=? AND term=? AND id<>?",
            name,
            year,
            term,
            id,
          )
        )
          fail(409, "มีห้องชื่อนี้ในภาคเรียนนี้แล้ว");
        const code = body.newCode === true ? this.code() : c.code,
          archived =
            typeof body.archived === "boolean" ? +body.archived : c.archived;
        await this.s.db.batch([
          this.s.stmt(
            "UPDATE classes SET name=?,year=?,term=?,archived=?,code=? WHERE id=?",
            name,
            year,
            term,
            archived,
            code,
            id,
          ),
          this.s.stmt("UPDATE users SET section=? WHERE class_id=?", name, id),
        ]);
        await this.audit(
          u,
          archived ? "ปิดห้อง" : "แก้ไขห้อง",
          `${name} · ${term}/${year}`,
        );
        return json({ class: (await this.classes()).find((c) => c.id === id) });
      }
    }
    if (path === "/teacher/audit" && method === "GET")
      return json({
        log: await this.s.all(
          "SELECT at,actor,action,detail FROM audit ORDER BY id DESC LIMIT 100",
        ),
      });
    const progress = /^\/teacher\/users\/(\d+)\/progress$/.exec(path);
    if (progress && method === "GET") {
      const target = await this.s.first<User>(
        "SELECT * FROM users WHERE id=?",
        Number(progress[1]),
      );
      if (!target) throw new ClassroomError(404, "ไม่พบนักศึกษา");
      return json({
        user: await this.userJson(target),
        problems: await this.progress(target),
      });
    }
    if (path === "/teacher/stats" && method === "POST") {
      if (
        !Array.isArray(body.ids) ||
        body.ids.length > 1000 ||
        !body.ids.every((x) => Number.isSafeInteger(x) && x > 0)
      )
        fail(400, "รายชื่อนักศึกษาไม่ถูกต้อง");
      const ids = new Set(body.ids as number[]),
        students = (
          await this.s.all<{ id: number }>(
            "SELECT id FROM users WHERE role='student'",
          )
        ).filter((x) => ids.has(x.id)),
        ps = await this.s.problems(u);
      const activity = await this.s.all<{
          problem_id: number;
          user_id: number;
        }>(
          "SELECT DISTINCT problem_id,user_id FROM attempts UNION SELECT problem_id,user_id FROM solves",
        ),
        solves = await this.s.all<{ problem_id: number; user_id: number }>(
          "SELECT problem_id,user_id FROM solves",
        );
      const selected = new Set(students.map((s) => s.id));
      return json({
        students: students.length,
        problems: ps.map((r) => {
          const p = this.s.parse(r);
          return {
            id: r.id,
            title: p.title,
            level: p.level,
            attempted: activity.filter(
              (a) => a.problem_id === r.id && selected.has(a.user_id),
            ).length,
            solved: solves.filter(
              (a) => a.problem_id === r.id && selected.has(a.user_id),
            ).length,
          };
        }),
      });
    }
    const project = /^\/teacher\/projects(?:\/(\d+)(\/submissions)?)?$/.exec(
      path,
    );
    if (project) {
      const id = Number(project[1]);
      if (!id && method === "GET")
        return json({ projects: await this.projects() });
      const old = id
        ? await this.s.first<Project>("SELECT * FROM projects WHERE id=?", id)
        : null;
      if (id && !old) throw new ClassroomError(404, "ไม่พบงานโปรเจกต์");
      if (project[2] && method === "GET") {
        const rows = await this.s.all<
          Submission & { uid: number; uname: string; student_id: string }
        >(
          `SELECT s.*,u.id uid,u.name uname,u.student_id FROM users u LEFT JOIN submissions s ON s.user_id=u.id AND s.project_id=? WHERE u.role='student' AND (u.class_id=? OR s.id IS NOT NULL) ORDER BY u.student_id`,
          id,
          old!.class_id,
        );
        return json({
          project: projectJson(old!),
          rows: rows.map((r) => ({
            user: { id: r.uid, name: r.uname, studentId: r.student_id },
            submission: r.id ? summary(r, old!.due_at) : null,
          })),
        });
      }
      if (
        (!id && method === "POST") ||
        (id && !project[2] && method === "PATCH")
      ) {
        const cid = old?.class_id ?? Number(body.classId);
        await this.class(cid, true);
        const title =
            body.title === undefined ? (old?.title ?? "") : str(body.title),
          detail =
            body.detail === undefined ? (old?.detail ?? "") : str(body.detail),
          due =
            body.dueAt === undefined
              ? (old?.due_at ?? null)
              : dateValue(body.dueAt);
        if (!title || title.length > 120 || detail.length > 10000)
          fail(400, "ชื่อหรือรายละเอียดงานไม่ถูกต้อง");
        const r = id
          ? await this.s
              .stmt(
                "UPDATE projects SET title=?,detail=?,due_at=? WHERE id=?",
                title,
                detail,
                due,
                id,
              )
              .run()
          : await this.s
              .stmt(
                "INSERT INTO projects(class_id,title,detail,due_at,created_at) VALUES(?,?,?,?,?)",
                cid,
                title,
                detail,
                due,
                Date.now(),
              )
              .run();
        const pid = id || r.meta.last_row_id;
        await this.audit(u, "สั่งงานโปรเจกต์", title);
        return json(
          { project: (await this.projects()).find((p) => p.id === pid) },
          id ? 200 : 201,
        );
      }
      if (id && !project[2] && method === "DELETE") {
        await this.s.stmt("DELETE FROM projects WHERE id=?", id).run();
        await this.audit(u, "ลบงานโปรเจกต์", old!.title);
        return json({ ok: true });
      }
    }
    const sub = /^\/teacher\/submissions\/(\d+)$/.exec(path);
    if (sub) {
      const id = Number(sub[1]);
      await this.submission(id);
      if (method === "GET")
        return json({ submission: await this.submission(id) });
      if (method === "PATCH") {
        const score = body.score == null ? null : Number(body.score),
          feedback = str(body.feedback);
        if (
          (score !== null &&
            (!Number.isFinite(score) || score < 0 || score > 1000)) ||
          feedback.length > 2000
        )
          fail(400, "คะแนนต้องเป็น 0–1000 และความเห็นไม่เกิน 2000 ตัวอักษร");
        await this.s
          .stmt(
            "UPDATE submissions SET score=?,feedback=?,graded_at=? WHERE id=?",
            score,
            feedback || null,
            score === null && !feedback ? null : Date.now(),
            id,
          )
          .run();
        await this.audit(u, "ให้คะแนนโปรเจกต์", `งาน #${id} · ${score ?? "—"}`);
        return json({ submission: await this.submission(id) });
      }
    }
    return null;
  }
}
