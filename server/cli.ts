// Account management for instructors. Students sign in with Google; these
// commands pre-register them (so they get the right student id / section)
// or fix up accounts afterwards. Teachers sign in with a username and password.
//   npm run user -- add <studentId> <name> <section> <email>
//   npm run user -- import <file.csv>          (studentId,name,section,email per line)
//   npm run user -- email <studentId> <email>    (link an existing account to a Google email)
//   npm run user -- section <studentId> <section>
//   npm run user -- teacher <username> <name> [password]   (random password printed if omitted)
//   npm run user -- password <username> [password]
//   npm run user -- list
//   npm run user -- remove <studentId>

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addTeacher, addUser, db, linkEmail, ProfileError, setPassword, setSection } from './db';

const [cmd, ...args] = process.argv.slice(2);

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

switch (cmd) {
  case 'add': {
    const [id, name, section, email] = args;
    if (!id || !name || !email) die('ใช้: npm run user -- add <รหัส> <ชื่อ> <section> <อีเมล Google>');
    addUser(id, name, section ?? '', email);
    console.log(`เพิ่ม ${id} (${name}) แล้ว — ล็อกอินด้วย ${email}`);
    break;
  }
  case 'import': {
    const file = args[0] ?? die('ใช้: npm run user -- import <file.csv>');
    let n = 0;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [id, name, section, email] = line.split(',').map((s) => s.trim());
      if (!id || !name || !email || id === 'studentId') continue;
      try {
        addUser(id, name, section ?? '', email);
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
  case 'section': {
    const [id, section] = args;
    if (!id || section == null) die('ใช้: npm run user -- section <รหัส> <section>');
    console.log(setSection(id, section) ? `ย้าย ${id} ไป ${section} แล้ว` : `ไม่พบ ${id}`);
    break;
  }
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
    console.table(db.prepare('SELECT student_id, name, section, email, role FROM users ORDER BY section, student_id').all());
    break;
  case 'remove': {
    const r = db.prepare('DELETE FROM users WHERE student_id = ?').run(args[0] ?? die('ใช้: npm run user -- remove <รหัส>'));
    console.log(Number(r.changes) ? 'ลบแล้ว' : 'ไม่พบบัญชีนี้');
    break;
  }
  default:
    die('คำสั่ง: add, import, email, section, teacher, password, list, remove');
}

function randomPassword(): string {
  return randomBytes(9).toString('base64url');
}
