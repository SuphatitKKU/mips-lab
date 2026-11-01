// Breadboard model for the Z80 lab at pin level. Every part has its datasheet
// pinout, wires join single pins (or the breadboard's power rails), and the
// analysis works out from the resulting nets whether the computer can run,
// where ROM and RAM answer on the bus, and which latch / buffer each OUT / IN
// port reaches — so a wire on the wrong pin breaks things the way it would on
// a real board. Resistors carry real values: every net gets a voltage from a
// small nodal solve, so dividers, potentiometers and light / temperature
// sensors feed an ADC, and an LED's brightness follows its current.

import { modVolts, moduleById, type ModuleDef } from './modules';

export type PartType =
  | 'CPU' | 'ROM' | 'RAM' | '138' | '574' | '244' | 'RN' | 'LED' | 'BTN' | '7SG' | '5V' | 'CLK' | 'Ω'
  | 'POT' | 'LDR' | 'NTC' | 'LM35' | 'LDM' | 'PIR' | 'IR' | 'REED' | 'TILT' | 'ADC' | 'RFID' | 'UART' | 'KIT'
  | 'SND' | 'VIB' | 'FLM' | 'H2O' | 'GAS' | 'HALL' | 'TCH'
  // catalogue modules (see modules.ts): digital in, switch, analog, output
  | 'MODI' | 'MODS' | 'MODA' | 'MODO' | 'MOD2' | 'MOD3' | 'MOD4';

export interface Part {
  id: string;
  type: PartType;
  x: number;
  y: number;
  rot: number;
  /** resistance in ohms (resistor, resistor network, potentiometer); unset = the part's default */
  val?: number;
  /** knob position 0–1 (potentiometer wiper, a module's trimpot, an analog module's reading) */
  pos?: number;
  /** catalogue module id, for MODI / MODS / MODA / MODO */
  model?: string;
}

/** "partId.pinNumber", or a power rail: rail:vt / rail:gt (top +/−), rail:vb / rail:gb (bottom +/−) */
export type PinRef = string;

export interface Wire {
  a: PinRef;
  b: PinRef;
}

export interface Board {
  parts: Part[];
  wires: Wire[];
}

export type PinKind = 'vcc' | 'gnd' | 'in' | 'out' | 'io' | 'nc' | 'pas';

export interface PinDef {
  n: number;
  name: string;
  kind: PinKind;
  /** pins that belong to a bus share a group name; the bus tool wires bit i to bit i */
  bus?: string;
  bit?: number;
  desc?: string;
}

// ---------- pinouts ----------

const pin = (n: number, name: string, kind: PinKind, desc?: string, bus?: string, bit?: number): PinDef => ({ n, name, kind, desc, bus, bit });
const A = (n: number, i: number, kind: PinKind = 'in') => pin(n, `A${i}`, kind, `address bit ${i}`, 'A', i);
const D = (n: number, i: number, name = `D${i}`, kind: PinKind = 'io') => pin(n, name, kind, `data bit ${i}`, 'D', i);

const Z80_PINS: PinDef[] = [
  A(1, 11, 'out'), A(2, 12, 'out'), A(3, 13, 'out'), A(4, 14, 'out'), A(5, 15, 'out'),
  pin(6, 'CLK', 'in', 'สัญญาณนาฬิกา'),
  D(7, 4), D(8, 3), D(9, 5), D(10, 6),
  pin(11, '+5V', 'vcc', 'ไฟเลี้ยง'),
  D(12, 2), D(13, 7), D(14, 0), D(15, 1),
  pin(16, '/INT', 'in', 'ขอ interrupt (active low) — ไม่ใช้ให้ต่อ +5V'),
  pin(17, '/NMI', 'in', 'interrupt ที่ปิดไม่ได้ (active low) — ไม่ใช้ให้ต่อ +5V'),
  pin(18, '/HALT', 'out', 'LOW เมื่อหยุดที่คำสั่ง HALT'),
  pin(19, '/MREQ', 'out', 'LOW เมื่ออ่าน/เขียนหน่วยความจำ'),
  pin(20, '/IORQ', 'out', 'LOW เมื่อใช้คำสั่ง IN / OUT'),
  pin(21, '/RD', 'out', 'LOW เมื่อ CPU อ่านข้อมูล'),
  pin(22, '/WR', 'out', 'LOW เมื่อ CPU เขียนข้อมูล'),
  pin(23, '/BUSACK', 'out', 'ยอมปล่อยบัส'),
  pin(24, '/WAIT', 'in', 'ให้ CPU รอ (active low) — ไม่ใช้ให้ต่อ +5V'),
  pin(25, '/BUSREQ', 'in', 'ขอใช้บัส (active low) — ไม่ใช้ให้ต่อ +5V'),
  pin(26, '/RESET', 'in', 'LOW = รีเซ็ต · ต่อ pull-up ไป +5V (และปุ่มลง GND ถ้าอยากกดรีเซ็ต)'),
  pin(27, '/M1', 'out', 'LOW ตอนอ่าน opcode'),
  pin(28, '/RFSH', 'out', 'refresh DRAM'),
  pin(29, 'GND', 'gnd', 'กราวด์'),
  A(30, 0, 'out'), A(31, 1, 'out'), A(32, 2, 'out'), A(33, 3, 'out'), A(34, 4, 'out'), A(35, 5, 'out'),
  A(36, 6, 'out'), A(37, 7, 'out'), A(38, 8, 'out'), A(39, 9, 'out'), A(40, 10, 'out'),
];

/** 2764 EPROM and 6264 SRAM share the JEDEC 28-pin layout. */
function mem28(rom: boolean): PinDef[] {
  const io = (n: number, i: number) => D(n, i, rom ? `O${i}` : `I/O${i}`, rom ? 'out' : 'io');
  return [
    rom ? pin(1, 'VPP', 'in', 'ไฟเขียน EPROM · ตอนอ่านให้ต่อ +5V') : pin(1, 'NC', 'nc', 'ไม่ได้ใช้'),
    A(2, 12), A(3, 7), A(4, 6), A(5, 5), A(6, 4), A(7, 3), A(8, 2), A(9, 1), A(10, 0),
    io(11, 0), io(12, 1), io(13, 2),
    pin(14, 'GND', 'gnd', 'กราวด์'),
    io(15, 3), io(16, 4), io(17, 5), io(18, 6), io(19, 7),
    rom ? pin(20, '/CE', 'in', 'เลือกชิป (active low)') : pin(20, '/CE1', 'in', 'เลือกชิป (active low)'),
    A(21, 10),
    pin(22, '/OE', 'in', 'เปิดเอาต์พุต (active low) — ต่อ /RD'),
    A(23, 11), A(24, 9), A(25, 8),
    rom ? pin(26, 'NC', 'nc', 'ไม่ได้ใช้') : pin(26, 'CE2', 'in', 'เลือกชิป (active HIGH)'),
    rom ? pin(27, '/PGM', 'in', 'โหมดเขียน EPROM · ตอนอ่านให้ต่อ +5V') : pin(27, '/WE', 'in', 'เขียนข้อมูล (active low) — ต่อ /WR'),
    pin(28, 'VCC', 'vcc', 'ไฟเลี้ยง'),
  ];
}

const DEC_PINS: PinDef[] = [
  pin(1, 'A', 'in', 'บิตเลือก 0', 'SEL', 0),
  pin(2, 'B', 'in', 'บิตเลือก 1', 'SEL', 1),
  pin(3, 'C', 'in', 'บิตเลือก 2', 'SEL', 2),
  pin(4, '/G2A', 'in', 'เปิดใช้ (active low)'),
  pin(5, '/G2B', 'in', 'เปิดใช้ (active low)'),
  pin(6, 'G1', 'in', 'เปิดใช้ (active HIGH)'),
  pin(7, '/Y7', 'out', 'LOW เมื่อเลือก 7', 'Y', 7),
  pin(8, 'GND', 'gnd', 'กราวด์'),
  ...[6, 5, 4, 3, 2, 1, 0].map((k, i) => pin(9 + i, `/Y${k}`, 'out', `LOW เมื่อเลือก ${k}`, 'Y', k)),
  pin(16, 'VCC', 'vcc', 'ไฟเลี้ยง'),
];

const FF_PINS: PinDef[] = [
  pin(1, '/OE', 'in', 'เปิดเอาต์พุต (active low) — ต่อ GND ให้ขับตลอด'),
  ...Array.from({ length: 8 }, (_, i) => D(2 + i, i, `D${i}`, 'in')),
  pin(10, 'GND', 'gnd', 'กราวด์'),
  pin(11, 'CLK', 'in', 'จำค่าตอนขอบขาขึ้น — ต่อ /Y ของ decoder'),
  ...Array.from({ length: 8 }, (_, i) => pin(12 + i, `Q${7 - i}`, 'out', `เอาต์พุตบิต ${7 - i}`, 'Q', 7 - i)),
  pin(20, 'VCC', 'vcc', 'ไฟเลี้ยง'),
];

const BUF_PINS: PinDef[] = (() => {
  const a = (n: number, g: number, k: number) => pin(n, `${g}A${k}`, 'in', `อินพุตบิต ${(g - 1) * 4 + k - 1}`, 'IN', (g - 1) * 4 + k - 1);
  const y = (n: number, g: number, k: number) => pin(n, `${g}Y${k}`, 'out', `เอาต์พุตบิต ${(g - 1) * 4 + k - 1} → บัสข้อมูล`, 'OUT', (g - 1) * 4 + k - 1);
  return [
    pin(1, '/1OE', 'in', 'เปิดกลุ่ม 1 (active low) — ต่อ /Y ของ decoder ฝั่งอ่าน'),
    a(2, 1, 1), y(3, 2, 4), a(4, 1, 2), y(5, 2, 3), a(6, 1, 3), y(7, 2, 2), a(8, 1, 4), y(9, 2, 1),
    pin(10, 'GND', 'gnd', 'กราวด์'),
    a(11, 2, 1), y(12, 1, 4), a(13, 2, 2), y(14, 1, 3), a(15, 2, 3), y(16, 1, 2), a(17, 2, 4), y(18, 1, 1),
    pin(19, '/2OE', 'in', 'เปิดกลุ่ม 2 (active low)'),
    pin(20, 'VCC', 'vcc', 'ไฟเลี้ยง'),
  ];
})();

const RN_PINS: PinDef[] = [
  ...Array.from({ length: 8 }, (_, i) => pin(1 + i, `R${i + 1}a`, 'pas', `ตัวต้านทานที่ ${i + 1} (ต่อกับขา ${16 - i})`, 'R1', i)),
  ...Array.from({ length: 8 }, (_, i) => pin(9 + i, `R${8 - i}b`, 'pas', `ตัวต้านทานที่ ${8 - i} (ต่อกับขา ${8 - i})`, 'R2', 7 - i)),
];

const LED_PINS: PinDef[] = [
  ...Array.from({ length: 8 }, (_, i) => pin(1 + i, `AN${i}`, 'in', `anode LED ${i} (+)`, 'AN', i)),
  ...Array.from({ length: 8 }, (_, i) => pin(9 + i, `K${7 - i}`, 'in', `cathode LED ${7 - i} (−) → GND`, 'K', 7 - i)),
];

const SEG_BIT = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, dp: 7 } as const;
const seg = (n: number, s: keyof typeof SEG_BIT) => pin(n, s.toUpperCase(), 'in', `segment ${s}`, 'SEG', SEG_BIT[s]);
const SEVEN_PINS: PinDef[] = [
  seg(1, 'e'), seg(2, 'd'), pin(3, 'COM', 'in', 'cathode ร่วม → GND'), seg(4, 'c'), seg(5, 'dp'),
  seg(6, 'b'), seg(7, 'a'), pin(8, 'COM', 'in', 'cathode ร่วม → GND'), seg(9, 'f'), seg(10, 'g'),
];

