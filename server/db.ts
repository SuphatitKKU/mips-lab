// SQLite storage (Node's built-in node:sqlite) plus the scoring / ranking queries.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type * as Sqlite from 'node:sqlite';
// loaded this way (not a static import) so the test runner, which doesn't know node:sqlite yet, can load this file too
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite;
import { FIRST_TRY_BONUS, POINTS, PROBLEMS, problemById } from '../src/data/problems';
import { CODE_ALPHABET, CODE_LEN, termOf, termText, type ClassInfo } from '../src/lib/terms';

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
-- a class = one section in one academic term; students join with its code
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  term INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- names a teacher listed for a class before the student has an account (or a real student id):
-- ident is a student id without dashes, or a lower-case email; claimed on sign-in / setting the id
CREATE TABLE IF NOT EXISTS roster (
  ident TEXT PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
);
-- problems a teacher set for a class, each with a deadline
CREATE TABLE IF NOT EXISTS assignments (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, problem_id)
);
-- Z80 board projects a teacher set for a class, and what students handed in
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  due_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  board TEXT NOT NULL,
  code TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  submitted_at INTEGER NOT NULL,
  score REAL,
  feedback TEXT,
  graded_at INTEGER,
  UNIQUE (project_id, user_id)
);
-- what teachers did (who deleted which class, …), newest first on the teacher page
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
`);
// the similar-code check was removed: drop the code it kept with each solve
if ((db.prepare('PRAGMA table_info(solves)').all() as { name: string }[]).some((c) => c.name === 'code')) db.exec('ALTER TABLE solves DROP COLUMN code');

// columns added after the first release
const userCols = new Set((db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name));
if (!userCols.has('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!userCols.has('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email); CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub);');
const needsClassMigration = !userCols.has('class_id'); // runs at the bottom of this file
// class history and term start dates were dropped: a student is only ever in their current class,
// and deleting a class wipes its students' work, so nothing older needs to be told apart
db.exec('DROP TABLE IF EXISTS enrollments');
if ((db.prepare('PRAGMA table_info(classes)').all() as { name: string }[]).some((c) => c.name === 'starts_at')) db.exec('ALTER TABLE classes DROP COLUMN starts_at');

// Students sign in with Google; teachers have a username (stored in student_id) and password.
export type Role = 'student' | 'teacher';

export interface User {
  id: number;
  student_id: string;
  name: string;
  /** label of the current class ("SEC 1 · 2/2569"), '' when none */
  section: string;
  class_id: number | null;
  /** 1 when the current class has been closed */
  class_archived: number;
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

/** The current class as "SEC 1 · 2/2569" (same as classLabel), for a users row named `t`. */
/** "SEC 1 · 2/2569" for a classes row named `c` (same as classLabel). */
const sectionLabelSql = (c: string) => `${c}.name || ' · ' || CASE ${c}.term WHEN 3 THEN 'พิเศษ' ELSE ${c}.term END || '/' || ${c}.year`;
const sectionSql = (t: string) => `COALESCE((SELECT ${sectionLabelSql('c')} FROM classes c WHERE c.id = ${t}.class_id), '')`;
const userColsOf = (t: string) =>
  `${t}.id, ${t}.student_id, ${t}.name, ${t}.role, ${t}.email, ${t}.class_id, ${sectionSql(t)} AS section,
   COALESCE((SELECT c.archived FROM classes c WHERE c.id = ${t}.class_id), 0) AS class_archived`;
const USER_COLS = userColsOf('users');

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
      '',
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
  if (claimRoster(user.id)) user = userById(user.id)!;
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
    // the test student starts without a class, so the join-code prompt can be tried
    addUser(sid, role === 'teacher' ? 'อาจารย์ทดสอบ (dev)' : 'ผู้ทดสอบ (dev)', '', null, role);
    user = find()!;
  }
  return { token: newSession(user.id), user };
}

export function linkEmail(studentId: string, email: string): boolean {
  return Number(db.prepare('UPDATE users SET email = ? WHERE student_id = ?').run(email.toLowerCase(), studentId).changes) > 0;
}

export function userForToken(token: string): User | null {
  const row = db
    .prepare(`SELECT ${userColsOf('u')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`)
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
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  if (patch.studentId !== undefined && !teacher) claimRoster(id);
  return userById(id)!;
}

export function teacherCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND pw_hash LIKE 'scrypt$%'").get() as { n: number }).n;
}

// ---------- classes ----------

interface ClassDb {
  id: number;
  name: string;
  year: number;
  term: number;
  code: string;
  archived: number;
  created_at: number;
}
const toClass = (r: ClassDb): ClassInfo => ({ id: r.id, name: r.name, year: r.year, term: r.term, code: r.code, archived: !!r.archived });

/** Thrown when classes from an earlier term still exist: the teacher deletes them first. */
export class OldClassesError extends Error {
  constructor(readonly classes: ClassInfo[]) {
    super(`ยังมีห้องของภาคเรียนก่อนอยู่ ${classes.length} ห้อง (${classes.map((c) => `${c.name} · ${termText(c)}`).join(', ')}) — ลบห้องเก่าก่อนจึงจะเปิดห้องใหม่ได้`);
  }
}

/** Classes from a term before year/term (other than exceptId). */
export function olderClasses(year: number, term: number, exceptId = 0): ClassInfo[] {
  return (db.prepare('SELECT * FROM classes WHERE year * 10 + term < ? AND id != ? ORDER BY year, term, name').all(year * 10 + term, exceptId) as unknown as ClassDb[]).map(
    toClass,
  );
}

function randomCode(): string {
  for (;;) {
    const code = Array.from(randomBytes(CODE_LEN), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!db.prepare('SELECT 1 FROM classes WHERE code = ?').get(code)) return code;
  }
}

function checkClass(name: string, year: number, term: number, exceptId = 0): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new ProfileError('กรุณาใส่ชื่อห้อง เช่น SEC 1');
  if (n.length > 40) throw new ProfileError('ชื่อห้องยาวเกิน 40 ตัวอักษร');
  if (!Number.isInteger(year) || year < 2500 || year > 2700) throw new ProfileError('ปีการศึกษาต้องเป็น พ.ศ. เช่น 2569');
  if (![1, 2, 3].includes(term)) throw new ProfileError('ภาคเรียนต้องเป็น 1, 2 หรือภาคเรียนพิเศษ');
  if (db.prepare('SELECT 1 FROM classes WHERE name = ? AND year = ? AND term = ? AND id != ?').get(n, year, term, exceptId))
    throw new ProfileError(`มีห้อง ${n} ในภาคเรียน ${term}/${year} แล้ว`);
  return n;
}

function insertClass(name: string, year: number, term: number): ClassInfo {
  const n = checkClass(name, year, term);
  const r = db.prepare('INSERT INTO classes (name, year, term, code, created_at) VALUES (?, ?, ?, ?, ?)').run(n, year, term, randomCode(), Date.now());
  return classById(Number(r.lastInsertRowid))!;
}

/** A new class. Throws OldClassesError while classes from an earlier term are still around. */
export function createClass(name: string, year: number, term: number): ClassInfo {
  checkClass(name, year, term);
  const old = olderClasses(year, term);
  if (old.length) throw new OldClassesError(old);
  return insertClass(name, year, term);
}

export function classById(id: number): ClassInfo | null {
  const r = db.prepare('SELECT * FROM classes WHERE id = ?').get(id) as ClassDb | undefined;
  return r ? toClass(r) : null;
}

export function updateClass(id: number, patch: { name?: string; year?: number; term?: number; archived?: boolean; newCode?: boolean }): ClassInfo {
  const c = classById(id);
  if (!c) throw new ProfileError('ไม่พบห้องนี้');
  const year = patch.year ?? c.year;
  const term = patch.term ?? c.term;
  const name = checkClass(patch.name ?? c.name, year, term, id);
  // moving a class to a later term follows the same rule as creating one
  if (year * 10 + term > c.year * 10 + c.term) {
    const old = olderClasses(year, term, id);
    if (old.length) throw new OldClassesError(old);
  }
  db.prepare('UPDATE classes SET name = ?, year = ?, term = ?, archived = ?, code = ? WHERE id = ?').run(
    name,
    year,
    term,
    +(patch.archived ?? c.archived),
    patch.newCode ? randomCode() : c.code,
    id,
  );
  return classById(id)!;
}

/**
 * Deletes a class and wipes its students' work (solves, attempts, drafts, revealed
 * answers) so a repeat student starts from zero next term. Accounts stay; they're
 * left with no class and must join a new one. A copy of the database is saved to
 * data/backups/ first, since this can't be undone. Returns how many students were wiped.
 */
export function deleteClass(id: number): { wiped: number; backup: string | null } {
  const c = classById(id);
  if (!c) throw new ProfileError('ไม่พบห้องนี้');
  const ids = (db.prepare("SELECT id FROM users WHERE class_id = ? AND role = 'student'").all(id) as { id: number }[]).map((r) => r.id);
  const saved = ids.length ? backup(`before-delete-class-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`) : null;
  db.exec('BEGIN');
  try {
    for (const t of ['solves', 'attempts', 'drafts', 'reveals', 'submissions']) db.prepare(`DELETE FROM ${t} WHERE user_id IN (SELECT id FROM users WHERE class_id = ? AND role = 'student')`).run(id);
    db.prepare('UPDATE users SET class_id = NULL WHERE class_id = ?').run(id);
    db.prepare('DELETE FROM roster WHERE class_id = ?').run(id);
    db.prepare('DELETE FROM classes WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { wiped: ids.length, backup: saved };
}

export interface ClassRow extends ClassInfo {
  /** students in the class now */
  students: number;
  /** listed by the teacher, waiting for their first sign-in */
  pending: number;
  /** problems assigned to the class */
  assigned: number;
}

/** Newest term first. */
export function listClasses(): ClassRow[] {
  return (
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student') AS students,
                (SELECT COUNT(*) FROM roster r WHERE r.class_id = c.id) AS pending,
                (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id) AS assigned
         FROM classes c ORDER BY c.year DESC, c.term DESC, c.name`,
      )
      .all() as unknown as (ClassDb & { students: number; pending: number; assigned: number })[]
  ).map((r) => ({ ...toClass(r), students: r.students, pending: r.pending, assigned: r.assigned }));
}

