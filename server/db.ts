// SQLite storage (Node's built-in node:sqlite) plus the scoring / ranking queries.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FIRST_TRY_BONUS, POINTS, PROBLEMS, problemById } from '../src/data/problems';

const DB_PATH = resolve(process.env.MIPSLAB_DB ?? 'data/mipslab.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  passed INTEGER NOT NULL,
  total INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, created_at);
CREATE TABLE IF NOT EXISTS solves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  first_try INTEGER NOT NULL,
  revealed INTEGER NOT NULL,
  solved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE TABLE IF NOT EXISTS reveals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL,
  revealed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE TABLE IF NOT EXISTS reset_requests (
  id INTEGER PRIMARY KEY,
  student_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
`);

// columns added after the first release
const userCols = new Set((db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name));
if (!userCols.has('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!userCols.has('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email); CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub);');

// Students sign in with Google; teachers have a username (stored in student_id) and password.
export type Role = 'student' | 'teacher';

export interface User {
  id: number;
  student_id: string;
  name: string;
  section: string;
  role: Role;
  email: string | null;
}

// ---------- passwords (teachers) ----------

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}

function checkPassword(pw: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  return timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), want.length), want);
}

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 8;

// ---------- sessions ----------

const SESSION_MS = 30 * 24 * 3600 * 1000;

function newSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_MS);
  return token;
}

const USER_COLS = 'id, student_id, name, section, role, email';

/**
 * Signs in a verified Google account: matches by Google id, then by an email the
 * instructor linked, otherwise creates a new student. University addresses whose
 * local part is a student number (6601234567@…) use that number as the student id.
 */
export function googleLogin(g: { sub: string; email: string; name: string }): { token: string; user: User; created: boolean } {
  const email = g.email.toLowerCase();
  let user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE google_sub = ?`).get(g.sub) as User | undefined;
  let created = false;
  if (!user) {
    user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).get(email) as User | undefined;
    if (user) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, user.id);
  }
  if (!user) {
    const local = email.split('@')[0];
    const wanted = /^\d{6,}$/.test(local) ? local : email;
    const taken = !!db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(wanted);
    const studentId = taken ? email : wanted;
    db.prepare('INSERT INTO users (student_id, name, section, pw_hash, role, created_at, email, google_sub) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      studentId,
      g.name || local,
      process.env.MIPSLAB_DEFAULT_SECTION ?? '',
      '!google', // no password login for this account
      'student',
      Date.now(),
      email,
      g.sub,
    );
    user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE google_sub = ?`).get(g.sub) as User;
    created = true;
  }
  if (user.role === 'teacher') throw new ProfileError('บัญชีอาจารย์เข้าด้วยชื่อผู้ใช้และรหัสผ่าน');
  return { token: newSession(user.id), user, created };
}

/** Teacher sign-in. Returns null on a wrong username or password. */
export function passwordLogin(username: string, password: string): { token: string; user: User } | null {
  const row = db.prepare(`SELECT ${USER_COLS}, pw_hash FROM users WHERE student_id = ? AND role = 'teacher'`).get(username.trim().toLowerCase()) as
    | (User & { pw_hash: string })
    | undefined;
  if (!row || !checkPassword(password, row.pw_hash)) return null;
  const { pw_hash: _, ...user } = row;
  void _;
  return { token: newSession(user.id), user };
}

/** Creates a teacher account; throws ProfileError on bad input. */
export function addTeacher(username: string, name: string, password: string): User {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) throw new ProfileError('ชื่อผู้ใช้ต้องเป็น a–z, 0–9, . _ - ยาว 3–32 ตัว');
  if (db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(u)) throw new ProfileError('ชื่อผู้ใช้นี้มีคนใช้แล้ว');
  if (!name.trim()) throw new ProfileError('กรุณาใส่ชื่อ');
  if (password.length < MIN_PASSWORD) throw new ProfileError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`);
  db.prepare("INSERT INTO users (student_id, name, section, pw_hash, role, created_at) VALUES (?, ?, '', ?, 'teacher', ?)").run(
    u,
    name.trim(),
    hashPassword(password),
    Date.now(),
  );
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE student_id = ?`).get(u) as unknown as User;
}

/** Sets a teacher's password and signs out their other sessions (keepToken stays signed in). */
export function setPassword(id: number, password: string, keepToken?: string) {
  if (password.length < MIN_PASSWORD) throw new ProfileError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`);
  db.prepare("UPDATE users SET pw_hash = ? WHERE id = ? AND role = 'teacher'").run(hashPassword(password), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, keepToken ?? '');
}