const ADC_PINS: PinDef[] = [
  pin(1, '/CS', 'in', 'เลือกชิป (active low) — ต่อ /Y ของ 74HC138 ที่ทำงานทั้งตอน IN และ OUT (/G2A ← /IORQ, /G2B ← GND)'),
  pin(2, '/RD', 'in', 'อ่านผล (active low) — ต่อ /RD ของ CPU'),
  pin(3, '/WR', 'in', 'สั่งเริ่มแปลง (active low) — ต่อ /WR ของ CPU'),
  pin(4, 'CLK IN', 'pas', 'clock ของ ADC · บอร์ดจำลองนี้มีวงจร RC ให้แล้ว ไม่ต้องต่อ'),
  pin(5, '/INTR', 'out', 'LOW เมื่อแปลงเสร็จ · กลับเป็น HIGH เมื่ออ่านผลหรือสั่งแปลงใหม่'),
  pin(6, 'VIN+', 'in', 'แรงดันที่จะวัด 0 – Vref'),
  pin(7, 'VIN−', 'in', 'ขาอ้างอิงลบ — ต่อ GND'),
  pin(8, 'AGND', 'gnd', 'กราวด์อนาล็อก'),
  pin(9, 'VREF/2', 'in', 'ครึ่งหนึ่งของแรงดันเต็มสเกล · ไม่ต่อ = เต็มสเกล 5V · ต่อ 1.28V = เต็มสเกล 2.56V (10 mV ต่อขั้น)'),
  pin(10, 'DGND', 'gnd', 'กราวด์ดิจิทัล'),
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((k, i) => D(11 + i, k, `DB${k}`, 'out')),
  pin(19, 'CLK R', 'pas', 'ตัวต้านทานของ clock · บอร์ดจำลองนี้มีให้แล้ว ไม่ต้องต่อ'),
  pin(20, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'),
];

/** Intel 8251A USART, used here only to receive. */
const USART_PINS: PinDef[] = [
  D(1, 2),
  D(2, 3),
  pin(3, 'RxD', 'in', 'รับข้อมูลอนุกรม — ต่อ TX ของโมดูล RFID'),
  pin(4, 'GND', 'gnd', 'กราวด์'),
  D(5, 4),
  D(6, 5),
  D(7, 6),
  D(8, 7),
  pin(9, '/TxC', 'pas', 'clock ฝั่งส่ง · บอร์ดจำลองนี้ป้อน 9600 baud × 16 ให้แล้ว'),
  pin(10, '/WR', 'in', 'เขียน (active low) — ต่อ /WR ของ CPU'),
  pin(11, '/CS', 'in', 'เลือกชิป (active low) — ต่อ /Y ของ 74HC138 ที่ถอดรหัสด้วย A1–A3 (A0 ใช้เลือก C/D)'),
  pin(12, 'C/D', 'in', 'เลือก register: 0 = ข้อมูล, 1 = คำสั่ง / สถานะ — ต่อ A0 ของ CPU'),
  pin(13, '/RD', 'in', 'อ่าน (active low) — ต่อ /RD ของ CPU'),
  pin(14, 'RxRDY', 'out', 'HIGH เมื่อมีไบต์รอให้อ่าน'),
  pin(15, 'TxRDY', 'out', 'HIGH เมื่อพร้อมรับไบต์ที่จะส่ง'),
  pin(16, 'SYNDET', 'nc', 'ใช้ในโหมด synchronous — ไม่ใช้'),
  pin(17, '/CTS', 'in', 'clear to send — ต่อ GND ถ้าจะส่งข้อมูล'),
  pin(18, 'TxEMPTY', 'out', 'HIGH เมื่อส่งหมดแล้ว'),
  pin(19, 'TxD', 'out', 'ส่งข้อมูลอนุกรม'),
  pin(20, 'CLK', 'pas', 'clock ของชิป · บอร์ดจำลองนี้มีให้แล้ว'),
  pin(21, 'RESET', 'in', 'HIGH = รีเซ็ตชิป — ต่อ GND'),
  pin(22, '/DSR', 'nc', 'ไม่ใช้'),
  pin(23, '/RTS', 'out', 'request to send'),
  pin(24, '/DTR', 'out', 'data terminal ready'),
  pin(25, '/RxC', 'pas', 'clock ฝั่งรับ · บอร์ดจำลองนี้ป้อน 9600 baud × 16 ให้แล้ว'),
  pin(26, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'),
  D(27, 0),
  D(28, 1),
];

const two = (a: string, b: string): PinDef[] => [pin(1, '1', 'pas', a), pin(2, '2', 'pas', b)];
/** Output modules with several control inputs: VCC, GND, IN1…INn. */
const modIn = (n: number): PinDef[] => [
  pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'),
  pin(2, 'GND', 'gnd', 'กราวด์'),
  ...Array.from({ length: n }, (_, i) => pin(3 + i, `IN${i + 1}`, 'in', `สัญญาณควบคุมที่ ${i + 1} จากพอร์ต OUT`, 'MIN', i)),
];
/** Digital sensor modules: VCC, GND, then the output. */
const dio = (what: string, out = 'DO'): PinDef[] => [pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'), pin(2, 'GND', 'gnd', 'กราวด์'), pin(3, out, 'out', what)];

/** Ports the trainer brings out to its headers, in header order. */
export const KIT_PORTS = [
  { bus: 'P1', port: 0x01, dir: 'out' },
  { bus: 'P2', port: 0x02, dir: 'out' },
  { bus: 'P3', port: 0x03, dir: 'in' },
] as const;

/** Z80 trainer: 8 pins per port (OUT 01h, OUT 02h, IN 03h), then +5V and GND. */
const KIT_PINS: PinDef[] = [
  ...KIT_PORTS.flatMap(({ bus, port, dir }, g) =>
    Array.from({ length: 8 }, (_, i) =>
      pin(
        1 + g * 8 + i,
        `${dir === 'out' ? 'OUT' : 'IN'}${port.toString(16).padStart(2, '0').toUpperCase()}.${i}`,
        dir === 'out' ? 'out' : 'in',
        dir === 'out'
          ? `พอร์ต OUT ${port.toString(16).padStart(2, '0').toUpperCase()}h บิต ${i} — ต่อ LED / 7-segment ได้ตรงๆ (มีตัวต้านทาน 330Ω ในบอร์ดแล้ว)`
          : `พอร์ต IN ${port.toString(16).padStart(2, '0').toUpperCase()}h บิต ${i} — มี pull-up ในบอร์ดแล้ว ต่อปุ่มหรือเซนเซอร์ลง GND ได้เลย`,
        bus,
        i,
      ),
    ),
  ),
  pin(25, '+5V', 'vcc', 'ไฟ +5V จากบอร์ด (ต่อกับรางไฟ + ให้แล้ว)'),
  pin(26, 'GND', 'gnd', 'กราวด์ของบอร์ด (ต่อกับรางไฟ − ให้แล้ว)'),
  pin(27, 'AIN', 'in', 'อินพุตอนาล็อก 0–5V → ADC0804 พอร์ต 04h · OUT (04h),A เริ่มแปลง แล้ว IN A,(04h) ได้ 0–255'),
  pin(28, 'RXD', 'in', 'รับข้อมูลอนุกรมเข้า 8251A (พอร์ต 06h ข้อมูล · 07h คำสั่ง/สถานะ) · ต่อ TX ของโมดูลได้ · terminal บนเว็บส่งเข้าทางนี้ด้วย'),
  pin(29, 'TXD', 'out', 'ส่งข้อมูลอนุกรมออกจาก 8251A · ไบต์ที่ส่งขึ้นใน terminal บนเว็บ'),
];

export const PINOUT: Record<PartType, PinDef[]> = {
  CPU: Z80_PINS,
  ROM: mem28(true),
  RAM: mem28(false),
  '138': DEC_PINS,
  '574': FF_PINS,
  '244': BUF_PINS,
  RN: RN_PINS,
  LED: LED_PINS,
  '7SG': SEVEN_PINS,
  BTN: [
    pin(1, '1', 'pas', 'ฝั่ง A (ต่อถึงขา 2 อยู่แล้ว)'),
    pin(2, '2', 'pas', 'ฝั่ง A (ต่อถึงขา 1 อยู่แล้ว)'),
    pin(3, '3', 'pas', 'ฝั่ง B (ต่อถึงขา 4 อยู่แล้ว) · กดแล้ว A ต่อกับ B'),
    pin(4, '4', 'pas', 'ฝั่ง B (ต่อถึงขา 3 อยู่แล้ว)'),
  ],
  '5V': [pin(1, '+5V', 'vcc', 'ไฟ +5V จากแหล่งจ่าย'), pin(2, 'GND', 'gnd', 'กราวด์ของแหล่งจ่าย')],
  CLK: [pin(1, 'NC', 'nc', 'ไม่ได้ใช้'), pin(7, 'GND', 'gnd', 'กราวด์'), pin(8, 'OUT', 'out', 'สัญญาณนาฬิกา → CLK ของ CPU'), pin(14, 'VCC', 'vcc', 'ไฟเลี้ยง')],
  'Ω': [pin(1, '1', 'pas', 'ขา 1'), pin(2, '2', 'pas', 'ขา 2')],
  POT: [
    pin(1, '1', 'pas', 'ปลายด้านหนึ่ง (ปุ่มหมุนที่ 0% อยู่ฝั่งนี้)'),
    pin(2, 'W', 'pas', 'ขากลาง (wiper) — แรงดันเลื่อนตามปุ่มหมุน'),
    pin(3, '3', 'pas', 'ปลายอีกด้าน (ปุ่มหมุนที่ 100% อยู่ฝั่งนี้)'),
  ],
  LDR: two('ขา 1 · ความต้านทานลดลงเมื่อแสงมากขึ้น', 'ขา 2'),
  NTC: two('ขา 1 · ความต้านทานลดลงเมื่อร้อนขึ้น (10kΩ ที่ 25°C)', 'ขา 2'),
  LM35: [pin(1, '+VS', 'vcc', 'ไฟเลี้ยง +5V'), pin(2, 'VOUT', 'out', 'แรงดัน 10 mV ต่อ °C (25°C = 0.25V)'), pin(3, 'GND', 'gnd', 'กราวด์')],
  LDM: [
    pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'),
    pin(2, 'GND', 'gnd', 'กราวด์'),
    pin(3, 'DO', 'out', 'ดิจิทัล: LOW เมื่อสว่างกว่าจุดที่ตั้งด้วย trimpot, HIGH เมื่อมืดกว่า'),
    pin(4, 'AO', 'out', 'อนาล็อก: แรงดันจาก LDR — ยิ่งมืดยิ่งสูง'),
  ],
  PIR: [pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'), pin(2, 'OUT', 'out', 'HIGH เมื่อตรวจจับการเคลื่อนไหว'), pin(3, 'GND', 'gnd', 'กราวด์')],
  IR: [pin(1, 'OUT', 'out', 'LOW เมื่อมีวัตถุในระยะที่ตั้งด้วย trimpot'), pin(2, 'GND', 'gnd', 'กราวด์'), pin(3, 'VCC', 'vcc', 'ไฟเลี้ยง +5V')],
  REED: two('หน้าสัมผัส — ต่อถึงขา 2 เมื่อมีแม่เหล็กอยู่ใกล้', 'หน้าสัมผัส — ต่อถึงขา 1 เมื่อมีแม่เหล็กอยู่ใกล้'),
  TILT: two('ต่อถึงขา 2 เมื่อวางตั้งตรง · เอียงแล้วลูกบอลกลิ้งออก วงจรขาด', 'ต่อถึงขา 1 เมื่อวางตั้งตรง'),
  ADC: ADC_PINS,
  RFID: [
    pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'),
    pin(2, 'GND', 'gnd', 'กราวด์'),
    pin(3, 'TX', 'out', 'ส่งเลขการ์ดแบบอนุกรม 9600 baud 8N1: 02h, เลข 10 หลัก (ASCII), checksum 2 หลัก, 03h'),
  ],
  UART: USART_PINS,
  KIT: KIT_PINS,
  SND: dio('LOW เมื่อเสียงดังกว่าจุดที่ตั้งด้วย trimpot'),
  VIB: dio('HIGH เมื่อมีการสั่นสะเทือน'),
  FLM: dio('LOW เมื่อพบเปลวไฟ (แสง IR 760–1100 nm)'),
  H2O: dio('LOW เมื่อแผ่นรับน้ำเปียก'),
  GAS: dio('LOW เมื่อแก๊สหรือควันเกินจุดที่ตั้งด้วย trimpot'),
  HALL: dio('LOW เมื่อมีแม่เหล็กใกล้ (open collector — ต้องมี pull-up)', 'OUT'),
  TCH: dio('HIGH ขณะแตะแผ่นสัมผัส', 'OUT'),
  MODI: dio('เอาต์พุตดิจิทัลของโมดูล (ดูคำอธิบาย)', 'OUT'),
  MODS: two('หน้าสัมผัส 1', 'หน้าสัมผัส 2'),
  MODA: [pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'), pin(2, 'GND', 'gnd', 'กราวด์'), pin(3, 'AO', 'out', 'แรงดันอนาล็อก 0–5V')],
  MODO: [pin(1, 'VCC', 'vcc', 'ไฟเลี้ยง +5V'), pin(2, 'GND', 'gnd', 'กราวด์'), pin(3, 'IN', 'in', 'สัญญาณควบคุมจากพอร์ต OUT')],
  MOD2: modIn(2),
  MOD3: modIn(3),
  MOD4: modIn(4),
};

export const PART_INFO: Record<PartType, { name: string; w: number; h: number; ref: string; desc: string }> = {
  CPU: { name: 'Z80 CPU', w: 300, h: 64, ref: 'U', desc: 'หน่วยประมวลผล 8 บิต (DIP-40) อ่านคำสั่งจาก ROM ผ่าน address/data bus แล้วสั่ง I/O ด้วย OUT / IN' },
  ROM: { name: 'EPROM 2764', w: 216, h: 64, ref: 'U', desc: 'หน่วยความจำ 8 KB (DIP-28) เก็บโปรแกรมที่ assemble แล้ว · หน้าต่างควอตซ์ไว้ลบข้อมูลด้วยแสง UV' },
  RAM: { name: 'SRAM 6264', w: 216, h: 64, ref: 'U', desc: 'หน่วยความจำ 8 KB (DIP-28) สำหรับ stack และตัวแปร · จำเป็นถ้าใช้ CALL / PUSH' },
  '138': { name: '74HC138 Decoder', w: 120, h: 44, ref: 'U', desc: 'ถอดรหัส 3 บิตเป็น 1 ใน 8 (/Y0–/Y7) ใช้แยกพอร์ต I/O · เปิดเมื่อ G1=HIGH, /G2A=/G2B=LOW' },
  '574': { name: '74HC574 Latch', w: 160, h: 44, ref: 'U', desc: 'D flip-flop 8 ตัว จำค่าบัสข้อมูลตอน CLK ขึ้นจาก LOW เป็น HIGH (ตอนจบคำสั่ง OUT) แล้วขับ Q0–Q7 ค้างไว้' },
  '244': { name: '74HC244 Buffer', w: 160, h: 44, ref: 'U', desc: 'บัฟเฟอร์ 3 สถานะ 8 บิต ปล่อยค่าอินพุตเข้าบัสข้อมูลเฉพาะตอนคำสั่ง IN ของพอร์ตนั้น' },
  RN: { name: 'Resistor network 8 ตัว', w: 120, h: 40, ref: 'RN', desc: 'ตัวต้านทาน 8 ตัวค่าเดียวกันใน DIP-16 (ขา 1↔16, 2↔15, …) ใช้จำกัดกระแส LED · เลือกค่าได้' },
  LED: { name: 'LED bar 8 ดวง', w: 120, h: 56, ref: 'D', desc: 'LED 8 ดวงในตัวเดียว ขา 1–8 เป็น anode (+), ขา 16–9 เป็น cathode (−) ต้องมีตัวต้านทานจำกัดกระแส' },
  BTN: { name: 'ปุ่มกด (tactile)', w: 60, h: 44, ref: 'SW', desc: 'ขา 1–2 ต่อถึงกัน ขา 3–4 ต่อถึงกัน กดแล้วสองฝั่งต่อกัน · ใช้คู่กับตัวต้านทาน pull-up' },
  '7SG': { name: '7-Segment (cathode ร่วม)', w: 60, h: 84, ref: 'DS', desc: 'ขาแต่ละ segment ต่อผ่านตัวต้านทาน · COM (ขา 3, 8) ต่อ GND · ส่งบิต 0–6 = a–g, บิต 7 = จุด' },
  '5V': { name: 'ไฟ 5V / GND', w: 80, h: 36, ref: 'P', desc: 'แหล่งจ่ายไฟ ต่อเข้ารางไฟ (+ แดง, − ดำ) ของ breadboard' },
  CLK: { name: 'Crystal oscillator', w: 80, h: 44, ref: 'Y', desc: 'oscillator แบบกระป๋อง DIP-14 (ขา 1, 7, 8, 14) สร้างสัญญาณนาฬิกาที่ขา 8' },
  'Ω': { name: 'ตัวต้านทาน', w: 60, h: 24, ref: 'R', desc: 'เลือกค่าได้ 100Ω–100kΩ · ใช้จำกัดกระแส LED, เป็น pull-up / pull-down หรือแบ่งแรงดัน' },
  POT: { name: 'Potentiometer', w: 50, h: 46, ref: 'VR', desc: 'ตัวต้านทานปรับค่าได้ 3 ขา: ปลาย 1, ขากลาง W, ปลาย 3 · ต่อปลายเข้า +5V / GND แล้วขากลางเป็นแรงดัน 0–5V ตามปุ่มหมุน' },
  LDR: { name: 'LDR (ตัวต้านทานแปรตามแสง)', w: 56, h: 24, ref: 'LDR', desc: 'มืด ~1MΩ · 10 lux ~10kΩ · สว่าง ~1kΩ · ต่ออนุกรมกับตัวต้านทานเป็นวงจรแบ่งแรงดัน แล้วอ่านด้วย ADC' },
  NTC: { name: 'Thermistor NTC 10k', w: 50, h: 24, ref: 'TH', desc: '10kΩ ที่ 25°C ยิ่งร้อนยิ่งต่ำ (B = 3950) · ต่อเป็นวงจรแบ่งแรงดันกับตัวต้านทาน 10kΩ แล้วอ่านด้วย ADC' },
  LM35: { name: 'LM35 วัดอุณหภูมิ', w: 44, h: 42, ref: 'U', desc: 'ให้แรงดัน 10 mV ต่อ °C โดยตรง · ต่อเข้า VIN+ ของ ADC0804 ที่ตั้งเต็มสเกล 2.56V จะอ่านได้เป็น °C พอดี' },
  LDM: { name: 'โมดูลวัดแสง (LM393)', w: 84, h: 40, ref: 'M', desc: 'LDR + comparator · DO เป็นดิจิทัล (อ่านด้วย 74HC244) จุดตัดตั้งด้วย trimpot · AO เป็นอนาล็อก (อ่านด้วย ADC)' },
  PIR: { name: 'PIR จับการเคลื่อนไหว', w: 70, h: 64, ref: 'M', desc: 'โมดูล HC-SR501 · OUT เป็น HIGH เมื่อตรวจพบการเคลื่อนไหวในระยะ' },
  IR: { name: 'IR ตรวจจับวัตถุ', w: 84, h: 40, ref: 'M', desc: 'โมดูล FC-51 ส่ง IR แล้วรับแสงสะท้อน · OUT เป็น LOW เมื่อมีวัตถุในระยะ (2–30 cm ตั้งด้วย trimpot)' },
  REED: { name: 'Reed switch (แม่เหล็ก)', w: 80, h: 22, ref: 'S', desc: 'หน้าสัมผัสในหลอดแก้ว ต่อถึงกันเมื่อมีแม่เหล็กใกล้ · ใช้คู่กับ pull-up เหมือนปุ่มกด' },
  TILT: { name: 'Tilt switch (เอียง)', w: 56, h: 26, ref: 'S', desc: 'SW-520D ต่อถึงกันเมื่อวางตั้งตรง ขาดเมื่อเอียง · ใช้คู่กับ pull-up' },
  ADC: { name: 'ADC0804 (อนาล็อก → ดิจิทัล)', w: 160, h: 44, ref: 'U', desc: 'แปลงแรงดัน 0–5V เป็นเลข 0–255 · OUT ไปพอร์ตของมันเพื่อเริ่มแปลง รอ /INTR เป็น LOW แล้ว IN อ่านผล' },
  RFID: { name: 'RFID 125kHz (RDM6300)', w: 96, h: 56, ref: 'M', desc: 'แตะการ์ด EM4100 แล้วส่งเลขการ์ดออกขา TX แบบอนุกรม 9600 baud · ต่อเข้า RxD ของ USART 8251A' },
  UART: { name: 'USART 8251A (serial)', w: 216, h: 50, ref: 'U', desc: 'รับข้อมูลอนุกรมทีละไบต์ · ตั้งโหมดและเปิดตัวรับก่อนใช้ · สถานะบิต 1 (RxRDY) = มีไบต์รออ่าน, บิต 4 = overrun (อ่านไม่ทัน)' },
  SND: { name: 'โมดูลเสียง (FC-04)', w: 84, h: 40, ref: 'M', desc: 'ไมโครโฟน + comparator · DO เป็น LOW เมื่อเสียงดังกว่าจุดที่ตั้ง' },
  VIB: { name: 'โมดูลสั่นสะเทือน (SW-420)', w: 84, h: 40, ref: 'M', desc: 'สปริงในหลอด + comparator · DO เป็น HIGH เมื่อมีการสั่นสะเทือน' },
  FLM: { name: 'โมดูลตรวจเปลวไฟ', w: 84, h: 40, ref: 'M', desc: 'โฟโตไดโอด IR 760–1100 nm · DO เป็น LOW เมื่อพบเปลวไฟในมุมมอง' },
  H2O: { name: 'โมดูลตรวจน้ำ (YL-83)', w: 84, h: 40, ref: 'M', desc: 'แผ่นลายทองแดงต่อกับ comparator · DO เป็น LOW เมื่อแผ่นเปียก' },
  GAS: { name: 'โมดูลแก๊ส/ควัน (MQ-2)', w: 84, h: 40, ref: 'M', desc: 'ตัวตรวจแก๊สแบบให้ความร้อน + comparator · DO เป็น LOW เมื่อแก๊สหรือควันเกินจุดที่ตั้ง' },
  HALL: { name: 'Hall sensor (A3144)', w: 44, h: 42, ref: 'U', desc: 'วัดสนามแม่เหล็ก · OUT เป็น LOW เมื่อมีแม่เหล็กใกล้ · เป็น open collector ต้องมี pull-up (IN ของบอร์ดสำเร็จมีให้แล้ว)' },
  TCH: { name: 'แผ่นสัมผัส (TTP223)', w: 50, h: 46, ref: 'M', desc: 'ปุ่มสัมผัสแบบ capacitive · OUT เป็น HIGH ขณะแตะ · ไม่ต้องใช้ pull-up' },
  MODI: { name: 'โมดูลดิจิทัล', w: 84, h: 40, ref: 'M', desc: 'โมดูลที่ให้เอาต์พุตดิจิทัล' },
  MODS: { name: 'สวิตช์', w: 70, h: 26, ref: 'S', desc: 'หน้าสัมผัสสองขา' },
  MODA: { name: 'โมดูลอนาล็อก', w: 84, h: 40, ref: 'M', desc: 'โมดูลที่ให้แรงดันอนาล็อก' },
  MODO: { name: 'โมดูลเอาต์พุต', w: 84, h: 40, ref: 'M', desc: 'โมดูลที่สั่งงานจากพอร์ต OUT' },
  MOD2: { name: 'โมดูลเอาต์พุต 2 ขา', w: 84, h: 40, ref: 'M', desc: 'โมดูลที่สั่งงานด้วยสองบิตของพอร์ต OUT' },
  MOD3: { name: 'โมดูลเอาต์พุต 3 ขา', w: 84, h: 40, ref: 'M', desc: 'โมดูลที่สั่งงานด้วยสามบิตของพอร์ต OUT' },
  MOD4: { name: 'โมดูลเอาต์พุต 4 ขา', w: 96, h: 40, ref: 'M', desc: 'โมดูลที่สั่งงานด้วยสี่บิตของพอร์ต OUT' },
  KIT: {
    name: 'บอร์ด Z80 สำเร็จ',
    w: 580,
    h: 112,
    ref: 'KIT',
    desc: 'ชุดฝึกที่ต่อ CPU, ROM, RAM, clock และ decoder ไว้ให้แล้ว · ต่ออุปกรณ์เข้าพอร์ต OUT 01h / OUT 02h / IN 03h, ขา AIN (ADC พอร์ต 04h) และ RXD/TXD (8251A พอร์ต 06h/07h) ได้เลย · ไฟของบอร์ดต่อเข้ารางไฟให้แล้ว',
  },
};

// ---------- RFID ----------

/** RDM6300 frame for a 10-hex-digit EM4100 card number: STX, the digits and an XOR checksum as ASCII, ETX. */
export function rfidFrame(uid: string): number[] {
  const digits = uid.toUpperCase().replace(/[^0-9A-F]/g, '').padStart(10, '0').slice(-10);
  let sum = 0;
  for (let i = 0; i < 10; i += 2) sum ^= parseInt(digits.slice(i, i + 2), 16);
  const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0));
  return [0x02, ...ascii(digits), ...ascii(sum.toString(16).toUpperCase().padStart(2, '0')), 0x03];
}
/** 9600 baud, 8N1: ten bit times per byte */
export const BAUD = 9600;

// ---------- values ----------

export const VCC = 5;
/** red LED forward voltage */
export const LED_VF = 2;
export const RES_VALUES = [100, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000];
export const RN_VALUES = [100, 220, 330, 470, 1000, 4700, 10000];
export const POT_VALUES = [1000, 10000, 100000];
const DEFAULT_VAL: Partial<Record<PartType, number>> = { 'Ω': 10000, RN: 330, POT: 10000 };
export const partVal = (p: Part) => p.val ?? DEFAULT_VAL[p.type] ?? 0;
export const partPos = (p: Part) => p.pos ?? 0.5;

/** 4700 → "4.7kΩ" */
export function fmtOhm(v: number) {
  const n = (x: number) => String(Math.round(x * 100) / 100);
  return v >= 1e6 ? `${n(v / 1e6)}MΩ` : v >= 1000 ? `${n(v / 1000)}kΩ` : `${n(v)}Ω`;
}

/** Three-digit resistor code: 330 → "331", 4700 → "472". */
export function resCode(v: number) {
  const e = Math.max(0, Math.floor(Math.log10(v)) - 1);
  return `${Math.round(v / 10 ** e)}${e}`;
}

// ---------- the room the sensors sit in ----------

export interface Env {
  /** illuminance, lux */
  light: number;
  /** °C */
  temp: number;
  /** distance from the IR module to the nearest object, cm */
  distance: number;
  motion: boolean;
  magnet: boolean;
  tilt: boolean;
  sound: boolean;
  vibration: boolean;
  flame: boolean;
  water: boolean;
  gas: boolean;
}
export const DEFAULT_ENV: Env = { light: 300, temp: 28, distance: 60, motion: false, magnet: false, tilt: false, sound: false, vibration: false, flame: false, water: false, gas: false };

/** GL5528-style LDR: ~1 MΩ dark, ~10 kΩ at 10 lux, a few hundred ohms in sunlight. */
export const ldrOhms = (lux: number) => Math.min(1e6, Math.max(300, 1e4 * Math.pow(Math.max(lux, 0.01) / 10, -0.8)));
/** 10 kΩ NTC thermistor, B = 3950 K. */
export const ntcOhms = (c: number) => 1e4 * Math.exp(3950 * (1 / (c + 273.15) - 1 / 298.15));
/** IR obstacle module: detection distance set by its trimpot, cm. */
export const irRange = (p: Part) => 2 + partPos(p) * 28;
/** Light module's AO: the LDR over a 10 kΩ divider, so darker = higher. */
export const ldmAo = (env: Env) => {
  const r = ldrOhms(env.light);
  return (VCC * r) / (r + 1e4);
};
/** Light module's comparator threshold, set by its trimpot. */
export const ldmThreshold = (p: Part) => VCC * partPos(p);
export const lm35Volts = (env: Env) => Math.max(0, Math.min(1.5, env.temp * 0.01));

/** Resistance of one resistive element of a part right now. */
export function ohms(p: Part, seg: number, env: Env): number {
  switch (p.type) {
    case 'POT': {
      const total = partVal(p);
      return Math.max(1, seg === 0 ? total * partPos(p) : total * (1 - partPos(p)));
    }
    case 'LDR':
      return ldrOhms(env.light);
    case 'NTC':
      return ntcOhms(env.temp);
    default:
      return partVal(p);
  }
}

export const pinDef = (type: PartType, n: number) => PINOUT[type].find((p) => p.n === n);
const pinNo = (type: PartType, name: string) => {
  const p = PINOUT[type].find((x) => x.name === name);
  if (!p) throw new Error(`no pin ${name} on ${type}`);
  return p.n;
};

// ---------- geometry ----------

export const BOARD_W = 900;
export const BOARD_H = 560;
export const RAILS: Record<string, { y: number; kind: 'vcc' | 'gnd'; label: string }> = {
  'rail:vt': { y: 34, kind: 'vcc', label: 'รางไฟ + ด้านบน' },
  'rail:gt': { y: 48, kind: 'gnd', label: 'รางไฟ − ด้านบน' },
  'rail:vb': { y: 512, kind: 'vcc', label: 'รางไฟ + ด้านล่าง' },
  'rail:gb': { y: 526, kind: 'gnd', label: 'รางไฟ − ด้านล่าง' },
};
export const isRail = (r: PinRef) => r.startsWith('rail:');

const DIP: Partial<Record<PartType, [x0: number, x1Inset: number]>> = {
  CPU: [11, 11], ROM: [11, 11], RAM: [11, 11], '138': [11, 11], '574': [11, 11], '244': [11, 11], RN: [11, 11], LED: [11, 11], '7SG': [8, 8], ADC: [11, 11], UART: [11, 11],
};
/** modules and 3-leg parts: pins in a row along the bottom edge */
const HEADER: Partial<Record<PartType, number>> = { POT: 3, LM35: 3, PIR: 3, IR: 3, LDM: 4, RFID: 3, SND: 3, VIB: 3, FLM: 3, H2O: 3, GAS: 3, HALL: 3, TCH: 3, MODI: 3, MODA: 3, MODO: 3, MOD2: 4, MOD3: 5, MOD4: 6 };

/** Trainer header pins: three ports of 8, 14 px apart with a gap between ports, then +5V and GND. */
export const kitPinX = (n: number) =>
  n <= 24 ? 22 + Math.floor((n - 1) / 8) * 140 + ((n - 1) % 8) * 14 : n <= 26 ? 22 + 3 * 140 + (n - 25) * 18 : n === 27 ? 504 : 530 + (n - 28) * 18;

/** Pin tip in the part's own unrotated box, plus the direction a wire leaves it. */
export function pinLocal(type: PartType, n: number): { x: number; y: number; dx: number; dy: number } {
  const { w, h } = PART_INFO[type];
  const dip = DIP[type];
  if (dip) {
    const N = PINOUT[type].length;
    const half = N / 2;
    const x = (i: number) => dip[0] + (i * (w - dip[0] - dip[1])) / (half - 1);
    return n <= half ? { x: x(n - 1), y: h, dx: 0, dy: 1 } : { x: x(N - n), y: 0, dx: 0, dy: -1 };
  }
  const row = HEADER[type];
  if (row) return { x: w / 2 + (n - 1 - (row - 1) / 2) * 12, y: h, dx: 0, dy: 1 };
  if (type === 'KIT') return { x: kitPinX(n), y: h, dx: 0, dy: 1 };
  switch (type) {
    case 'BTN':
      return [{ x: 7, y: 12, dx: -1, dy: 0 }, { x: 7, y: 32, dx: -1, dy: 0 }, { x: 53, y: 12, dx: 1, dy: 0 }, { x: 53, y: 32, dx: 1, dy: 0 }][n - 1];
    case '5V':
      return { x: n === 1 ? w * 0.27 : w * 0.73, y: 14, dx: 0, dy: -1 };
    case 'CLK':
      return { 1: { x: 10, y: h, dx: 0, dy: 1 }, 7: { x: w - 10, y: h, dx: 0, dy: 1 }, 8: { x: w - 10, y: 0, dx: 0, dy: -1 }, 14: { x: 10, y: 0, dx: 0, dy: -1 } }[n]!;
    default: // resistor leads
      return { x: n === 1 ? 0 : w, y: h / 2, dx: n === 1 ? -1 : 1, dy: 0 };
  }
}

/** Pin tip on the board (rotation applied). Odd rotations turn the part 90° clockwise. */
export function pinPos(p: Part, n: number) {
  const l = pinLocal(p.type, n);
  if (p.rot % 2 === 0) return { x: p.x + l.x, y: p.y + l.y, dx: l.dx, dy: l.dy };
  const { h } = PART_INFO[p.type];
  return { x: p.x + h - l.y, y: p.y + l.x, dx: -l.dy, dy: l.dx };
}

export function partSize(p: Part) {
  const { w, h } = PART_INFO[p.type];
  return p.rot % 2 ? { w: h, h: w } : { w, h };
}

export function newId(board: Board, type: PartType) {
  const base = PART_INFO[type].ref.toLowerCase();
  let i = 1;
  while (board.parts.some((p) => p.id === `${base}${i}`)) i++;
  return `${base}${i}`;
}

export const ref = (partId: string, n: number): PinRef => `${partId}.${n}`;
export function parseRef(r: PinRef): { part: string; n: number } | null {
  const k = r.lastIndexOf('.');
  return k < 0 ? null : { part: r.slice(0, k), n: Number(r.slice(k + 1)) };
}

/** Old boards (part-to-part wires) can't be read at pin level. */
export function isPinBoard(b: Board): boolean {
  return b.parts.every((p) => p.type in PINOUT) && b.wires.every((w) => [w.a, w.b].every((r) => isRail(r) || parseRef(r)));
}

// ---------- nets ----------

/** One resistive element: part `part`'s element `seg` between nets `a` and `b`. */
export interface Resistor {
  a: number;
  b: number;
  part: Part;
  seg: number;
}

export interface Nets {
  /** net id of a pin or rail */
  of: (r: PinRef) => number;
  members: Map<number, PinRef[]>;
  /** nets joined through a resistor, potentiometer, LDR or thermistor */
  resistors: Resistor[];
}

/** Switch-like parts that conduct right now: held buttons, reed switches near a magnet, upright tilt switches. */
export function closedSwitches(board: Board, pressed: ReadonlySet<string>, env: Env = DEFAULT_ENV): ReadonlySet<string> {
  const out = new Set(pressed);
  for (const p of board.parts) if ((p.type === 'REED' && env.magnet) || (p.type === 'TILT' && !env.tilt)) out.add(p.id);
  return out;
}

/** Joins pins by wires and by the parts' internal connections (button contacts, 7-seg COM, closed switches). */
export function buildNets(board: Board, closed: ReadonlySet<string> = new Set()): Nets {
  const parent = new Map<PinRef, PinRef>();
  const find = (r: PinRef): PinRef => {
    let x = r;
    while (parent.get(x) !== x) {
      const up = parent.get(x);
      if (up == null) {
        parent.set(x, x);
        return x;
      }
      x = up;
    }
    return x;
  };
  const union = (a: PinRef, b: PinRef) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of Object.keys(RAILS)) parent.set(r, r);
  for (const p of board.parts) for (const d of PINOUT[p.type]) parent.set(ref(p.id, d.n), ref(p.id, d.n));
  const known = (r: PinRef) => parent.has(r);
  for (const w of board.wires) if (known(w.a) && known(w.b)) union(w.a, w.b);
  for (const p of board.parts) {
    if (p.type === 'BTN') {
      union(ref(p.id, 1), ref(p.id, 2));
      union(ref(p.id, 3), ref(p.id, 4));
      if (closed.has(p.id)) union(ref(p.id, 1), ref(p.id, 3));
    }
    if ((p.type === 'REED' || p.type === 'TILT') && closed.has(p.id)) union(ref(p.id, 1), ref(p.id, 2));
    if (p.type === '7SG') union(ref(p.id, 3), ref(p.id, 8));
    if (p.type === 'MODS' && closed.has(p.id) !== !!moduleById(p.model)?.nc) union(ref(p.id, 1), ref(p.id, 2));
  }
  const ids = new Map<PinRef, number>();
  const members = new Map<number, PinRef[]>();
  for (const r of parent.keys()) {
    const root = find(r);
    if (!ids.has(root)) ids.set(root, ids.size);
    const id = ids.get(root)!;
    members.set(id, [...(members.get(id) ?? []), r]);
  }
  const of = (r: PinRef) => ids.get(find(r)) ?? -1;
  const resistors: Resistor[] = [];
  const add = (part: Part, seg: number, a: number, b: number) => resistors.push({ a: of(ref(part.id, a)), b: of(ref(part.id, b)), part, seg });
  for (const p of board.parts) {
    if (p.type === 'Ω' || p.type === 'LDR' || p.type === 'NTC') add(p, 0, 1, 2);
    if (p.type === 'RN') for (let i = 1; i <= 8; i++) add(p, i - 1, i, 17 - i);
    if (p.type === 'POT') {
      add(p, 0, 1, 2);
      add(p, 1, 2, 3);
    }
  }
  return { of, members, resistors };
}

/**
 * Node voltages of the resistor network: nets in `fixed` hold their voltage,
 * every other net reachable through resistors is solved by nodal analysis
 * (Σ g·(Vn − Vm) = 0). Nets with no resistive path to a fixed one stay unknown.
 */
function solveVolts(edges: { a: number; b: number; g: number }[], fixed: ReadonlyMap<number, number>, skip: ReadonlySet<number>) {
  const out = new Map(fixed);
  const adj = new Map<number, { to: number; g: number }[]>();
  for (const e of edges) {
    if (e.a === e.b || skip.has(e.a) || skip.has(e.b)) continue;
    adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, g: e.g }]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, g: e.g }]);
  }
  const unknown: number[] = [];
  const seen = new Set<number>(fixed.keys());
  const queue = [...fixed.keys()];
  while (queue.length) {
    for (const { to } of adj.get(queue.pop()!) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      unknown.push(to);
      queue.push(to);
    }
  }
  const n = unknown.length;
  if (!n) return out;
  const idx = new Map(unknown.map((u, i) => [u, i]));
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const rhs = new Float64Array(n);
  for (const [i, u] of unknown.entries())
    for (const { to, g } of adj.get(u)!) {
      A[i][i] += g;
      const f = fixed.get(to);
      if (f != null) rhs[i] += g * f;
      else A[i][idx.get(to)!] -= g;
    }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    [A[c], A[best]] = [A[best], A[c]];
    [rhs[c], rhs[best]] = [rhs[best], rhs[c]];
    const piv = A[c][c];
    if (Math.abs(piv) < 1e-15) continue;
    for (let r = c + 1; r < n; r++) {
      const k = A[r][c] / piv;
      if (!k) continue;
      for (let j = c; j < n; j++) A[r][j] -= k * A[c][j];
      rhs[r] -= k * rhs[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = rhs[r];
    for (let j = r + 1; j < n; j++) sum -= A[r][j] * x[j];
    x[r] = Math.abs(A[r][r]) < 1e-15 ? 0 : sum / A[r][r];
  }
  for (const [i, u] of unknown.entries()) out.set(u, x[i]);
  return out;
}

