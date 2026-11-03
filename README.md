# MIPS Lab

เว็บแอปสำหรับเรียนรู้สถาปัตยกรรมคอมพิวเตอร์ผ่านการเขียนโปรแกรม **C, MIPS และ Z80** ผู้เรียนทดลองแปลงโค้ด รันโปรแกรมทีละขั้น และทำแบบฝึกหัดพร้อมผลตรวจได้ในเบราว์เซอร์ ส่วนอาจารย์จัดการห้องเรียน มอบหมายงาน และติดตามผลการเรียนได้ในระบบเดียว

**[เปิดใช้งาน MIPS Lab](https://mips-lab-kku.pages.dev)**

## ฟีเจอร์หลัก

### ทดลองเขียนและรันโปรแกรม

- แปลงภาษา C ชุดย่อยเป็น MIPS พร้อม machine code และคำอธิบายคำสั่งภาษาไทย
- เลือกบรรทัด C หรือคำสั่ง MIPS เพื่อดูส่วนของโค้ดที่เชื่อมโยงกัน และแปลง MIPS กลับเป็น C เพื่อศึกษาพฤติกรรมของคำสั่ง
- รัน MIPS ทีละขั้น ดูค่า registers, memory, stack และ datapath พร้อมย้อนดูสถานะการทำงาน
- ทดลอง C ที่มีฟังก์ชัน recursion, pointer, array, `switch`, `sizeof` และอาร์เรย์ 2 มิติ
- ต่อวงจรบอร์ด Z80 เสมือน เขียน assembly ทดลอง ROM/RAM และพอร์ต I/O พร้อม logic analyzer และ serial terminal
- เปิดหน้าแรกเพื่อทดลอง C → MIPS ได้ก่อนเข้าสู่ระบบ

### สำหรับนักศึกษา

- สมัครสมาชิกและเข้าสู่ระบบด้วยรหัสผ่าน หรือใช้บัญชี Google ผ่าน Firebase Auth
- เข้าห้องเรียนด้วยรหัสห้อง ดูงานที่ได้รับมอบหมายและกำหนดส่ง
- ทำแบบฝึกหัด C, MIPS และ Z80 พร้อมบันทึกโค้ดอัตโนมัติ ทดสอบเคสตัวอย่าง และส่งตรวจเคสซ่อน
- ดูคะแนน ประวัติการส่ง เฉลย และอันดับในห้องเรียน
- ส่งวงจรและโปรแกรม Z80 เป็นงานโปรเจกต์ให้อาจารย์ตรวจ

### สำหรับอาจารย์

- สร้างห้องเรียนแยกตามปีการศึกษาและภาคเรียน จัดการรายชื่อและรหัสเข้าห้อง
- สร้างและแก้ไขโจทย์ กำหนดเฉลย เคสทดสอบ คะแนน และการเผยแพร่
- มอบหมายโจทย์และโปรเจกต์ Z80 พร้อมกำหนดส่ง ตรวจคะแนนและให้ความเห็น
- จัดการบัญชีนักศึกษา ดูความคืบหน้า คะแนนรายข้อ และประวัติการส่ง
- ค้นหา กรอง เรียงลำดับ และเลือกคอลัมน์ในตาราง พร้อมส่งออก CSV, Word และพิมพ์หรือบันทึก PDF

## เทคโนโลยี

| ส่วน | เทคโนโลยี |
| --- | --- |
| เว็บแอป | React, TypeScript, Vite |
| API | Cloudflare Pages Functions |
| ฐานข้อมูล | Cloudflare D1 |
| การเข้าสู่ระบบ | บัญชีและ session ใน D1; Google Sign-in ผ่าน Firebase Auth สำหรับนักศึกษา |
| Compiler และ simulator | TypeScript ใช้ร่วมกันในเบราว์เซอร์และระบบตรวจคำตอบ |
| การทดสอบ | Vitest และ Playwright |

ระบบตรวจคำตอบและคำนวณคะแนนบน server โดยเก็บบัญชี ห้องเรียน โจทย์ คะแนน และงานที่ส่งใน D1 ส่วน Firebase ใช้สำหรับยืนยันตัวตนด้วย Google

## เริ่มใช้งานบนเครื่อง

ต้องใช้ **Node.js 22.12 ขึ้นไป** และ npm

```sh
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run build
npm run dev
```

เปิด [http://localhost:5173](http://localhost:5173) โดยเว็บจะเรียก local API ที่พอร์ต `3001` และใช้ฐานข้อมูล D1 บนเครื่อง

คำสั่ง seed เตรียมโจทย์เริ่มต้น 24 ข้อและบัญชีอาจารย์ บัญชีสำหรับเครื่องนี้อยู่ที่ `private/local-admin.json` ซึ่งถูกยกเว้นจาก Git การเริ่มใช้งานด้วยรหัสผ่านไม่ต้องตั้งค่า Google เพิ่ม ส่วนการใช้ Google Sign-in ดู [คู่มือ Firebase Google Login](docs/firebase-google-login.md)

## คำสั่งที่ใช้บ่อย

| คำสั่ง | การใช้งาน |
| --- | --- |
| `npm run dev` | เปิดเว็บและ Pages Functions บนเครื่อง |
| `npm run build` | ตรวจ TypeScript และสร้าง production bundle |
| `npm test` | ทดสอบ compiler, simulator, grader และกติกาของระบบ |
| `npm run test:e2e` | ทดสอบ API และหน้าเว็บด้วย local D1 และ Playwright |
| `npm run db:migrate:local` | ปรับ schema ของฐานข้อมูลบนเครื่อง |
| `npm run db:seed:local` | เตรียมโจทย์และบัญชีเริ่มต้นบนเครื่อง |

สำหรับ E2E ครั้งแรก ติดตั้งเบราว์เซอร์ด้วย `npx playwright install chromium` ก่อนรันชุดทดสอบ

## นำขึ้น Cloudflare

โปรเจกต์ใช้ Cloudflare Pages ชื่อ `mips-lab-kku` และ D1 ชื่อ `mips-lab-db` ตั้งค่าใน `wrangler.toml`

```sh
npx wrangler login
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

ใช้ seed เมื่อเตรียมระบบครั้งแรก โดยบัญชีและโจทย์ที่มีอยู่จะไม่ถูกเขียนทับ สำรองฐานข้อมูลก่อนเปลี่ยน schema ของระบบที่ใช้งานจริง และเก็บบัญชี ไฟล์ seed และ database dump ไว้ใน `private/` โดยไม่ commit ลง Git อ่านขั้นตอนเพิ่มเติมใน [คู่มือ Cloudflare Pages และ D1](docs/cloudflare-deployment.md)

## โครงสร้างโปรเจกต์

```text
src/
  components/       ส่วนประกอบหน้าเว็บ ตาราง และภาพจำลอง
  screens/          หน้านักศึกษา อาจารย์ และห้องทดลอง
  lib/cc/           Compiler C → MIPS และตัวแปลง MIPS → C
  lib/mips/         Assembler, CPU และ datapath
  lib/z80/          Assembler, emulator และบอร์ด Z80
  data/             คลังโจทย์เริ่มต้น
functions/api/      Cloudflare Pages Functions API
cloudflare/        การเข้าถึง D1 บัญชี ห้องเรียน และกติกาของระบบ
migrations/        Schema และ migration ของ D1
scripts/           เตรียมข้อมูลและเครื่องมือดูแลโปรเจกต์
e2e/               การทดสอบ API และเบราว์เซอร์
examples/          ตัวอย่างวงจรและโปรแกรม Z80
docs/              คู่มือการใช้งานและรายละเอียดทางเทคนิค
server/            Backend Express/SQLite รุ่นเดิมสำหรับอ้างอิง
```

## ขอบเขตของตัวแปลงภาษา

Compiler รองรับ **C ชุดย่อยสำหรับการเรียน** โดยใช้โมเดลจำนวนเต็ม 32 บิต ยังมีข้อจำกัด เช่น ฟังก์ชันรับได้ไม่เกิน 4 พารามิเตอร์ อาร์เรย์ไม่เกิน 2 มิติ และยังไม่รองรับ floating point, struct/union, preprocessor และ standard library/I/O การแปลง MIPS กลับเป็น C อธิบายพฤติกรรมของคำสั่งและอาจได้โครงสร้างต่างจาก source เดิม

ดูรายละเอียดและตัวอย่างใน [ขอบเขตภาษา C ที่รองรับ](docs/c-education-features.md) และ [ผลตรวจ compiler และระบบ](docs/compiler-and-system-audit.md)

## เอกสารเพิ่มเติม

- [ห้องเรียน งานมอบหมาย โปรเจกต์ Z80 และตารางข้อมูล](docs/classroom-integration.md)
- [การเข้าสู่ระบบด้วย Google และการเชื่อมบัญชี](docs/firebase-google-login.md)
- [ติดตั้ง ดูแลระบบ และ deploy บน Cloudflare](docs/cloudflare-deployment.md)
- [ตัวอย่าง C: switch, sizeof, pointer และ matrix](docs/c-education-features.md)