export function verifyPassword(id: number, password: string): boolean {
  const row = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(id) as { pw_hash: string } | undefined;
  return !!row && checkPassword(password, row.pw_hash);
}

/** Development only: signs in a fixed test student (or teacher) without Google. */
export function devLogin(role: Role = 'student'): { token: string; user: User } {
  const sid = role === 'teacher' ? 'dev-teacher' : 'dev';
  const find = () => db.prepare(`SELECT ${USER_COLS} FROM users WHERE student_id = ?`).get(sid) as User | undefined;
  let user = find();
  if (!user) {
    if (role === 'teacher') addUser(sid, 'อาจารย์ทดสอบ (dev)', '', null, 'teacher');
    else addUser(sid, 'ผู้ทดสอบ (dev)', 'SEC 1', null);
    user = find()!;
  }
  return { token: newSession(user.id), user };
}

export function linkEmail(studentId: string, email: string): boolean {
  return Number(db.prepare('UPDATE users SET email = ? WHERE student_id = ?').run(email.toLowerCase(), studentId).changes) > 0;
}

export function setSection(studentId: string, section: string): boolean {
  return Number(db.prepare('UPDATE users SET section = ? WHERE student_id = ?').run(section, studentId).changes) > 0;
}

export function userForToken(token: string): User | null {
  const row = db
    .prepare('SELECT u.id, u.student_id, u.name, u.section, u.role, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?')
    .get(token, Date.now()) as User | undefined;
  return row ?? null;
}

export function userById(id: number): User | null {
  return (db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as User | undefined) ?? null;
}

// ---------- profile ----------

export class ProfileError extends Error {}

/** Student ids are digits, optionally with a dash before the check digit (e.g. 653040123-4). */
export const STUDENT_ID_RE = /^\d[\d-]{4,18}\d$/;

export interface ProfilePatch {
  name?: string;
  /** student id for students, username for teachers */
  studentId?: string;
  section?: string;
}

/** Validates and saves profile fields; throws ProfileError with a message for the user. */
export function updateUser(id: number, patch: ProfilePatch): User {
  const current = userById(id);
  if (!current) throw new ProfileError('ไม่พบบัญชีนี้');
  const teacher = current.role === 'teacher';
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new ProfileError('กรุณาใส่ชื่อ');
    if (name.length > 80) throw new ProfileError('ชื่อยาวเกิน 80 ตัวอักษร');
    sets.push('name = ?');
    vals.push(name);
  }
  if (patch.studentId !== undefined) {
    const sid = teacher ? patch.studentId.trim().toLowerCase() : patch.studentId.trim();
    if (teacher && !USERNAME_RE.test(sid)) throw new ProfileError('ชื่อผู้ใช้ต้องเป็น a–z, 0–9, . _ - ยาว 3–32 ตัว');
    if (!teacher && !STUDENT_ID_RE.test(sid)) throw new ProfileError('รหัสนักศึกษาต้องเป็นตัวเลข 6–20 หลัก (มีขีดได้ เช่น 653040123-4)');
    if (db.prepare('SELECT 1 FROM users WHERE student_id = ? AND id != ?').get(sid, id)) throw new ProfileError(teacher ? 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' : 'รหัสนี้มีคนใช้แล้ว');
    sets.push('student_id = ?');
    vals.push(sid);
  }
  if (patch.section !== undefined && !teacher) {
    const section = patch.section.trim();
    if (section.length > 40) throw new ProfileError('ชื่อกลุ่มยาวเกิน 40 ตัวอักษร');
    sets.push('section = ?');
    vals.push(section);
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return userById(id)!;
}

export function teacherCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND pw_hash LIKE 'scrypt$%'").get() as { n: number }).n;
}