export type Level = 0 | 1 | 'Z' | 'X';

export interface LevelOpts {
  env?: Env;
  /** pins driven to an analog voltage (sensor outputs) */
  analog?: ReadonlyMap<PinRef, number>;
}

/**
 * Logic level and voltage of every net. Strong sources are the supply pins and
 * any driven outputs passed in `drive`; analog outputs hold their voltage; every
 * other net reached through resistors gets its voltage from a nodal solve and
 * reads HIGH at VCC/2 or above (a pull-up, a series R, a divider).
 */
export function netLevels(board: Board, nets: Nets, drive: ReadonlyMap<PinRef, 0 | 1> = new Map(), opts: LevelOpts = {}) {
  const env = opts.env ?? DEFAULT_ENV;
  const strong = new Map<number, Level>();
  const put = (id: number, v: 0 | 1) => {
    const cur = strong.get(id);
    strong.set(id, cur == null || cur === v ? v : 'X');
  };
  for (const p of board.parts)
    if (p.type === '5V') {
      put(nets.of(ref(p.id, 1)), 1);
      put(nets.of(ref(p.id, 2)), 0);
    }
  for (const [r, v] of drive) put(nets.of(r), v);
  const fixed = new Map<number, number>();
  const shorted = new Set<number>();
  for (const [id, l] of strong) {
    if (l === 'X') shorted.add(id);
    else if (l === 0 || l === 1) fixed.set(id, l * VCC);
  }
  for (const [r, v] of opts.analog ?? []) {
    const id = nets.of(r);
    if (!strong.has(id)) fixed.set(id, v);
  }
  const volts = solveVolts(
    nets.resistors.map((x) => ({ a: x.a, b: x.b, g: 1 / ohms(x.part, x.seg, env) })),
    fixed,
    shorted,
  );
  const level = (id: number): Level => {
    const s = strong.get(id);
    if (s != null) return s;
    const v = volts.get(id);
    return v == null ? 'Z' : v >= VCC / 2 ? 1 : 0;
  };
  return {
    level,
    at: (r: PinRef) => level(nets.of(r)),
    strongAt: (r: PinRef) => strong.get(nets.of(r)) ?? 'Z',
    /** volts on the pin's net, or null when it floats */
    volts: (r: PinRef) => (shorted.has(nets.of(r)) ? null : (volts.get(nets.of(r)) ?? null)),
    env,
  };
}

