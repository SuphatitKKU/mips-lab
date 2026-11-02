# C สำหรับการเรียน: switch, sizeof, address และ matrix

เพิ่มความสามารถใน compiler TypeScript ตัวเดิม ทั้งฝั่ง browser และ Pages Functions ใช้ implementation เดียวกัน ไม่มีการเปลี่ยน schema D1 หรือรีเซ็ตบัญชี/คะแนน

## ลองบนหน้าเว็บ

เปิด `/code?mode=convert` แล้วเลือกตัวอย่างใหม่ในเมนู **โค้ดตัวอย่าง**:

1. **switch · fall-through และ break** — case 2 ทำงานต่อเข้า case 3 ได้ผล 25
2. **sizeof · ขนาดอาร์เรย์และแถว** — คำนวณจำนวนสมาชิกของ matrix 2×3 ได้ผล 6
3. **&ตัวแปร · แก้ค่าผ่าน pointer** — ส่ง `&value` ไปเพิ่มค่าในอีกฟังก์ชัน ได้ผล 5
4. **อาร์เรย์ 2 มิติ · row-major** — ส่งแถวที่สองไปหาผลรวม ได้ผล 15

คลิกบรรทัด C หรือคำสั่ง MIPS เพื่อดูตำแหน่งที่เชื่อมกันและคำอธิบาย จากนั้นเลือก **รันทีละขั้น** เพื่อดู register, memory และ stack ที่เปลี่ยนจริง

## พฤติกรรมที่รองรับ

- `switch/case/default`: ประเมิน selector ครั้งเดียว รองรับ labels ติดกัน, fall-through, nested switch และ default ที่อยู่กลางบล็อก ปฏิเสธ case/default ซ้ำและ case ที่ไม่ใช่ integer constant expression
- `break` ออกจาก loop/switch ที่ใกล้ที่สุด ส่วน `continue` ข้าม switch ไปหา loop ที่ครอบอยู่
- `sizeof(type)` และ `sizeof expression`: ไม่เรียกฟังก์ชันหรือเพิ่มค่าตัวแปรใน operand; อาร์เรย์ local/global คิดขนาดเต็ม ส่วนพารามิเตอร์อาร์เรย์คิดเป็น pointer
- `&local`, `&parameter`, `&global`, address ของสมาชิก และ pointer หลายระดับ ตัวแปรที่ address ถูกใช้จะมี storage ใน memory ทำให้การเขียนผ่าน alias เปลี่ยนค่าจริง
- อาร์เรย์ 2 มิติแบบขนาดคงที่: local/global, initializer แบนหรือแยกแถว, zero-fill ค่าเริ่มต้นที่ขาด, infer จำนวนแถวจาก initializer และพารามิเตอร์ `int a[][3]`
- การเข้าถึงแถวใช้ stride ตามจำนวนคอลัมน์; ส่ง `matrix[row]` ให้ฟังก์ชันที่รับ `int*` ได้
- การป้อนอาร์เรย์ให้ UI/grader ใช้รายการแบน เช่น `[1,2,3,4,5,6]` สำหรับ matrix 2×3 หน่วยความจำของ char เป็น byte ทั้ง browser, run-once และ grading
- Compound assignment ลง memory คำนวณ target เพียงครั้งเดียว เช่น `a[i++] += 3` ไม่เพิ่ม `i` สองครั้ง
- Integer constant expressions ใช้กับ case, dimensions และ static global initializers ได้ รวม sizeof ที่รู้ชนิดข้อมูล

ขนาดข้อมูลในโมเดล MIPS นี้: `int`, `unsigned int`, pointer = 4 bytes; `char`, `unsigned char` = 1 byte ตัวแปร scalar ที่ต้องวางบน stack อาจมี padding เพื่อจัดแนว 4 bytes แต่ sizeof(char) และระยะสมาชิก char array ยังคงเป็น 1 byte

## ขอบเขตที่ยังจำกัด

- ยังเป็นภาษา C ชุดย่อย ไม่ใช่การรับรอง conformance กับ C ทุกมาตรฐาน; arithmetic ของ simulator ใช้จำนวนเต็ม 32 บิต
- ฟังก์ชันรับได้ไม่เกิน 4 พารามิเตอร์ และยังมีขีดจำกัด register สำหรับ scalar ที่ไม่อยู่ใน memory
- Array ไม่เกิน 2 มิติ, สมาชิกไม่เกิน 4096 ต่อ declaration, stack frame ไม่เกิน 32760 bytes; VLA ยังไม่รองรับ พารามิเตอร์ matrix ต้องระบุจำนวนคอลัมน์คงที่
- Declarator ซับซ้อน เช่นการประกาศตัวแปร pointer-to-array แบบ `int (*p)[3]` ยังไม่รองรับ แม้การคำนวณ address/stride ของ matrix และพารามิเตอร์ matrix จะรองรับแล้ว
- ยังไม่รองรับ struct/union, floating point, standard library/I/O, string literals, preprocessor, goto และ comma operator
- `#include`, `#define`, `#if` และ comment ที่ไม่ปิดจะแจ้ง diagnostic พร้อมบรรทัด แทนการข้ามเงียบ ๆ
- การแปลง MIPS กลับ C แสดงพฤติกรรมของคำสั่ง ไม่ได้สร้างโครงสร้าง switch หรือ matrix เดิมคืนเหมือน source ทุกตัวอักษร

## การตรวจ

ทดสอบ source → compiler → assembler → MIPS CPU พร้อมตรวจ `$sp` และ `$s0–$s7`, กรณี alias/recursion/shadowing, signed/unsigned char, matrix หลายขนาดและทุก index, sizeof ที่ไม่มี side effects และภาษาไม่รองรับ นอกจากนี้เพิ่ม round-trip C → MIPS → C สำหรับฟีเจอร์ใหม่ และ browser E2E โหลดตัวอย่าง แปลง รัน และแสดง error จริง

อ้างอิงพฤติกรรมภาษา: [Microsoft C sizeof](https://learn.microsoft.com/en-us/cpp/c-language/sizeof-operator-c) และ [Microsoft C switch](https://learn.microsoft.com/en-us/cpp/c-language/switch-statement-c)
