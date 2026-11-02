# Google Login: Firebase Auth + Cloudflare D1

Firebase ใช้เฉพาะยืนยันตัวตนด้วย Google ฐานข้อมูลนักศึกษา ห้องเรียน โจทย์ คะแนน งานที่ส่ง และ session ยังคงอยู่ใน D1 เดิม ไม่มี Firestore หรือ Realtime Database ในเส้นทางทำงานของ MIPS Lab

## โปรเจกต์ที่ใช้

ผู้ใช้เลือกใช้ Firebase project `muton-2802c` แทนการลบ หลังตรวจพบว่าโควตาสร้างโปรเจกต์ใหม่เต็ม และการลบโปรเจกต์ไม่คืนโควตาทันที ไม่มีการลบโปรเจกต์หรือฐานข้อมูลเดิมของ Muton

สร้าง Web App ชื่อ **MIPS Lab** ภายใต้โปรเจกต์นี้ด้วย Firebase CLI ของผู้ใช้ แล้วเปิด Google provider ด้วย `firebase deploy --only auth` เก็บ config สำหรับ Auth ไว้ใน `.firebaserc` / `firebase.json`

โดเมน `localhost`, `127.0.0.1` และ `mips-lab-kku.pages.dev` ได้รับอนุญาตใน Firebase Auth โดยยังเก็บ authorized domains เดิมไว้ Firebase API key ใน `src/lib/firebaseConfig.ts` เป็น public web configuration ไม่ใช่ OAuth client secret หรือสิทธิ์ admin ห้ามนำ CLI tokens, service account keys หรือ auth exports มาใส่ใน source code

## การทำงาน

1. ผู้ใช้กด Google ในหน้าล็อกอิน Firebase SDK เปิดหน้าต่างเลือกบัญชีและออก Firebase ID token
2. Pages Function ตรวจลายเซ็น RS256 จากกุญแจสาธารณะของ Google รวมถึง project audience, issuer, อายุ token, เวลายืนยันตัวตน, verified email และ provider `google.com` ไม่เชื่อ role ที่ส่งมาจาก browser
3. ค้นบัญชี D1 จาก `firebase_uid` แล้วออก session D1 ตามกลไกเดิม บัญชีที่อาจารย์ปิดยังเข้าระบบไม่ได้
4. Google account ใหม่สร้างเป็นนักศึกษาเท่านั้น ต้องตั้งรหัสนักศึกษาจริงก่อนเข้าห้องเรียน หากมีรายชื่อรออยู่ ระบบจะจับคู่หลังตั้งรหัสนักศึกษา
5. นักศึกษาที่มีบัญชีเดิมเข้าสู่ระบบด้วยรหัสผ่านก่อน แล้วกด **เชื่อมต่อบัญชี Google** ในหน้าตั้งค่า การเชื่อมคง user ID, รหัสผ่าน, ห้องเรียน และคะแนนเดิม ไม่ยึดบัญชีเดิมจาก email หรือรหัสนักศึกษาเพียงอย่างเดียว

อาจารย์ใช้ชื่อผู้ใช้และรหัสผ่านเท่านั้น หน้าอาจารย์ไม่มีปุ่ม Google หรือสมัครสมาชิก และ server ปฏิเสธ Google login / Google linking สำหรับบัญชีอาจารย์ รวมถึงบัญชีที่เคยเชื่อม Google ไว้ก่อนเปลี่ยนนโยบาย

นักศึกษาสมัครด้วยรหัสนักศึกษา ชื่อ และรหัสผ่านได้จากปุ่ม **สมัครสมาชิก** ในหน้าล็อกอิน ใช้ `/api/auth/register` และ session D1 เดิม เลือกใส่รหัสเข้าห้องตอนสมัครหรือเข้าภายหลังได้ ระบบตรวจรหัสซ้ำทั้งแบบมี/ไม่มีขีด บังคับ role นักศึกษา และจำกัดจำนวนคำขอสมัคร

SDK ใช้ in-memory Firebase persistence และ sign out หลังนำ ID token ออกมาแล้ว การใช้งานต่อเป็น session D1 ไม่ย้ายระบบ session หรือข้อมูลห้องเรียนเข้า Firebase

## Schema และ deployment

`0003_firebase_google.sql` เพิ่ม `users.firebase_uid` พร้อม unique index เท่านั้น ก่อน deploy backend ใหม่ต้อง apply migration ให้ตรงกับฐานข้อมูลนั้น

```sh
npm ci
npm run db:migrate:local
npm run build
npm test
npm run test:e2e
```

Firebase Auth configuration เปิดใช้บน project แล้ว ส่วน code และ D1 migration สำหรับเว็บ production ต้อง deploy แยกตาม workflow ของ Cloudflare ไม่มีการ deploy Hosting/Firestore/Realtime Database ด้วย Firebase CLI

## การทดสอบ

- ตรวจ token ที่เซ็นจริงด้วย test key และปฏิเสธ audience/issuer/provider/email/เวลา/ลายเซ็นที่ไม่ถูกต้อง
- ตรวจ account linking กับ schema SQL จริง รวมถึงคะแนนเดิม บทบาทอาจารย์ บัญชีปิด และการห้ามยึดบัญชีด้วยอีเมล
- Browser tests ตรวจปุ่ม Google, token ปลอม และระบบแนะนำทุก route บน desktop/mobile
- การเลือกบัญชี Google จริงเป็นการโต้ตอบของเจ้าของบัญชี ชุดทดสอบไม่ได้เก็บหรือกรอกรหัสผ่าน Google ของผู้ใช้

อ้างอิง [Firebase Google Sign-in](https://firebase.google.com/docs/auth/web/google-signin), [การตรวจ ID token](https://firebase.google.com/docs/auth/admin/verify-id-tokens) และ [ตั้งค่า Auth ด้วย CLI](https://firebase.google.com/docs/auth/configure-providers-cli)
