import {
  publicProblem,
  FIRST_TRY_BONUS,
  type Problem,
} from "../src/data/problems";
import { DAY, periodStart, pointsFor, studentYear } from "./domain";
import { digest, randomToken } from "./password";
export interface User {
  id: number;
  class_id: number | null;
  firebase_uid: string | null;
  student_id: string;
  name: string;
  section: string;
  role: "teacher" | "student";
  email: string | null;
  pw_hash: string;
  active: number;
  year_override: number | null;
  last_active: number | null;
}
export interface ProblemRow {
  id: number;
  body: string;
  published: number;
  section: string;
  due_at: number | null;
  created_by: number | null;
  updated_at: number;
}
export class Store {
  constructor(readonly db: D1Database) {}
  stmt(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args);
  }
  async all<T>(sql: string, ...args: unknown[]) {
    return (await this.stmt(sql, ...args).all<T>()).results;
  }
  async first<T>(sql: string, ...args: unknown[]) {
    return this.stmt(sql, ...args).first<T>();
  }
  async year() {
    return Number(
      (
        await this.first<{ value: string }>(
          "SELECT value FROM settings WHERE key='academicYear'",
        )
      )?.value ?? 2569,
    );
  }
  userJson(u: User, year: number) {
    return {
      id: u.id,
      classId: u.class_id,
      studentId: u.student_id,
      name: u.name,
      section: u.section,
      role: u.role,
      email: u.email,
      googleLinked: !!u.firebase_uid,
      hasPassword: !!u.pw_hash,
      active: !!u.active,
      year: studentYear(u.student_id, year, u.year_override),
      yearOverride: u.year_override,
      entryYear: /^\d{9,12}(?:-\d)?$/.test(u.student_id)
        ? 2500 + Number(u.student_id.slice(0, 2))
        : null,
      initials: u.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p.match(/[ก-ฮA-Za-z0-9]/)?.[0] ?? p[0] ?? "")
        .join("")
        .toUpperCase(),
    };
  }
  async session(u: User) {
    const token = randomToken();
    await this.stmt(
      "INSERT INTO sessions VALUES (?,?,?)",
      await digest(token),
      u.id,
      Date.now() + 7 * DAY,
    ).run();
    return token;
  }
  async sections() {
    return (
      await this.all<{ section: string }>(
        "SELECT DISTINCT section FROM users WHERE role='student' AND section<>'' ORDER BY section",
      )
    ).map((r) => r.section);
  }
  async problems(u: User) {
    return this.all<ProblemRow>(
      `SELECT * FROM problems ${u.role === "teacher" ? "" : "WHERE published=1 AND (section='' OR section=? OR id IN (SELECT problem_id FROM assignments WHERE class_id=?))"} ORDER BY id`,
      ...(u.role === "teacher" ? [] : [u.section, u.class_id ?? -1]),
    );
  }
  parse(r: ProblemRow): Problem {
    return { ...JSON.parse(r.body), id: r.id };
  }
  async problem(id: number, u: User) {
    const r = await this.first<ProblemRow>(
      "SELECT * FROM problems WHERE id=?",
      id,
    );
    return r &&
      (u.role === "teacher" ||
        (r.published &&
          (!r.section ||
            r.section === u.section ||
            !!(await this.first(
              "SELECT 1 FROM assignments WHERE class_id=? AND problem_id=?",
              u.class_id ?? -1,
              id,
            )))))
      ? r
      : null;
  }
  async status(uid: number) {
    const solves = await this.all<{ problem_id: number }>(
      "SELECT problem_id FROM solves WHERE user_id=?",
      uid,
    );
    const drafts = await this.all<{ problem_id: number }>(
      "SELECT problem_id FROM drafts WHERE user_id=?",
      uid,
    );
    const attempts = await this.all<{
      problem_id: number;
      passed: number;
      total: number;
    }>(
      "SELECT a.problem_id,a.passed,a.total FROM attempts a JOIN (SELECT MAX(id) id FROM attempts WHERE user_id=? GROUP BY problem_id) b ON a.id=b.id",
      uid,
    );
    const st = new Map<
      number,
      { st: string; passed?: number; total?: number }
    >();
    drafts.forEach((d) => st.set(d.problem_id, { st: "doing" }));
    attempts.forEach((a) =>
      st.set(a.problem_id, { st: "doing", passed: a.passed, total: a.total }),
    );
    solves.forEach((s) => st.set(s.problem_id, { st: "done" }));
    return st;
  }
  async potential(uid: number, p: Problem) {
    const row = await this.first<{ n: number }>(
      "SELECT COUNT(*) n FROM attempts WHERE user_id=? AND problem_id=? AND kind='submit'",
      uid,
      p.id,
    );
    const firstTry = row?.n === 0;
    return {
      points: pointsFor(p) + (firstTry ? FIRST_TRY_BONUS : 0),
      firstTry,
      revealed: false,
    };
  }
  async draft(uid: number, pid: number, code: string) {
    await this.stmt(
      "INSERT INTO drafts VALUES (?,?,?,?) ON CONFLICT(user_id,problem_id) DO UPDATE SET code=excluded.code,updated_at=excluded.updated_at",
      uid,
      pid,
      code,
      Date.now(),
    ).run();
  }
  async last(uid: number, pid: number) {
    const r = await this.first<{
      kind: string;
      passed: number;
      total: number;
      result: string;
      created_at: number;
    }>(
      "SELECT kind,passed,total,result,created_at FROM attempts WHERE user_id=? AND problem_id=? ORDER BY id DESC LIMIT 1",
      uid,
      pid,
    );
    return r ? { ...r, result: JSON.parse(r.result) } : null;
  }
  async detail(r: ProblemRow, u: User) {
    const p = this.parse(r),
      rows = await this.problems(u),
      idx = rows.findIndex((x) => x.id === r.id);
    return {
      problem: publicProblem(p),
      draft:
        (
          await this.first<{ code: string }>(
            "SELECT code FROM drafts WHERE user_id=? AND problem_id=?",
            u.id,
            r.id,
          )
        )?.code ?? null,
      status: (await this.status(u.id)).get(r.id)?.st ?? "todo",
      solved: await this.first(
        "SELECT * FROM solves WHERE user_id=? AND problem_id=?",
        u.id,
        r.id,
      ),
      revealed: false,
      potential: await this.potential(u.id, p),
      base: pointsFor(p),
      bonus: FIRST_TRY_BONUS,
      last: await this.last(u.id, r.id),
      prev: rows[idx - 1]?.id ?? null,
      next: rows[idx + 1]?.id ?? null,
      dueAt:
        (
          await this.first<{ due_at: number }>(
            "SELECT due_at FROM assignments WHERE class_id=? AND problem_id=?",
            u.class_id ?? -1,
            r.id,
          )
        )?.due_at ?? r.due_at,
    };
  }
  async ranking(
    from: number,
    to = Number.MAX_SAFE_INTEGER,
    section?: string,
    classId?: number,
  ) {
    const rows = await this.all<{
      id: number;
      name: string;
      section: string;
      points: number;
      passed: number;
      last: number;
    }>(
      `SELECT u.id,u.name,u.section,COALESCE(SUM(s.points),0) points,COUNT(s.problem_id) passed,COALESCE(MAX(s.solved_at),0) last FROM users u LEFT JOIN solves s ON s.user_id=u.id AND s.solved_at>=? AND s.solved_at<? WHERE u.role='student' AND u.active=1 ${classId !== undefined ? "AND u.class_id=?" : section !== undefined ? "AND u.section=?" : ""} GROUP BY u.id ORDER BY points DESC,passed DESC,last,u.id`,
      from,
      to,
      ...(classId !== undefined
        ? [classId]
        : section !== undefined
          ? [section]
          : []),
    );
    let rank = 0;
    return rows.map((r, i) => {
      if (
        !i ||
        r.points !== rows[i - 1].points ||
        r.passed !== rows[i - 1].passed
      )
        rank = i + 1;
      return { ...r, rank };
    });
  }
  async activity(uid: number) {
    const rows = await this.all<{ day: number }>(
      "SELECT DISTINCT CAST((created_at+25200000)/86400000 AS INTEGER) day FROM attempts WHERE user_id=? ORDER BY day DESC",
      uid,
    );
    const days = new Set(rows.map((r) => r.day));
    let d = Math.floor((Date.now() + 25200000) / DAY);
    if (!days.has(d)) d--;
    let streak = 0;
    while (days.has(d--)) streak++;
    const monday = Math.floor((periodStart("week") + 25200000) / DAY);
    return {
      streak,
      week: Array.from({ length: 7 }, (_, i) => days.has(monday + i)),
    };
  }
  async users() {
    const year = await this.year();
    const rows = await this.all<User & { points: number; passed: number }>(
      "SELECT u.*,COALESCE(SUM(s.points),0) points,COUNT(s.problem_id) passed FROM users u LEFT JOIN solves s ON s.user_id=u.id GROUP BY u.id ORDER BY u.student_id",
    );
    return rows.map((u) => ({
      ...this.userJson(u, year),
      points: u.points,
      passed: u.passed,
      lastActive: u.last_active,
    }));
  }
}
