// MIPS Lab API server. In development Vite proxies /api here; in production
// this also serves the built front-end from dist/.

import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIRST_TRY_BONUS, POINTS, PROBLEMS, problemById, publicProblem, TOPICS, type Problem } from '../src/data/problems';
import { grade, runOnce, type GradeResult } from '../src/lib/grader';
import * as store from './db';
import { GoogleAuthError, verifyGoogleToken } from './google';

const app = express();
app.use(express.json({ limit: '200kb' }));

type Authed = Request & { user: store.User; token: string };

function auth(req: Request, res: Response, next: NextFunction) {
  const token = /^Bearer (\w+)$/.exec(req.get('authorization') ?? '')?.[1];
  const user = token ? store.userForToken(token) : null;
  if (!user) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
    return;
  }
  Object.assign(req, { user, token });
  next();
}

const wrap =
  (fn: (req: Authed, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      fn(req as Authed, res);
    } catch (e) {
      next(e);
    }
  };

function teacherOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as Authed).user.role !== 'teacher') {
    res.status(403).json({ error: 'หน้านี้สำหรับอาจารย์เท่านั้น' });
    return;
  }
  next();
}

const userJson = (u: store.User) => ({
  studentId: u.student_id,
  name: u.name,
  section: u.section,
  initials: store.initials(u.name),
  role: u.role,
  email: u.email,
});

/** Sends ProfileError as 400 with its message. */
function saveUser(res: Response, id: number, patch: store.ProfilePatch): store.User | null {
  try {
    return store.updateUser(id, patch);
  } catch (e) {
    if (!(e instanceof store.ProfileError)) throw e;
    res.status(400).json({ error: e.message });
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// ---------- auth ----------

app.post('/api/auth/logout', auth, wrap((req, res) => {
  store.logout(req.token);
  res.json({ ok: true });
}));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || null;
const GOOGLE_DOMAIN = process.env.MIPSLAB_GOOGLE_DOMAIN?.trim() || undefined;
// test login without Google: on under `npm run dev`, never under `npm start`
const DEV_LOGIN = process.env.npm_lifecycle_event === 'dev:api' || process.env.MIPSLAB_DEV_LOGIN === '1';

app.get('/api/auth/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID, googleDomain: GOOGLE_DOMAIN ?? null, devLogin: DEV_LOGIN });
});

app.post('/api/auth/dev', wrap((req, res) => {
  if (!DEV_LOGIN) {
    res.status(404).json({ error: 'ไม่พบ API นี้' });
    return;
  }
  const r = store.devLogin(req.body?.role === 'teacher' ? 'teacher' : 'student');
  res.json({ token: r.token, user: userJson(r.user), created: false });
}));

app.post('/api/auth/google', async (req, res, next) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      res.status(501).json({ error: 'ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID บนเซิร์ฟเวอร์' });
      return;
    }
    const credential = req.body?.credential;
    if (typeof credential !== 'string') {
      res.status(400).json({ error: 'ไม่ได้รับข้อมูลจาก Google' });
      return;
    }
    const profile = await verifyGoogleToken(credential, { clientId: GOOGLE_CLIENT_ID, domain: GOOGLE_DOMAIN });
    const r = store.googleLogin(profile);
    res.json({ token: r.token, user: userJson(r.user), created: r.created });
  } catch (e) {
    if (e instanceof GoogleAuthError) res.status(401).json({ error: e.message });
    else if (e instanceof store.ProfileError) res.status(403).json({ error: e.message });
    else next(e);
  }
});

// wrong passwords per ip+username: 5 tries, then locked for 10 minutes
const FAIL_LIMIT = 5;
const LOCK_MS = 10 * 60 * 1000;
const fails = new Map<string, { n: number; until: number }>();

app.post('/api/auth/password', wrap((req, res) => {
  const username = str(req.body?.username)?.trim().toLowerCase() ?? '';
  const password = str(req.body?.password) ?? '';
  if (!username || !password) {
    res.status(400).json({ error: 'กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน' });
    return;
  }
  const key = `${req.ip}|${username}`;
  const f = fails.get(key);
  if (f && f.n >= FAIL_LIMIT && f.until > Date.now()) {
    res.status(429).json({ error: `ใส่รหัสผิดหลายครั้ง ลองใหม่ในอีก ${Math.ceil((f.until - Date.now()) / 60000)} นาที` });
    return;
  }
  const r = store.passwordLogin(username, password);
  if (!r) {
    if (fails.size > 5000) for (const [k, v] of fails) if (v.until <= Date.now()) fails.delete(k);
    const n = (f && f.until > Date.now() ? f.n : 0) + 1;
    fails.set(key, { n, until: Date.now() + LOCK_MS });
    res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    return;
  }
  fails.delete(key);
  res.json({ token: r.token, user: userJson(r.user), created: false });
}));