export type Levels = ReturnType<typeof netLevels>;

// ---------- analysis ----------

export interface Check {
  label: string;
  ok: boolean;
  /** what is wrong, pin by pin */
  detail?: string[];
}

/** Address decode as a mask/value pair over the 8-bit port number (or 16-bit memory address). */
export interface Match {
  mask: number;
  value: number;
}
export const matches = (m: Match, x: number) => (x & m.mask) === m.value;

export interface OutLatch {
  id: string;
  port: Match;
  /** CPU data line feeding Dk, or -1 */
  dataMap: number[];
  outputsOn: boolean;
}

export interface InBuffer {
  id: string;
  /** decode for each half (/1OE, /2OE); null = never enabled */
  groups: [Match | null, Match | null];
  /** for output bit k (1Y1…2Y4): CPU data line it drives, or -1 */
  dataMap: number[];
}

/** An ADC0804 the CPU can reach: OUT to `wr` starts a conversion, IN from `rd` reads it. */
export interface Adc {
  id: string;
  rd: Match | null;
  wr: Match | null;
  /** for DBk: CPU data line it drives, or -1 */
  dataMap: number[];
}

/** An 8251A the CPU can reach; C/D comes from address line `cd`, so data and control/status sit on neighbouring ports. */
export interface Usart {
  id: string;
  rd: Match | null;
  wr: Match | null;
  /** CPU address line on C/D */
  cd: number;
  /** for Dk: CPU data line it drives, or -1 */
  dataMap: number[];
  /** RFID module whose TX reaches RxD */
  rfid: string | null;
}

export interface Analysis {
  cpu: Part | null;
  checks: Check[];
  canRun: boolean;
  problems: string[];
  nets: Nets;
  rom: { id: string; at: Match } | null;
  ram: { id: string; at: Match } | null;
  latches: OutLatch[];
  buffers: InBuffer[];
  adcs: Adc[];
  usarts: Usart[];
  /** sensor modules and chips outside the CPU core that have power, by part id */
  live: Set<string>;
  /** CPU control pins and the nets they sit on, for reset handling at run time */
  resetRef: PinRef | null;
}

const ACTIVE: PartType[] = ['LM35', 'LDM', 'PIR', 'IR', 'ADC', 'RFID', 'UART', 'SND', 'VIB', 'FLM', 'H2O', 'GAS', 'HALL', 'TCH', 'MODI', 'MODA', 'MODO', 'MOD2', 'MOD3', 'MOD4'];

const name = (p: Part) => p.id.toUpperCase();

