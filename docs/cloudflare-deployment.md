# Cloudflare Pages + D1

Production project: `mips-lab-kku` · URL: https://mips-lab-kku.pages.dev

Database: `mips-lab-db` · binding: `DB` · configuration: `wrangler.toml`

`pages.dev` เป็น Cloudflare Pages ส่วน GitHub เก็บ source code; GitHub Pages เป็นบริการ static คนละระบบและไม่รัน D1/Pages Functions การ deploy ครั้งนี้ใช้ Wrangler แบบ direct upload ไม่ได้อ้างว่าตั้ง Git integration หรือ automatic deploy จากทุก push แล้ว

## ใช้งานบนเครื่อง

ต้องใช้ Node 22.12+ (ทดสอบด้วย Node 25) และติดตั้ง dependency ด้วย `npm ci`

```sh
npm run db:migrate:local
npm run db:seed:local
npm run build
npm run dev
```

เปิด http://localhost:5173 · Vite proxy `/api` ไป local Pages Functions บน :3001 ซึ่งใช้ local D1 เท่านั้น

บัญชีอาจารย์ local อ่านจาก `private/local-admin.json`; production อ่านจาก `private/remote-admin.json` ทั้งโฟลเดอร์ถูก gitignore ห้าม push ไฟล์เหล่านี้หรือ SQL seed ซึ่งมี password hash ไม่ต้องสร้าง `.env` หรือใส่ Google key เพื่อเริ่มใช้งาน

## Deploy

```sh
npx wrangler whoami
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

Seed ตรวจเฉลยครบทุกข้อก่อนเขียนและใช้ INSERT OR IGNORE จึงไม่ทับ user หรือโจทย์ที่มีอยู่แล้ว ไม่ควรใช้ seed เป็นวิธีอัปเดตโจทย์ที่เคยตรวจให้คะแนนแล้ว ให้ใช้งานหน้าอาจารย์หรือสร้าง migration เฉพาะ

ก่อนเปลี่ยน schema ของระบบที่มีข้อมูลใช้งานจริงให้ export:

```sh
npx wrangler d1 export mips-lab-db --remote --output private/backup.sql
```

สำหรับ CI ในอนาคตต้องเพิ่ม Cloudflare API token ลง GitHub Actions Secrets พร้อม Account ID จึงจะตั้ง workflow deploy ได้ ไม่ควรนำ OAuth token ของ Wrangler บนเครื่องไป commit หรือคัดลอกใส่ workflow

## การดูแลห้องเรียน

1. เข้าแท็บอาจารย์ด้วยบัญชี admin ที่เก็บในไฟล์ private แล้วเปลี่ยนรหัสที่หน้าตั้งค่า
2. หน้าอาจารย์ → นักศึกษาและคะแนน → เพิ่มนักศึกษา ใส่รหัส ชื่อ กลุ่ม และรหัสผ่านเริ่มต้น
3. นักศึกษาเข้าสู่ระบบด้วยรหัสและรหัสผ่าน เปลี่ยนรหัสผ่านได้เอง แต่ย้ายกลุ่ม/เปลี่ยนรหัสนักศึกษาเองไม่ได้
4. สร้างโจทย์ ระบุภาษา ฟังก์ชัน พารามิเตอร์ เคสทดสอบ เฉลย คะแนน กลุ่ม และกำหนดส่ง
5. เฉลยต้องผ่านทุกเคสก่อนบันทึก เลือกเผยแพร่เพื่อเปิดให้นักศึกษาในกลุ่มนั้น
6. ดูคะแนน สถานะรายข้อ ประวัติส่ง และโค้ดรายคน กรองชั้นปี/กลุ่มและส่งออก CSV ได้

คะแนนพื้นฐานตั้งได้ 1–1000; ผ่านในการ submit ครั้งแรก +5; การ test ไม่ทำให้เสียโบนัส; คะแนนบันทึกครั้งเดียวด้วย unique key และ D1 transaction batch; อาจารย์ทดลองโจทย์แล้วไม่ได้คะแนนในอันดับ

เมื่อมีผู้ทำโจทย์แล้วจะล็อกภาษา พารามิเตอร์ เคส เกณฑ์ และคะแนน แต่แก้ข้อความ เฉลยที่ผ่านเดิม สถานะเผยแพร่ กลุ่ม และกำหนดส่งได้ การปิดบัญชีเพิกถอน session และกัน login แต่เก็บประวัติไว้

## ความปลอดภัยและการตรวจสอบ

- Password: PBKDF2 SHA-256 พร้อม salt สุ่มต่อบัญชี; session token สุ่ม 256 bits และเก็บเฉพาะ SHA-256 hash ใน D1 อายุ 7 วัน
- ล็อก login หลังผิด 5 ครั้งต่อ IP+username เป็นเวลา 10 นาที บันทึกใน D1
- Teacher endpoints ตรวจ role บน server; การเรียกด้วยบัญชีนักศึกษาถูกปฏิเสธ
- เคสซ่อนและเฉลยไม่ออกใน API โจทย์นักศึกษา; ผลเคสซ่อนแสดงเฉพาะผ่าน/ไม่ผ่าน
- Endpoint dev login ไม่ถูกเปิดใน Pages Functions; Google OAuth ยังปิดอยู่
- Local และ remote D1 แยกกัน; E2E ไม่แตะฐานข้อมูล production
- `npm test` ตรวจ compiler/CPU/grader และกติกาห้องเรียน; `npm run test:e2e` ตรวจ API กับ local D1 และ browser desktop/mobile

ตรวจ production แล้ว: health/D1, password login/logout, dashboard และการตรวจเฉลย MIPS/C/Z80 บน `pages.dev` ผ่าน โดยใช้บัญชีอาจารย์ ไม่ได้สร้างนักศึกษาหรือคะแนนตัวอย่างใน production; มี CI บน GitHub สำหรับ build, unit tests และ local D1/browser E2E ส่วน deployment ยังใช้คำสั่ง Wrangler
