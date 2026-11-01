// Ready-made projects for the Z80 trainer: a board wired with the same
// "ต่ออัตโนมัติ" rules students use, plus a program that drives it. Delays are
// sized for the board's default 10 kHz clock.

import { addWires, autoWire, DEFAULT_BOARD, type Board, type Part } from './board';

export interface Example {
  name: string;
  desc: string;
  board: Board;
  code: string;
}

/** The trainer plus `parts`, each wired by autoWire in the order given. */
function wired(parts: Part[]): Board {
  let b: Board = { parts: [...DEFAULT_BOARD.parts, ...parts], wires: [] };
  for (const p of parts) {
    const r = autoWire(b, p.id);
    if ('error' in r) throw new Error(`${p.id}: ${r.error}`);
    b = addWires(b, r.wires);
  }
  return b;
}

// ---------- routines shared by the programs ----------

/** SHOW<port>: the digit 0–9 in A on a 7-segment at that OUT port. */
const showDigit = (port: 1 | 2) => `; แสดงเลข 0–9 ใน A บน 7-segment ที่ OUT 0${port}h
SHOW${port}:  PUSH HL
        PUSH DE
        LD   HL, SEGTAB
        LD   D, 0
        LD   E, A
        ADD  HL, DE
        LD   A, (HL)
        OUT  (0${port}h), A
        POP  DE
        POP  HL
        RET
SEGTAB: DB   3Fh, 06h, 5Bh, 4Fh, 66h, 6Dh, 7Dh, 07h, 7Fh, 6Fh`;

/** DELAY: about `count` × 26 T-states (at 10 kHz, 0180h ≈ 1 s). Keeps every register. */
const delay = (count: string, note: string) => `; หน่วงเวลา — ${note}
DELAY:  PUSH AF
        PUSH BC
        LD   BC, ${count}
DLY1:   DEC  BC
        LD   A, B
        OR   C
        JR   NZ, DLY1
        POP  BC
        POP  AF
        RET`;

/** KEYS: H = buttons on IN 03h pressed since the last call (1 = just pressed); L remembers the last reading. */
const KEYS_EDGE = `; อ่านปุ่ม: H = บิตของปุ่มที่ "เพิ่งกด" ตั้งแต่ครั้งก่อน (1 = เพิ่งกด)
;           L = ค่าปุ่มครั้งก่อน (ตั้งเป็น 0FFh ตอนเริ่ม)
EDGES:  IN   A, (03h)
        LD   C, A
        CPL                ; 1 = กดอยู่
        AND  L             ; และครั้งก่อนยังปล่อยอยู่
        LD   H, A
        LD   L, C          ; จำไว้เทียบครั้งหน้า
        RET`;

// ---------- programs ----------

const COUNTER = `; ตัวนับ 0–9 ด้วยปุ่ม
;   7-segment  = OUT 01h (เลขฐานสิบ)
;   LED 8 ดวง  = OUT 02h (เลขเดียวกันในฐานสอง)
;   SW1        = IN 03h บิต 0 → +1 (เกิน 9 วนกลับ 0)
;   SW2        = IN 03h บิต 1 → กลับเป็น 0
;   ปุ่มกด = อ่านได้ 0, ปล่อย = 1

        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   C, 0          ; C = ค่านับ
SHOW:   LD   A, C
        CALL SHOW1         ; เลขบน 7-segment
        LD   A, C
        OUT  (02h), A      ; เลขฐานสองบน LED
WAIT:   IN   A, (03h)
        BIT  0, A
        JR   Z, PLUS       ; SW1 ถูกกด
        BIT  1, A
        JR   Z, CLEAR      ; SW2 ถูกกด
        JR   WAIT
PLUS:   INC  C
        LD   A, C
        CP   10
        JR   C, RELEASE    ; ยังไม่ถึง 10
        LD   C, 0          ; เกิน 9 วนกลับ 0
        JR   RELEASE
CLEAR:  LD   C, 0
RELEASE: IN  A, (03h)      ; รอจนปล่อยทั้งสองปุ่ม
        AND  03h
        CP   03h
        JR   NZ, RELEASE
        CALL DELAY         ; กันปุ่มเด้ง
        JR   SHOW

${showDigit(1)}

${delay('0040h', 'สั้นๆ ไว้กันปุ่มเด้ง')}
`;