export function sections(): string[] {
  return (db.prepare("SELECT DISTINCT section FROM users WHERE role = 'student' AND section != '' ORDER BY section").all() as { section: string }[]).map(
    (r) => r.section,
  );
}

export interface UserRow extends User {
  points: number;
  passed: number;
  last_active: number | null;
}

/** Everyone with their all-time score and last attempt, for the teacher page. */
export function listUsers(): UserRow[] {
  return db
    .prepare(
      `SELECT u.id, u.student_id, u.name, u.section, u.role, u.email,
              (SELECT COALESCE(SUM(points), 0) FROM solves WHERE user_id = u.id) AS points,
              (SELECT COUNT(*) FROM solves WHERE user_id = u.id) AS passed,
              (SELECT MAX(created_at) FROM attempts WHERE user_id = u.id) AS last_active
       FROM users u
       ORDER BY u.role DESC, u.section, u.student_id`,
    )
    .all() as unknown as UserRow[];
}

export function logout(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Pre-registers a student so their Google email lands on this student id and section. */
export function addUser(studentId: string, name: string, section: string, email: string | null, role: Role = 'student') {
  db.prepare('INSERT INTO users (student_id, name, section, pw_hash, role, created_at, email) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    studentId,
    name,
    section,
    '!google',
    role,
    Date.now(),
    email?.toLowerCase() ?? null,
  );
}

// ---------- problems ----------

export type Status = 'done' | 'doing' | 'todo';

export function draft(userId: number, pid: number): string | null {
  const r = db.prepare('SELECT code FROM drafts WHERE user_id = ? AND problem_id = ?').get(userId, pid) as { code: string } | undefined;
  return r?.code ?? null;
}

export function saveDraft(userId: number, pid: number, code: string) {
  db.prepare(
    'INSERT INTO drafts (user_id, problem_id, code, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, problem_id) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at',
  ).run(userId, pid, code, Date.now());
}

export function recordAttempt(userId: number, pid: number, kind: 'test' | 'submit', passed: number, total: number, result: unknown) {
  db.prepare('INSERT INTO attempts (user_id, problem_id, kind, passed, total, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId,
    pid,
    kind,
    passed,
    total,
    JSON.stringify(result),
    Date.now(),
  );
}

export function lastAttempt(userId: number, pid: number) {
  const r = db
    .prepare('SELECT kind, passed, total, result, created_at FROM attempts WHERE user_id = ? AND problem_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId, pid) as { kind: string; passed: number; total: number; result: string; created_at: number } | undefined;
  return r ? { ...r, result: JSON.parse(r.result) } : null;
}

export function solve(userId: number, pid: number) {
  return db.prepare('SELECT points, first_try, revealed, solved_at FROM solves WHERE user_id = ? AND problem_id = ?').get(userId, pid) as
    | { points: number; first_try: number; revealed: number; solved_at: number }
    | undefined;
}

export function isRevealed(userId: number, pid: number): boolean {
  return !!db.prepare('SELECT 1 FROM reveals WHERE user_id = ? AND problem_id = ?').get(userId, pid);
}

export function reveal(userId: number, pid: number) {
  db.prepare('INSERT OR IGNORE INTO reveals (user_id, problem_id, revealed_at) VALUES (?, ?, ?)').run(userId, pid, Date.now());
}

/** Points the user would get for solving now. */
export function pointsFor(userId: number, pid: number): { points: number; firstTry: boolean; revealed: boolean } {
  const p = problemById(pid)!;
  const base = POINTS[p.level];
  const revealed = isRevealed(userId, pid);
  const tries = (db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND problem_id = ? AND kind = 'submit'").get(userId, pid) as {
    n: number;
  }).n;
  const firstTry = tries === 0;
  if (revealed) return { points: Math.floor(base / 2), firstTry, revealed };
  return { points: base + (firstTry ? FIRST_TRY_BONUS : 0), firstTry, revealed };
}

export function markSolved(userId: number, pid: number): number | null {
  if (solve(userId, pid)) return null;
  const { points, firstTry, revealed } = pointsFor(userId, pid);
  db.prepare('INSERT INTO solves (user_id, problem_id, points, first_try, revealed, solved_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId,
    pid,
    points,
    +firstTry,
    +revealed,
    Date.now(),
  );
  return points;
}

export function statuses(userId: number): Map<number, { st: Status; passed?: number; total?: number }> {
  const out = new Map<number, { st: Status; passed?: number; total?: number }>();
  const solved = new Set((db.prepare('SELECT problem_id FROM solves WHERE user_id = ?').all(userId) as { problem_id: number }[]).map((r) => r.problem_id));
  const last = db
    .prepare(
      'SELECT a.problem_id, a.passed, a.total FROM attempts a JOIN (SELECT problem_id, MAX(id) AS id FROM attempts WHERE user_id = ? GROUP BY problem_id) m ON m.id = a.id',
    )
    .all(userId) as { problem_id: number; passed: number; total: number }[];
  const drafts = new Set((db.prepare('SELECT problem_id FROM drafts WHERE user_id = ?').all(userId) as { problem_id: number }[]).map((r) => r.problem_id));
  for (const p of PROBLEMS) out.set(p.id, { st: solved.has(p.id) ? 'done' : drafts.has(p.id) ? 'doing' : 'todo' });
  for (const l of last) if (!solved.has(l.problem_id)) out.set(l.problem_id, { st: 'doing', passed: l.passed, total: l.total });
  return out;
}

// ---------- stats & ranking ----------

export type Period = 'week' | 'month' | 'all';

export function periodStart(period: Period, now = new Date()): number {
  if (period === 'all') return 0;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'month') d.setDate(1);
  else d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d.getTime();
}