// ---------- me ----------

app.get('/api/me', auth, wrap((req, res) => {
  const u = req.user;
  const all = store.ranking(0);
  const me = all.find((r) => r.id === u.id);
  const week = store.ranking(store.periodStart('week'), Infinity, u.section);
  const weekStart = store.periodStart('week');
  const lastWeek = store.ranking(weekStart - 7 * 24 * 3600 * 1000, weekStart, u.section);
  const rankNow = week.find((r) => r.id === u.id)?.rank ?? null;
  const rankBefore = lastWeek.find((r) => r.id === u.id)?.rank ?? null;

  // most recent unsolved problem the student touched
  const st = store.statuses(u.id);
  const last = store.db
    .prepare('SELECT problem_id FROM attempts WHERE user_id = ? ORDER BY id DESC')
    .all(u.id) as { problem_id: number }[];
  let cont = null;
  for (const { problem_id } of last) {
    if (st.get(problem_id)?.st === 'done') continue;
    const p = problemById(problem_id);
    const a = store.lastAttempt(u.id, problem_id);
    if (!p || !a) continue;
    const failed = (a.result as GradeResult).results?.find((r) => !r.ok && !r.hidden);
    cont = { id: p.id, title: p.title, passed: a.passed, total: a.total, failing: failed ? failed.input : null };
    break;
  }
  const next = PROBLEMS.find((p) => st.get(p.id)?.st !== 'done');
  res.json({
    user: userJson(u),
    points: me?.points ?? 0,
    passed: me?.passed ?? 0,
    total: PROBLEMS.length,
    streak: store.streak(u.id),
    rank: rankNow,
    rankDelta: rankNow && rankBefore ? rankBefore - rankNow : null,
    continue: cont,
    next: next ? { id: next.id, title: next.title } : null,
  });
}));

// ---------- profile ----------

app.get('/api/profile', auth, wrap((req, res) => {
  res.json({ user: userJson(req.user), sections: store.sections() });
}));

app.put('/api/profile', auth, wrap((req, res) => {
  const b = req.body ?? {};
  const patch: store.ProfilePatch = { name: str(b.name) };
  // students keep a real student id once they have one; only teachers change it after that
  const sid = str(b.studentId);
  if (sid !== undefined && sid.trim() !== req.user.student_id) {
    if (req.user.role !== 'teacher' && store.STUDENT_ID_RE.test(req.user.student_id)) {
      res.status(403).json({ error: 'ตั้งรหัสนักศึกษาแล้ว — ถ้าต้องการแก้ ติดต่ออาจารย์' });
      return;
    }
    patch.studentId = sid;
  }
  if (req.user.role === 'student') patch.section = str(b.section);
  const user = saveUser(res, req.user.id, patch);
  if (user) res.json({ user: userJson(user) });
}));

app.put('/api/profile/password', auth, teacherOnly, wrap((req, res) => {
  const current = str(req.body?.current) ?? '';
  const next = str(req.body?.next) ?? '';
  if (!store.verifyPassword(req.user.id, current)) {
    res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    return;
  }
  try {
    store.setPassword(req.user.id, next, req.token);
  } catch (e) {
    if (!(e instanceof store.ProfileError)) throw e;
    res.status(400).json({ error: e.message });
    return;
  }
  res.json({ ok: true });
}));

// ---------- teacher ----------

app.get('/api/teacher/users', auth, teacherOnly, wrap((_req, res) => {
  res.json({
    sections: store.sections(),
    users: store.listUsers().map((u) => ({ id: u.id, ...userJson(u), points: u.points, passed: u.passed, lastActive: u.last_active })),
  });
}));

app.patch('/api/teacher/users/:id', auth, teacherOnly, wrap((req, res) => {
  const id = Number(req.params.id);
  const target = store.userById(id);
  if (!target) {
    res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
    return;
  }
  const b = req.body ?? {};
  const password = str(b.password);
  if (password !== undefined) {
    if (target.role !== 'teacher') {
      res.status(400).json({ error: 'นักศึกษาเข้าด้วย Google ไม่มีรหัสผ่าน' });
      return;
    }
    try {
      store.setPassword(id, password, id === req.user.id ? req.token : undefined);
    } catch (e) {
      if (!(e instanceof store.ProfileError)) throw e;
      res.status(400).json({ error: e.message });
      return;
    }
  }
  const user = saveUser(res, id, { name: str(b.name), studentId: str(b.studentId), section: str(b.section) });
  if (user) res.json({ user: { id: user.id, ...userJson(user) } });
}));

