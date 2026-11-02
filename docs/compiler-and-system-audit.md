# ผลตรวจ C → MIPS และระบบเดิม

ฐานงาน: `origin/mips-lab-web` commit `f180d62` ดึงมาที่ `D:\comarch-web` แล้วทำต่อบน `codex/cloudflare-teacher-dashboard` (ไม่ได้รวมทับ `main`)

## ตัวแปลงใช้เทคโนโลยีอะไร

เป็น compiler สำหรับการเรียนที่เขียนเองด้วย **TypeScript** ไม่ได้เรียก GCC, Clang, LLVM หรือบริการ AI

1. `src/lib/cc/parse.ts` แยก token และ parse แบบ recursive descent เป็น AST
2. `src/lib/cc/compile.ts` สร้าง MIPS assembly พร้อมตำแหน่งบรรทัด C และคำอธิบายภาษาไทย
3. `src/lib/mips/assembler.ts` แปลง assembly เป็นคำสั่งเครื่อง
4. `src/lib/mips/cpu.ts` จำลอง CPU เพื่อรัน ตรวจผล และแสดงการเปลี่ยน register/memory

บนหน้าแปลงและจำลอง งานนี้รันใน browser; การตรวจเพื่อให้คะแนนรันซ้ำบน Pages Functions โดยอ่านเกณฑ์จาก D1 นักศึกษาไม่สามารถส่งคะแนนที่คำนวณเองมาบันทึกได้

## สิ่งที่รองรับ

- `int`, `unsigned int`, `char`, `unsigned char`, `void`, pointer หลายระดับ และ array หนึ่ง/สองมิติ
- ตัวแปร local/global, local array, การอ่าน/เขียน memory ผ่าน pointer/array
- ฟังก์ชัน การเรียกซ้อน recursion และ return; พารามิเตอร์ไม่เกิน 4 ตัวผ่าน `$a0–$a3`
- `if/else`, `while`, `do/while`, `for`, `break`, `continue`, `switch/case/default` พร้อม fall-through
- arithmetic, comparison, bitwise, logical short circuit, ternary, assignment และ increment/decrement
- ฟังก์ชัน leaf ใช้ `$t` registers; ฟังก์ชันที่เรียกฟังก์ชันอื่นใช้ `$s` registers และ stack frame พร้อมบันทึก/คืน `$ra`
- แปลง MIPS → C ได้ด้วย lifter ของโปรเจกต์ แต่ไม่ได้ย้อนกลับเป็น source เดิม หรือเป็น decompiler สำหรับ executable ทั่วไป

## ข้อจำกัดที่สำคัญ

- ไม่ใช่ compiler C เต็มมาตรฐาน และไม่ใช่เครื่องมือสร้าง native executable
- ไม่รองรับ `struct`, `union`, floating point, `printf`/string literal, `goto`, `long`, `short`, `static local`, VLA, array มากกว่า 2 มิติ และ comma operator
- รองรับ `&` ของ local/parameter/global โดยตัวแปรที่มีการใช้ address จะเก็บบน stack และอ่าน/เขียนจริงผ่าน pointer
- รองรับ `sizeof(type)` / `sizeof expression` / ขนาดอาร์เรย์เต็มและรายแถว โดยไม่รัน operand
- ฟังก์ชันที่เรียกฟังก์ชันอื่นมีพารามิเตอร์และตัวแปร scalar รวมได้ไม่เกิน 8 ตัวตามจำนวน `$s` registers; leaf functions ก็มีขีดจำกัด register
- global initializer รองรับ integer constant expressions และ sizeof ที่ทราบชนิดข้อมูล แต่ไม่เรียกฟังก์ชันหรือเก็บ address ของ global เป็น initializer
- preprocessor เช่น `#include`, `#define`, `#if` จะถูกปฏิเสธด้วยข้อความอธิบาย ไม่ข้ามแล้วแปลงต่อเงียบ ๆ
- simulator มี instruction budget เพื่อหยุดโปรแกรมไม่จบ การตรวจบน Cloudflare ยังขึ้นกับ CPU quota ของบัญชี ควรใช้ test case ขนาดเล็กตามขอบเขตการเรียน

## หลักฐานทดสอบ

ชุด `compiler.suite.test.ts` ครอบคลุมทั้งความสามารถเดิมและฟีเจอร์ใหม่ (เพิ่ม positive tests แทนกรณีที่เดิมต้อง reject) ครอบคลุมโปรแกรมจริง, calling convention, 400 random expressions × 5 inputs, 200 random programs × 5 inputs, C → MIPS → C และกรณีที่ต้องปฏิเสธภาษานอก subset ส่วน `cc.test.ts` มีอีก 9 tests

## ส่วนไหนเป็นของจริง / ส่วนไหนหายหรือยังไม่พร้อม

| ส่วน | สิ่งที่ตรวจพบและสิ่งที่ทำต่อ |
|---|---|
| Compiler / assembler / CPU / Z80 | เป็น implementation จริง มี unit tests ไม่ใช่ผลลัพธ์ mock |
| Backend เดิม | Express + `node:sqlite` มี API คะแนนจริง แต่ใช้กับ Cloudflare Pages โดยตรงไม่ได้ |
| ไฟล์ฐานข้อมูลและ keys เดิม | ไม่ได้อยู่ใน Git จึงไม่มีประวัตินักศึกษา/คะแนนเดิมให้ย้าย ไม่อ้างว่าย้ายข้อมูลเดิมสำเร็จ |
| คลังโจทย์ | `src/data/` ไม่ได้ถูก push เพราะ `.gitignore` เขียน `data/` แบบไม่ยึด root; แก้เป็น `/data/` |
| โจทย์ที่ประกอบกลับ | 24 ข้อ: ข้อ 14–24 แปลงจาก JSON ใน `origin/main`; ข้อ 1–13 สร้างจากพฤติกรรมที่ tests/README อธิบาย ไม่ใช่การกู้ข้อความต้นฉบับที่หายไปทุกตัวอักษร |
| หน้าอาจารย์เดิม | มีการจัดการ user บางส่วน แต่ยังสร้างโจทย์ผ่านหน้าเว็บไม่ได้ |
| ระบบใหม่ | D1 จริงสำหรับ user/session/โจทย์/draft/attempt/solve/settings; Pages Functions เป็น API |
| Google OAuth | เลื่อนไว้ท้ายสุดตามคำขอ ไม่มีการใส่ client ID สมมติ และไม่มี dev login บน production |
| บัญชีทดลอง/คะแนนตัวอย่าง | ไม่ seed นักศึกษาปลอมหรืออันดับปลอมลง production; test data ใช้เฉพาะ local D1 |

ชั้นปีใช้เลข 2 หลักแรกเป็นปีที่เข้าเรียน เช่น 66 → 2566 และ `ปีการศึกษาปัจจุบัน - ปีที่เข้า + 1` อาจารย์ตั้งปีการศึกษาและ override ชั้นปีรายคนได้ เพราะรหัสไม่บอกการพักการเรียนหรือการซ้ำชั้น

รายละเอียดฟีเจอร์และขอบเขตใหม่: [C สำหรับการเรียน](c-education-features.md)
