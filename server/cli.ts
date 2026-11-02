// Account management for instructors. Students sign in with Google; these
// commands pre-register them (so they get the right student id / class)
// or fix up accounts afterwards. Teachers sign in with a username and password.
// <classCode> is a class's join code from the teacher page ('' = no class yet).
//   npm run user -- add <studentId> <name> <classCode> <email>
//   npm run user -- import <file.csv>          (studentId,name,classCode,email per line)
//   npm run user -- email <studentId> <email>    (link an existing account to a Google email)
//   npm run user -- class <studentId> <classCode>
//   npm run user -- classes
//   npm run user -- teacher <username> <name> [password]   (random password printed if omitted)
//   npm run user -- password <username> [password]
//   npm run user -- list
//   npm run user -- remove <studentId>

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { termText } from '../src/lib/terms';
import { addTeacher, addUser, db, linkEmail, listClasses, ProfileError, setClassByCode, setPassword } from './db';

const [cmd, ...args] = process.argv.slice(2);

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

switch (cmd) {
  case 'add': {
    const [id, name, code, email] = args;
    if (!id || !name || !email) die('ใช้: npm run user -- add <รหัส> <ชื่อ> <รหัสเข้าห้อง หรือ ""> <อีเมล Google>');
    try {
      addUser(id, name, code ?? '', email);
    } catch (e) {
      die(e instanceof ProfileError ? e.message : String(e));
    }
    console.log(`เพิ่ม ${id} (${name}) แล้ว — ล็อกอินด้วย ${email}`);
    break;
  }
  case 'import': {
    const file = args[0] ?? die('ใช้: npm run user -- import <file.csv>');
    let n = 0;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [id, name, code, email] = line.split(',').map((s) => s.trim());
      if (!id || !name || !email || id === 'studentId') continue;
      try {
        addUser(id, name, code ?? '', email);
        n++;
      } catch (e) {
        console.error(`ข้าม ${id}: ${(e as Error).message}`);
      }
    }
    console.log(`นำเข้า ${n} บัญชี`);
    break;
  }
  case 'email': {
    const [id, email] = args;
    if (!id || !email) die('ใช้: npm run user -- email <รหัส> <อีเมล Google>');
    console.log(linkEmail(id, email) ? `ผูก ${id} กับ ${email} แล้ว` : `ไม่พบ ${id}`);
    break;
  }
  case 'class': {
    const [id, code] = args;
    if (!id || !code) die('ใช้: npm run user -- class <รหัส> <รหัสเข้าห้อง>');
    try {
      const c = setClassByCode(id, code);
      console.log(c ? `ย้าย ${id} ไป ${c.name} · ${termText(c)} แล้ว` : `ไม่พบ ${id}`);
    } catch (e) {
      die(e instanceof ProfileError ? e.message : String(e));
    }
    break;
  }
  case 'classes':
    console.table(listClasses().map((c) => ({ ห้อง: c.name, ภาคเรียน: termText(c), รหัสเข้าห้อง: c.code, นักศึกษา: c.students, ปิดแล้ว: c.archived })));
    break;
  case 'teacher': {
    const [username, name, given] = args;
    if (!username || !name) die('ใช้: npm run user -- teacher <ชื่อผู้ใช้> <ชื่อ> [รหัสผ่าน]');
    const password = given ?? randomPassword();
    try {
      addTeacher(username, name, password);
    } catch (e) {
      die(e instanceof ProfileError ? e.message : String(e));
    }
    console.log(`สร้างบัญชีอาจารย์ ${username.toLowerCase()} แล้ว${given ? '' : ` — รหัสผ่าน: ${password}`}`);
    break;
  }
  case 'password': {
    const [username, given] = args;
    if (!username) die('ใช้: npm run user -- password <ชื่อผู้ใช้> [รหัสผ่านใหม่]');
    const row = db.prepare("SELECT id FROM users WHERE student_id = ? AND role = 'teacher'").get(username.toLowerCase()) as { id: number } | undefined;
    if (!row) die(`ไม่พบบัญชีอาจารย์ ${username}`);
    const password = given ?? randomPassword();
    try {
      setPassword(row.id, password);
    } catch (e) {
      die(e instanceof ProfileError ? e.message : String(e));
    }
    console.log(`ตั้งรหัสผ่านใหม่ให้ ${username} แล้ว${given ? '' : ` — รหัสผ่าน: ${password}`}`);
    break;
  }
  case 'list':
    console.table(
      db
        .prepare(
          `SELECT u.student_id, u.name, COALESCE(c.name || ' · ' || CASE c.term WHEN 3 THEN 'พิเศษ' ELSE c.term END || '/' || c.year, '') AS class, u.email, u.role
           FROM users u LEFT JOIN classes c ON c.id = u.class_id ORDER BY class, u.student_id`,
        )
        .all(),
    );
    break;
  case 'remove': {
    const r = db.prepare('DELETE FROM users WHERE student_id = ?').run(args[0] ?? die('ใช้: npm run user -- remove <รหัส>'));
    console.log(Number(r.changes) ? 'ลบแล้ว' : 'ไม่พบบัญชีนี้');
    break;
  }
  default:
    die('คำสั่ง: add, import, email, class, classes, teacher, password, list, remove');
}

function randomPassword(): string {
  return randomBytes(9).toString('base64url');
}