export function analyze(board: Board): Analysis {
  const nets = buildNets(board);
  const lv = netLevels(board, nets);
  const of = (t: PartType) => board.parts.filter((p) => p.type === t);
  const cpus = of('CPU');
  const cpu = cpus[0] ?? null;
  const problems: string[] = [];
  const checks: Check[] = [];
  const empty: Analysis = { cpu, checks, canRun: false, problems, nets, rom: null, ram: null, latches: [], buffers: [], adcs: [], usarts: [], live: new Set(), resetRef: null };

  for (const id of nets.members.keys())
    if (lv.level(id) === 'X') problems.push(`ลัดวงจร! มีจุดที่ต่อ +5V กับ GND ถึงกัน (${nets.members.get(id)!.slice(0, 4).join(', ')}) — ของจริงไฟจะตกหรือแหล่งจ่ายเสียหาย`);
  const shorted = problems.length > 0;

  const powered = (p: Part) => {
    const v = PINOUT[p.type].find((d) => d.kind === 'vcc');
    const g = PINOUT[p.type].find((d) => d.kind === 'gnd');
    return !shorted && !!v && !!g && lv.strongAt(ref(p.id, v.n)) === 1 && lv.strongAt(ref(p.id, g.n)) === 0;
  };
  const wired = new Set(board.wires.flatMap((w) => [w.a, w.b]));
  for (const p of board.parts) {
    if (!ACTIVE.includes(p.type)) continue;
    if (powered(p)) empty.live.add(p.id);
    else if (PINOUT[p.type].some((d) => d.kind !== 'vcc' && d.kind !== 'gnd' && wired.has(ref(p.id, d.n))))
      problems.push(`${partName(p)} ${name(p)}: ยังไม่มีไฟเลี้ยง — ต่อ VCC กับ +5V และ GND กับกราวด์ (หรือกด “ต่อไฟเลี้ยงทุกชิป”)`);
  }
  ledCurrentChecks(board, nets, problems);

  checks.push({ label: 'มี CPU บนบอร์ด', ok: !!cpu });
  if (!cpu) return empty;
  if (cpus.length > 1) problems.push('มี CPU มากกว่าหนึ่งตัว — ใช้ตัวแรกที่วาง');

  const P = (p: Part, pinName: string) => ref(p.id, pinNo(p.type, pinName));
  const cpuPin = (pinName: string) => P(cpu, pinName);
  const net = (r: PinRef) => nets.of(r);
  const same = (a: PinRef, b: PinRef) => net(a) === net(b);
  const describe = (r: PinRef) => {
    const l = lv.at(r);
    if (l === 1) return 'HIGH';
    if (l === 0) return 'LOW';
    const others = nets.members.get(net(r))!.filter((x) => x !== r);
    return others.length ? `ต่อกับ ${others.slice(0, 2).map(label(board)).join(', ')}` : 'ลอย (ไม่ได้ต่อ)';
  };
  const powerDetail = (p: Part) => {
    const out: string[] = [];
    for (const d of PINOUT[p.type])
      if (d.kind === 'vcc' && lv.strongAt(ref(p.id, d.n)) !== 1) out.push(`ขา ${d.n} (${d.name}) ต้องต่อ +5V — ตอนนี้ ${describe(ref(p.id, d.n))}`);
      else if (d.kind === 'gnd' && lv.strongAt(ref(p.id, d.n)) !== 0) out.push(`ขา ${d.n} (GND) ต้องต่อ GND — ตอนนี้ ${describe(ref(p.id, d.n))}`);
    return out;
  };

  // CPU power, clock, control inputs
  checks.push({ label: `ไฟเลี้ยง CPU (ขา 11 +5V, ขา 29 GND)`, ok: powered(cpu), detail: powerDetail(cpu) });
  const osc = of('CLK').find((o) => same(ref(o.id, 8), cpuPin('CLK')));
  const clkDetail: string[] = [];
  if (!osc) clkDetail.push(`ขา 6 (CLK) ของ CPU ต้องต่อกับขา 8 (OUT) ของ oscillator — ตอนนี้ ${describe(cpuPin('CLK'))}`);
  else if (!powered(osc)) clkDetail.push(...powerDetail(osc).map((d) => `oscillator ${name(osc)}: ${d}`));
  checks.push({ label: 'สัญญาณนาฬิกา (CLK ← oscillator)', ok: clkDetail.length === 0, detail: clkDetail });

  const ctrlDetail: string[] = [];
  for (const c of ['/RESET', '/WAIT', '/BUSREQ', '/INT', '/NMI']) {
    const l = lv.at(cpuPin(c));
    if (l !== 1) ctrlDetail.push(`${c} (ขา ${pinNo('CPU', c)}) ต้องเป็น HIGH — ตอนนี้ ${describe(cpuPin(c))}${c === '/RESET' && l === 0 ? ' (CPU ค้างอยู่ในสถานะรีเซ็ต)' : ''}`);
  }
  checks.push({ label: 'ขาควบคุมของ CPU ไม่ลอย (/RESET /WAIT /BUSREQ /INT /NMI = HIGH)', ok: ctrlDetail.length === 0, detail: ctrlDetail });

  // memory chips
  const busCheck = (chip: Part, bus: 'A' | 'D', bits: number) => {
    const out: string[] = [];
    for (let i = 0; i < bits; i++) {
      const d = PINOUT[chip.type].find((x) => x.bus === bus && x.bit === i)!;
      const want = PINOUT.CPU.find((x) => x.bus === bus && x.bit === i)!;
      const r = ref(chip.id, d.n);
      if (same(r, ref(cpu.id, want.n))) continue;
      const wrong = PINOUT.CPU.find((x) => x.bus === bus && same(r, ref(cpu.id, x.n)));
      out.push(wrong ? `${d.name} (ขา ${d.n}) ต่อกับ ${wrong.name} ของ CPU — ต้องเป็น ${want.name}` : `${d.name} (ขา ${d.n}) ต้องต่อกับ ${want.name} (ขา ${want.n}) ของ CPU — ตอนนี้ ${describe(r)}`);
    }
    return out;
  };
  const A15 = cpuPin('A15');
  const ramChips = of('RAM');

  const romChip = of('ROM')[0] ?? null;
  let rom: Analysis['rom'] = null;
  if (!romChip) checks.push({ label: 'มี EPROM เก็บโปรแกรม', ok: false, detail: ['วาง EPROM 2764 แล้วต่อ address / data bus กับ CPU'] });
  else {
    const pw = powerDetail(romChip);
    checks.push({ label: `ไฟเลี้ยง ROM ${name(romChip)} (ขา 28, 14)`, ok: pw.length === 0, detail: pw });
    const ad = busCheck(romChip, 'A', 13);
    checks.push({ label: 'ROM: address A0–A12 ต่อกับ CPU', ok: ad.length === 0, detail: ad });
    const dd = busCheck(romChip, 'D', 8);
    checks.push({ label: 'ROM: data O0–O7 ต่อกับ D0–D7 ของ CPU', ok: dd.length === 0, detail: dd });
    const ce = P(romChip, '/CE');
    const ctl: string[] = [];
    let at: Match | null = null;
    if (same(ce, A15)) at = { mask: 0x8000, value: 0 };
    else if (same(ce, cpuPin('/MREQ')) || lv.at(ce) === 0) {
      at = { mask: 0, value: 0 };
      if (ramChips.length) ctl.push('/CE ของ ROM ทำงานทุก address จะแย่งบัสกับ RAM — ต่อ /CE กับ A15 แทน (ROM อยู่ 0000h–7FFFh)');
    } else ctl.push(`/CE (ขา 20) ต้องต่อกับ A15 ของ CPU (หรือ /MREQ ถ้าไม่มี RAM) — ตอนนี้ ${describe(ce)}`);
    if (!same(P(romChip, '/OE'), cpuPin('/RD'))) ctl.push(`/OE (ขา 22) ต้องต่อกับ /RD (ขา 21) ของ CPU — ตอนนี้ ${describe(P(romChip, '/OE'))}`);
    for (const pn of ['VPP', '/PGM']) if (lv.at(P(romChip, pn)) !== 1) ctl.push(`${pn} (ขา ${pinNo('ROM', pn)}) ต้องต่อ +5V ตอนอ่าน — ตอนนี้ ${describe(P(romChip, pn))}`);
    checks.push({ label: 'ROM: เลือกชิป /CE และ /OE ← /RD', ok: ctl.length === 0, detail: ctl });
    if (pw.length + ad.length + dd.length + ctl.length === 0 && at) rom = { id: romChip.id, at };
  }
  if (of('ROM').length > 1) problems.push('มี ROM มากกว่าหนึ่งตัว — โปรแกรมถูกเขียนลงตัวแรกเท่านั้น');

  // RAM is optional for the CPU to run, but stack instructions need it
  let ram: Analysis['ram'] = null;
  const ramChip = ramChips[0] ?? null;
  if (ramChips.length > 1) problems.push('มี RAM มากกว่าหนึ่งตัว — ใช้ตัวแรกที่วางเท่านั้น ตัวอื่นจะไม่ตอบบัส');
  if (ramChip) {
    const det = [
      ...powerDetail(ramChip),
      ...busCheck(ramChip, 'A', 13),
      ...busCheck(ramChip, 'D', 8),
    ];
    if (!same(P(ramChip, '/CE1'), cpuPin('/MREQ'))) det.push(`/CE1 (ขา 20) ต้องต่อกับ /MREQ (ขา 19) ของ CPU — ตอนนี้ ${describe(P(ramChip, '/CE1'))}`);
    if (!same(P(ramChip, 'CE2'), A15)) det.push(`CE2 (ขา 26) ต้องต่อกับ A15 ของ CPU เพื่อให้ RAM อยู่ 8000h–FFFFh — ตอนนี้ ${describe(P(ramChip, 'CE2'))}`);
    if (!same(P(ramChip, '/OE'), cpuPin('/RD'))) det.push(`/OE (ขา 22) ต้องต่อกับ /RD ของ CPU — ตอนนี้ ${describe(P(ramChip, '/OE'))}`);
    if (!same(P(ramChip, '/WE'), cpuPin('/WR'))) det.push(`/WE (ขา 27) ต้องต่อกับ /WR ของ CPU — ตอนนี้ ${describe(P(ramChip, '/WE'))}`);
    checks.push({ label: `RAM ${name(ramChip)} (stack ที่ 8000h–FFFFh)`, ok: det.length === 0, detail: det });
    if (!det.length) ram = { id: ramChip.id, at: { mask: 0x8000, value: 0x8000 } };
  } else problems.push('ยังไม่มี RAM — CALL / RET / PUSH ใช้ stack ไม่ได้ (เขียนแล้วหาย อ่านได้ FFh) โปรแกรมที่เรียก subroutine จะหลุด');

  // I/O decoders: which /Y output is low for which port, on reads and/or writes
  const decoders = new Map<string, { read: boolean; write: boolean; out: (k: number) => Match | null }>();
  for (const d of of('138')) {
    const det: string[] = [];
    if (!powered(d)) det.push(...powerDetail(d));
    if (lv.at(P(d, 'G1')) !== 1) det.push(`G1 (ขา 6) ต้องเป็น HIGH — ตอนนี้ ${describe(P(d, 'G1'))}`);
    const enables = [P(d, '/G2A'), P(d, '/G2B')];
    const iorq = enables.findIndex((r) => same(r, cpuPin('/IORQ')));
    const other = enables[1 - iorq];
    let read = false;
    let write = false;
    if (iorq < 0) det.push(`ขา /G2A หรือ /G2B ต้องต่อ /IORQ (ขา 20) ของ CPU เพื่อให้ทำงานเฉพาะคำสั่ง IN / OUT`);
    else if (same(other, cpuPin('/WR'))) write = true;
    else if (same(other, cpuPin('/RD'))) read = true;
    else if (lv.at(other) === 0) read = write = true;
    else det.push(`${enables.indexOf(other) === 0 ? '/G2A' : '/G2B'} อีกขาต้องต่อ /WR (พอร์ตเขียน), /RD (พอร์ตอ่าน) หรือ GND — ตอนนี้ ${describe(other)}`);
    // select inputs → port bits
    const sel: ({ bit: number } | { fixed: 0 | 1 })[] = [];
    for (const s of ['A', 'B', 'C']) {
      const r = P(d, s);
      const line = PINOUT.CPU.find((x) => x.bus === 'A' && x.bit! < 8 && same(r, ref(cpu.id, x.n)));
      const l = lv.at(r);
      if (line) sel.push({ bit: line.bit! });
      else if (l === 0 || l === 1) sel.push({ fixed: l });
      else det.push(`${s} (ขา ${pinNo('138', s)}) ต้องต่อกับ A0–A7 ของ CPU — ตอนนี้ ${describe(r)}`);
    }
    if (det.length) {
      problems.push(`decoder ${name(d)}: ${det.join(' · ')}`);
      continue;
    }
    decoders.set(d.id, {
      read,
      write,
      out: (k) => {
        let mask = 0;
        let value = 0;
        for (const [i, s] of sel.entries()) {
          const want = (k >> i) & 1;
          if ('fixed' in s) {
            if (s.fixed !== want) return null;
          } else if (mask & (1 << s.bit) && ((value >> s.bit) & 1) !== want) return null;
          else {
            mask |= 1 << s.bit;
            value |= want << s.bit;
          }
        }
        return { mask, value };
      },
    });
  }
  /** decode for an active-low enable/clock pin: driven by a /Y output of a working decoder */
  const decodedBy = (r: PinRef, kind: 'read' | 'write') => {
    for (const [id, dec] of decoders) {
      if (!dec[kind]) continue;
      for (let k = 0; k < 8; k++) if (same(r, ref(id, pinNo('138', `/Y${k}`)))) return dec.out(k);
    }
    return null;
  };
  const dataLine = (r: PinRef) => PINOUT.CPU.find((x) => x.bus === 'D' && same(r, ref(cpu.id, x.n)))?.bit ?? -1;

  const latches: OutLatch[] = [];
  for (const l of of('574')) {
    const det: string[] = [];
    if (!powered(l)) det.push(...powerDetail(l));
    const port = decodedBy(P(l, 'CLK'), 'write');
    if (!port) det.push(`CLK (ขา 11) ต้องต่อกับ /Y ของ 74HC138 ที่ถอดรหัสพอร์ตเขียน (/IORQ + /WR) — ตอนนี้ ${describe(P(l, 'CLK'))}`);
    const dataMap = Array.from({ length: 8 }, (_, i) => dataLine(P(l, `D${i}`)));
    const loose = dataMap.flatMap((v, i) => (v < 0 ? [`D${i}`] : []));
    if (loose.length === 8) det.push('D0–D7 (ขา 2–9) ต้องต่อกับบัสข้อมูล D0–D7 ของ CPU');
    else if (loose.length) problems.push(`latch ${name(l)}: ${loose.join(', ')} ไม่ได้ต่อกับบัสข้อมูล — บิตนั้นจะเป็น 0`);
    else if (dataMap.some((v, i) => v !== i)) problems.push(`latch ${name(l)}: บัสข้อมูลต่อสลับบิต — Q จะไม่ตรงกับค่าที่ OUT`);
    const outputsOn = lv.at(P(l, '/OE')) === 0;
    if (!outputsOn) problems.push(`latch ${name(l)}: /OE (ขา 1) ต้องต่อ GND ไม่อย่างนั้น Q0–Q7 ไม่ขับออก — ตอนนี้ ${describe(P(l, '/OE'))}`);
    if (det.length) problems.push(`latch ${name(l)}: ${det.join(' · ')}`);
    else latches.push({ id: l.id, port: port!, dataMap, outputsOn });
  }
  checks.push({
    label: 'latch 74HC574 รับค่าจากคำสั่ง OUT (บัสข้อมูล + decoder)',
    ok: latches.length > 0,
    detail: latches.length ? [] : ['ต่อ D0–D7 กับบัสข้อมูล, CLK กับ /Y ของ 74HC138 (/G2A ← /IORQ, /G2B ← /WR, A/B/C ← A0–A2)'],
  });

  const buffers: InBuffer[] = [];
  for (const b of of('244')) {
    if (!powered(b)) {
      problems.push(`buffer ${name(b)}: ${powerDetail(b).join(' · ')}`);
      continue;
    }
    const groups: InBuffer['groups'] = [decodedBy(P(b, '/1OE'), 'read'), decodedBy(P(b, '/2OE'), 'read')];
    if (!groups[0] && !groups[1]) problems.push(`buffer ${name(b)}: /1OE หรือ /2OE ต้องต่อกับ /Y ของ 74HC138 ที่ถอดรหัสพอร์ตอ่าน (/IORQ + /RD)`);
    const dataMap = Array.from({ length: 8 }, (_, k) => dataLine(ref(b.id, PINOUT['244'].find((x) => x.bus === 'OUT' && x.bit === k)!.n)));
    // only the halves a decoder enables have to reach the bus
    const used = dataMap.filter((_, k) => groups[k < 4 ? 0 : 1]);
    if (used.length && used.every((v) => v < 0)) problems.push(`buffer ${name(b)}: ขา Y (เอาต์พุต) ยังไม่ได้ต่อกับบัสข้อมูล D0–D7 ของ CPU — IN จะอ่านได้ FFh`);
    else if (dataMap.some((v, k) => groups[k < 4 ? 0 : 1] && v !== k)) problems.push(`buffer ${name(b)}: บัสข้อมูลต่อไม่ครบหรือสลับบิต — ค่าที่ IN ได้จะเพี้ยน`);
    buffers.push({ id: b.id, groups, dataMap });
  }

  const adcs: Adc[] = [];
  for (const a of of('ADC')) {
    if (!empty.live.has(a.id)) continue;
    const det: string[] = [];
    const rd = decodedBy(P(a, '/CS'), 'read');
    const wr = decodedBy(P(a, '/CS'), 'write');
    if (!rd && !wr) det.push(`/CS (ขา 1) ต้องต่อกับ /Y ของ 74HC138 ที่ /G2A ← /IORQ และ /G2B ← GND (ทำงานทั้ง IN และ OUT) — ตอนนี้ ${describe(P(a, '/CS'))}`);
    else if (!wr) det.push('decoder ที่ต่อ /CS ทำงานเฉพาะตอน IN — สั่งเริ่มแปลงด้วย OUT ไม่ได้ · ต่อ /G2B ของ 74HC138 ตัวนั้นลง GND');
    else if (!rd) det.push('decoder ที่ต่อ /CS ทำงานเฉพาะตอน OUT — อ่านผลด้วย IN ไม่ได้ · ต่อ /G2B ของ 74HC138 ตัวนั้นลง GND');
    if (!same(P(a, '/RD'), cpuPin('/RD'))) det.push(`/RD (ขา 2) ต้องต่อกับ /RD (ขา 21) ของ CPU — ตอนนี้ ${describe(P(a, '/RD'))}`);
    if (!same(P(a, '/WR'), cpuPin('/WR'))) det.push(`/WR (ขา 3) ต้องต่อกับ /WR (ขา 22) ของ CPU — ตอนนี้ ${describe(P(a, '/WR'))}`);
    if (lv.at(P(a, 'VIN−')) !== 0) det.push(`VIN− (ขา 7) ต้องต่อ GND — ตอนนี้ ${describe(P(a, 'VIN−'))}`);
    const dataMap = Array.from({ length: 8 }, (_, k) => dataLine(P(a, `DB${k}`)));
    if (dataMap.every((v) => v < 0)) det.push('DB0–DB7 (ขา 18–11) ต้องต่อกับบัสข้อมูล D0–D7 ของ CPU');
    else if (dataMap.some((v, k) => v !== k)) problems.push(`ADC ${name(a)}: บัสข้อมูลต่อไม่ครบหรือสลับบิต — ค่าที่อ่านได้จะเพี้ยน`);
    if (det.length) problems.push(`ADC ${name(a)}: ${det.join(' · ')}`);
    else adcs.push({ id: a.id, rd, wr, dataMap });
  }

  const usarts: Usart[] = [];
  for (const u of of('UART')) {
    if (!empty.live.has(u.id)) continue;
    const det: string[] = [];
    const cdLine = PINOUT.CPU.find((x) => x.bus === 'A' && same(P(u, 'C/D'), ref(cpu.id, x.n)));
    if (!cdLine) det.push(`C/D (ขา 12) ต้องต่อกับ A0 ของ CPU — ตอนนี้ ${describe(P(u, 'C/D'))}`);
    const rd = decodedBy(P(u, '/CS'), 'read');
    const wr = decodedBy(P(u, '/CS'), 'write');
    if (!rd || !wr)
      det.push(`/CS (ขา 11) ต้องต่อกับ /Y ของ 74HC138 ที่ /G2A ← /IORQ, /G2B ← GND (ทำงานทั้ง IN และ OUT) — ตอนนี้ ${describe(P(u, '/CS'))}`);
    else if (cdLine && ((rd.mask >> cdLine.bit!) & 1))
      det.push(`decoder ที่ต่อ /CS ใช้ ${cdLine.name} ด้วย จึงเข้าได้แค่ register เดียว — ต่อ A B C ของ 74HC138 ตัวนั้นกับ A1 A2 A3 แทน แล้วให้ ${cdLine.name} เลือก C/D`);
    if (!same(P(u, '/RD'), cpuPin('/RD'))) det.push(`/RD (ขา 13) ต้องต่อกับ /RD (ขา 21) ของ CPU — ตอนนี้ ${describe(P(u, '/RD'))}`);
    if (!same(P(u, '/WR'), cpuPin('/WR'))) det.push(`/WR (ขา 10) ต้องต่อกับ /WR (ขา 22) ของ CPU — ตอนนี้ ${describe(P(u, '/WR'))}`);
    if (lv.at(P(u, 'RESET')) !== 0) det.push(`RESET (ขา 21) ต้องต่อ GND ไม่อย่างนั้นชิปค้างอยู่ในสถานะรีเซ็ต — ตอนนี้ ${describe(P(u, 'RESET'))}`);
    const dataMap = Array.from({ length: 8 }, (_, k) => dataLine(P(u, `D${k}`)));
    if (dataMap.every((v) => v < 0)) det.push('D0–D7 ต้องต่อกับบัสข้อมูล D0–D7 ของ CPU');
    else if (dataMap.some((v, k) => v !== k)) problems.push(`USART ${name(u)}: บัสข้อมูลต่อไม่ครบหรือสลับบิต — ไบต์ที่อ่านได้จะเพี้ยน`);
    const rfid = of('RFID').find((r) => same(ref(r.id, 3), P(u, 'RxD')))?.id ?? null;
    // the trainer's own 8251A also takes bytes from the web terminal, so a free RxD is fine there
    if (!rfid) {
      if (!isKitInner(u.id)) problems.push(`USART ${name(u)}: RxD (ขา 3) ยังไม่ได้ต่อกับ TX ของโมดูล RFID — จะไม่มีข้อมูลเข้ามา`);
    }
    else if (!empty.live.has(rfid)) problems.push(`USART ${name(u)}: โมดูล RFID ที่ต่อ RxD ยังไม่มีไฟเลี้ยง`);
    if (det.length) problems.push(`USART ${name(u)}: ${det.join(' · ')}`);
    else usarts.push({ id: u.id, rd, wr, cd: cdLine!.bit!, dataMap, rfid });
  }

  // two chips driving the same data line on the same IN port fight over the bus
  const partOf = (id: string) => board.parts.find((p) => p.id === id)!;
  const readers = [
    ...buffers.flatMap((b) => b.groups.flatMap((g, gi) => (g ? [{ who: `buffer ${name(partOf(b.id))}`, at: g, lines: b.dataMap.slice(gi * 4, gi * 4 + 4) }] : []))),
    ...adcs.flatMap((a) => (a.rd ? [{ who: `ADC ${name(partOf(a.id))}`, at: a.rd, lines: a.dataMap }] : [])),
    ...usarts.flatMap((u) => (u.rd ? [{ who: `USART ${name(partOf(u.id))}`, at: u.rd, lines: u.dataMap }] : [])),
  ];
  for (let i = 0; i < readers.length; i++)
    for (let j = i + 1; j < readers.length; j++) {
      const [x, y] = [readers[i], readers[j]];
      const overlap = ((x.at.value ^ y.at.value) & x.at.mask & y.at.mask) === 0;
      if (overlap && x.lines.some((l) => l >= 0 && y.lines.includes(l)))
        problems.push(`${x.who} กับ ${y.who} ขับบัสข้อมูลพร้อมกันตอน IN พอร์ต ${hexPort((x.at.value | y.at.value) & 0xff)} — ใช้ /Y คนละขาของ 74HC138`);
    }

  // LEDs and displays need a current-limiting resistor and a ground
  for (const led of [...of('LED'), ...of('7SG')]) {
    const pins = PINOUT[led.type];
    const gnd = pins.filter((d) => d.bus === 'K' || d.name === 'COM');
    if (gnd.some((d) => lv.at(ref(led.id, d.n)) !== 0)) problems.push(`${PART_INFO[led.type].name} ${name(led)}: ขา cathode / COM ต้องต่อ GND ไม่อย่างนั้นไม่ติด`);
    const drivenDirect = pins.filter((d) => (d.bus === 'AN' || d.bus === 'SEG') && nets.members.get(net(ref(led.id, d.n)))!.some((r) => isLatchQ(board, r)));
    if (drivenDirect.length) problems.push(`${PART_INFO[led.type].name} ${name(led)}: ${drivenDirect.map((d) => d.name).join(', ')} ต่อกับ latch ตรงๆ ไม่ผ่านตัวต้านทาน — ของจริง LED / ชิปอาจเสียหาย`);
  }

  const resetRef = cpuPin('/RESET');
  const canRun = !shorted && checks.every((c) => c.ok || c.label.startsWith('RAM') || c.label.startsWith('latch'));
  return { cpu, checks, canRun, problems, nets, rom, ram, latches, buffers, adcs, usarts, live: empty.live, resetRef };
}

