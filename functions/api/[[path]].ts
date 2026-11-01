import { FIRST_TRY_BONUS, type Problem } from "../../src/data/problems";
import { grade, runOnce, type GradeResult } from "../../src/lib/grader";
import { Store, type User, type ProblemRow } from "../../cloudflare/store";
import { checkPassword, digest, hashPassword } from "../../cloudflare/password";
import {
  DAY,
  periodStart,
  pointsFor,
  validateProblem,
} from "../../cloudflare/domain";
interface Env {
  DB: D1Database;
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const text = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const redact = (r: GradeResult): GradeResult => ({
  ...r,
  results: r.results.map((t) =>
    t.hidden
      ? {
          ok: t.ok,
          hidden: true,
          input: "เคสซ่อน",
          expected: "",
          got: "",
          msg: t.ok ? undefined : "ไม่ผ่านเคสซ่อน",
        }
      : t,
  ),
});
async function route(request: Request, env: Env): Promise<Response> {
  const s = new Store(env.DB),
    url = new URL(request.url),
    path = url.pathname.replace(/^\/api/, "").replace(/\/$/, ""),
    method = request.method;
  let body: Record<string, unknown> = {};
  if (!["GET", "HEAD"].includes(method)) {
    if (Number(request.headers.get("content-length") ?? 0) > 200000)
      fail(413, "ข้อมูลใหญ่เกินไป");
    const raw = await request.text();
    if (raw.length > 200000) fail(413, "ข้อมูลใหญ่เกินไป");
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      fail(400, "JSON ไม่ถูกต้อง");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail(400, "ข้อมูลไม่ถูกต้อง");
  }
  if (path === "/health" && method === "GET") {
    await s.first("SELECT 1");
    return json({ ok: true, database: "D1" });
  }
  if (path === "/auth/config" && method === "GET")
    return json({
      googleClientId: null,
      googleDomain: null,
      devLogin: false,
      passwordLogin: true,
    });
  if (path === "/auth/password" && method === "POST") {
    const username = text(body.username, 64).toLowerCase(),
      password = typeof body.password === "string" ? body.password : "";
    const key = await digest(
        `${request.headers.get("cf-connecting-ip") ?? "local"}|${username}`,
      ),
      now = Date.now();
    const locked = await s.first<{ failures: number; until_at: number }>(
      "SELECT * FROM login_limits WHERE key=?",
      key,
    );
    if (locked && locked.failures >= 5 && locked.until_at > now)
      fail(429, "ใส่รหัสผิดหลายครั้ง ลองใหม่ใน 10 นาที");
    const u = await s.first<User>(
      "SELECT * FROM users WHERE student_id=? AND active=1",
      username,
    );
    if (!u || !(await checkPassword(password, u.pw_hash))) {
      await s
        .stmt(
          "INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_at>? THEN failures+1 ELSE 1 END,until_at=excluded.until_at",
          key,
          now + 600000,
          now,
        )
        .run();
      return json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
    }
    await env.DB.batch([
      s.stmt("DELETE FROM login_limits WHERE key=?", key),
      s.stmt("DELETE FROM login_limits WHERE until_at<?", now),
      s.stmt("DELETE FROM sessions WHERE expires_at<?", now),
    ]);
    return json({
      token: await s.session(u),
      user: s.userJson(u, await s.year()),
      created: false,
    });
  }
  if (path.startsWith("/auth/") && path !== "/auth/logout")
    fail(404, "ยังไม่เปิดวิธีเข้าสู่ระบบนี้");
  const token = /^Bearer ([a-f0-9]{64})$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  const tokenHash = token ? await digest(token) : "";
  const user = token
    ? await s.first<User>(
        "SELECT u.* FROM users u JOIN sessions t ON t.user_id=u.id WHERE t.token_hash=? AND t.expires_at>? AND u.active=1",
        tokenHash,
        Date.now(),
      )
    : null;
  if (!user) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
  const u = user;
  if (!u.last_active || Date.now() - u.last_active > 60000)
    await s
      .stmt("UPDATE users SET last_active=? WHERE id=?", Date.now(), u.id)
      .run();
  const teacher = () => {
    if (u.role !== "teacher") fail(403, "สำหรับอาจารย์เท่านั้น");
  };
  if (path === "/auth/logout" && method === "POST") {
    await s.stmt("DELETE FROM sessions WHERE token_hash=?", tokenHash).run();
    return json({ ok: true });
  }
  if (path === "/profile" && method === "GET")
    return json({
      user: s.userJson(u, await s.year()),
      sections: await s.sections(),
    });
  if (path === "/profile" && method === "PUT") {
    const name = text(body.name, 80);
    if (!name) fail(400, "กรอกชื่อ");
    if (body.studentId !== undefined && body.studentId !== u.student_id)
      fail(403, "ติดต่ออาจารย์เพื่อแก้รหัสนักศึกษาหรือชื่อผู้ใช้");
    if (body.section !== undefined && body.section !== u.section)
      fail(403, "ติดต่ออาจารย์เพื่อย้ายกลุ่มเรียน");
    await s.stmt("UPDATE users SET name=? WHERE id=?", name, u.id).run();
    return json({ user: s.userJson({ ...u, name }, await s.year()) });
  }
  if (path === "/profile/password" && method === "PUT") {
    if (!(await checkPassword(String(body.current ?? ""), u.pw_hash)))
      fail(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");
    const hash = await hashPassword(String(body.next ?? ""));
    await env.DB.batch([
      s.stmt("UPDATE users SET pw_hash=? WHERE id=?", hash, u.id),
      s.stmt(
        "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
        u.id,
        tokenHash,
      ),
    ]);
    return json({ ok: true });
  }
  if (path.startsWith("/teacher/")) {
    teacher();
    if (path === "/teacher/users" && method === "GET")
      return json({
        users: await s.users(),
        sections: await s.sections(),
        academicYear: await s.year(),
      });
    if (path === "/teacher/settings" && method === "PUT") {
      const year = Number(body.academicYear);
      if (!Number.isInteger(year) || year < 2500 || year > 2700)
        fail(400, "ปีการศึกษาไม่ถูกต้อง");
      await s
        .stmt(
          "UPDATE settings SET value=? WHERE key='academicYear'",
          String(year),
        )
        .run();
      return json({ ok: true });
    }
    if (
      ["/teacher/students", "/teacher/teachers"].includes(path) &&
      method === "POST"
    ) {
      const role = path.endsWith("teachers") ? "teacher" : "student",
        id = text(body.studentId ?? body.username, 64).toLowerCase(),
        name = text(body.name, 80),
        section = role === "teacher" ? "" : text(body.section, 40);
      if (
        !name ||
        (role === "teacher"
          ? !/^[a-z0-9._-]{3,32}$/.test(id)
          : !/^\d{9,12}(?:-\d)?$/.test(id))
      )
        fail(
          400,
          "ชื่อหรือรหัสไม่ถูกต้อง (รหัสนักศึกษา 9–12 หลัก อนุญาต -เลขตรวจสอบ)",
        );
      const hash = await hashPassword(String(body.password ?? ""));
      if (await s.first("SELECT id FROM users WHERE student_id=?", id))
        fail(409, "รหัสหรือชื่อผู้ใช้นี้มีอยู่แล้ว");
      const r = await s
        .stmt(
          "INSERT INTO users (student_id,name,section,role,pw_hash,created_at) VALUES (?,?,?,?,?,?)",
          id,
          name,
          section,
          role,
          hash,
          Date.now(),
        )
        .run();
      const row = (await s.first<User>(
        "SELECT * FROM users WHERE id=?",
        r.meta.last_row_id,
      ))!;
      return json(
        {
          user: {
            ...s.userJson(row, await s.year()),
            points: 0,
            passed: 0,
            lastActive: null,
          },
        },
        201,
      );
    }
    const match = /^\/teacher\/users\/(\d+)(\/report)?$/.exec(path);
    if (match) {
      const target = await s.first<User>(
        "SELECT * FROM users WHERE id=?",
        Number(match[1]),
      );
      if (!target) fail(404, "ไม่พบบัญชี");
      if (match[2] && method === "GET") {
        const attempts = await s.all<{ result: string }>(
          "SELECT id,problem_id,kind,passed,total,code,result,created_at FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 200",
          target!.id,
        );
        return json({
          user: s.userJson(target!, await s.year()),
          solves: await s.all(
            "SELECT * FROM solves WHERE user_id=? ORDER BY problem_id",
            target!.id,
          ),
          attempts: attempts.map((a) => ({
            ...a,
            result: JSON.parse(a.result),
          })),
        });
      }
      if (!match[2] && method === "PATCH") {
        const t = target!,
          name = body.name === undefined ? t.name : text(body.name, 80),
          id =
            body.studentId === undefined
              ? t.student_id
              : text(body.studentId, 64).toLowerCase(),
          section =
            body.section === undefined ? t.section : text(body.section, 40),
          active = body.active === undefined ? t.active : +!!body.active;
        const override =
          body.yearOverride === undefined
            ? t.year_override
            : body.yearOverride === null
              ? null
              : Number(body.yearOverride);
        if (
          !name ||
          (t.role === "student"
            ? !/^\d{9,12}(?:-\d)?$/.test(id)
            : !/^[a-z0-9._-]{3,32}$/.test(id)) ||
          (override !== null &&
            (!Number.isInteger(override) || override < 1 || override > 20))
        )
          fail(400, "ข้อมูลบัญชีไม่ถูกต้อง");
        if (t.id === u.id && !active)
          fail(400, "ปิดบัญชีที่กำลังใช้อยู่ไม่ได้");
        if (
          t.role === "teacher" &&
          !active &&
          !(await s.first(
            "SELECT id FROM users WHERE role='teacher' AND active=1 AND id<>?",
            t.id,
          ))
        )
          fail(400, "ต้องมีอาจารย์อย่างน้อยหนึ่งบัญชี");
        if (
          await s.first(
            "SELECT id FROM users WHERE student_id=? AND id<>?",
            id,
            t.id,
          )
        )
          fail(409, "รหัสซ้ำ");
        const hash =
          body.password === undefined
            ? t.pw_hash
            : await hashPassword(String(body.password));
        await env.DB.batch([
          s.stmt(
            "UPDATE users SET name=?,student_id=?,section=?,active=?,year_override=?,pw_hash=? WHERE id=?",
            name,
            id,
            section,
            active,
            override,
            hash,
            t.id,
          ),
          ...(body.password !== undefined || !active
            ? [s.stmt("DELETE FROM sessions WHERE user_id=?", t.id)]
            : []),
        ]);
        return json({
          user: s.userJson(
            {
              ...t,
              name,
              student_id: id,
              section,
              active,
              year_override: override,
            },
            await s.year(),
          ),
        });
      }
    }
    if (path === "/teacher/problems" && method === "GET") {
      const rows = await s.problems(u);
      return json({
        problems: rows.map((r) => ({
          problem: s.parse(r),
          published: !!r.published,
          section: r.section,
          dueAt: r.due_at,
        })),
        sections: await s.sections(),
      });
    }
    if (
      (path === "/teacher/problems" && method === "POST") ||
      (/^\/teacher\/problems\/\d+$/.test(path) && method === "PUT")
    ) {
      const id = Number(path.split("/")[3]),
        old = id
          ? await s.first<ProblemRow>("SELECT * FROM problems WHERE id=?", id)
          : null;
      if (id && !old) fail(404, "ไม่พบโจทย์");
      const p = validateProblem(body.problem),
        section = text(body.section, 40),
        published = body.published === true ? 1 : 0;
      const due =
        body.dueAt == null || body.dueAt === "" ? null : Number(body.dueAt);
      if (due !== null && (!Number.isSafeInteger(due) || due < 0))
        fail(400, "วันส่งไม่ถูกต้อง");
      if (
        old &&
        (await s.first(
          "SELECT a.id FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.problem_id=? AND u.role='student' LIMIT 1",
          id,
        ))
      ) {
        const before = s.parse(old);
        const stable = (x: Problem) =>
          JSON.stringify([
            x.kind,
            x.fn,
            x.params,
            x.returns,
            x.tests,
            x.allowedRegs,
            x.mustUse,
            x.port,
            pointsFor(x),
          ]);
        if (stable(before) !== stable(p))
          fail(
            409,
            "มีนักศึกษาทำแล้ว เปลี่ยนภาษา เคส เกณฑ์ หรือคะแนนไม่ได้ ให้สร้างโจทย์ใหม่",
          );
      }
      if (old)
        await s
          .stmt(
            "UPDATE problems SET body=?,section=?,published=?,due_at=?,updated_at=? WHERE id=?",
            JSON.stringify({ ...p, id }),
            section,
            published,
            due,
            Date.now(),
            id,
          )
          .run();
      else {
        const result = await s
          .stmt(
            "INSERT INTO problems (body,section,published,due_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            JSON.stringify(p),
            section,
            published,
            due,
            u.id,
            Date.now(),
            Date.now(),
          )
          .run();
        return json({ id: result.meta.last_row_id }, 201);
      }
      return json({ id });
    }
    if (path === "/teacher/overview" && method === "GET") {
      return json({
        academicYear: await s.year(),
        students: await s.users(),
        problems: await s
          .all<Record<string, unknown> & { body: string }>(
            "SELECT p.id,p.body,p.published,p.section,p.due_at,COUNT(DISTINCT a.user_id) attempted,COUNT(DISTINCT sv.user_id) solved FROM problems p LEFT JOIN attempts a ON a.problem_id=p.id AND a.user_id IN (SELECT id FROM users WHERE role='student') LEFT JOIN solves sv ON sv.problem_id=p.id GROUP BY p.id ORDER BY p.id",
          )
          .then((rows) =>
            rows.map((r) => ({
              ...r,
              body: undefined,
              title: JSON.parse(r.body).title,
            })),
          ),
      });
    }
    fail(404, "ไม่พบ API อาจารย์");
  }
  const rows = await s.problems(u),
    st = await s.status(u.id);
  if (path === "/problems" && method === "GET")
    return json({
      topics: ["ทั้งหมด", ...new Set(rows.map((r) => s.parse(r).topic))],
      problems: rows.map((r) => {
        const p = s.parse(r),
          status = st.get(p.id);
        return {
          id: p.id,
          title: p.title,
          sub: p.sub,
          level: p.level,
          topic: p.topic,
          kind: p.kind,
          points: pointsFor(p),
          status: status?.st ?? "todo",
          passed: status?.passed,
          total: status?.total,
        };
      }),
    });
  const pm =
    /^\/problems\/(\d+)(?:\/(draft|test|submit|try|answer|reveal))?$/.exec(
      path,
    );
  if (pm) {
    const row = await s.problem(Number(pm[1]), u);
    if (!row) fail(404, "ไม่พบโจทย์หรือไม่มีสิทธิ์เข้าถึงกลุ่มนี้");
    const r = row!,
      p = s.parse(r),
      action = pm[2];
    if (!action && method === "GET") return json(await s.detail(r, u));
    if (action === "answer" && method === "GET") {
      const solved = !!(await s.first(
        "SELECT 1 FROM solves WHERE user_id=? AND problem_id=?",
        u.id,
        p.id,
      ));
      if (!solved && u.role !== "teacher")
        return json(
          { error: "ดูเฉลยได้หลังจากส่งผ่านแล้ว", locked: true },
          403,
        );
      return json({
        id: p.id,
        title: p.title,
        kind: p.kind,
        fn: p.fn,
        params: p.params,
        answer: p.answer,
        sample: "args" in p.tests[0] ? p.tests[0].args : [],
        solved: true,
        revealedBeforeSolve: false,
        half: Math.floor(pointsFor(p) / 2),
        base: pointsFor(p),
      });
    }
    if (action === "reveal") fail(403, "ดูเฉลยได้หลังจากส่งผ่านแล้ว");
    if (action === "try" && method === "POST") {
      const args = body.args;
      if (
        !Array.isArray(args) ||
        args.length !== (p.kind === "z80" ? 0 : p.params.length) ||
        !args.every(
          (a) =>
            Number.isInteger(a) ||
            (Array.isArray(a) && a.length <= 64 && a.every(Number.isInteger)),
        )
      )
        fail(400, "ค่ารับเข้าไม่ถูกต้อง");
      // Custom runs never expose hidden tests; use only the instructor's reference on supplied input.
      const code = p.answer.code
          .find((c) => c.lang === p.kind)!
          .lines.join("\n"),
        result = runOnce(p, code, args as (number | number[])[]);
      return json({ expected: result.errors.length ? null : result.outputs });
    }
    if (["draft", "test", "submit"].includes(action)) {
      if (method !== (action === "draft" ? "PUT" : "POST"))
        fail(405, "วิธีเรียกไม่ถูกต้อง");
      if (typeof body.code !== "string" || body.code.length > 16000)
        fail(400, "โค้ดต้องไม่เกิน 16000 ตัว");
      const code = body.code as string;
      if (action === "draft") {
        await s.draft(u.id, p.id, code);
        return json({ ok: true, savedAt: Date.now() });
      }
      if (!code.trim()) fail(400, "ยังไม่มีโค้ด");
      if (
        action === "submit" &&
        u.role === "student" &&
        r.due_at &&
        Date.now() > r.due_at
      )
        fail(403, "เลยกำหนดส่งแล้ว ยังทดสอบและบันทึกร่างได้");
      const recent = await s.first<{ created_at: number }>(
        "SELECT created_at FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 1",
        u.id,
      );
      if (recent && Date.now() - recent.created_at < 1000)
        fail(429, "กรุณารอ 1 วินาทีก่อนตรวจอีกครั้ง");
      const result = redact(grade(p, code, action === "submit")),
        pass =
          !result.errors.length &&
          result.total > 0 &&
          result.passed === result.total;
      const now = Date.now();
      const statements = [];
      // A single D1 batch serializes first-try scoring, unique solve insertion and attempt recording.
      if (action === "submit" && pass && u.role === "student")
        statements.push(
          s.stmt(
            "INSERT OR IGNORE INTO solves (user_id,problem_id,points,first_try,solved_at) SELECT ?,?,?+CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE user_id=? AND problem_id=? AND kind='submit') THEN 0 ELSE ? END,CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE user_id=? AND problem_id=? AND kind='submit') THEN 0 ELSE 1 END,?",
            u.id,
            p.id,
            pointsFor(p),
            u.id,
            p.id,
            FIRST_TRY_BONUS,
            u.id,
            p.id,
            now,
          ),
        );
      statements.push(
        s.stmt(
          "INSERT INTO attempts (user_id,problem_id,kind,code,passed,total,result,created_at) VALUES (?,?,?,?,?,?,?,?)",
          u.id,
          p.id,
          action,
          code,
          result.passed,
          result.total,
          JSON.stringify(result),
          now,
        ),
        s.stmt(
          "INSERT INTO drafts VALUES (?,?,?,?) ON CONFLICT(user_id,problem_id) DO UPDATE SET code=excluded.code,updated_at=excluded.updated_at",
          u.id,
          p.id,
          code,
          now,
        ),
      );
      const batch = await env.DB.batch(statements);
      let awarded: number | null = null;
      if (statements.length === 3 && batch[0].meta.changes)
        awarded = (await s.first<{ points: number }>(
          "SELECT points FROM solves WHERE user_id=? AND problem_id=?",
          u.id,
          p.id,
        ))!.points;
      return json({
        ...result,
        kind: action,
        pass,
        awarded,
        alreadySolved: pass && action === "submit" && awarded === null,
      });
    }
  }
  if (path === "/me" && method === "GET") {
    const all = await s.ranking(0),
      week = await s.ranking(
        periodStart("week"),
        Number.MAX_SAFE_INTEGER,
        u.section,
      ),
      prev = await s.ranking(
        periodStart("week") - 7 * DAY,
        periodStart("week"),
        u.section,
      ),
      me = all.find((x) => x.id === u.id),
      rank = week.find((x) => x.id === u.id)?.rank ?? null,
      before = prev.find((x) => x.id === u.id)?.rank ?? null;
    const next = rows.find((r) => st.get(r.id)?.st !== "done"),
      last = await s.first<{
        problem_id: number;
        passed: number;
        total: number;
      }>(
        "SELECT problem_id,passed,total FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 1",
        u.id,
      ),
      cont =
        last &&
        rows.find(
          (r) => r.id === last.problem_id && st.get(r.id)?.st !== "done",
        );
    return json({
      user: s.userJson(u, await s.year()),
      points: me?.points ?? 0,
      passed: rows.filter((r) => st.get(r.id)?.st === "done").length,
      total: rows.length,
      ...(await s.activity(u.id)),
      rank,
      rankDelta: rank && before ? before - rank : null,
      continue: cont
        ? {
            id: cont.id,
            title: s.parse(cont).title,
            passed: last!.passed,
            total: last!.total,
            failing: null,
          }
        : null,
      next: next ? { id: next.id, title: s.parse(next).title } : null,
    });
  }
  if (path === "/leaderboard" && method === "GET") {
    const period = ["week", "month", "all"].includes(
        url.searchParams.get("period") ?? "",
      )
        ? url.searchParams.get("period")!
        : "week",
      scope = url.searchParams.get("scope") === "all" ? "all" : "section";
    const from = periodStart(period),
      section = scope === "section" ? u.section : undefined,
      rank = await s.ranking(from, Number.MAX_SAFE_INTEGER, section),
      me = rank.find((r) => r.id === u.id),
      above = me ? [...rank].reverse().find((r) => r.points > me.points) : null,
      next = rows.find((r) => st.get(r.id)?.st !== "done");
    const priorFrom =
        period === "week"
          ? from - 7 * DAY
          : period === "month"
            ? periodStart("month", from - DAY)
            : 0,
      priorTo = period === "all" ? Date.now() - 7 * DAY : from,
      before = (await s.ranking(priorFrom, priorTo, section)).find(
        (r) => r.id === u.id,
      );
    return json({
      period,
      scope,
      section: u.section,
      sections: await s.sections(),
      rows: rank.map((r) => ({
        ...r,
        initials: s.userJson({ ...u, name: r.name }, 0).initials,
        me: r.id === u.id,
      })),
      me: me
        ? {
            ...me,
            next: above
              ? {
                  rank: above.rank,
                  gap: above.points - me.points,
                  points: above.points,
                }
              : null,
            total: rows.length,
            ...(await s.activity(u.id)),
            rankDelta: before && before.points ? before.rank - me.rank : null,
            problem: next
              ? {
                  id: next.id,
                  title: s.parse(next).title,
                  points: (await s.potential(u.id, s.parse(next))).points,
                }
              : null,
          }
        : null,
    });
  }
  return fail(404, "ไม่พบ API นี้");
}
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await route(request, env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (
      e instanceof Error &&
      /^(รหัสผ่าน|ข้อมูลโจทย์|เลือกภาษา|กรอก |ชื่อฟังก์ชัน|ระดับความยาก|คะแนนต้อง|พารามิเตอร์|กำหนดผลลัพธ์|ต้องมี |ค่า hidden|เคส |พอร์ต |allowedRegs|เฉลยต้อง)/.test(
        e.message,
      )
    )
      return json({ error: e.message }, 400);
    console.error(
      "API request failed",
      request.method,
      new URL(request.url).pathname,
      e instanceof Error ? e.message : "unknown",
    );
    return json({ error: "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง" }, 500);
  }
};