const RUNNER = `; ไฟวิ่งปรับความเร็วด้วยปุ่ม
;   LED 8 ดวง  = OUT 01h (ไฟวิ่ง)
;   7-segment  = OUT 02h (ระดับความเร็ว 1–9)
;   SW1        = IN 03h บิต 0 → เร็วขึ้น
;   SW2        = IN 03h บิต 1 → ช้าลง

        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   D, 01h        ; D = ตำแหน่งไฟ
        LD   E, 5          ; E = ระดับความเร็ว 1–9
        LD   L, 0FFh       ; ปุ่มครั้งก่อน: ปล่อยหมด
        LD   A, E
        CALL SHOW2
LOOP:   LD   A, D
        OUT  (01h), A
        LD   A, 10
        SUB  E
        LD   B, A          ; B = 10 − ระดับ → ยิ่งระดับสูง ยิ่งรอสั้น
WAITS:  CALL KEYS
        CALL DELAY
        DJNZ WAITS
        RLC  D             ; เลื่อนไฟไปดวงถัดไป (D7 วนกลับ D0)
        JR   LOOP

; ปรับระดับตามปุ่มที่เพิ่งกด แล้วแสดงระดับ
KEYS:   CALL EDGES
        BIT  0, H
        JR   Z, K1
        LD   A, E
        CP   9
        JR   NC, K1
        INC  E             ; SW1: เร็วขึ้น
K1:     BIT  1, H
        JR   Z, K2
        LD   A, E
        CP   2
        JR   C, K2
        DEC  E             ; SW2: ช้าลง
K2:     LD   A, E
        JP   SHOW2

${KEYS_EDGE}

${showDigit(2)}

${delay('0030h', 'หน่วยเวลาเล็กๆ ของไฟวิ่ง')}
`;

const TIMING = `; เกมกดให้ตรงจังหวะ
;   LED 8 ดวง  = OUT 01h — ไฟวิ่งจาก D0 ไป D7 วนไปเรื่อยๆ
;   7-segment  = OUT 02h — คะแนน 0–9
;   SW1        = IN 03h บิต 0
;   กด SW1 ตอนไฟอยู่ดวงสุดท้าย (D7) = +1 คะแนน · กดตอนอื่น = คะแนนกลับเป็น 0

        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   D, 01h        ; D = ตำแหน่งไฟ
        LD   E, 0          ; E = คะแนน
        LD   L, 0FFh       ; ปุ่มครั้งก่อน: ปล่อยหมด
        LD   A, E
        CALL SHOW2
LOOP:   LD   A, D
        OUT  (01h), A
        LD   B, 4          ; แบ่งเวลาแต่ละดวงเป็น 4 ช่วง เพื่ออ่านปุ่มบ่อยๆ
STEP:   CALL KEYS
        CALL DELAY
        DJNZ STEP
        RLC  D
        JR   LOOP

; ตรวจว่ากดตรงจังหวะไหม
KEYS:   CALL EDGES
        BIT  0, H
        RET  Z             ; ไม่ได้เพิ่งกด SW1
        BIT  7, D
        JR   Z, MISS       ; ไฟไม่ได้อยู่ดวงสุดท้าย
        LD   A, E
        CP   9
        JR   NC, SCORE     ; ได้ 9 แล้ว ค้างไว้ที่ 9
        INC  E
        JR   SCORE
MISS:   LD   E, 0
SCORE:  LD   A, E
        JP   SHOW2

${KEYS_EDGE}

${showDigit(2)}

${delay('0020h', 'หน่วยเวลาเล็กๆ ของไฟวิ่ง')}
`;

const MOTION_LIGHT = `; ไฟติดเมื่อมีการเคลื่อนไหว แล้วดับเองเมื่อครบเวลา
;   PIR        = IN 03h บิต 0 (มีการเคลื่อนไหว = 1)
;   LED 8 ดวง  = OUT 01h — ติดทั้งแถวระหว่างนับเวลา
;   7-segment  = OUT 02h — เวลาที่เหลือ 9 → 1 (ดับเมื่อหมดเวลา)
;   มีการเคลื่อนไหวระหว่างนับ = เริ่มนับ 9 ใหม่

        ORG  0000h
START:  LD   SP, 0FFFFh
        LD   E, 0          ; E = เวลาที่เหลือ (0 = ไฟดับ)
LOOP:   IN   A, (03h)
        BIT  0, A
        JR   Z, TICK       ; ไม่มีการเคลื่อนไหว
        LD   E, 9          ; มีการเคลื่อนไหว → เริ่มนับใหม่
TICK:   LD   A, E
        OR   A
        JR   Z, OFF
        LD   A, 0FFh
        OUT  (01h), A      ; ไฟติด
        LD   A, E
        CALL SHOW2         ; เวลาที่เหลือ
        CALL DELAY         ; รอ 1 หน่วยเวลา
        DEC  E
        JR   LOOP
OFF:    XOR  A
        OUT  (01h), A      ; ไฟดับ
        OUT  (02h), A      ; 7-segment ดับ
        JR   LOOP

${showDigit(2)}

${delay('0180h', 'ประมาณ 1 วินาทีที่ clock 10 kHz')}
`;

