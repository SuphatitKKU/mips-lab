// Classes, roster, assignments, the delete-wipes-scores rule, backups and the
// similar-code check — against a throwaway database in the OS temp folder.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSimilar, similarity, tokens } from './similarity';

const dir = mkdtempSync(join(tmpdir(), 'mipslab-test-'));
process.env.MIPSLAB_DB = join(dir, 'test.db');
type Store = typeof import('./db');
let store: Store;

beforeAll(async () => {
  store = await import('./db'); // after MIPSLAB_DB is set, so the real database is never opened
});
afterAll(() => {
  store?.db.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** A student with a session-less account, optionally in a class. */
function student(classId: number | null = null, sid?: string) {
  n++;
  const studentId = sid ?? `66${String(n).padStart(8, '0')}`;
  store.addUser(studentId, `นักศึกษา ${n}`, '', `s${n}@example.com`);
  const id = (store.db.prepare('SELECT id FROM users WHERE student_id = ?').get(studentId) as { id: number }).id;
  if (classId != null) store.setUserClass(id, classId);
  return id;
}
const count = (table: string, userId: number) => (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;
function work(userId: number, pid = 1) {
  store.markSolved(userId, pid, 'add $v0, $a0, $a1\njr $ra');
  store.recordAttempt(userId, pid, 'submit', 1, 1, {});
  store.saveDraft(userId, pid + 1, 'x');
  store.reveal(userId, pid + 2);
}

describe('classes', () => {
  it('creates classes and refuses a newer term while an older one exists', () => {
    const a = store.createClass('SEC 1', 2569, 1);
    store.createClass('SEC 2', 2569, 1); // same term: fine
    expect(() => store.createClass('SEC 1', 2569, 2)).toThrow(store.OldClassesError);
    expect(() => store.createClass('SEC 1', 2569, 1)).toThrow(/มีห้อง SEC 1/);
    try {
      store.createClass('SEC 1', 2569, 3);
    } catch (e) {
      expect((e as InstanceType<Store['OldClassesError']>).classes.map((c) => c.name).sort()).toEqual(['SEC 1', 'SEC 2']);
    }
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('labels the special term as พิเศษ', async () => {
    const { termText } = await import('../src/lib/terms');
    expect(termText({ year: 2569, term: 3 })).toBe('พิเศษ/2569');
    expect(termText({ year: 2569, term: 2 })).toBe('2/2569');
  });

  it('a closed class rejects its join code', () => {
    const c = store.listClasses().find((x) => x.name === 'SEC 2')!;
    store.updateClass(c.id, { archived: true });
    const s = student();
    expect(() => store.joinClass(s, c.code)).toThrow(/ปิดรับแล้ว/);
    store.updateClass(c.id, { archived: false });
    expect(store.joinClass(s, c.code.toLowerCase()).id).toBe(c.id);
  });

  it('deleting a class wipes only its students’ work and keeps their accounts', () => {
    const [sec1, sec2] = ['SEC 1', 'SEC 2'].map((name) => store.listClasses().find((x) => x.name === name)!);
    const inside = student(sec1.id);
    const outside = student(sec2.id);
    work(inside);
    work(outside);
    const r = store.deleteClass(sec1.id);
    expect(r.wiped).toBe(1);
    expect(r.backup && existsSync(r.backup)).toBe(true);
    for (const t of ['solves', 'attempts', 'drafts', 'reveals']) {
      expect(count(t, inside)).toBe(0);
      expect(count(t, outside)).toBe(1);
    }
    expect(store.userById(inside)?.class_id).toBeNull();
    expect(store.classById(sec1.id)).toBeNull();
    // with the old term gone, nothing blocks… except SEC 2 (still 1/2569)
    expect(() => store.createClass('SEC 1', 2569, 2)).toThrow(store.OldClassesError);
    store.deleteClass(sec2.id);
    expect(store.createClass('SEC 1', 2569, 2).term).toBe(2);
  });
});

describe('roster', () => {
  it('moves existing accounts now and holds the rest until they set their student id', () => {
    const c = store.listClasses()[0];
    const existing = student(null, '6500000001');
    const r = store.addRoster(c.id, '650000000-1\n6599999999, late@example.com\nnot-an-id');
    expect(r.moved).toHaveLength(1);
    expect(r.pending).toBe(2);
    expect(r.invalid).toEqual(['not-an-id']);
    expect(store.userById(existing)?.class_id).toBe(c.id);
    // a Google account whose email isn't a student number sets its id later → claims the seat
    store.addUser('newbie@example.com', 'มาใหม่', '', 'newbie@example.com');
    const id = (store.db.prepare("SELECT id FROM users WHERE email = 'newbie@example.com'").get() as { id: number }).id;
    store.updateUser(id, { studentId: '6599999999' });
    expect(store.userById(id)?.class_id).toBe(c.id);
    expect(store.listClasses()[0].pending).toBe(1); // late@example.com still waiting
  });
});

describe('assignments', () => {
  it('counts assignments solved by the deadline', () => {
    const c = store.listClasses()[0];
    const s = student(c.id);
    const now = Date.now();
    store.setAssignments(c.id, [
      { problemId: 1, dueAt: now + 3600_000 }, // solved in time
      { problemId: 2, dueAt: now - 3600_000 }, // deadline passed before the solve
      { problemId: 3, dueAt: now + 3600_000 }, // not solved
    ]);
    store.markSolved(s, 1);
    store.markSolved(s, 2);
    const row = store.listUsers().find((u) => u.id === s)!;
    expect(row.assigned).toBe(3);
    expect(row.on_time).toBe(1);
    expect(store.progress(s).find((p) => p.id === 1)?.dueAt).toBe(now + 3600_000);
    expect(() => store.setAssignments(c.id, [{ problemId: 99999, dueAt: now }])).toThrow(/ไม่พบโจทย์/);
  });

  it('problem stats count attempts and solves for the given students only', () => {
    const c = store.listClasses()[0];
    const a = student(c.id);
    const b = student(c.id);
    store.recordAttempt(a, 5, 'test', 0, 3, {});
    store.recordAttempt(b, 5, 'submit', 3, 3, {});
    store.markSolved(b, 5);
    const p5 = store.problemStats([a, b]).problems.find((p) => p.id === 5)!;
    expect(p5).toMatchObject({ attempted: 2, solved: 1 });
    expect(store.problemStats([a]).problems.find((p) => p.id === 5)).toMatchObject({ attempted: 1, solved: 0 });
  });
});

describe('backups and audit', () => {
  it('keeps one daily backup per day and prunes old ones', () => {
    const day = (d: string) => store.dailyBackup(2, new Date(`${d}T12:00:00`));
    expect(day('2026-01-01')).toMatch(/daily-2026-01-01\.db$/);
    expect(day('2026-01-01')).toBeNull(); // same day: nothing new
    day('2026-01-02');
    day('2026-01-03');
    const files = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('daily-'));
    expect(files.sort()).toEqual(['daily-2026-01-02.db', 'daily-2026-01-03.db']);
  });

  it('records teacher actions newest first', () => {
    const t = store.addTeacher('teach.er', 'อาจารย์ทดสอบ', 'password123');
    store.audit(t, 'สร้างห้อง', 'A');
    store.audit(t, 'ลบห้อง', 'B');
    expect(store.auditLog(2).map((r) => r.action)).toEqual(['ลบห้อง', 'สร้างห้อง']);
  });
});

describe('similar code', () => {
  const a = `
main:   addi $t0, $zero, 0      # sum
        addi $t1, $zero, 1
loop:   bgt  $t1, $a0, done
        add  $t0, $t0, $t1
        addi $t1, $t1, 1
        j    loop
done:   move $v0, $t0
        jr   $ra`;
  // same program: labels renamed, comments and spacing changed
  const b = `start: addi $t0,$zero,0
 addi $t1,$zero,1
again: bgt $t1,$a0,finish   ; z80-style comment
 add $t0,$t0,$t1
 addi $t1,$t1,1
 j again
finish: move $v0,$t0
 jr $ra`;
  const other = `
        li   $v0, 0
        blez $a0, out
top:    add  $v0, $v0, $a0
        addi $a0, $a0, -1
        bgtz $a0, top
out:    jr   $ra`;

  it('sees through renamed labels and comments', () => {
    expect(tokens(a)).toEqual(tokens(b));
    expect(similarity(a, b)).toBe(1);
    expect(similarity(a, other)).toBeLessThan(0.5);
  });

  it('pairs only near-identical answers to the same problem, skipping short ones', () => {
    const pairs = findSimilar(
      [
        { userId: 1, problemId: 7, code: a },
        { userId: 2, problemId: 7, code: b },
        { userId: 3, problemId: 7, code: other },
        { userId: 4, problemId: 8, code: a }, // other problem
        { userId: 5, problemId: 9, code: 'jr $ra' },
        { userId: 6, problemId: 9, code: 'jr $ra' }, // too short to judge
      ],
      0.85,
    );
    expect(pairs).toEqual([{ problemId: 7, a: 1, b: 2, similarity: 1 }]);
  });
});