/** Warns when a series resistor lets too much or too little current through an LED driven HIGH. */
function ledCurrentChecks(board: Board, nets: Nets, problems: string[]) {
  for (const led of board.parts.filter((p) => p.type === 'LED' || p.type === '7SG')) {
    const found = new Map<number, Part>();
    for (const d of PINOUT[led.type]) {
      if (d.bus !== 'AN' && d.bus !== 'SEG') continue;
      const an = nets.of(ref(led.id, d.n));
      for (const r of nets.resistors) {
        if (r.part.type === 'LDR' || r.part.type === 'NTC' || (r.a !== an && r.b !== an)) continue;
        const other = r.a === an ? r.b : r.a;
        if (nets.members.get(other)!.some((m) => isLatchQ(board, m) || m === 'rail:vt' || m === 'rail:vb')) found.set(ohms(r.part, r.seg, DEFAULT_ENV), r.part);
      }
    }
    for (const [R, part] of found) {
      const mA = ((VCC - LED_VF) / R) * 1000;
      const what = `${PART_INFO[led.type].name} ${name(led)}: ${name(part)} ${fmtOhm(R)} ให้กระแส ${mA < 1 ? mA.toFixed(2) : mA.toFixed(0)} mA`;
      if (mA > 25) problems.push(`${what} — เกินพิกัด LED (~20 mA) และขาเอาต์พุต 74HC574 (~25 mA) ของจริงจะร้อนจนพัง · ใช้ 220Ω–1kΩ`);
      else if (mA > 20) problems.push(`${what} — เกินพิกัด LED (~20 mA) อายุจะสั้น · ใช้ 220Ω ขึ้นไป`);
      else if (mA < 1) problems.push(`${what} — น้อยมาก LED จะหรี่จนแทบมองไม่เห็น · ใช้ 330Ω–1kΩ`);
    }
  }
}

function isLatchQ(board: Board, r: PinRef) {
  const pr = parseRef(r);
  const p = pr && board.parts.find((x) => x.id === pr.part);
  return !!p && p.type === '574' && pinDef('574', pr!.n)?.bus === 'Q';
}

/** "U1 D0 (ขา 14)" for a pin, or the rail's name. */
export const label = (board: Board) => (r: PinRef) => {
  if (isRail(r)) return RAILS[r]?.label ?? r;
  const pr = parseRef(r);
  const p = pr && board.parts.find((x) => x.id === pr.part);
  if (!p) return r;
  const d = pinDef(p.type, pr!.n);
  return `${p.id.toUpperCase()} ${d?.name ?? ''} (ขา ${pr!.n})`;
};

/** Smallest port number a decode answers to, for display. */
export const firstMatch = (m: Match) => m.value;

// ---------- run-time view of the outputs ----------

/** Q-pin drive levels of every latch whose outputs are enabled. */
export function latchDrive(an: Analysis, values: ReadonlyMap<string, number>) {
  const drive = new Map<PinRef, 0 | 1>();
  for (const l of an.latches) {
    if (!l.outputsOn) continue;
    const v = values.get(l.id) ?? 0;
    for (const d of PINOUT['574']) if (d.bus === 'Q') drive.set(ref(l.id, d.n), ((v >> d.bit!) & 1) as 0 | 1);
  }
  return drive;
}

/** Run-time state of chips whose output pins follow it. */
export interface ChipPins {
  /** ADC0804 /INTR by part id */
  intr?: ReadonlyMap<string, 0 | 1>;
  /** 8251A RxRDY by part id */
  rxrdy?: ReadonlyMap<string, boolean>;
}

/**
 * Everything driving a pin at run time: latch outputs, digital sensor outputs,
 * the ADC's /INTR and the USART's status pins, plus the analog sensor outputs.
 */