app.post('/api/teacher/teachers', auth, teacherOnly, wrap((req, res) => {
  const b = req.body ?? {};
  try {
    const u = store.addTeacher(str(b.username) ?? '', str(b.name) ?? '', str(b.password) ?? '');
    res.json({ user: { id: u.id, ...userJson(u), points: 0, passed: 0, lastActive: null } });
  } catch (e) {
    if (!(e instanceof store.ProfileError)) throw e;
    res.status(400).json({ error: e.message });
  }
}));

// ---------- problems ----------

const summary =(p: Problem, s?: { st: store.Status; passed?: number; total?: number }) => ({
  id: p.id,
  title: p.title,
  sub: p.sub,
  level: p.level,
  topic: p.topic,
  kind: p.kind,
  points: POINTS[p.level],
  status: s?.st ?? 'todo',
  passed: s?.passed,
  total: s?.total,
});

app.get('/api/problems', auth, wrap((req, res) => {
  const st = store.statuses(req.user.id);
  res.json({ topics: TOPICS, problems: PROBLEMS.map((p) => summary(p, st.get(p.id))) });
}));

function getProblem(req: Request, res: Response): Problem | null {
  const p = problemById(Number(req.params.id));
  if (!p) res.status(404).json({ error: 'ไม่พบโจทย์ข้อนี้' });
  return p ?? null;
}

/** Hidden tests only show pass/fail, never their data. */
function redact(r: GradeResult): GradeResult {
  return {
    ...r,
    results: r.results.map((x) => (x.hidden ? { ok: x.ok, hidden: true, input: 'เคสซ่อน', expected: '', got: '', msg: x.ok ? undefined : 'ไม่ผ่านเคสซ่อน — ลองคิดกรณีขอบ' } : x)),
  };
}

app.get('/api/problems/:id', auth, wrap((req, res) => {
  const p = getProblem(req, res);
  if (!p) return;
  const uid = req.user.id;
  const solved = store.solve(uid, p.id);
  const idx = PROBLEMS.indexOf(p);
  res.json({
    problem: publicProblem(p),
    draft: store.draft(uid, p.id),
    status: store.statuses(uid).get(p.id)?.st ?? 'todo',
    solved: solved ?? null,
    revealed: store.isRevealed(uid, p.id),
    potential: store.pointsFor(uid, p.id),
    base: POINTS[p.level],
    bonus: FIRST_TRY_BONUS,
    last: store.lastAttempt(uid, p.id),
    prev: PROBLEMS[idx - 1]?.id ?? null,
    next: PROBLEMS[idx + 1]?.id ?? null,
  });
}));

app.put('/api/problems/:id/draft', auth, wrap((req, res) => {
  const p = getProblem(req, res);
  if (!p) return;
  const code = req.body?.code;
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'ไม่มีโค้ด' });
    return;
  }
  store.saveDraft(req.user.id, p.id, code);
  res.json({ ok: true, savedAt: Date.now() });
}));

function run(kind: 'test' | 'submit') {
  return wrap((req, res) => {
    const p = getProblem(req, res);
    if (!p) return;
    const code = req.body?.code;
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: 'ยังไม่มีโค้ด' });
      return;
    }
    const uid = req.user.id;
    store.saveDraft(uid, p.id, code);
    const result = redact(grade(p, code, kind === 'submit'));
    const pass = !result.errors.length && result.passed === result.total;
    let awarded: number | null = null;
    // points are computed before this attempt is recorded so the first submit counts as first try
    if (kind === 'submit' && pass) awarded = store.markSolved(uid, p.id);
    store.recordAttempt(uid, p.id, kind, result.passed, result.total, result);
    res.json({ ...result, kind, pass, awarded, alreadySolved: kind === 'submit' && pass && awarded == null });
  });
}
app.post('/api/problems/:id/test', auth, run('test'));
app.post('/api/problems/:id/submit', auth, run('submit'));

const isWord = (v: unknown) => Number.isInteger(v) && (v as number) >= -0x80000000 && (v as number) <= 0xffffffff;

/** "ลองรัน": what the answer key produces for the student's own input, so the page can say whether their output matches. */
app.post('/api/problems/:id/try', auth, wrap((req, res) => {
  const p = getProblem(req, res);
  if (!p) return;
  const args: unknown = req.body?.args;
  const ok =
    Array.isArray(args) &&
    args.length === (p.kind === 'z80' ? 0 : p.params.length) &&
    args.every((v) => isWord(v) || (Array.isArray(v) && v.length <= 64 && v.every(isWord)));
  if (!ok) {
    res.status(400).json({ error: 'ค่าที่ใส่ไม่ถูกต้อง' });
    return;
  }
  const key = p.answer.code.find((c) => c.lang === p.kind);
  if (!key) {
    res.json({ expected: null });
    return;
  }
  const r = runOnce(p, key.lines.join('\n'), args as (number | number[])[]);
  res.json({ expected: r.errors.length ? null : r.outputs });
}));

