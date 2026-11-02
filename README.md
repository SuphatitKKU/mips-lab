# MIPS Lab — Cloudflare classroom

ดึงฐานจาก branch เพื่อน `mips-lab-web` (`f180d62`) แล้วทำต่อบน `codex/cloudflare-teacher-dashboard`

ระบบปัจจุบัน: **React + TypeScript + Vite → Cloudflare Pages Functions → D1**

เว็บ: https://mips-lab-kku.pages.dev · เพิ่ม Google Login ผ่าน Firebase Auth แล้ว ข้อมูลและ session ยังอยู่ใน D1 เดิม นักศึกษาสมัครสมาชิกเองหรือเชื่อม Google กับบัญชีเดิมได้ อาจารย์ใช้รหัสผ่านเท่านั้น

- อาจารย์สร้าง/แก้โจทย์ C, MIPS, Z80 พร้อมเฉลย public/hidden cases คะแนน กลุ่มเรียน และวันส่ง
- จัดการบัญชีนักศึกษา กลุ่ม ชั้นปี รหัสผ่าน การเปิด/ปิดบัญชี และดูคะแนน/ประวัติส่งรายคน
- ชั้นปีคำนวณจากเลข 2 หลักแรกของรหัสและปีการศึกษาที่อาจารย์ตั้ง พร้อม override รายคน
- ตรวจคำตอบและให้คะแนนฝั่ง server; draft/attempt/solve เก็บใน D1 จริง
- ห้องเรียนแยกภาคเรียน รหัสเข้าห้อง รายชื่อรอ งานมอบหมาย และโปรเจกต์ Z80 ที่ตรวจคะแนน/ให้ความเห็นได้
- ตารางรายชื่อและผลคะแนนค้นหา เรียงลำดับ แบ่งหน้า เลือกคอลัมน์ ส่งออก CSV/Word/PDF ได้
- ไม่ต้องมีฐานข้อมูลหรือ Google keys เดิม และไม่เปิด dev-login ใน production

## เริ่มบนเครื่อง

```sh
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run build
npm run dev
```

เว็บ http://localhost:5173 · local API :3001 · บัญชี local อยู่ `private/local-admin.json` (gitignored)

```sh
npm test
npm run test:e2e
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

บัญชี production อยู่ `private/remote-admin.json` ห้าม commit โฟลเดอร์ private, SQL seed, database dump หรือ credentials

ฟีเจอร์ใหม่: `switch`, `sizeof`, `&ตัวแปร` และอาร์เรย์ 2 มิติ พร้อม [ตัวอย่างและขอบเขตภาษา](docs/c-education-features.md)

อ่าน [คู่มือ Firebase Google Login](docs/firebase-google-login.md), [คู่มือ classroom และ data tables](docs/classroom-integration.md), [คู่มือ deploy/ใช้งาน](docs/cloudflare-deployment.md) และ [ผลตรวจ compiler/ระบบเดิม](docs/compiler-and-system-audit.md)

## ที่มาของโจทย์

branch เพื่อนขาด `src/data/` เพราะกฎ ignore `data/` ครอบทุกตำแหน่ง แก้เป็น `/data/` และประกอบ bank กลับเป็น 24 ข้อ ข้อ 14–24 ดัดแปลงจาก JSON ของ `origin/main`; ข้อ 1–13 สร้างจากพฤติกรรมที่ tests และ README เดิมอธิบาย ไม่ใช่ไฟล์ต้นฉบับที่กู้ครบทุกตัวอักษร ไม่มีข้อมูล user หรือคะแนนเดิมใน Git ให้ย้าย

## โครงสร้าง

- `functions/api/[[path]].ts` — Pages Functions API, authorization และ classroom workflow
- `cloudflare/` — D1 queries, password/session และกติกาชั้นปี/คะแนน/validation
- `migrations/` — schema D1; `scripts/seed-d1.ts` — seed ที่ไม่ทับข้อมูลเดิม
- `src/lib/cc`, `src/lib/mips`, `src/lib/z80` — compiler, assembler และ simulator จาก branch เพื่อน
- `src/screens/TeacherDashboard.tsx` — dashboard ที่เชื่อม D1 ผ่าน API
- `e2e/` — ทดสอบ classroom จริงกับ local D1 และ browser
- `server/` — backend Express/SQLite เดิม เก็บไว้เป็น reference; ไม่ได้ deploy และ CLI ในนี้ไม่แก้ D1

## เอกสารของ branch เพื่อน (ประวัติ ก่อนย้าย Cloudflare)

รายละเอียดด้านล่างบันทึก backend/Google/SQLite แบบเดิม ไม่ใช่ขั้นตอนใช้งาน production ปัจจุบัน


เว็บแอปฝึก C ⇄ MIPS และ Z80 (React + TypeScript + Vite, backend เป็น Node + SQLite) สร้างตาม design handoff "Modernist MIPS Lab v3"

## เริ่มใช้งาน

ต้องใช้ Node 22.5 ขึ้นไป (ใช้ `node:sqlite` ที่มากับ Node)

```bash
npm install
cp .env.example .env   # ใส่ GOOGLE_CLIENT_ID (ดูหัวข้อด้านล่าง) — ไม่มีค่านี้จะล็อกอินไม่ได้
npm run seed:demo   # เพื่อนร่วมชั้นตัวอย่างสำหรับหน้าอันดับ (ไม่บังคับ)
npm run dev         # API ที่ :3001 + เว็บที่ http://localhost:5173
npm test            # unit test: assembler, CPU, C compiler, MIPS→C, Z80, ตัวตรวจโจทย์
npm run build       # typecheck ทั้งเว็บและ server แล้ว build ลง dist/
npm start           # production: server เดียวเสิร์ฟทั้ง API และ dist/ (PORT, ค่าเริ่มต้น 3001)
```

ฐานข้อมูลอยู่ที่ `data/mipslab.db` (เปลี่ยนได้ด้วย `MIPSLAB_DB`)

## เข้าสู่ระบบด้วย Google (ทางเดียวที่ใช้ได้)

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → ประเภท **Web application**
2. Authorized JavaScript origins ใส่ `http://localhost:5173` (และโดเมนจริงตอน deploy)
3. คัดลอก `.env.example` เป็น `.env` แล้วใส่ `GOOGLE_CLIENT_ID=...` จากนั้นรัน `npm run dev` ใหม่