/** 8251A on the trainer: set up, send a byte, send a 0-ended string, wait for a byte. */
const UART_IO = `; ---------- 8251A ของบอร์ดสำเร็จ: 06h ข้อมูล · 07h คำสั่ง/สถานะ ----------
UINIT:  LD   A, 4Eh
        OUT  (07h), A      ; โหมด: async 8 บิต ไม่มี parity 1 stop ×16
        LD   A, 15h
        OUT  (07h), A      ; คำสั่ง: เปิดตัวส่ง (บิต 0) และตัวรับ (บิต 2)
        RET
; ส่ง A ออก TxD
PUTC:   PUSH AF
PC1:    IN   A, (07h)
        BIT  0, A          ; TxRDY = พร้อมส่ง
        JR   Z, PC1
        POP  AF
        OUT  (06h), A
        RET
; ส่งข้อความที่ HL ชี้ (จบด้วยไบต์ 0)
PUTS:   LD   A, (HL)
        OR   A
        RET  Z
        CALL PUTC
        INC  HL
        JR   PUTS
; รอจนมีไบต์เข้าทาง RxD แล้วคืนใน A
GETC:   IN   A, (07h)
        BIT  1, A          ; RxRDY = มีไบต์รออ่าน
        JR   Z, GETC
        IN   A, (06h)
        RET`;

const GUESS = `; ทายเลข 0–9 ผ่าน serial terminal
;   กด “เปิด terminal” ใต้บอร์ด แล้วพิมพ์ในแท็บนั้น → เข้า Z80 ทาง RxD
;   Z80 ตอบกลับทาง TxD → ขึ้นใน terminal
;   LED ที่ OUT 01h แสดงจำนวนครั้งที่ทาย

        ORG  0000h
START:  LD   SP, 0FFFFh
        CALL UINIT
        LD   HL, HELLO
        CALL PUTS
NEW:    LD   HL, PRESS
        CALL PUTS
        LD   C, 0
SEED:   INC  C             ; นับไปเรื่อยๆ ระหว่างรอ — ค่าที่ได้ขึ้นกับจังหวะที่กด
        IN   A, (07h)
        BIT  1, A
        JR   Z, SEED
        IN   A, (06h)      ; ทิ้งปุ่มที่กดเริ่ม
        LD   A, C
MOD10:  CP   10            ; เหลือเศษจากการหารด้วย 10
        JR   C, GOTIT
        SUB  10
        JR   MOD10
GOTIT:  LD   E, A          ; E = เลขลับ 0–9
        LD   D, 0          ; D = จำนวนครั้งที่ทาย
        LD   A, D
        OUT  (01h), A
        LD   HL, ASK
        CALL PUTS
GUESS:  CALL GETC
        CP   30h           ; ต่ำกว่า '0' ไม่ใช่ตัวเลข
        JR   C, GUESS
        CP   3Ah           ; สูงกว่า '9' ไม่ใช่ตัวเลข
        JR   NC, GUESS
        CALL PUTC          ; แสดงตัวที่พิมพ์
        SUB  30h           ; '0'–'9' → 0–9
        LD   B, A
        INC  D
        LD   A, D
        OUT  (01h), A      ; จำนวนครั้งบน LED
        LD   A, B
        CP   E
        JR   Z, WIN
        LD   HL, HIGHER
        JR   C, SAY        ; ทายน้อยไป
        LD   HL, LOWER
SAY:    CALL PUTS
        JR   GUESS
WIN:    LD   HL, RIGHT
        CALL PUTS
        LD   A, D
        CP   10
        JR   NC, MANY
        ADD  A, 30h
        CALL PUTC
        JR   DONE
MANY:   LD   A, 2Bh        ; '+' เมื่อเกิน 9 ครั้ง
        CALL PUTC
DONE:   LD   HL, CRLF
        CALL PUTS
        JR   NEW

HELLO:  DB   'Z80 guessing game', 0Dh, 0Ah, 0
PRESS:  DB   0Dh, 0Ah, 'Press any key to start', 0Dh, 0Ah, 0
ASK:    DB   'Guess 0-9 > ', 0
HIGHER: DB   '  higher', 0Dh, 0Ah, 'Guess 0-9 > ', 0
LOWER:  DB   '  lower', 0Dh, 0Ah, 'Guess 0-9 > ', 0
RIGHT:  DB   '  correct! tries = ', 0
CRLF:   DB   0Dh, 0Ah, 0

${UART_IO}
`;