export interface RankRow {
  id: number;
  name: string;
  section: string;
  passed: number;
  points: number;
  rank: number;
}

export function ranking(from: number, to = Infinity, section?: string): RankRow[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.section,
              COUNT(s.problem_id) AS passed,
              COALESCE(SUM(s.points), 0) AS points,
              COALESCE(MAX(s.solved_at), 0) AS last
       FROM users u LEFT JOIN solves s ON s.user_id = u.id AND s.solved_at >= ? AND s.solved_at < ?
       WHERE u.role = 'student' ${section ? 'AND u.section = ?' : ''}
       GROUP BY u.id`,
    )
    .all(...([from, to === Infinity ? Number.MAX_SAFE_INTEGER : to, ...(section ? [section] : [])] as number[])) as (Omit<RankRow, 'rank'> & {
    last: number;
  })[];
  rows.sort((a, b) => b.points - a.points || b.passed - a.passed || a.last - b.last || a.name.localeCompare(b.name, 'th'));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.points !== rows[i - 1].points || r.passed !== rows[i - 1].passed) rank = i + 1;
    return { id: r.id, name: r.name, section: r.section, passed: r.passed, points: r.points, rank };
  });
}

export function streak(userId: number, now = new Date()): number {
  const days = new Set(
    (db.prepare('SELECT created_at FROM attempts WHERE user_id = ?').all(userId) as { created_at: number }[]).map((r) =>
      new Date(r.created_at).toDateString(),
    ),
  );
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // today not done yet still keeps yesterday's streak
  let n = 0;
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Monday → Sunday of this week: whether the student worked on anything that day. */
export function weekActivity(userId: number, now = new Date()): boolean[] {
  const days = new Set(
    (db.prepare('SELECT created_at FROM attempts WHERE user_id = ? AND created_at >= ?').all(userId, periodStart('week', now)) as { created_at: number }[]).map((r) =>
      new Date(r.created_at).toDateString(),
    ),
  );
  const d = new Date(periodStart('week', now));
  return Array.from({ length: 7 }, () => {
    const on = days.has(d.toDateString());
    d.setDate(d.getDate() + 1);
    return on;
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  // skip leading Thai vowels that can't start a syllable visually
  const first = (s: string) => (s.match(/[ก-ฮA-Za-z0-9]/)?.[0] ?? s[0] ?? '');
  return (first(parts[0] ?? '') + first(parts[1] ?? '')).toUpperCase();
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}