export function runDrive(
  board: Board,
  an: Analysis,
  values: ReadonlyMap<string, number>,
  env: Env = DEFAULT_ENV,
  chips: ChipPins = {},
  closed: ReadonlySet<string> = new Set(),
) {
  const drive = latchDrive(an, values);
  const analog = new Map<PinRef, number>();
  for (const p of board.parts) {
    if (!an.live.has(p.id)) continue;
    if (p.type === 'PIR') drive.set(ref(p.id, 2), env.motion ? 1 : 0);
    if (p.type === 'IR') drive.set(ref(p.id, 1), env.distance <= irRange(p) ? 0 : 1);
    if (p.type === 'LDM') {
      const ao = ldmAo(env);
      analog.set(ref(p.id, 4), ao);
      drive.set(ref(p.id, 3), ao > ldmThreshold(p) ? 1 : 0);
    }
    if (p.type === 'LM35') analog.set(ref(p.id, 2), lm35Volts(env));
    if (p.type === 'SND') drive.set(ref(p.id, 3), env.sound ? 0 : 1);
    if (p.type === 'VIB') drive.set(ref(p.id, 3), env.vibration ? 1 : 0);
    if (p.type === 'FLM') drive.set(ref(p.id, 3), env.flame ? 0 : 1);
    if (p.type === 'H2O') drive.set(ref(p.id, 3), env.water ? 0 : 1);
    if (p.type === 'GAS') drive.set(ref(p.id, 3), env.gas ? 0 : 1);
    // open collector: pulls low near a magnet, otherwise lets the pull-up decide
    if (p.type === 'HALL' && env.magnet) drive.set(ref(p.id, 3), 0);
    if (p.type === 'TCH') drive.set(ref(p.id, 3), closed.has(p.id) ? 1 : 0);
    if (p.type === 'MODI') {
      const m = moduleById(p.model);
      if (m) drive.set(ref(p.id, 3), (closed.has(p.id) ? m.active! : 1 - m.active!) as 0 | 1);
    }
    if (p.type === 'MODA') {
      const m = moduleById(p.model);
      if (m?.q) analog.set(ref(p.id, 3), modVolts(m, partPos(p)));
    }
    if (p.type === 'ADC') drive.set(ref(p.id, 5), chips.intr?.get(p.id) ?? 1);
    // serial lines idle HIGH between bytes
    if (p.type === 'RFID') drive.set(ref(p.id, 3), 1);
    if (p.type === 'UART') {
      drive.set(ref(p.id, 14), chips.rxrdy?.get(p.id) ? 1 : 0);
      drive.set(ref(p.id, 15), 1);
      drive.set(ref(p.id, 18), 1);
      drive.set(ref(p.id, 19), 1);
    }
  }
  return { drive, analog };
}

/** Levels and voltages of the running board: closed switches, driven outputs, sensors in `env`. */
export function probe(
  board: Board,
  an: Analysis,
  values: ReadonlyMap<string, number>,
  closed: ReadonlySet<string> = new Set(),
  env: Env = DEFAULT_ENV,
  chips: ChipPins = {},
) {
  const nets = closed.size ? buildNets(board, closed) : an.nets;
  const { drive, analog } = runDrive(board, an, values, env, chips, closed);
  return { nets, lv: netLevels(board, nets, drive, { env, analog }) };
}

/** Which LEDs / segments are lit, given latch values and pressed buttons. */
export function outputs(board: Board, an: Analysis, values: ReadonlyMap<string, number>, closed: ReadonlySet<string> = new Set(), env: Env = DEFAULT_ENV) {
  return litOf(board, probe(board, an, values, closed, env).lv);
}

const ledPins = (p: Part, i: number): [anode: PinRef, cathode: PinRef] =>
  p.type === 'LED' ? [ref(p.id, 1 + i), ref(p.id, 16 - i)] : [ref(p.id, PINOUT['7SG'].find((d) => d.bus === 'SEG' && d.bit === i)!.n), ref(p.id, 3)];

/** Which LEDs / segments are lit at these levels. */
export function litOf(board: Board, lv: Levels) {
  const lit = new Map<string, boolean[]>();
  for (const p of board.parts)
    if (p.type === 'LED' || p.type === '7SG')
      lit.set(
        p.id,
        Array.from({ length: 8 }, (_, i) => {
          const [a, k] = ledPins(p, i);
          return lv.at(a) === 1 && lv.at(k) === 0;
        }),
      );
  return lit;
}

/** Milliamps through each lit LED / segment: (V − Vf) / R summed over its series resistors; driven with no resistor = past the limit. */
export function ledCurrents(board: Board, nets: Nets, lv: Levels) {
  const out = new Map<string, number[]>();
  for (const p of board.parts) {
    if (p.type !== 'LED' && p.type !== '7SG') continue;
    out.set(
      p.id,
      Array.from({ length: 8 }, (_, i) => {
        const [a, k] = ledPins(p, i);
        if (lv.at(a) !== 1 || lv.at(k) !== 0) return 0;
        if (lv.strongAt(a) === 1) return 40;
        const an = nets.of(a);
        const vk = lv.volts(k) ?? 0;
        let mA = 0;
        for (const r of nets.resistors) {
          if (r.a !== an && r.b !== an) continue;
          const other = nets.members.get(r.a === an ? r.b : r.a)![0];
          const v = lv.volts(other);
          if (v != null) mA += (Math.max(0, v - LED_VF - vk) / ohms(r.part, r.seg, lv.env)) * 1000;
        }
        return mA;
      }),
    );
  }
  return out;
}

/** True while the /RESET pin is pulled low (e.g. a reset button is held). */
export function inReset(board: Board, an: Analysis, closed: ReadonlySet<string>) {
  if (!an.resetRef || !closed.size) return false;
  return netLevels(board, buildNets(board, closed)).at(an.resetRef) === 0;
}

// ---------- editing helpers ----------

const key = (w: Wire) => [w.a, w.b].sort().join('|');

export function addWires(board: Board, add: Wire[]): Board {
  const have = new Set(board.wires.map(key));
  const fresh = add.filter((w) => w.a !== w.b && !have.has(key(w)) && have.add(key(w)));
  return fresh.length ? { ...board, wires: [...board.wires, ...fresh] } : board;
}

/** Wires every bit of the bus under pin `a` to the same bit of the bus under pin `b` (or all of them to a rail). */
export function busWires(board: Board, a: PinRef, b: PinRef): Wire[] {
  const group = (r: PinRef) => {
    const pr = parseRef(r);
    const p = pr && board.parts.find((x) => x.id === pr.part);
    const d = p && pinDef(p.type, pr!.n);
    if (!p || !d?.bus) return null;
    return new Map(PINOUT[p.type].filter((x) => x.bus === d.bus).map((x) => [x.bit!, ref(p.id, x.n)]));
  };
  const ga = group(a);
  if (!ga) return [{ a, b }];
  if (isRail(b)) return [...ga.values()].map((r) => ({ a: r, b }));
  const gb = group(b);
  if (!gb) return [{ a, b }];
  return [...ga].flatMap(([bit, r]) => (gb.has(bit) ? [{ a: r, b: gb.get(bit)! }] : []));
}

/** Supply wiring: terminal to the top rails, top rails jumpered to the bottom ones, every chip's VCC / GND to the nearer rail. */
export function powerWires(board: Board): Wire[] {
  const out: Wire[] = [];
  const term = board.parts.find((p) => p.type === '5V');
  if (term) out.push({ a: ref(term.id, 1), b: 'rail:vt' }, { a: ref(term.id, 2), b: 'rail:gt' });
  out.push({ a: 'rail:vt', b: 'rail:vb' }, { a: 'rail:gt', b: 'rail:gb' });
  for (const p of board.parts) {
    if (p.type === '5V') continue;
    for (const d of PINOUT[p.type]) {
      if (d.kind !== 'vcc' && d.kind !== 'gnd') continue;
      const top = pinPos(p, d.n).y < BOARD_H / 2;
      out.push({ a: ref(p.id, d.n), b: d.kind === 'vcc' ? (top ? 'rail:vt' : 'rail:vb') : top ? 'rail:gt' : 'rail:gb' });
    }
  }
  return out;
}

// ---------- the board students start with ----------

function defaultBoard(): Board {
  const parts: Part[] = [
    { id: 'p5v', type: '5V', x: 790, y: 64, rot: 0 },
    { id: 'y1', type: 'CLK', x: 40, y: 80, rot: 0 },
    { id: 'r1', type: 'Ω', x: 300, y: 92, rot: 0 },
    { id: 'sw1', type: 'BTN', x: 400, y: 82, rot: 0 },
    { id: 'u1', type: 'CPU', x: 40, y: 190, rot: 0 },
    { id: 'u2', type: 'ROM', x: 380, y: 190, rot: 0 },
    { id: 'u3', type: 'RAM', x: 640, y: 190, rot: 0 },
    { id: 'u4', type: '138', x: 50, y: 380, rot: 0 },
    { id: 'u5', type: '574', x: 240, y: 380, rot: 0 },
    { id: 'rn1', type: 'RN', x: 470, y: 382, rot: 0 },
    { id: 'd1', type: 'LED', x: 680, y: 374, rot: 0 },
  ];
  let b: Board = { parts, wires: [] };
  const P = (id: string, pinName: string) => {
    const p = parts.find((x) => x.id === id)!;
    return ref(id, pinNo(p.type, pinName));
  };
  const w = (a: PinRef, c: PinRef) => ({ a, b: c });
  b = addWires(b, powerWires(b));
  b = addWires(b, [
    // clock, control pull-ups, reset button
    w(P('y1', 'OUT'), P('u1', 'CLK')),
    ...['/WAIT', '/BUSREQ', '/INT', '/NMI'].map((c) => w(P('u1', c), 'rail:vt')),
    w(P('u1', '/RESET'), ref('r1', 2)),
    w(ref('r1', 1), 'rail:vt'),
    w(P('u1', '/RESET'), ref('sw1', 1)),
    w(ref('sw1', 3), 'rail:gt'),
    // ROM at 0000h–7FFFh
    ...busWires(b, P('u2', 'A0'), P('u1', 'A0')),
    ...busWires(b, P('u2', 'O0'), P('u1', 'D0')),
    w(P('u2', '/CE'), P('u1', 'A15')),
    w(P('u2', '/OE'), P('u1', '/RD')),
    w(P('u2', 'VPP'), 'rail:vt'),
    w(P('u2', '/PGM'), 'rail:vt'),
    // RAM at 8000h–FFFFh
    ...busWires(b, P('u3', 'A0'), P('u1', 'A0')),
    ...busWires(b, P('u3', 'I/O0'), P('u1', 'D0')),
    w(P('u3', '/CE1'), P('u1', '/MREQ')),
    w(P('u3', 'CE2'), P('u1', 'A15')),
    w(P('u3', '/OE'), P('u1', '/RD')),
    w(P('u3', '/WE'), P('u1', '/WR')),
    // port decode: OUT to port n pulls /Yn low (A0–A2 select, /IORQ + /WR enable)
    ...busWires(b, P('u4', 'A'), P('u1', 'A0')),
    w(P('u4', 'G1'), 'rail:vb'),
    w(P('u4', '/G2A'), P('u1', '/IORQ')),
    w(P('u4', '/G2B'), P('u1', '/WR')),
    // latch on port 01h → resistors → LEDs
    ...busWires(b, P('u5', 'D0'), P('u1', 'D0')),
    w(P('u5', 'CLK'), P('u4', '/Y1')),
    w(P('u5', '/OE'), 'rail:gb'),
    ...busWires(b, P('u5', 'Q0'), ref('rn1', 1)),
    ...busWires(b, ref('rn1', 16), P('d1', 'AN0')),
    ...busWires(b, P('d1', 'K0'), 'rail:gb'),
  ]);
  return b;
}

/** The full breadboard computer, wired by hand — for "ต่อเอง". */
export const FULL_BOARD: Board = defaultBoard();

/**
 * The trainer as the circuit it stands for: a hidden Z80, ROM, RAM, clock and
 * supply, a write decoder feeding two 74HC574 latches (ports 01h, 02h) through
 * 330 Ω to the OUT headers, and a read decoder enabling a 74HC244 on port 03h
 * whose inputs are the IN headers with 10 kΩ pull-ups. The board's supply also
 * feeds the breadboard rails. Analysis and the emulator run on this; the screen
 * shows only the trainer.
 */