const ADC_LOG = `; ส่งค่า ADC ขึ้นเว็บ
;   ตัวต้านทานแบบเลื่อนต่อที่ AIN (ADC พอร์ต 04h)
;   อ่านค่า 0–255 แล้วส่งข้อความ "ADC = ###" ขึ้น terminal ทุกครึ่งวินาที
;   และแสดงค่าเดียวกันบน LED ที่ OUT 01h

        ORG  0000h
START:  LD   SP, 0FFFFh
        CALL UINIT
LOOP:   OUT  (04h), A      ; เริ่มแปลง
        LD   B, 20
W1:     DJNZ W1            ; รอให้แปลงเสร็จ
        IN   A, (04h)      ; ค่า 0–255
        OUT  (01h), A
        PUSH AF
        LD   HL, LABEL
        CALL PUTS
        POP  AF
        CALL PUTDEC
        LD   HL, CRLF
        CALL PUTS
        CALL DELAY
        JR   LOOP

; ส่ง A เป็นเลขฐานสิบ 3 หลัก
PUTDEC: LD   B, 100
        CALL DIGIT
        LD   B, 10
        CALL DIGIT
        ADD  A, 30h
        JP   PUTC
DIGIT:  LD   C, 30h        ; นับว่าลบ B ได้กี่ครั้ง
DG1:    CP   B
        JR   C, DG2
        SUB  B
        INC  C
        JR   DG1
DG2:    PUSH AF
        LD   A, C
        CALL PUTC
        POP  AF
        RET

LABEL:  DB   'ADC = ', 0
CRLF:   DB   0Dh, 0Ah, 0

${UART_IO}

${delay('00C0h', 'ประมาณครึ่งวินาทีที่ clock 10 kHz')}
`;

/** LED on OUT 01h, 7-segment on OUT 02h, then the inputs on IN 03h bits 0, 1, … */
const panel = (...inputs: Part[]) =>
  wired([
    { id: 'd1', type: 'LED', x: 70, y: 320, rot: 0 },
    { id: 'ds1', type: '7SG', x: 260, y: 300, rot: 0 },
    ...inputs,
  ]);

export const EXAMPLES: Example[] = [
  {
    name: 'ตัวนับกดปุ่ม 0–9',
    desc: '7-segment ที่ OUT 01h · LED ที่ OUT 02h · ปุ่ม +1 และปุ่มล้างที่ IN 03h',
    board: wired([
      { id: 'ds1', type: '7SG', x: 70, y: 300, rot: 0 },
      { id: 'd1', type: 'LED', x: 230, y: 320, rot: 0 },
      { id: 'sw1', type: 'BTN', x: 470, y: 320, rot: 0 },
      { id: 'sw2', type: 'BTN', x: 590, y: 320, rot: 0 },
    ]),
    code: COUNTER,
  },
  {
    name: 'ไฟวิ่งปรับความเร็ว',
    desc: 'ไฟวิ่งที่ OUT 01h · ระดับความเร็วบน 7-segment ที่ OUT 02h · SW1 เร็วขึ้น SW2 ช้าลง',
    board: panel({ id: 'sw1', type: 'BTN', x: 470, y: 320, rot: 0 }, { id: 'sw2', type: 'BTN', x: 590, y: 320, rot: 0 }),
    code: RUNNER,
  },
  {
    name: 'เกมกดให้ตรงจังหวะ',
    desc: 'กด SW1 ตอนไฟวิ่งถึงดวงสุดท้าย · คะแนนบน 7-segment ที่ OUT 02h',
    board: panel({ id: 'sw1', type: 'BTN', x: 470, y: 320, rot: 0 }),
    code: TIMING,
  },
  {
    name: 'ไฟติดเมื่อมีการเคลื่อนไหว',
    desc: 'PIR ที่ IN 03h · ไฟ OUT 01h ติดแล้วนับถอยหลังบน 7-segment ก่อนดับเอง · คลิก PIR เพื่อจำลองการเคลื่อนไหว',
    board: panel({ id: 'm1', type: 'PIR', x: 470, y: 300, rot: 0 }),
    code: MOTION_LIGHT,
  },
  {
    name: 'ทายเลขผ่าน terminal',
    desc: 'พิมพ์ใน serial terminal (แท็บใหม่) · Z80 ตอบกลับทาง UART · LED แสดงจำนวนครั้งที่ทาย',
    board: wired([{ id: 'd1', type: 'LED', x: 70, y: 320, rot: 0 }]),
    code: GUESS,
  },
  {
    name: 'ส่งค่า ADC ขึ้นเว็บ',
    desc: 'เลื่อนตัวต้านทานที่ AIN · Z80 ส่ง "ADC = ###" ขึ้น serial terminal ทุกครึ่งวินาที',
    board: wired([
      { id: 'd1', type: 'LED', x: 70, y: 320, rot: 0 },
      { id: 'vr1', type: 'MODA', model: 'slidepot', pos: 0.5, x: 300, y: 320, rot: 0 },
    ]),
    code: ADC_LOG,
  },
];
