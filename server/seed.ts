// Demo classmates with solved problems so the leaderboard has something to show.
//   npm run seed:demo

import { POINTS, PROBLEMS } from '../src/data/problems';
import { addUser, db } from './db';

const SECTION = 'SEC 1';
const CLASSMATES: [string, string, number][] = [
  ['6601000001', 'ภูมิ ก.', 12],
  ['6601000002', 'มายด์ ศ.', 11],
  ['6601000003', 'ต้นกล้า ว.', 10],
  ['6601000004', 'ปุณ น.', 9],
  ['6601000005', 'ฟ้าใส ร.', 7],
  ['6601000006', 'กันต์ พ.', 6],
  ['6601000007', 'น้ำทิพย์ ท.', 4],
  ['6601000008', 'ธนา จ.', 3],
];

const exists = (id: string) => !!db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(id);

const day = 24 * 3600 * 1000;
CLASSMATES.forEach(([id, name, solved], k) => {
  if (exists(id)) return;
  addUser(id, name, k % 3 === 2 ? 'SEC 2' : SECTION, null);
  const uid = (db.prepare('SELECT id FROM users WHERE student_id = ?').get(id) as { id: number }).id;
  PROBLEMS.slice(0, solved).forEach((p, i) => {
    const at = Date.now() - ((i * 3 + k) % 20) * day - i * 3600_000;
    const first = (i + k) % 3 !== 0;
    const pts = POINTS[p.level] + (first ? 5 : 0);
    db.prepare('INSERT INTO solves (user_id, problem_id, points, first_try, revealed, solved_at) VALUES (?, ?, ?, ?, 0, ?)').run(uid, p.id, pts, +first, at);
    db.prepare("INSERT INTO attempts (user_id, problem_id, kind, passed, total, result, created_at) VALUES (?, ?, 'submit', ?, ?, '{}', ?)").run(
      uid,
      p.id,
      p.tests.length,
      p.tests.length,
      at,
    );
  });
});
console.log('สร้างเพื่อนร่วมชั้นตัวอย่างแล้ว');