export function expandKit(board: Board): Board {
  const kit = board.parts.find((p) => p.type === 'KIT');
  if (!kit) return board;
  const id = (s: string) => `${kit.id}~${s}`;
  const hidden = (s: string, type: PartType, val?: number): Part => ({ id: id(s), type, x: -1000, y: -1000, rot: 0, ...(val ? { val } : {}) });
  const inner: Part[] = [
    hidden('pwr', '5V'),
    hidden('y1', 'CLK'),
    hidden('r1', 'Ω', 10000),
    hidden('u1', 'CPU'),
    hidden('u2', 'ROM'),
    hidden('u3', 'RAM'),
    hidden('u4', '138'),
    hidden('u5', '138'),
    hidden('u6', '574'),
    hidden('u7', '574'),
    hidden('u8', '244'),
    hidden('rn1', 'RN', 330),
    hidden('rn2', 'RN', 330),
    hidden('rn3', 'RN', 10000),
    hidden('u9', '138'),
    hidden('u10', 'ADC'),
    hidden('u11', 'UART'),
    hidden('u12', '138'),
  ];
  let b: Board = { parts: [...board.parts, ...inner], wires: board.wires };
  const type = (s: string) => inner.find((x) => x.id === id(s))!.type;
  const P = (s: string, pinName: string) => ref(id(s), pinNo(type(s), pinName));
  const K = (n: number) => ref(kit.id, n);
  const V = ref(id('pwr'), 1);
  const G = ref(id('pwr'), 2);
  const w = (a: PinRef, c: PinRef): Wire => ({ a, b: c });
  const portPin = (g: number, i: number) => K(1 + g * 8 + i);

  const ws: Wire[] = [
    // supply: every hidden chip, the trainer's own +5V / GND pins and the breadboard rails
    ...inner.flatMap((p) => (p.type === '5V' ? [] : PINOUT[p.type].filter((d) => d.kind === 'vcc' || d.kind === 'gnd').map((d) => w(ref(p.id, d.n), d.kind === 'vcc' ? V : G)))),
    w(K(25), V),
    w(K(26), G),
    w(V, 'rail:vt'),
    w(V, 'rail:vb'),
    w(G, 'rail:gt'),
    w(G, 'rail:gb'),
    // clock, control pull-ups, reset pull-up
    w(P('y1', 'OUT'), P('u1', 'CLK')),
    ...['/WAIT', '/BUSREQ', '/INT', '/NMI'].map((c) => w(P('u1', c), V)),
    w(P('u1', '/RESET'), ref(id('r1'), 2)),
    w(ref(id('r1'), 1), V),
    // ROM at 0000h–7FFFh, RAM at 8000h–FFFFh
    w(P('u2', '/CE'), P('u1', 'A15')),
    w(P('u2', '/OE'), P('u1', '/RD')),
    w(P('u2', 'VPP'), V),
    w(P('u2', '/PGM'), V),
    w(P('u3', '/CE1'), P('u1', '/MREQ')),
    w(P('u3', 'CE2'), P('u1', 'A15')),
    w(P('u3', '/OE'), P('u1', '/RD')),
    w(P('u3', '/WE'), P('u1', '/WR')),
    // port decoders: u4 on OUT (/IORQ + /WR), u5 on IN (/IORQ + /RD), A0–A2 select
    w(P('u4', 'G1'), V),
    w(P('u4', '/G2A'), P('u1', '/IORQ')),
    w(P('u4', '/G2B'), P('u1', '/WR')),
    w(P('u5', 'G1'), V),
    w(P('u5', '/G2A'), P('u1', '/IORQ')),
    w(P('u5', '/G2B'), P('u1', '/RD')),
    // OUT 01h / 02h latches, always driving
    w(P('u6', 'CLK'), P('u4', '/Y1')),
    w(P('u7', 'CLK'), P('u4', '/Y2')),
    w(P('u6', '/OE'), G),
    w(P('u7', '/OE'), G),
    // IN 03h buffer, both halves
    w(P('u8', '/1OE'), P('u5', '/Y3')),
    w(P('u8', '/2OE'), P('u5', '/Y3')),
    // pull-ups on the IN header: RN pins 9–16 to +5V
    ...Array.from({ length: 8 }, (_, i) => w(ref(id('rn3'), 9 + i), V)),
    // ADC on port 04h: u9 decodes both IN and OUT (/G2B to ground), AIN is VIN+
    w(P('u9', 'G1'), V),
    w(P('u9', '/G2A'), P('u1', '/IORQ')),
    w(P('u9', '/G2B'), G),
    w(P('u10', '/CS'), P('u9', '/Y4')),
    w(P('u10', '/RD'), P('u1', '/RD')),
    w(P('u10', '/WR'), P('u1', '/WR')),
    w(P('u10', 'VIN−'), G),
    w(P('u10', 'VIN+'), K(27)),
    // 8251A on ports 06h (data) / 07h (command, status): u12 decodes A1–A3 on IN and OUT, A0 picks C/D
    w(P('u12', 'G1'), V),
    w(P('u12', '/G2A'), P('u1', '/IORQ')),
    w(P('u12', '/G2B'), G),
    w(P('u12', 'A'), P('u1', 'A1')),
    w(P('u12', 'B'), P('u1', 'A2')),
    w(P('u12', 'C'), P('u1', 'A3')),
    w(P('u11', '/CS'), P('u12', '/Y3')),
    w(P('u11', 'C/D'), P('u1', 'A0')),
    w(P('u11', '/RD'), P('u1', '/RD')),
    w(P('u11', '/WR'), P('u1', '/WR')),
    w(P('u11', 'RESET'), G),
    w(P('u11', '/CTS'), G),
    w(P('u11', 'RxD'), K(28)),
    w(P('u11', 'TxD'), K(29)),
  ];
  b = addWires(b, ws);
  b = addWires(b, [
    ...busWires(b, P('u2', 'A0'), P('u1', 'A0')),
    ...busWires(b, P('u2', 'O0'), P('u1', 'D0')),
    ...busWires(b, P('u3', 'A0'), P('u1', 'A0')),
    ...busWires(b, P('u3', 'I/O0'), P('u1', 'D0')),
    ...busWires(b, P('u4', 'A'), P('u1', 'A0')),
    ...busWires(b, P('u5', 'A'), P('u1', 'A0')),
    ...busWires(b, P('u9', 'A'), P('u1', 'A0')),
    ...busWires(b, P('u10', 'DB0'), P('u1', 'D0')),
    ...busWires(b, P('u11', 'D0'), P('u1', 'D0')),
    ...busWires(b, P('u6', 'D0'), P('u1', 'D0')),
    ...busWires(b, P('u7', 'D0'), P('u1', 'D0')),
    ...busWires(b, P('u8', '1Y1'), P('u1', 'D0')),
    // latch Q → 330 Ω → OUT header
    ...busWires(b, P('u6', 'Q0'), ref(id('rn1'), 1)),
    ...busWires(b, P('u7', 'Q0'), ref(id('rn2'), 1)),
    ...busWires(b, ref(id('rn1'), 16), portPin(0, 0)),
    ...busWires(b, ref(id('rn2'), 16), portPin(1, 0)),
    // IN header → buffer inputs, with the pull-ups
    ...busWires(b, P('u8', '1A1'), portPin(2, 0)),
    ...busWires(b, ref(id('rn3'), 1), portPin(2, 0)),
  ]);
  return b;
}

/** Parts the "ต่ออัตโนมัติ" button knows how to put on the trainer. */
export const AUTO_WIRABLE: ReadonlySet<PartType> = new Set(['LED', '7SG', 'BTN', 'REED', 'TILT', 'PIR', 'IR', 'LDM', 'SND', 'VIB', 'FLM', 'H2O', 'GAS', 'HALL', 'TCH', 'MODI', 'MODS', 'MODA', 'MODO', 'MOD2', 'MOD3', 'MOD4']);

/**
 * Wires one part to the trainer the obvious way: LED bars and 7-segments to the
 * first OUT port with all 8 pins free, switches and digital sensor outputs to the
 * lowest free IN 03h bit, grounds and supplies to the nearer rails. Says where it
 * went so the student knows which port / bit their code must use.
 */
export function autoWire(board: Board, partId: string): { wires: Wire[]; msg: string } | { error: string } {
  const kit = board.parts.find((p) => p.type === 'KIT');
  const part = board.parts.find((p) => p.id === partId);
  if (!part) return { error: 'ไม่พบชิ้นส่วนนี้' };
  if (!kit) return { error: 'ต้องมีบอร์ด Z80 สำเร็จบนบอร์ดก่อน' };
  if (!AUTO_WIRABLE.has(part.type)) return { error: `${PART_INFO[part.type].name} ต่ออัตโนมัติไม่ได้ — ต่อเองตามการใช้งาน` };
  const mine = (r: PinRef) => parseRef(r)?.part === part.id;
  if (board.wires.some((w) => mine(w.a) || mine(w.b))) return { error: `${part.id.toUpperCase()} ต่อสายไว้แล้ว — ลบสายเดิมก่อนถ้าจะให้ต่อใหม่` };

  const used = new Set(board.wires.flatMap((w) => [w.a, w.b]));
  const kitPin = (g: number, i: number) => ref(kit.id, 1 + g * 8 + i);
  const top = pinPos(part, 1).y < BOARD_H / 2;
  const V = top ? 'rail:vt' : 'rail:vb';
  const G = top ? 'rail:gt' : 'rail:gb';
  const id = part.id.toUpperCase();
  const at = (n: number) => ref(part.id, n);

  if (part.type === 'LED' || part.type === '7SG') {
    const g = [0, 1].find((k) => Array.from({ length: 8 }, (_, i) => kitPin(k, i)).every((r) => !used.has(r)));
    if (g == null) return { error: 'OUT 01h และ OUT 02h ถูกใช้หมดแล้ว — ลบสายที่พอร์ตใดพอร์ตหนึ่งก่อน' };
    const port = `OUT ${hexPort(KIT_PORTS[g].port)}`;
    if (part.type === 'LED')
      return {
        wires: [...busWires(board, at(1), kitPin(g, 0)), ...busWires(board, at(16), G)],
        msg: `ต่อ ${id} ที่ ${port} · LED 0–7 = บิต 0–7 · cathode ลง GND`,
      };
    return {
      wires: [...busWires(board, at(pinNo('7SG', 'A')), kitPin(g, 0)), { a: at(3), b: G }],
      msg: `ต่อ ${id} ที่ ${port} · บิต 0–6 = a–g, บิต 7 = จุด · COM ลง GND`,
    };
  }

  const mod = moduleById(part.model);
  if (part.type === 'MODA') {
    if (used.has(ref(kit.id, 27))) return { error: 'ขา AIN ของบอร์ดสำเร็จมีอุปกรณ์ต่ออยู่แล้ว — ADC มีช่องเดียว' };
    return {
      wires: [{ a: at(3), b: ref(kit.id, 27) }, { a: at(1), b: V }, { a: at(2), b: G }],
      msg: `ต่อ ${id} ที่ AIN · OUT (04h),A เริ่มแปลง แล้ว IN A,(04h) ได้ 0–255`,
    };
  }
  if (part.type === 'MODO') {
    const pinOut = [0, 1].flatMap((g) => Array.from({ length: 8 }, (_, i) => [g, i])).find(([g, i]) => !used.has(kitPin(g, i)));
    if (!pinOut) return { error: 'OUT 01h และ OUT 02h ถูกใช้ครบทุกบิตแล้ว' };
    const [g, i] = pinOut;
    return {
      wires: [{ a: at(3), b: kitPin(g, i) }, { a: at(1), b: V }, { a: at(2), b: G }],
      msg: `ต่อ ${id} ที่ OUT ${hexPort(KIT_PORTS[g].port)} บิต ${i} · ส่ง ${mod?.active ?? 1} = ${mod?.trigger ?? 'ทำงาน'}`,
    };
  }
  if (part.type === 'MOD2' || part.type === 'MOD3' || part.type === 'MOD4') {
    const n = Number(part.type[3]);
    // n neighbouring free bits in one OUT port
    let at0: [number, number] | null = null;
    for (const g of [0, 1])
      for (let i = 0; i + n <= 8 && !at0; i++) if (Array.from({ length: n }, (_, k) => kitPin(g, i + k)).every((r) => !used.has(r))) at0 = [g, i];
    if (!at0) return { error: `ไม่มีบิตว่างติดกัน ${n} บิตในพอร์ต OUT` };
    const [g, i] = at0;
    const names = mod?.inputs ?? [];
    return {
      wires: [...Array.from({ length: n }, (_, k) => ({ a: at(3 + k), b: kitPin(g, i + k) })), { a: at(1), b: V }, { a: at(2), b: G }],
      msg: `ต่อ ${id} ที่ OUT ${hexPort(KIT_PORTS[g].port)} บิต ${i}–${i + n - 1} · ${names.map((nm, k) => `${nm} = บิต ${i + k}`).join(', ')}`,
    };
  }
  const bit = Array.from({ length: 8 }, (_, i) => i).find((i) => !used.has(kitPin(2, i)));
  if (bit == null) return { error: 'IN 03h ถูกใช้ครบ 8 บิตแล้ว — ลบสายที่บิตใดบิตหนึ่งก่อน' };
  const into = kitPin(2, bit);
  const where = `IN 03h บิต ${bit}`;
  switch (part.type) {
    case 'BTN':
      return { wires: [{ a: at(1), b: into }, { a: at(3), b: G }], msg: `ต่อ ${id} ที่ ${where} · ปล่อย = 1, กด = 0` };
    case 'REED':
      return { wires: [{ a: at(1), b: into }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · ไม่มีแม่เหล็ก = 1, มีแม่เหล็กใกล้ = 0` };
    case 'TILT':
      return { wires: [{ a: at(1), b: into }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · ตั้งตรง = 0, เอียง = 1` };
    case 'PIR':
      return { wires: [{ a: at(2), b: into }, { a: at(1), b: V }, { a: at(3), b: G }], msg: `ต่อ ${id} ที่ ${where} · มีการเคลื่อนไหว = 1` };
    case 'IR':
      return { wires: [{ a: at(1), b: into }, { a: at(3), b: V }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · มีวัตถุในระยะ = 0` };
    case 'LDM':
      return { wires: [{ a: at(3), b: into }, { a: at(1), b: V }, { a: at(2), b: G }], msg: `ต่อ ${id} (ขา DO) ที่ ${where} · มืดกว่าจุดที่ตั้ง = 1` };
    case 'MODS':
      return { wires: [{ a: at(1), b: into }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · ${mod?.trigger ?? 'ทำงาน'} = ${mod?.nc ? 1 : 0}` };
    case 'MODI':
      return { wires: [{ a: at(3), b: into }, { a: at(1), b: V }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · ${mod?.trigger ?? 'ทำงาน'} = ${mod?.active ?? 1}` };
    default: {
      // VCC, GND, output modules
      const when: Partial<Record<PartType, string>> = {
        SND: 'เสียงดัง = 0',
        VIB: 'มีการสั่น = 1',
        FLM: 'พบเปลวไฟ = 0',
        H2O: 'เปียก = 0',
        GAS: 'แก๊สเกินจุดที่ตั้ง = 0',
        HALL: 'มีแม่เหล็กใกล้ = 0',
        TCH: 'แตะอยู่ = 1',
      };
      return { wires: [{ a: at(3), b: into }, { a: at(1), b: V }, { a: at(2), b: G }], msg: `ต่อ ${id} ที่ ${where} · ${when[part.type]}` };
    }
  }
}

const hexPort = (v: number) => v.toString(16).toUpperCase().padStart(2, '0') + 'h';

/** A part's catalogue entry, when it has one. */
export const partModule = (p: Part): ModuleDef | undefined => moduleById(p.model);
/** Display name: the catalogue module's name, else the part type's. */
export const partName = (p: Part) => partModule(p)?.name ?? PART_INFO[p.type].name;
/** Description: the catalogue module's, else the part type's. */
export const partDesc = (p: Part) => partModule(p)?.desc ?? PART_INFO[p.type].desc;

/** True for a part the trainer hides (its CPU, latches, …). */
export const isKitInner = (partId: string) => partId.includes('~');

/** Students start on the bare trainer and add what their project needs. */
export const DEFAULT_BOARD: Board = { parts: [{ id: 'kit1', type: 'KIT', x: 40, y: 80, rot: 0 }], wires: [] };