**ทดลองโดยไม่ต้องตั้งค่า Google:** ตอนรัน `npm run dev` หน้าล็อกอินจะมีปุ่ม "เข้าแบบทดลอง (dev)" เข้าเป็นบัญชี `dev` (SEC 1) ได้ทันที — ปุ่มนี้ไม่มีใน `npm start` (บังคับเปิดได้ด้วย `MIPSLAB_DEV_LOGIN=1` ห้ามใช้บนเครื่องจริง)

ล็อกอินครั้งแรกระบบสร้างบัญชีให้อัตโนมัติ (ไม่มีระบบรหัสผ่าน) — ถ้าอีเมลเป็นแบบ `6601234567@…` จะใช้เลขนั้นเป็นรหัสนักศึกษา ถ้าอีเมลตรงกับที่อาจารย์ลงทะเบียนไว้จะเข้าบัญชีนั้น · `MIPSLAB_GOOGLE_DOMAIN` จำกัดให้ใช้ได้เฉพาะโดเมนเดียว · server ตรวจลายเซ็น ID token กับกุญแจของ Google เองทุกครั้ง

## จัดการบัญชี (สำหรับอาจารย์ · ไม่บังคับ)

```bash
npm run user -- add 6601234567 "ชื่อ นามสกุล" "SEC 1" someone@uni.ac.th   # ลงทะเบียนล่วงหน้า
npm run user -- import students.csv        # studentId,name,section,email ต่อบรรทัด
npm run user -- email 6601234567 someone@uni.ac.th
npm run user -- section 6601234567 "SEC 2"
npm run user -- teacher somchai.j "อ.สมชาย ใจดี"  # สร้างบัญชีอาจารย์ (ไม่ใส่รหัสผ่าน = สุ่มให้แล้วพิมพ์ออกมา)
npm run user -- password somchai.j             # ตั้งรหัสผ่านอาจารย์ใหม่ (ลืมรหัส)
npm run user -- list
npm run user -- remove 6601234567
```

## บทบาท: นักศึกษา / อาจารย์

- **นักศึกษา** — เข้าด้วย Google (สร้างบัญชีให้อัตโนมัติ) · ทำโจทย์ ติดอันดับ แก้ชื่อ/กลุ่มเรียนได้เอง และตั้งรหัสนักศึกษาได้ครั้งเดียว (หลังจากนั้นอาจารย์แก้ให้)
- **อาจารย์** — เข้าด้วย**ชื่อผู้ใช้และรหัสผ่าน** (แท็บ "อาจารย์" ในหน้าล็อกอิน) · มีเมนู "อาจารย์" (`/teacher`) ดูรายชื่อ คะแนน การใช้งานล่าสุด แก้ชื่อ/รหัส/กลุ่มของนักศึกษา เพิ่มบัญชีอาจารย์ และตั้งรหัสผ่านใหม่ให้อาจารย์ท่านอื่น · ไม่อยู่ในกระดานอันดับ · เปิดเฉลยได้โดยไม่เสียคะแนน
- สร้างบัญชีอาจารย์คนแรกด้วย `npm run user -- teacher <ชื่อผู้ใช้> "<ชื่อ>"` · รหัสผ่านเก็บแบบ scrypt hash · ใส่รหัสผิด 5 ครั้งล็อก 10 นาที · ตอน `npm run dev` มีปุ่ม "เข้าแบบทดลองเป็นอาจารย์ (dev)"

## Routes

