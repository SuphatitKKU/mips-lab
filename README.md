# MIPS Lab — งานคน A

โปรเจกต์นี้ทำเฉพาะ **งานคน A** ตาม README ต้นฉบับ: assembler/encoder, simulator, `judge()`, ตัวแปลง C → MIPS, หน้าแปลงโค้ดและจำลองการรัน รวมถึงโจทย์ MIPS แยกไฟล์ หน้าตาเว็บอ้างอิงจากไฟล์ HTML template ที่ให้มา โดยแสดงเฉพาะหน้าของ A

## เริ่มใช้งาน

```powershell
npm install
npm run dev
```

เปิด `http://localhost:5173/convert` หรือ `http://localhost:5173/simulate` สั่ง `npm test`, `npm run typecheck`, และ `npm run build` เพื่อตรวจงาน

## โครงสร้างงาน A

| ที่อยู่ | สิ่งที่มี |
|---|---|
| `packages/contracts/index.ts` | `Reg`, `TestCase`, `JudgeFn`, `JudgeResult`, `Problem` ตาม contract กลาง |
| `packages/mips-core/src/isa.ts` | ชื่อ register, opcode/funct, memory layout และ profile |
| `packages/mips-core/src/assembler.ts` | `assemble(source)` และ `fields(word)` |
| `packages/mips-core/src/simulator.ts` | `Simulator.step()`, `back()`, `run()` พร้อม registers, HI/LO, memory และ trace 5 stages |
| `packages/mips-core/src/judge.ts` | `judge(source, tests)` สำหรับตรวจ Assembly กับ test case |
| `packages/mips-core/src/c-compiler.ts` | `compileC(source)` ส่ง `asm` กับ mapping บรรทัด C ↔ MIPS |
| `apps/web/src/features/converter/` | หน้า `/convert` |
| `apps/web/src/features/simulator/` | หน้า `/simulate?src=<encoded>` |
| `content/problems/mips/` | โจทย์ 15 ข้อ พร้อม test case และเฉลย C/Assembly |

`judge()` ประกอบคำสั่งเพียงครั้งเดียว แล้วรันแต่ละ test case ใน simulator แยกกัน จำกัด 10,000 คำสั่งต่อ case เพื่อหยุด loop ไม่สิ้นสุด รายงาน `AdEL`, `AdES`, `Ov`, `Syntax`, `Timeout` ตาม contract

## ขอบเขตภาษาและการจำลอง

- MIPS32: คำสั่งระดับ 1 และ 2 ในแผน ยกเว้น floating point ระดับ 3; pseudo `li`, `la`, `move`, `blt`, `bgt`, `ble`, `bge`, `b`, `nop`; `.text`, `.data`, `.word`, `.half`, `.byte`, `.space`
- C subset: `int`, ตัวแปร, อาร์เรย์ขนาดคงที่, นิพจน์จำนวนเต็ม, `if/else`, `while`, `for`, ฟังก์ชันที่รับอาร์กิวเมนต์ได้สูงสุด 4 ตัว, `return` ไม่มี pointer, global variables, block scope, struct, floating point หรือ I/O
- โหมด MIPS → C แสดงความหมายคร่าว ๆ ทีละคำสั่ง ไม่ใช่ decompiler ที่กู้โครงสร้าง C เดิม
- Memory ที่ไม่เคยเขียนอ่านเป็นศูนย์; `.space` จอง address โดยไม่เพิ่ม byte ใน map; ไม่มีการตรวจ array bounds
- `syscall` รองรับรหัส 10 (exit) เท่านั้น และ `mfc0` อ่านค่า CP0 เริ่มต้นเป็นศูนย์

ค่าเริ่มต้นใน `isa.ts` เป็นแบบ **MARS สำหรับห้องเรียน**: ไม่มี branch delay slot, `jal` เก็บ `PC+4`, little endian, text ที่ `0x00400000`, static data ที่ `0x10000000`, `$gp=0x10008000`, `$sp=0x7ffffffc` ควรยืนยันกับอาจารย์ก่อนใช้ในการตรวจงานจริง ถ้าต้องใช้ delay slot แบบ Green Card ต้องเพิ่มการรันคำสั่งใน slot ให้ครบก่อนเปิดใช้งาน

## ขอบเขตปัจจุบัน

เว็บเปิดเฉพาะ `/convert` และ `/simulate` สำหรับงาน A ส่วนระบบบัญชีผู้ใช้, หน้าโจทย์, คะแนน/อันดับ และ Z80 ยังไม่เริ่มทำ