// ---------- roster: the teacher's list of who is in a class ----------

/** A student id without dashes, or a lower-case email; null when it's neither. */
export function rosterIdent(raw: string): string | null {
  const s = raw.trim();
  if (s.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : null;
  const digits = s.replace(/-/g, '');
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

export interface RosterResult {
  /** existing accounts moved into the class now */
  moved: string[];
  /** already in this class */
  already: number;
  /** no account yet: placed in the class on their first sign-in */
  pending: number;
  /** lines that are neither a student id nor an email */
  invalid: string[];
}

/** Adds a pasted list (student ids or emails, one per line or comma separated) to a class. */
export function addRoster(classId: number, text: string): RosterResult {
  const c = classById(classId);
  if (!c) throw new ProfileError('ไม่พบห้องนี้');
  if (c.archived) throw new ProfileError('ห้องนี้ปิดแล้ว — เปิดห้องอีกครั้งก่อนเพิ่มรายชื่อ');
  const out: RosterResult = { moved: [], already: 0, pending: 0, invalid: [] };
  const seen = new Set<string>();
  const find = db.prepare("SELECT id, name, class_id FROM users WHERE role = 'student' AND (REPLACE(student_id, '-', '') = ? OR email = ?)");
  db.exec('BEGIN');
  try {
    for (const raw of text.split(/[\s,;]+/)) {
      if (!raw) continue;
      const ident = rosterIdent(raw);
      if (!ident) {
        if (out.invalid.length < 20) out.invalid.push(raw.slice(0, 40));
        continue;
      }
      if (seen.has(ident)) continue;
      seen.add(ident);
      const u = find.get(ident, ident) as { id: number; name: string; class_id: number | null } | undefined;
      if (u) {
        db.prepare('DELETE FROM roster WHERE ident = ?').run(ident);
        if (u.class_id === classId) out.already++;
        else {
          setUserClass(u.id, classId);
          out.moved.push(u.name);
        }
      } else {
        db.prepare('INSERT INTO roster (ident, class_id, added_at) VALUES (?, ?, ?) ON CONFLICT(ident) DO UPDATE SET class_id = excluded.class_id, added_at = excluded.added_at').run(
          ident,
          classId,
          Date.now(),
        );
        out.pending++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return out;
}

/** Puts a student into the class a teacher listed them in (by student id or email), if any. */
export function claimRoster(userId: number): boolean {
  const u = db.prepare("SELECT student_id, email FROM users WHERE id = ? AND role = 'student'").get(userId) as { student_id: string; email: string | null } | undefined;
  if (!u) return false;
  const idents = [rosterIdent(u.student_id), u.email?.toLowerCase() ?? null].filter((x): x is string => !!x);
  if (!idents.length) return false;
  const marks = idents.map(() => '?').join(', ');
  const r = db
    .prepare(`SELECT r.class_id FROM roster r JOIN classes c ON c.id = r.class_id WHERE r.ident IN (${marks}) AND c.archived = 0 ORDER BY r.added_at DESC LIMIT 1`)
    .get(...idents) as { class_id: number } | undefined;
  db.prepare(`DELETE FROM roster WHERE ident IN (${marks})`).run(...idents);
  if (!r) return false;
  setUserClass(userId, r.class_id);
  return true;
}

/** Moves a student into a class (null = none). */
export function setUserClass(userId: number, classId: number | null) {
  if (classId != null && !classById(classId)) throw new ProfileError('ไม่พบห้องนี้');
  db.prepare("UPDATE users SET class_id = ? WHERE id = ? AND role = 'student'").run(classId, userId);
}

/** A student entering a join code. Throws ProfileError when the code is wrong or the class is closed. */
export function joinClass(userId: number, code: string): ClassInfo {
  const r = db.prepare('SELECT * FROM classes WHERE code = ?').get(code.trim().toUpperCase().replace(/[\s-]/g, '')) as ClassDb | undefined;
  if (!r) throw new ProfileError('ไม่พบห้องเรียนรหัสนี้ — ตรวจรหัสที่อาจารย์ให้อีกครั้ง');
  if (r.archived) throw new ProfileError('ห้องนี้ปิดรับแล้ว — ติดต่ออาจารย์');
  setUserClass(userId, r.id);
  return toClass(r);
}

/** For the CLI: put a student (by student id) into the class with this join code. */
export function setClassByCode(studentId: string, code: string): ClassInfo | null {
  const u = db.prepare('SELECT id FROM users WHERE student_id = ?').get(studentId) as { id: number } | undefined;
  if (!u) return null;
  return joinClass(u.id, code);
}

export interface UserRow extends User {
  points: number;
  passed: number;
  last_active: number | null;
  /** problems set for their class */
  assigned: number;
  /** of those, solved by the deadline */
  on_time: number;
}

/** Everyone with their all-time score and last attempt, for the teacher page. */
export function listUsers(): UserRow[] {
  return db
    .prepare(
      `SELECT ${userColsOf('u')},
              (SELECT COALESCE(SUM(points), 0) FROM solves WHERE user_id = u.id) AS points,
              (SELECT COUNT(*) FROM solves WHERE user_id = u.id) AS passed,
              (SELECT MAX(created_at) FROM attempts WHERE user_id = u.id) AS last_active,
              (SELECT COUNT(*) FROM assignments a WHERE a.class_id = u.class_id) AS assigned,
              (SELECT COUNT(*) FROM assignments a JOIN solves s ON s.problem_id = a.problem_id AND s.user_id = u.id
                WHERE a.class_id = u.class_id AND s.solved_at <= a.due_at) AS on_time
       FROM users u
       ORDER BY u.role DESC, section, u.student_id`,
    )
    .all() as unknown as UserRow[];
}

export function logout(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Pre-registers a student so their Google email lands on this student id (and the class with this join code, if given). */
export function addUser(studentId: string, name: string, classCode: string, email: string | null, role: Role = 'student') {
  const r = db.prepare('INSERT INTO users (student_id, name, section, pw_hash, role, created_at, email) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    studentId,
    name,
    '',
    '!google',
    role,
    Date.now(),
    email?.toLowerCase() ?? null,
  );
  if (classCode && role === 'student') joinClass(Number(r.lastInsertRowid), classCode);
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
  passed: number;
  points: number;
  rank: number;
}

/** Students ranked by points solved in [from, to); with classId, only students in that class. */
export function ranking(from: number, to = Infinity, classId?: number | null): RankRow[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.name,
              COUNT(s.problem_id) AS passed,
              COALESCE(SUM(s.points), 0) AS points,
              COALESCE(MAX(s.solved_at), 0) AS last
       FROM users u LEFT JOIN solves s ON s.user_id = u.id AND s.solved_at >= ? AND s.solved_at < ?
       WHERE u.role = 'student' ${classId != null ? 'AND u.class_id = ?' : ''}
       GROUP BY u.id`,
    )
    .all(...([from, to === Infinity ? Number.MAX_SAFE_INTEGER : to, ...(classId != null ? [classId] : [])] as number[])) as (Omit<RankRow, 'rank'> & {
    last: number;
  })[];
  rows.sort((a, b) => b.points - a.points || b.passed - a.passed || a.last - b.last || a.name.localeCompare(b.name, 'th'));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.points !== rows[i - 1].points || r.passed !== rows[i - 1].passed) rank = i + 1;
    return { id: r.id, name: r.name, passed: r.passed, points: r.points, rank };
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

// ---------- assignments: problems set for a class, with deadlines ----------

export interface Assignment {
  problemId: number;
  dueAt: number;
}

export function assignments(classId: number): Assignment[] {
  return (db.prepare('SELECT problem_id, due_at FROM assignments WHERE class_id = ? ORDER BY due_at, problem_id').all(classId) as { problem_id: number; due_at: number }[]).map(
    (r) => ({ problemId: r.problem_id, dueAt: r.due_at }),
  );
}

/** Replaces a class's assignments with this list. */
export function setAssignments(classId: number, list: Assignment[]) {
  if (!classById(classId)) throw new ProfileError('ไม่พบห้องนี้');
  const seen = new Set<number>();
  for (const a of list) {
    if (!problemById(a.problemId)) throw new ProfileError(`ไม่พบโจทย์ข้อ ${a.problemId}`);
    if (!Number.isFinite(a.dueAt) || a.dueAt <= 0) throw new ProfileError(`กรุณาใส่กำหนดส่งของโจทย์ข้อ ${a.problemId}`);
    if (seen.has(a.problemId)) throw new ProfileError(`โจทย์ข้อ ${a.problemId} ซ้ำ`);
    seen.add(a.problemId);
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
    const ins = db.prepare('INSERT INTO assignments (class_id, problem_id, due_at) VALUES (?, ?, ?)');
    for (const a of list) ins.run(classId, a.problemId, a.dueAt);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** problem id → deadline, for the student's current class. */
export function dueMap(user: User): Map<number, number> {
  return new Map(user.class_id == null ? [] : assignments(user.class_id).map((a) => [a.problemId, a.dueAt]));
}

// ---------- teacher views: one student's progress, per-problem stats ----------

export interface ProblemProgress {
  id: number;
  title: string;
  level: string;
  status: Status;
  points: number | null;
  solvedAt: number | null;
  firstTry: boolean;
  /** submits + test runs */
  attempts: number;
  /** last run: tests passed / total */
  last: { passed: number; total: number; at: number } | null;
  dueAt: number | null;
}

export function progress(userId: number): ProblemProgress[] {
  const user = userById(userId);
  if (!user) throw new ProfileError('ไม่พบบัญชีนี้');
  const st = statuses(userId);
  const due = dueMap(user);
  const solves = new Map(
    (db.prepare('SELECT problem_id, points, first_try, solved_at FROM solves WHERE user_id = ?').all(userId) as {
      problem_id: number;
      points: number;
      first_try: number;
      solved_at: number;
    }[]).map((r) => [r.problem_id, r]),
  );
  const tries = new Map(
    (db.prepare('SELECT problem_id, COUNT(*) AS n FROM attempts WHERE user_id = ? GROUP BY problem_id').all(userId) as { problem_id: number; n: number }[]).map((r) => [
      r.problem_id,
      r.n,
    ]),
  );
  return PROBLEMS.map((p) => {
    const s = solves.get(p.id);
    const a = lastAttempt(userId, p.id);
    return {
      id: p.id,
      title: p.title,
      level: p.level,
      status: st.get(p.id)?.st ?? 'todo',
      points: s?.points ?? null,
      solvedAt: s?.solved_at ?? null,
      firstTry: !!s?.first_try,
      attempts: tries.get(p.id) ?? 0,
      last: a ? { passed: a.passed, total: a.total, at: a.created_at } : null,
      dueAt: due.get(p.id) ?? null,
    };
  });
}

export interface ProblemStat {
  id: number;
  title: string;
  level: string;
  /** students (of the given ones) who ran or submitted it */
  attempted: number;
  solved: number;
}

/** How a group of students is doing on each problem. */
export function problemStats(userIds: number[]): { students: number; problems: ProblemStat[] } {
  const ids = userIds.filter(Number.isInteger);
  const counts = (sql: string) => {
    const m = new Map<number, number>();
    if (!ids.length) return m;
    const rows = db.prepare(sql.replace('$IDS', ids.map(() => '?').join(','))).all(...ids) as { problem_id: number; n: number }[];
    for (const r of rows) m.set(r.problem_id, r.n);
    return m;
  };
  const attempted = counts('SELECT problem_id, COUNT(DISTINCT user_id) AS n FROM attempts WHERE user_id IN ($IDS) GROUP BY problem_id');
  const solved = counts('SELECT problem_id, COUNT(*) AS n FROM solves WHERE user_id IN ($IDS) GROUP BY problem_id');
  return {
    students: ids.length,
    problems: PROBLEMS.map((p) => ({ id: p.id, title: p.title, level: p.level, attempted: attempted.get(p.id) ?? 0, solved: solved.get(p.id) ?? 0 })),
  };
}

// ---------- Z80 board projects: set by the teacher, handed in by students ----------

export interface Project {
  id: number;
  classId: number;
  title: string;
  detail: string;
  dueAt: number | null;
  createdAt: number;
}
interface ProjectDb {
  id: number;
  class_id: number;
  title: string;
  detail: string;
  due_at: number | null;
  created_at: number;
}
const toProject = (r: ProjectDb): Project => ({ id: r.id, classId: r.class_id, title: r.title, detail: r.detail, dueAt: r.due_at, createdAt: r.created_at });

export function projectById(id: number): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectDb | undefined;
  return r ? toProject(r) : null;
}

function checkProject(title: string, detail: string, dueAt: number | null) {
  const t = title.trim().replace(/\s+/g, ' ');
  if (!t) throw new ProfileError('กรุณาใส่ชื่องาน');
  if (t.length > 100) throw new ProfileError('ชื่องานยาวเกิน 100 ตัวอักษร');
  if (detail.length > 4000) throw new ProfileError('รายละเอียดยาวเกิน 4000 ตัวอักษร');
  if (dueAt != null && (!Number.isFinite(dueAt) || dueAt <= 0)) throw new ProfileError('กำหนดส่งไม่ถูกต้อง');
  return t;
}

export function createProject(classId: number, title: string, detail: string, dueAt: number | null): Project {
  if (!classById(classId)) throw new ProfileError('ไม่พบห้องนี้');
  const t = checkProject(title, detail, dueAt);
  const r = db.prepare('INSERT INTO projects (class_id, title, detail, due_at, created_at) VALUES (?, ?, ?, ?, ?)').run(classId, t, detail.trim(), dueAt, Date.now());
  return projectById(Number(r.lastInsertRowid))!;
}

export function updateProject(id: number, patch: { title?: string; detail?: string; dueAt?: number | null }): Project {
  const p = projectById(id);
  if (!p) throw new ProfileError('ไม่พบงานนี้');
  const title = checkProject(patch.title ?? p.title, patch.detail ?? p.detail, patch.dueAt === undefined ? p.dueAt : patch.dueAt);
  db.prepare('UPDATE projects SET title = ?, detail = ?, due_at = ? WHERE id = ?').run(title, (patch.detail ?? p.detail).trim(), patch.dueAt === undefined ? p.dueAt : patch.dueAt, id);
  return projectById(id)!;
}

export function deleteProject(id: number) {
  if (!projectById(id)) throw new ProfileError('ไม่พบงานนี้');
  db.prepare('DELETE FROM projects WHERE id = ?').run(id); // submissions go with it (cascade)
}

export interface ProjectRow extends Project {
  classLabel: string;
  /** students in the class now */
  students: number;
  submitted: number;
  graded: number;
}

/** Every project, newest class/term first, with hand-in counts. */
export function listProjects(): ProjectRow[] {
  return (
    db
      .prepare(
        `SELECT p.*, ${sectionLabelSql('c')} AS class_label,
                (SELECT COUNT(*) FROM users u WHERE u.class_id = p.class_id AND u.role = 'student') AS students,
                (SELECT COUNT(*) FROM submissions s WHERE s.project_id = p.id) AS submitted,
                (SELECT COUNT(*) FROM submissions s WHERE s.project_id = p.id AND s.score IS NOT NULL) AS graded
         FROM projects p JOIN classes c ON c.id = p.class_id
         ORDER BY c.year DESC, c.term DESC, c.name, COALESCE(p.due_at, p.created_at) DESC`,
      )
      .all() as unknown as (ProjectDb & { class_label: string; students: number; submitted: number; graded: number })[]
  ).map((r) => ({ ...toProject(r), classLabel: r.class_label, students: r.students, submitted: r.submitted, graded: r.graded }));
}

export interface SubmissionSummary {
  id: number;
  name: string;
  note: string;
  submittedAt: number;
  late: boolean;
  score: number | null;
  feedback: string | null;
  gradedAt: number | null;
}
interface SubmissionDb {
  id: number;
  project_id: number;
  user_id: number;
  name: string;
  board: string;
  code: string;
  note: string;
  submitted_at: number;
  score: number | null;
  feedback: string | null;
  graded_at: number | null;
}
const toSummary = (s: SubmissionDb, dueAt: number | null): SubmissionSummary => ({
  id: s.id,
  name: s.name,
  note: s.note,
  submittedAt: s.submitted_at,
  late: dueAt != null && s.submitted_at > dueAt,
  score: s.score,
  feedback: s.feedback,
  gradedAt: s.graded_at,
});

/** The class's students (and anyone else who handed in), each with their hand-in if any. */
export function projectSubmissions(projectId: number) {
  const p = projectById(projectId);
  if (!p) throw new ProfileError('ไม่พบงานนี้');
  const rows = db
    .prepare(
      `SELECT u.id AS uid, u.name AS uname, u.student_id, s.*
       FROM users u LEFT JOIN submissions s ON s.user_id = u.id AND s.project_id = ?
       WHERE u.role = 'student' AND (u.class_id = ? OR s.id IS NOT NULL)
       ORDER BY u.student_id`,
    )
    .all(projectId, p.classId) as unknown as (SubmissionDb & { uid: number; uname: string; student_id: string })[];
  return {
    project: p,
    rows: rows.map((r) => ({ user: { id: r.uid, name: r.uname, studentId: r.student_id }, submission: r.id ? toSummary(r, p.dueAt) : null })),
  };
}

/** One hand-in with its board and program (to open on the board page). */
export function submissionById(id: number) {
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionDb | undefined;
  if (!s) return null;
  const p = projectById(s.project_id)!;
  const u = userById(s.user_id)!;
  return { ...toSummary(s, p.dueAt), board: JSON.parse(s.board) as unknown, code: s.code, project: { id: p.id, title: p.title }, student: { id: u.id, name: u.name, studentId: u.student_id } };
}

export function gradeSubmission(id: number, score: number | null, feedback: string) {
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 1000)) throw new ProfileError('คะแนนต้องเป็นตัวเลข 0–1000');
  if (feedback.length > 2000) throw new ProfileError('ความเห็นยาวเกิน 2000 ตัวอักษร');
  const r = db.prepare('UPDATE submissions SET score = ?, feedback = ?, graded_at = ? WHERE id = ?').run(score, feedback.trim() || null, score == null && !feedback.trim() ? null : Date.now(), id);
  if (!Number(r.changes)) throw new ProfileError('ไม่พบงานที่ส่งนี้');
  return submissionById(id)!;
}

/** Projects of the student's current class, each with what they handed in. */
export function myProjects(user: User) {
  if (user.class_id == null) return [];
  const projects = (db.prepare('SELECT * FROM projects WHERE class_id = ? ORDER BY COALESCE(due_at, created_at)').all(user.class_id) as unknown as ProjectDb[]).map(toProject);
  const mine = new Map(
    (db.prepare('SELECT * FROM submissions WHERE user_id = ?').all(user.id) as unknown as SubmissionDb[]).map((s) => [s.project_id, s]),
  );
  return projects.map((p) => ({ ...p, submission: mine.has(p.id) ? toSummary(mine.get(p.id)!, p.dueAt) : null }));
}

/** A student hands in (or re-hands in) their board for a project of their class. Locked once graded. */
export function submitProject(user: User, projectId: number, sub: { name: string; board: unknown; code: string; note: string }) {
  const p = projectById(projectId);
  if (!p || p.classId !== user.class_id) throw new ProfileError('ไม่พบงานนี้ในห้องของคุณ');
  const b = sub.board as { parts?: unknown; wires?: unknown } | null;
  if (!b || !Array.isArray(b.parts) || !Array.isArray(b.wires)) throw new ProfileError('ข้อมูลบอร์ดไม่ถูกต้อง');
  if (typeof sub.code !== 'string' || sub.code.length > 200_000) throw new ProfileError('โค้ดไม่ถูกต้องหรือยาวเกินไป');
  if (sub.note.length > 1000) throw new ProfileError('ข้อความถึงอาจารย์ยาวเกิน 1000 ตัวอักษร');
  const prev = db.prepare('SELECT score, graded_at FROM submissions WHERE project_id = ? AND user_id = ?').get(projectId, user.id) as { score: number | null; graded_at: number | null } | undefined;
  if (prev?.graded_at) throw new ProfileError('อาจารย์ตรวจงานนี้แล้ว ส่งใหม่ไม่ได้ — ติดต่ออาจารย์ถ้าต้องการแก้');
  db.prepare(
    `INSERT INTO submissions (project_id, user_id, name, board, code, note, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET name = excluded.name, board = excluded.board, code = excluded.code, note = excluded.note, submitted_at = excluded.submitted_at`,
  ).run(projectId, user.id, sub.name.trim().slice(0, 60) || p.title, JSON.stringify(sub.board), sub.code, sub.note.trim(), Date.now());
  return myProjects(user).find((x) => x.id === projectId)!;
}

// ---------- audit log ----------

export function audit(actor: User, action: string, detail: string) {
  db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), `${actor.name} (${actor.student_id})`, action, detail);
}

export function auditLog(limit = 100): { at: number; actor: string; action: string; detail: string }[] {
  return db.prepare('SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit) as { at: number; actor: string; action: string; detail: string }[];
}

// ---------- backups ----------

const BACKUP_DIR = resolve(dirname(DB_PATH), 'backups');

/** Copies the database to data/backups/<name>.db (consistent even while in use). */
export function backup(name: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = resolve(BACKUP_DIR, `${name}.db`);
  try {
    unlinkSync(file);
  } catch {
    /* not there yet */
  }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** One backup per day (daily-YYYY-MM-DD.db), keeping the newest `keep`. Returns the file when one was made. */
export function dailyBackup(keep = 14, now = new Date()): string | null {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const daily = readdirSync(BACKUP_DIR)
    .filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  const made = daily.includes(`daily-${day}.db`) ? null : backup(`daily-${day}`);
  const all = made ? [...daily, `daily-${day}.db`] : daily;
  for (const f of all.slice(0, Math.max(0, all.length - keep))) unlinkSync(resolve(BACKUP_DIR, f));
  return made;
}

// ---------- one-time migration: free-text sections → classes ----------

if (needsClassMigration) {
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE users ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL');
    // each old section becomes a class in the term its first student signed up
    const old = db.prepare("SELECT section, MIN(created_at) AS at FROM users WHERE role = 'student' AND TRIM(section) != '' GROUP BY section").all() as {
      section: string;
      at: number;
    }[];
    for (const o of old) {
      const { year, term } = termOf(o.at);
      const name = o.section.trim().replace(/\s+/g, ' ').slice(0, 40);
      const same = db.prepare('SELECT id FROM classes WHERE name = ? AND year = ? AND term = ?').get(name, year, term) as { id: number } | undefined;
      const id = same?.id ?? insertClass(name, year, term).id;
      db.prepare("UPDATE users SET class_id = ? WHERE role = 'student' AND section = ?").run(id, o.section);
    }
    db.exec('COMMIT');
    if (old.length) console.log(`ย้ายกลุ่มเรียนเดิม ${old.length} กลุ่มไปเป็นห้องเรียนแล้ว — ดูรหัสเข้าห้องได้ที่หน้าอาจารย์`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