| Path | หน้าจอ |
| --- | --- |
| `/login` | นักศึกษาเข้าด้วย Google · อาจารย์เข้าด้วยชื่อผู้ใช้/รหัสผ่าน |
| `/` | หน้าแรก: ทำต่อจากครั้งก่อน, คะแนน, streak, อันดับสัปดาห์ |
| `/code` | เขียน C หรือ MIPS ที่เดียว แล้วสลับโหมด · **แปลง** (`?mode=convert`): C → MIPS (compiler จริง) / MIPS → C พร้อม machine code และคำอธิบายทีละคำสั่ง · **รันทีละขั้น** (`?mode=run`): ใส่ค่า $a0–$a3 (ตัวเลขหรืออาร์เรย์), แถบควบคุมด้านล่าง (← / → บนคีย์บอร์ดก็ได้), Registers, Memory, Datapath, ประวัติ · `/convert` และ `/sim` เดิมพามาที่นี่ |
| `/problems` | รายการโจทย์ กรองตามหัวข้อ/สถานะ/ค้นหา |
| `/problems/:id` | ทำโจทย์: บันทึกอัตโนมัติ, ทดสอบ (เคสที่เห็น), ส่งคำตอบ (รวมเคสซ่อน) |
| `/problems/:id/answer` | เฉลย (เปิดก่อนผ่านได้คะแนนครึ่งเดียว) |
| `/leaderboard` | อันดับ สัปดาห์/เดือน/ตลอดกาล ในกลุ่มหรือทั้งหมด |
| `/settings` | ตั้งค่าโปรไฟล์: ชื่อ, รหัสนักศึกษา, กลุ่มเรียน (อาจารย์: ชื่อผู้ใช้, เปลี่ยนรหัสผ่าน), ออกจากระบบ (กดรูปโปรไฟล์ที่เมนู) |
| `/teacher` | (อาจารย์) รายชื่อทั้งหมด ค้นหา/กรองกลุ่ม แก้ข้อมูลและบทบาท |
| `/z80` | บอร์ด Z80 ระดับขา: ชิปทุกตัวใช้ pinout จริง (Z80, 2764, 6264, 74HC138/574/244), ต่อสายขาต่อขาหรือทั้งบัส, รางไฟ +/−, ตรวจวงจรบอกขาที่ผิด, ROM/RAM/พอร์ตทำงานตาม address decode ที่ต่อ, ปุ่มรีเซ็ต, logic analyzer · `?problem=7` ส่งคำตอบโจทย์ Z80 |

## โครงสร้าง

- `src/lib/mips/` — assembler (คำสั่ง MIPS32 จำนวนเต็ม + pseudo-instruction + directive `.data`/`.word`/`.asciiz` ฯลฯ), CPU ที่อธิบายแต่ละขั้นเป็นภาษาไทยและย้อนกลับได้, decoder
- `src/lib/cc/` — `compile.ts` คอมไพเลอร์ C ชุดย่อย → MIPS (ฟังก์ชัน, recursion, pointer/array, global) · `lift.ts` แปลง MIPS → C
- `src/lib/z80/` — assembler + emulator Z80 · `board.ts` pinout, net และการตรวจวงจร · `machine.ts` ต่อ emulator เข้ากับวงจร (memory map, OUT/IN)
- `src/lib/grader.ts` — ตัวตรวจโจทย์ (ใช้ทั้งฝั่ง server)
- `src/data/problems.ts` — คลังโจทย์ 24 ข้อ พร้อมเคสทดสอบ เคสซ่อน คำใบ้ และเฉลย · เพิ่มโจทย์ใหม่ที่ไฟล์นี้ (มี test ตรวจว่าเฉลยทุกข้อผ่านเคสของตัวเอง) · ข้อ 14–24 อยู่ใน `src/data/basicProblems.ts`
- `server/` — API (Express), ฐานข้อมูล, คะแนน/อันดับ, CLI จัดการบัญชี
- `src/screens/`, `src/components/` — หน้าจอและ component (เช่น `CodeEditor`, `Datapath`)

## การคิดคะแนน

ง่าย 10 · กลาง 20 · ยาก 40 pts — ผ่านในการส่งครั้งแรก +5 · เปิดเฉลยก่อนผ่านได้ครึ่งเดียว · อันดับสัปดาห์เริ่มนับใหม่ทุกวันจันทร์

## เครดิต

- **[SuphatitKKU/mips-lab](https://github.com/SuphatitKKU/mips-lab)** (งานคน A) — โจทย์ข้อ 14–24 (บวก, ลบ, คู่/คี่, ยกกำลังสอง, ค่ามาก/น้อยกว่า, ค่าสัมบูรณ์, เครื่องหมาย, clamp, 2ⁿ, ห.ร.ม.) มาจากชุดโจทย์ `content/problems/mips` ของ repo นี้ โดยใช้ test case และเฉลยเดิม แล้วเขียนโจทย์ คำใบ้ เคสซ่อน และคำอธิบายเพิ่ม · คำสั่ง `ll` / `sc` (จอง address แล้วเขียนแบบมีเงื่อนไข) ทำตามหลักการเดียวกับ simulator ของ repo นี้