app.get('/api/problems/:id/answer', auth, wrap((req, res) => {
  const p = getProblem(req, res);
  if (!p) return;
  const uid = req.user.id;
  const solved = !!store.solve(uid, p.id) || req.user.role === 'teacher';
  if (!solved) {
    res.status(403).json({ error: 'ดูเฉลยได้หลังจากส่งผ่านข้อนี้แล้ว', locked: true });
    return;
  }
  const sample = (p.tests.find((t) => !t.hidden) as { args?: unknown[] } | undefined)?.args ?? [];
  res.json({ title: p.title, id: p.id, kind: p.kind, fn: p.fn, params: p.params, answer: p.answer, sample, solved, revealedBeforeSolve: !solved, half: Math.floor(POINTS[p.level] / 2), base: POINTS[p.level] });
}));

// revealing the answer before solving is no longer allowed; kept so old clients get a clear error
app.post('/api/problems/:id/reveal', auth, wrap((_req, res) => {
  res.status(403).json({ error: 'ดูเฉลยได้หลังจากส่งผ่านข้อนี้แล้ว', locked: true });
}));

// ---------- leaderboard ----------

app.get('/api/leaderboard', auth, wrap((req, res) => {
  const period = (['week', 'month', 'all'].includes(String(req.query.period)) ? req.query.period : 'week') as store.Period;
  const scope = req.query.scope === 'all' ? 'all' : 'section';
  const rows = store.ranking(store.periodStart(period), Infinity, scope === 'section' ? req.user.section : undefined);
  const meIdx = rows.findIndex((r) => r.id === req.user.id);
  const me = rows[meIdx];
  const above = me ? [...rows].reverse().find((r) => r.points > me.points) : undefined;
  const sections = (store.db.prepare("SELECT DISTINCT section FROM users WHERE role = 'student' ORDER BY section").all() as { section: string }[]).map(
    (r) => r.section,
  );
  const uid = req.user.id;
  const DAY = 24 * 3600 * 1000;
  const now = Date.now();
  const start = store.periodStart(period);

  // rank in the previous window of the same kind, to show ▲ / ▼
  const prevFrom = period === 'week' ? start - 7 * DAY : period === 'month' ? store.periodStart('month', new Date(start - DAY)) : 0;
  const prevTo = period === 'all' ? now - 7 * DAY : start;
  const before = store.ranking(prevFrom, prevTo, scope === 'section' ? req.user.section : undefined).find((r) => r.id === uid);
  const rankDelta = me && before && before.points > 0 ? before.rank - me.rank : null;

  const st = store.statuses(uid);
  const nextP = PROBLEMS.find((p) => st.get(p.id)?.st !== 'done');
  res.json({
    period,
    scope,
    section: req.user.section,
    sections,
    rows: rows.map((r) => ({ rank: r.rank, name: r.name, initials: store.initials(r.name), passed: r.passed, points: r.points, me: r.id === req.user.id })),
    me: me
      ? {
          rank: me.rank,
          points: me.points,
          passed: me.passed,
          next: above ? { rank: above.rank, gap: above.points - me.points, points: above.points } : null,
          total: PROBLEMS.length,
          streak: store.streak(uid),
          week: store.weekActivity(uid),
          rankDelta,
          problem: nextP ? { id: nextP.id, title: nextP.title, points: store.pointsFor(uid, nextP.id).points } : null,
        }
      : null,
  });
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'ไม่พบ API นี้' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  console.error(err);
  res.status(500).json({ error: 'เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง' });
});

// ---------- static front-end (production) ----------

const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`MIPS Lab API → http://localhost:${port}`);
  if (DEV_LOGIN) console.log('⚠ เปิดปุ่ม "เข้าแบบทดลอง" (dev) ในหน้าล็อกอิน — ใช้ตอนพัฒนาเท่านั้น');
  else if (!GOOGLE_CLIENT_ID) console.log('⚠ ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID ใน .env — จะยังล็อกอินไม่ได้');
  if (!store.userCount()) {
    console.log('ยังไม่มีผู้ใช้ — นักศึกษาล็อกอินด้วย Google แล้วระบบจะสร้างบัญชีให้เอง');
  }
  if (!store.teacherCount()) {
    console.log('ยังไม่มีบัญชีอาจารย์ — สร้างด้วย: npm run user -- teacher <ชื่อผู้ใช้> "<ชื่อ>"');
  }
});
