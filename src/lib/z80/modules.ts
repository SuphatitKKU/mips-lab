// A catalogue of real sensor and output modules for the Z80 trainer, beyond
// the parts drawn one by one. Each entry is one of four shapes:
//   in  — VCC, GND, OUT: a digital output that flips when something happens
//   sw  — two contacts that close (or open, for NC) when operated
//   ain — VCC, GND, AO: an analog voltage read through the trainer's ADC (port 04h)
//   out — VCC, GND, IN: driven from an OUT port bit, does something when IN is at its active level
//   outn — VCC, GND, IN1…INn (2–4): driven from neighbouring OUT bits, what it does depends on all of them
// Descriptions say what the module senses or does, never what to build with it.

export type ModKind = 'in' | 'sw' | 'ain' | 'out' | 'outn';

/** How the module is drawn: board colour, the part on it, and a short marking. */
export interface ModLook {
  pcb: 'blue' | 'green' | 'red' | 'black' | 'purple';
  part: 'mesh' | 'lens' | 'slot' | 'probe' | 'pad' | 'chip' | 'disc' | 'can' | 'coil' | 'cyl' | 'led' | 'motor' | 'lever' | 'button' | 'dome';
  tag: string;
}

export interface ModuleDef {
  id: string;
  kind: ModKind;
  group: string;
  name: string;
  desc: string;
  /** in / sw: the condition, as the label of its switch; out: what it does when on */
  trigger: string;
  /** in: output level while triggered; out: input level that turns it on */
  active?: 0 | 1;
  /** sw: normally closed — operating it opens the contacts */
  nc?: boolean;
  /** ain: the quantity the slider sets, and the volts at its two ends (linear between) */
  q?: { name: string; unit: string; min: number; max: number; v0: number; v1: number; step?: number };
  /** outn: input names, IN1 first */
  inputs?: string[];
  /** outn: what each pattern of input levels does ("10" = IN1 HIGH, IN2 LOW); missing patterns read as `idle` */
  states?: Record<string, string>;
  /** outn: or each input works on its own: on at level `on`, called `labels[i]` */
  each?: { on: 0 | 1; labels: string[] };
  look: ModLook;
}

const GAS = 'แก๊สและอากาศ';
const WATER = 'น้ำและของเหลว';
const OPTIC = 'แสง ระยะ และการตรวจจับวัตถุ';
const FORCE = 'การสั่น แรง และการเอียง';
const SWITCH = 'สวิตช์';
const POWER = 'ไฟฟ้า';
const ANALOG = 'โมดูลอนาล็อก (ต่อขา AIN · ADC 04h)';
const OUTPUT = 'โมดูลเอาต์พุต (ต่อ OUT)';

const gas = (id: string, tag: string, name: string, what: string, trigger: string): ModuleDef => ({
  id,
  kind: 'in',
  group: GAS,
  name: `${tag} ${name}`,
  desc: `ตัวตรวจแบบให้ความร้อน + comparator · ไวต่อ${what} · OUT เป็น LOW เมื่อเกินจุดที่ตั้งด้วย trimpot`,
  trigger,
  active: 0,
  look: { pcb: 'blue', part: 'mesh', tag },
});
const sw = (id: string, name: string, desc: string, trigger: string, part: ModLook['part'], tag: string, nc = false): ModuleDef => ({
  id,
  kind: 'sw',
  group: SWITCH,
  name,
  desc: `${desc} · ${nc ? 'ปกติต่อถึงกัน (NC) ทำงานแล้วขาด' : 'ปกติขาด (NO) ทำงานแล้วต่อถึงกัน'} · ใช้คู่กับ pull-up`,
  trigger,
  nc,
  look: { pcb: 'black', part, tag },
});
const ain = (
  id: string,
  name: string,
  desc: string,
  q: NonNullable<ModuleDef['q']>,
  look: ModLook,
): ModuleDef => ({ id, kind: 'ain', group: ANALOG, name, desc: `${desc} · AO ต่อเข้า AIN ของบอร์ดสำเร็จ แล้วอ่านด้วย ADC พอร์ต 04h`, trigger: q.name, q, look });
const outn = (id: string, name: string, desc: string, inputs: string[], look: ModLook, rule: Pick<ModuleDef, 'states' | 'each'>): ModuleDef => ({
  id,
  kind: 'outn',
  group: OUTPUT,
  name,
  desc: `${desc} · ขา ${inputs.join(', ')} ต่อบิตติดกันของพอร์ต OUT`,
  trigger: '',
  inputs,
  look,
  ...rule,
});
const out = (id: string, name: string, desc: string, trigger: string, look: ModLook, active: 0 | 1 = 1): ModuleDef => ({
  id,
  kind: 'out',
  group: OUTPUT,
  name,
  desc: `${desc} · ขา IN = ${active} → ทำงาน`,
  trigger,
  active,
  look,
});

export const MODULES: ModuleDef[] = [
  // ---------- gas and air ----------
  gas('mq3', 'MQ-3', 'แอลกอฮอล์', 'ไอแอลกอฮอล์', 'มีไอแอลกอฮอล์'),
  gas('mq4', 'MQ-4', 'มีเทน', 'แก๊สมีเทน', 'มีแก๊สมีเทน'),
  gas('mq5', 'MQ-5', 'แก๊สธรรมชาติ', 'แก๊สธรรมชาติและ LPG', 'มีแก๊สธรรมชาติ'),
  gas('mq6', 'MQ-6', 'LPG', 'LPG และบิวเทน', 'มีแก๊ส LPG'),
  gas('mq7', 'MQ-7', 'คาร์บอนมอนอกไซด์', 'คาร์บอนมอนอกไซด์ (CO)', 'มี CO'),
  gas('mq8', 'MQ-8', 'ไฮโดรเจน', 'แก๊สไฮโดรเจน', 'มีไฮโดรเจน'),
  gas('mq9', 'MQ-9', 'CO และแก๊สติดไฟ', 'CO และแก๊สที่ติดไฟได้', 'มี CO หรือแก๊สติดไฟ'),
  gas('mq131', 'MQ-131', 'โอโซน', 'โอโซน', 'มีโอโซน'),
  gas('mq135', 'MQ-135', 'คุณภาพอากาศ', 'แอมโมเนีย เบนซีน และควัน', 'อากาศมีสารเจือปนสูง'),
  gas('mq136', 'MQ-136', 'ไฮโดรเจนซัลไฟด์', 'ไฮโดรเจนซัลไฟด์ (H₂S)', 'มี H₂S'),
  gas('mq137', 'MQ-137', 'แอมโมเนีย', 'แอมโมเนีย (NH₃)', 'มีแอมโมเนีย'),
  gas('mq138', 'MQ-138', 'สารอินทรีย์ระเหย', 'สารอินทรีย์ระเหยง่าย (VOC)', 'มี VOC'),
  gas('mq303a', 'MQ-303A', 'แอลกอฮอล์ (ขนาดเล็ก)', 'ไอแอลกอฮอล์ ใช้ไฟน้อย', 'มีไอแอลกอฮอล์'),
  gas('tgs2600', 'TGS2600', 'สารปนเปื้อนในอากาศ', 'ไฮโดรเจนและ CO ปริมาณน้อย', 'อากาศมีสารปนเปื้อน'),
  {
    id: 'hr202',
    kind: 'in',
    group: GAS,
    name: 'HR202 ความชื้นอากาศ',
    desc: 'ตัวต้านทานแปรตามความชื้น + comparator · OUT เป็น LOW เมื่อความชื้นเกินจุดที่ตั้ง',
    trigger: 'ความชื้นเกินจุดที่ตั้ง',
    active: 0,
    look: { pcb: 'blue', part: 'chip', tag: 'HR202' },
  },
  {
    id: 'ky028',
    kind: 'in',
    group: GAS,
    name: 'KY-028 อุณหภูมิ (ดิจิทัล)',
    desc: 'NTC + comparator · OUT เป็น HIGH เมื่อร้อนกว่าจุดที่ตั้งด้วย trimpot',
    trigger: 'ร้อนกว่าจุดที่ตั้ง',
    active: 1,
    look: { pcb: 'black', part: 'probe', tag: 'KY-028' },
  },

  // ---------- water and liquids ----------
  {
    id: 'yl69',
    kind: 'in',
    group: WATER,
    name: 'YL-69 ความชื้นดิน',
    desc: 'ขั้วโลหะสองขาปักดิน + comparator · OUT เป็น LOW เมื่อดินชื้นกว่าจุดที่ตั้ง',
    trigger: 'ดินชื้น',
    active: 0,
    look: { pcb: 'blue', part: 'probe', tag: 'YL-69' },
  },
  {
    id: 'xkcy25',
    kind: 'in',
    group: WATER,
    name: 'XKC-Y25 ระดับของเหลวแบบไม่สัมผัส',
    desc: 'ติดข้างภาชนะ ตรวจผ่านผนังที่ไม่ใช่โลหะ · OUT เป็น HIGH เมื่อมีของเหลวที่ระดับเซนเซอร์',
    trigger: 'มีของเหลวที่ระดับเซนเซอร์',
    active: 1,
    look: { pcb: 'black', part: 'pad', tag: 'XKC-Y25' },
  },
  sw('float', 'สวิตช์ลูกลอย', 'ลูกลอยมีแม่เหล็กเลื่อนขึ้นลงตามระดับน้ำ', 'ระดับน้ำถึงลูกลอย', 'cyl', 'FLOAT'),
  sw('flowsw', 'สวิตช์การไหลของน้ำ', 'ใบพายในท่อดันหน้าสัมผัสเมื่อน้ำไหล', 'มีน้ำไหลในท่อ', 'cyl', 'FLOW'),

  // ---------- light, distance and objects ----------
  {
    id: 'tcrt5000',
    kind: 'in',
    group: OPTIC,
    name: 'TCRT5000 แยกพื้นสีดำ-ขาว',
    desc: 'ส่ง IR แล้วรับแสงสะท้อนในระยะไม่กี่มิลลิเมตร · OUT เป็น HIGH เมื่อพื้นใต้เซนเซอร์สะท้อนแสงน้อย (สีดำ)',
    trigger: 'พื้นใต้เซนเซอร์เป็นสีดำ',
    active: 1,
    look: { pcb: 'blue', part: 'lens', tag: 'TCRT5000' },
  },
  {
    id: 'ky010',
    kind: 'in',
    group: OPTIC,
    name: 'KY-010 ช่องแสง (photo interrupter)',
    desc: 'ไดโอดส่งแสงกับตัวรับอยู่คนละฝั่งของช่อง · OUT เป็น HIGH เมื่อมีวัตถุบังช่อง',
    trigger: 'มีวัตถุบังช่อง',
    active: 1,
    look: { pcb: 'black', part: 'slot', tag: 'KY-010' },
  },
  {
    id: 'fc03',
    kind: 'in',
    group: OPTIC,
    name: 'FC-03 ช่องแสงวัดรอบ',
    desc: 'ช่องแสงกว้าง 5 mm + LM393 · OUT เป็น HIGH เมื่อมีวัตถุบังช่อง เช่น ซี่ของจานหมุน',
    trigger: 'มีวัตถุบังช่อง',
    active: 1,
    look: { pcb: 'blue', part: 'slot', tag: 'FC-03' },
  },
  {
    id: 'laserrx',
    kind: 'in',
    group: OPTIC,
    name: 'โมดูลรับแสงเลเซอร์',
    desc: 'ตัวรับแสงที่ไวต่อเลเซอร์สีแดง · OUT เป็น HIGH ขณะแสงเลเซอร์ส่องโดน',
    trigger: 'แสงเลเซอร์ส่องโดน',
    active: 1,
    look: { pcb: 'black', part: 'lens', tag: 'LASER RX' },
  },
  {
    id: 'e18',
    kind: 'in',
    group: OPTIC,
    name: 'E18-D80NK IR ปรับระยะ',
    desc: 'หัวทรงกระบอก ปรับระยะตรวจ 3–80 cm ด้วยสกรูท้าย · OUT (NPN) เป็น LOW เมื่อมีวัตถุในระยะ',
    trigger: 'มีวัตถุในระยะ',
    active: 0,
    look: { pcb: 'black', part: 'cyl', tag: 'E18' },
  },
  {
    id: 'e3f',
    kind: 'in',
    group: OPTIC,
    name: 'E3F-20C1 ลำแสงส่องตรง',
    desc: 'ตัวส่งกับตัวรับแยกกันคนละฝั่ง ระยะได้ถึง 20 m · OUT (NPN) เป็น LOW เมื่อลำแสงถูกบัง',
    trigger: 'ลำแสงถูกบัง',
    active: 0,
    look: { pcb: 'black', part: 'cyl', tag: 'E3F' },
  },
  {
    id: 'ky022',
    kind: 'in',
    group: OPTIC,
    name: 'KY-022 รับสัญญาณ IR 38 kHz',
    desc: 'ตัวรับ TSOP1838 สำหรับรีโมท IR · OUT เป็น LOW ขณะได้รับแสง IR ที่กะพริบ 38 kHz',
    trigger: 'ได้รับสัญญาณ IR 38 kHz',
    active: 0,
    look: { pcb: 'black', part: 'dome', tag: 'KY-022' },
  },
  {
    id: 'ljc18',
    kind: 'in',
    group: OPTIC,
    name: 'LJC18A3 พร็อกซิมิตีแบบ capacitive',
    desc: 'หัวตรวจเกลียว M18 ตรวจได้ทั้งโลหะ พลาสติก และของเหลว ระยะ 1–10 mm · OUT (NPN) เป็น LOW เมื่อมีวัตถุ',
    trigger: 'มีวัตถุใกล้หัวตรวจ',
    active: 0,
    look: { pcb: 'black', part: 'cyl', tag: 'LJC18A3' },
  },
  {
    id: 'lj12',
    kind: 'in',
    group: OPTIC,
    name: 'LJ12A3 พร็อกซิมิตีแบบ inductive',
    desc: 'หัวตรวจเกลียว M12 ตรวจเฉพาะโลหะ ระยะ 4 mm · OUT (NPN) เป็น LOW เมื่อมีโลหะ',
    trigger: 'มีโลหะใกล้หัวตรวจ',
    active: 0,
    look: { pcb: 'black', part: 'cyl', tag: 'LJ12A3' },
  },
  {
    id: 'rcwl0516',
    kind: 'in',
    group: OPTIC,
    name: 'RCWL-0516 ไมโครเวฟตรวจการเคลื่อนไหว',
    desc: 'เรดาร์ดอปเพลอร์ ~3 GHz ตรวจผ่านพลาสติกและไม้บางๆ ได้ · OUT เป็น HIGH ราว 2 วินาทีเมื่อมีการเคลื่อนไหว',
    trigger: 'มีการเคลื่อนไหวในระยะ',
    active: 1,
    look: { pcb: 'blue', part: 'coil', tag: 'RCWL-0516' },
  },
  {
    id: 'ld2410',
    kind: 'in',
    group: OPTIC,
    name: 'LD2410 เรดาร์ 24 GHz',
    desc: 'เรดาร์คลื่นมิลลิเมตร ตรวจได้ทั้งวัตถุที่ขยับและที่นิ่งแต่มีการหายใจ · OUT เป็น HIGH เมื่อตรวจพบ',
    trigger: 'ตรวจพบในระยะ',
    active: 1,
    look: { pcb: 'black', part: 'chip', tag: 'LD2410' },
  },

  // ---------- vibration, force, tilt ----------
  {
    id: 'ky002',
    kind: 'in',
    group: FORCE,
    name: 'KY-002 สปริงรับแรงกระแทก',
    desc: 'สปริงในปลอกโลหะแตะหน้าสัมผัสเมื่อโดนกระแทก · OUT เป็น LOW ชั่วขณะที่มีแรงกระแทก',
    trigger: 'มีแรงกระแทก',
    active: 0,
    look: { pcb: 'black', part: 'can', tag: 'KY-002' },
  },
  {
    id: 'ky031',
    kind: 'in',
    group: FORCE,
    name: 'KY-031 เซนเซอร์การเคาะ',
    desc: 'สปริงแข็งที่ไวต่อการเคาะ · OUT เป็น LOW ขณะมีการเคาะ',
    trigger: 'มีการเคาะ',
    active: 0,
    look: { pcb: 'black', part: 'can', tag: 'KY-031' },
  },
  {
    id: 'piezo',
    kind: 'in',
    group: FORCE,
    name: 'แผ่นเพียโซ + LM358',
    desc: 'แผ่นเพียโซสร้างแรงดันเมื่อโดนแรงสั่น ขยายและเทียบด้วย LM358 · OUT เป็น HIGH เมื่อแรงสั่นเกินจุดที่ตั้ง',
    trigger: 'มีแรงสั่นกระทบแผ่น',
    active: 1,
    look: { pcb: 'blue', part: 'disc', tag: 'PIEZO' },
  },
  {
    id: 'ky017',
    kind: 'in',
    group: FORCE,
    name: 'KY-017 สวิตช์เอียงแบบปรอท',
    desc: 'หยดปรอทในหลอดแก้วไหลแตะขั้วเมื่อเอียง · OUT เป็น HIGH เมื่อเอียงจนปรอทแตะขั้ว',
    trigger: 'เอียงจนปรอทแตะขั้ว',
    active: 1,
    look: { pcb: 'black', part: 'can', tag: 'KY-017' },
  },
  {
    id: 'fsr402',
    kind: 'in',
    group: FORCE,
    name: 'FSR-402 แรงกด (ดิจิทัล)',
    desc: 'แผ่นกลมความต้านทานลดลงตามแรงกด + comparator · OUT เป็น LOW เมื่อกดแรงกว่าจุดที่ตั้ง',
    trigger: 'กดแรงเกินจุดที่ตั้ง',
    active: 0,
    look: { pcb: 'blue', part: 'pad', tag: 'FSR402' },
  },
  {
    id: 'ky036',
    kind: 'in',
    group: FORCE,
    name: 'KY-036 สัมผัสขั้วโลหะ',
    desc: 'วัดกระแสเล็กน้อยที่ไหลผ่านร่างกายเมื่อแตะขั้วโลหะ · OUT เป็น HIGH ขณะแตะ',
    trigger: 'แตะขั้วโลหะ',
    active: 1,
    look: { pcb: 'black', part: 'probe', tag: 'KY-036' },
  },
  {
    id: 'ch926',
    kind: 'in',
    group: FORCE,
    name: 'CH-926 ตัวรับเหรียญ',
    desc: 'ตรวจขนาดและน้ำหนักของเหรียญ · OUT เป็น LOW เป็นพัลส์เมื่อมีเหรียญผ่าน',
    trigger: 'มีเหรียญผ่าน',
    active: 0,
    look: { pcb: 'black', part: 'slot', tag: 'CH-926' },
  },

  // ---------- switches ----------
  sw('microsw', 'ไมโครสวิตช์ (KW11)', 'สวิตช์ก้านกดระยะสั้น', 'กดก้านสวิตช์', 'lever', 'KW11'),
  sw('limitsw', 'ลิมิตสวิตช์แบบล้อ', 'ก้านปลายเป็นล้อ ทำงานเมื่อมีวัตถุดันล้อ', 'ล้อถูกดัน', 'lever', 'LIMIT'),
  sw('mushroom', 'ปุ่มหัวเห็ดแบบ NC', 'ปุ่มหัวใหญ่ กดแล้วล็อกค้าง บิดเพื่อคลาย', 'กดปุ่มค้างไว้', 'button', 'NC', true),
  sw('toggle', 'สวิตช์โยก (toggle)', 'ก้านโยกค้างได้สองตำแหน่ง', 'โยกขึ้น', 'lever', 'TOGGLE'),
  sw('slide', 'สวิตช์เลื่อน (SS-12D00)', 'ก้านเลื่อนค้างได้สองตำแหน่ง', 'เลื่อนไปอีกฝั่ง', 'lever', 'SLIDE'),
  sw('keysw', 'สวิตช์กุญแจ', 'บิดด้วยลูกกุญแจเท่านั้น', 'บิดกุญแจ', 'button', 'KEY'),
  sw('footsw', 'สวิตช์เท้าเหยียบ', 'แป้นเหยียบขนาดใหญ่', 'เหยียบแป้น', 'pad', 'FOOT'),
  sw('mat', 'แผ่นสวิตช์รับแรงกด', 'แผ่นบางสองชั้นที่แตะกันเมื่อมีน้ำหนักกด', 'มีน้ำหนักกดบนแผ่น', 'pad', 'MAT'),
  sw('ksd301', 'KSD301 สวิตช์ความร้อน 60°C', 'แผ่นไบเมทัลโก่งตัวเมื่อร้อน', 'อุณหภูมิเกิน 60°C', 'disc', 'KSD301'),
  sw('w1209', 'XH-W1209 เทอร์โมสตัท', 'โมดูลวัดอุณหภูมิพร้อมจอและรีเลย์ ตั้งค่าที่ตัวโมดูล · ต่อหน้าสัมผัสรีเลย์', 'อุณหภูมิถึงค่าที่ตั้ง', 'coil', 'W1209'),
  sw('airsw', 'สวิตช์แรงดันลม', 'ไดอะแฟรมดันหน้าสัมผัสเมื่อแรงดันลมถึงค่าที่ตั้ง', 'แรงดันลมถึงค่าที่ตั้ง', 'disc', 'AIR'),

  // ---------- electrical ----------
  {
    id: 'ac220',
    kind: 'in',
    group: POWER,
    name: 'ตรวจไฟ AC 220V (optocoupler)',
    desc: 'ขั้วเข้าแยกจากวงจรด้วย optocoupler · OUT เป็น LOW เมื่อมีไฟ AC ที่ขั้วเข้า',
    trigger: 'มีไฟ AC ที่ขั้วเข้า',
    active: 0,
    look: { pcb: 'blue', part: 'chip', tag: '220V' },
  },
  {
    id: 'pc817',
    kind: 'in',
    group: POWER,
    name: 'PC817 อินพุตแยกกราวด์ 12–24V',
    desc: 'optocoupler รับแรงดัน 12–24V จากอีกวงจรหนึ่ง · OUT เป็น LOW เมื่อมีแรงดันที่ขั้วเข้า',
    trigger: 'มีแรงดันที่ขั้วเข้า',
    active: 0,
    look: { pcb: 'red', part: 'chip', tag: 'PC817' },
  },

  // ---------- analog, read through the ADC ----------
  ain('gp2y0a21', 'Sharp GP2Y0A21 ระยะ 10–80 cm', 'วัดระยะด้วย IR แบบสามเหลี่ยม · ยิ่งใกล้แรงดันยิ่งสูง (ค่าจริงไม่เป็นเส้นตรง)', { name: 'ระยะวัตถุ', unit: 'cm', min: 10, max: 80, v0: 3.1, v1: 0.4 }, { pcb: 'black', part: 'lens', tag: 'GP2Y0A21' }),
  ain('gp2y0a02', 'Sharp GP2Y0A02 ระยะ 20–150 cm', 'วัดระยะด้วย IR ระยะไกล · ยิ่งใกล้แรงดันยิ่งสูง', { name: 'ระยะวัตถุ', unit: 'cm', min: 20, max: 150, v0: 2.7, v1: 0.4 }, { pcb: 'black', part: 'lens', tag: 'GP2Y0A02' }),
  ain('gp2y0a41', 'Sharp GP2Y0A41 ระยะ 4–30 cm', 'วัดระยะด้วย IR ระยะใกล้ · ยิ่งใกล้แรงดันยิ่งสูง', { name: 'ระยะวัตถุ', unit: 'cm', min: 4, max: 30, v0: 3.1, v1: 0.3 }, { pcb: 'black', part: 'lens', tag: 'GP2Y0A41' }),
  ain('lvez1', 'MaxBotix LV-EZ1 อัลตราโซนิก', 'วัดระยะด้วยคลื่นเสียง ขา AN ให้ ~3.9 mV ต่อ cm', { name: 'ระยะวัตถุ', unit: 'cm', min: 15, max: 645, v0: 0.06, v1: 2.49 }, { pcb: 'green', part: 'can', tag: 'LV-EZ1' }),
  ain('acs712', 'ACS712-5A วัดกระแส', 'Hall วัดกระแสในสายที่ผ่านตัวชิป · 2.5V ที่ 0A, 185 mV ต่อ A', { name: 'กระแส', unit: 'A', min: -5, max: 5, v0: 1.575, v1: 3.425, step: 0.1 }, { pcb: 'red', part: 'chip', tag: 'ACS712' }),
  ain('vsense', 'โมดูลวัดแรงดัน 0–25V', 'วงจรแบ่งแรงดัน 5 : 1 สำหรับวัดแรงดันสูงกว่า 5V', { name: 'แรงดันที่ขั้วเข้า', unit: 'V', min: 0, max: 25, v0: 0, v1: 5, step: 0.1 }, { pcb: 'red', part: 'chip', tag: '0-25V' }),
  ain('guva', 'GUVA-S12SD รังสี UV', 'โฟโตไดโอดไวต่อ UV 240–370 nm · ~0.1V ต่อดัชนี UV 1', { name: 'ดัชนี UV', unit: 'UVI', min: 0, max: 11, v0: 0, v1: 1.1, step: 0.1 }, { pcb: 'purple', part: 'led', tag: 'GUVA' }),
  ain('ml8511', 'ML8511 ความเข้ม UV', 'ตัวรับ UV พร้อมวงจรขยาย · 1.0V ที่ไม่มี UV ถึง 2.8V ที่ 15 mW/cm²', { name: 'ความเข้ม UV', unit: 'mW/cm²', min: 0, max: 15, v0: 1, v1: 2.8, step: 0.1 }, { pcb: 'purple', part: 'chip', tag: 'ML8511' }),
  ain('temt6000', 'TEMT6000 แสงแวดล้อม', 'โฟโตทรานซิสเตอร์ที่ตอบสนองคล้ายตามนุษย์ · แรงดันเพิ่มตามความสว่างจนอิ่มตัว', { name: 'ความสว่าง', unit: 'lux', min: 0, max: 250, v0: 0, v1: 5 }, { pcb: 'blue', part: 'led', tag: 'TEMT6000' }),
  ain('soilcap', 'ความชื้นดินแบบ capacitive', 'แผ่นวัดแบบ capacitive ไม่มีโลหะสัมผัสดิน · ดินแห้ง ~2.8V ดินเปียก ~1.2V', { name: 'ความชื้นดิน', unit: '%', min: 0, max: 100, v0: 2.8, v1: 1.2 }, { pcb: 'black', part: 'probe', tag: 'SOIL v1.2' }),
  ain('waterlvl', 'แถบวัดระดับน้ำ', 'ลายทองแดงสลับกันบนแผ่น ยิ่งจมลึกแรงดันยิ่งสูง', { name: 'ความลึกที่จม', unit: 'mm', min: 0, max: 40, v0: 0, v1: 4 }, { pcb: 'red', part: 'pad', tag: 'WATER' }),
  ain('flex', 'Flex sensor 2.2"', 'แถบที่ความต้านทานเพิ่มเมื่องอ ต่อเป็นวงจรแบ่งแรงดัน', { name: 'มุมงอ', unit: '°', min: 0, max: 90, v0: 2.5, v1: 1.6 }, { pcb: 'black', part: 'pad', tag: 'FLEX' }),
  ain('fsr406', 'FSR-406 แรงกด (อนาล็อก)', 'แผ่นสี่เหลี่ยมความต้านทานลดลงตามแรงกด ต่อกับตัวต้านทาน 10kΩ', { name: 'แรงกด', unit: 'N', min: 0, max: 10, v0: 0, v1: 4.5, step: 0.1 }, { pcb: 'black', part: 'pad', tag: 'FSR406' }),
  ain('softpot', 'Softpot ตัวต้านทานแบบเมมเบรน 50 mm', 'แถบบางที่แรงดันขากลางขึ้นกับตำแหน่งที่กด', { name: 'ตำแหน่งที่กด', unit: 'mm', min: 0, max: 50, v0: 0, v1: 5 }, { pcb: 'black', part: 'pad', tag: 'SOFTPOT' }),
  ain('slidepot', 'ตัวต้านทานแบบเลื่อน 10kΩ', 'ก้านเลื่อนเป็นเส้นตรง ระยะเลื่อน 60 mm', { name: 'ตำแหน่งก้าน', unit: '%', min: 0, max: 100, v0: 0, v1: 5 }, { pcb: 'black', part: 'lever', tag: 'SLIDE 10K' }),
  ain('tmp36', 'TMP36 อุณหภูมิ', 'ไอซีวัดอุณหภูมิ 0.5V ที่ 0°C เพิ่ม 10 mV ต่อ °C', { name: 'อุณหภูมิ', unit: '°C', min: -40, max: 125, v0: 0.1, v1: 1.75 }, { pcb: 'black', part: 'chip', tag: 'TMP36' }),
  ain('lm335', 'LM335 อุณหภูมิ (เคลวิน)', 'ไอซีวัดอุณหภูมิ 10 mV ต่อเคลวิน (2.73V ที่ 0°C)', { name: 'อุณหภูมิ', unit: '°C', min: -40, max: 100, v0: 2.33, v1: 3.73 }, { pcb: 'black', part: 'chip', tag: 'LM335' }),
  ain('ky013', 'KY-013 เทอร์มิสเตอร์ (อนาล็อก)', 'NTC 10kΩ บนแผ่นพร้อมตัวต้านทานแบ่งแรงดัน · ยิ่งร้อนแรงดันยิ่งต่ำ', { name: 'อุณหภูมิ', unit: '°C', min: 0, max: 100, v0: 3.3, v1: 0.6 }, { pcb: 'black', part: 'probe', tag: 'KY-013' }),
  ain('ad8495', 'AD8495 เทอร์โมคัปเปิล K', 'วงจรขยายเทอร์โมคัปเปิล 5 mV ต่อ °C บวก 1.25V', { name: 'อุณหภูมิ', unit: '°C', min: 0, max: 700, v0: 1.25, v1: 4.75 }, { pcb: 'blue', part: 'probe', tag: 'AD8495' }),
  ain('hih4030', 'HIH-4030 ความชื้นสัมพัทธ์', 'ไอซีวัดความชื้นแบบ capacitive · ~0.96V ที่ 0% ถึง ~4.0V ที่ 100%', { name: 'ความชื้น', unit: '%RH', min: 0, max: 100, v0: 0.96, v1: 4.03 }, { pcb: 'red', part: 'chip', tag: 'HIH-4030' }),
  ain('mpx5700', 'MPX5700AP แรงดันอากาศ', 'วัดแรงดันสัมบูรณ์ 15–700 kPa', { name: 'แรงดัน', unit: 'kPa', min: 15, max: 700, v0: 0.3, v1: 4.7 }, { pcb: 'black', part: 'chip', tag: 'MPX5700' }),
  ain('waterpress', 'เซนเซอร์แรงดันน้ำ 0–1.2 MPa', 'หัวเกลียวต่อท่อ ให้ 0.5–4.5V ตามแรงดัน', { name: 'แรงดันน้ำ', unit: 'MPa', min: 0, max: 1.2, v0: 0.5, v1: 4.5, step: 0.01 }, { pcb: 'black', part: 'cyl', tag: '1.2MPa' }),
  ain('mg811', 'MG-811 คาร์บอนไดออกไซด์', 'ตัวตรวจ CO₂ แบบอิเล็กโทรไลต์แข็งพร้อมวงจรขยาย · ยิ่ง CO₂ มากแรงดันยิ่งต่ำ', { name: 'CO₂', unit: 'ppm', min: 400, max: 10000, v0: 2.4, v1: 1 }, { pcb: 'blue', part: 'mesh', tag: 'MG-811' }),
  ain('gp2y1014', 'Sharp GP2Y1014AU ฝุ่นละออง', 'วัดแสงที่ฝุ่นสะท้อนในห้องวัด · ~0.5V ต่อ 0.1 mg/m³', { name: 'ฝุ่น', unit: 'mg/m³', min: 0, max: 0.5, v0: 0.6, v1: 3.6, step: 0.01 }, { pcb: 'black', part: 'slot', tag: 'GP2Y1014' }),
  ain('max4466', 'MAX4466 ไมโครโฟนขยาย', 'ไมโครโฟนพร้อมวงจรขยายปรับได้ · ค่าในที่นี้คือแรงดันเฉลี่ยตามความดังของเสียง', { name: 'ความดังเสียง', unit: 'dB', min: 30, max: 100, v0: 0.2, v1: 2.5 }, { pcb: 'purple', part: 'disc', tag: 'MAX4466' }),
  ain('myoware', 'MyoWare กล้ามเนื้อ (EMG)', 'วัดสัญญาณไฟฟ้าจากกล้ามเนื้อผ่านแผ่นอิเล็กโทรด · ให้แรงดันตามแรงเกร็ง', { name: 'แรงเกร็งกล้ามเนื้อ', unit: '%', min: 0, max: 100, v0: 0, v1: 3.3 }, { pcb: 'red', part: 'pad', tag: 'MYOWARE' }),
  ain('ss49e', 'SS49E Hall แบบเชิงเส้น', 'วัดความแรงและทิศของสนามแม่เหล็ก · 2.5V ที่ไม่มีสนาม ~14 mV ต่อ mT', { name: 'สนามแม่เหล็ก', unit: 'mT', min: -100, max: 100, v0: 1.1, v1: 3.9 }, { pcb: 'black', part: 'chip', tag: 'SS49E' }),
  ain('ph', 'E-201 หัววัด pH', 'หัววัดแก้วพร้อมวงจรขยาย · ~2.5V ที่ pH 7 ลดลง ~0.18V ต่อ pH', { name: 'pH', unit: 'pH', min: 0, max: 14, v0: 3.76, v1: 1.24, step: 0.1 }, { pcb: 'blue', part: 'probe', tag: 'pH' }),
  ain('tds', 'TDS วัดสารละลายในน้ำ', 'วัดการนำไฟฟ้าของน้ำ คิดเป็นปริมาณสารละลาย', { name: 'TDS', unit: 'ppm', min: 0, max: 1000, v0: 0, v1: 2.3 }, { pcb: 'blue', part: 'probe', tag: 'TDS' }),
  ain('turbidity', 'วัดความขุ่นของน้ำ', 'ส่งแสงผ่านน้ำแล้ววัดแสงที่ทะลุ · ยิ่งขุ่นแรงดันยิ่งต่ำ', { name: 'ความขุ่น', unit: 'NTU', min: 0, max: 3000, v0: 4.2, v1: 2.5 }, { pcb: 'black', part: 'slot', tag: 'TURBIDITY' }),
  ain('solar', 'แผงโซลาร์เซลล์ขนาดเล็ก', 'แผง 5V ต่อผ่านวงจรแบ่งแรงดัน · แรงดันตามความเข้มแสงแดด', { name: 'ความเข้มแสงแดด', unit: 'W/m²', min: 0, max: 1000, v0: 0, v1: 4.5 }, { pcb: 'black', part: 'pad', tag: 'SOLAR' }),
  ain('sct013', 'SCT-013-030 คล้องสายวัดกระแส AC', 'หม้อแปลงกระแสแบบคล้องสาย ต่อผ่านวงจรเรียงกระแส · 1V ที่ 30A', { name: 'กระแส AC', unit: 'A', min: 0, max: 30, v0: 0, v1: 1, step: 0.1 }, { pcb: 'black', part: 'coil', tag: 'SCT-013' }),

  // ---------- outputs, driven from an OUT port bit ----------
  out('ky012', 'KY-012 ออดแบบแอกทีฟ', 'มีวงจรกำเนิดเสียงในตัว ให้ไฟก็ดังทันที', 'ดัง', { pcb: 'black', part: 'can', tag: 'KY-012' }),
  out('relayh', 'รีเลย์ 1 ช่อง (ทริกเกอร์ HIGH)', 'หน้าสัมผัส 10A 250VAC แยกจากวงจรควบคุม', 'รีเลย์ดูด', { pcb: 'blue', part: 'coil', tag: 'RELAY-H' }),
  out('relayl', 'รีเลย์ 1 ช่อง (ทริกเกอร์ LOW)', 'หน้าสัมผัส 10A 250VAC · ทำงานเมื่อขา IN เป็น LOW', 'รีเลย์ดูด', { pcb: 'blue', part: 'coil', tag: 'RELAY-L' }, 0),
  out('ssr', 'G3MB-202P โซลิดสเตตรีเลย์', 'สวิตช์ไฟ AC 2A ด้วยไทรแอก ไม่มีหน้าสัมผัสกลไก', 'จ่ายไฟ AC', { pcb: 'blue', part: 'chip', tag: 'SSR' }),
  out('irf520', 'IRF520 มอสเฟต', 'สวิตช์ไฟ DC สูงสุด 24V ให้โหลดภายนอก', 'จ่ายไฟให้โหลด', { pcb: 'purple', part: 'chip', tag: 'IRF520' }),
  out('ky008', 'KY-008 เลเซอร์ 650 nm', 'ไดโอดเลเซอร์สีแดงกำลังต่ำ', 'ยิงแสงเลเซอร์', { pcb: 'black', part: 'can', tag: 'KY-008' }),
  out('ky005', 'KY-005 ส่ง IR', 'LED อินฟราเรด 940 nm', 'ส่งแสง IR', { pcb: 'black', part: 'led', tag: 'KY-005' }),
  out('vibmotor', 'มอเตอร์สั่น (โมดูล)', 'มอเตอร์แบบเหรียญพร้อมทรานซิสเตอร์ขับ', 'สั่น', { pcb: 'blue', part: 'disc', tag: 'VIB MOTOR' }),
  out('led1w', 'LED 1W กำลังสูง', 'LED ขาวสว่างมากบนแผ่นระบายความร้อน พร้อมวงจรขับ', 'ติดสว่าง', { pcb: 'black', part: 'led', tag: '1W LED' }),
  out('ky034', 'KY-034 LED 7 สีกะพริบเอง', 'LED ที่มีวงจรเปลี่ยนสีในตัว', 'กะพริบเปลี่ยนสี', { pcb: 'black', part: 'led', tag: 'KY-034' }),
  out('electromag', 'แม่เหล็กไฟฟ้า P20/15', 'ขดลวดดูดเหล็กแรง ~2.5 kg พร้อมวงจรขับ', 'ดูดเหล็ก', { pcb: 'black', part: 'coil', tag: 'P20/15' }),
  out('solenoid', 'โซลินอยด์ดัน-ดึง', 'แกนเหล็กเลื่อนเข้าเมื่อจ่ายไฟ พร้อมวงจรขับ', 'แกนดึงเข้า', { pcb: 'black', part: 'cyl', tag: 'SOLENOID' }),
  out('fan', 'พัดลมเล็ก (โมดูลขับมอเตอร์)', 'มอเตอร์ DC พร้อมใบพัดและทรานซิสเตอร์ขับ', 'หมุน', { pcb: 'red', part: 'motor', tag: 'FAN' }),
  out('pump', 'ปั๊มน้ำเล็ก + มอสเฟต', 'ปั๊มจุ่มน้ำ 3–5V พร้อมวงจรขับ', 'ปั๊มทำงาน', { pcb: 'blue', part: 'motor', tag: 'PUMP' }),
  out('ptc', 'แผ่นความร้อน PTC + มอสเฟต', 'เซรามิก PTC ที่จำกัดอุณหภูมิตัวเอง', 'ร้อนขึ้น', { pcb: 'black', part: 'pad', tag: 'PTC' }),
  out('mist', 'โมดูลพ่นหมอกอัลตราโซนิก', 'แผ่นเพียโซสั่นความถี่สูงทำให้น้ำเป็นละออง', 'พ่นละออง', { pcb: 'green', part: 'disc', tag: 'MIST' }),
  out('isd1820', 'ISD1820 เล่นเสียงที่บันทึก', 'โมดูลบันทึกเสียงได้ 10 วินาที · ขา PLAYE สั่งเล่น', 'เล่นเสียง', { pcb: 'red', part: 'disc', tag: 'ISD1820' }),
  out('valve', 'โซลินอยด์วาล์วน้ำ 12V + รีเลย์', 'วาล์วเปิดเมื่อจ่ายไฟให้ขดลวด ใช้กับแรงดันน้ำประปา', 'วาล์วเปิดให้น้ำไหล', { pcb: 'blue', part: 'cyl', tag: 'VALVE' }),
  out('peristaltic', 'ปั๊มรีดสาย (peristaltic) + มอสเฟต', 'ลูกกลิ้งรีดสายยางดันของเหลวทีละน้อยในปริมาณคงที่', 'ปั๊มของเหลว', { pcb: 'black', part: 'motor', tag: 'PERISTALTIC' }),
  out('airpump', 'ปั๊มลมขนาดเล็ก + มอสเฟต', 'ปั๊มไดอะแฟรม 5V อัดลมออกทางหัวท่อ', 'ปั๊มลม', { pcb: 'blue', part: 'motor', tag: 'AIR PUMP' }),
  out('uvled', 'LED UV 395 nm', 'LED อัลตราไวโอเลตย่านใกล้แสงม่วง พร้อมตัวต้านทาน', 'ติด (แสง UV)', { pcb: 'purple', part: 'led', tag: 'UV LED' }),

  // ---------- outputs with several inputs ----------
  outn('l298n', 'L298N มอเตอร์ DC 2 ทิศทาง', 'H-bridge ขับมอเตอร์ DC สูงสุด 2A', ['IN1', 'IN2'], { pcb: 'red', part: 'motor', tag: 'L298N' }, {
    states: { '00': 'หยุด (ปล่อยหมุนอิสระ)', '10': 'หมุนเดินหน้า', '01': 'หมุนถอยหลัง', '11': 'เบรก' },
  }),
  outn('l9110s', 'L9110S มอเตอร์เกียร์ TT', 'H-bridge ขนาดเล็กกับมอเตอร์เกียร์สีเหลือง', ['IA', 'IB'], { pcb: 'green', part: 'motor', tag: 'L9110S' }, {
    states: { '00': 'หยุด', '10': 'หมุนตามเข็มนาฬิกา', '01': 'หมุนทวนเข็มนาฬิกา', '11': 'หยุด' },
  }),
  outn('relay2', 'รีเลย์ 2 ช่อง (ทริกเกอร์ LOW)', 'หน้าสัมผัส 10A 250VAC สองชุด แยกกันอิสระ', ['IN1', 'IN2'], { pcb: 'blue', part: 'coil', tag: 'RELAY×2' }, {
    each: { on: 0, labels: ['ช่อง 1', 'ช่อง 2'] },
  }),
  outn('relay4', 'รีเลย์ 4 ช่อง (ทริกเกอร์ LOW)', 'หน้าสัมผัส 10A 250VAC สี่ชุด แยกกันอิสระ', ['IN1', 'IN2', 'IN3', 'IN4'], { pcb: 'blue', part: 'coil', tag: 'RELAY×4' }, {
    each: { on: 0, labels: ['ช่อง 1', 'ช่อง 2', 'ช่อง 3', 'ช่อง 4'] },
  }),
  outn('ky016', 'KY-016 LED RGB', 'LED สามสีในดวงเดียว ผสมสีได้ 7 สี', ['R', 'G', 'B'], { pcb: 'black', part: 'led', tag: 'KY-016' }, {
    states: { '000': 'ดับ', '100': 'แดง', '010': 'เขียว', '001': 'น้ำเงิน', '110': 'เหลือง', '101': 'ม่วงแดง', '011': 'ฟ้า', '111': 'ขาว' },
  }),
  outn('ky011', 'KY-011 LED 2 สี', 'LED แดงและเขียวในดวงเดียว', ['R', 'G'], { pcb: 'black', part: 'led', tag: 'KY-011' }, {
    states: { '00': 'ดับ', '10': 'แดง', '01': 'เขียว', '11': 'ส้ม' },
  }),
  outn('led3', 'LED 3 ดวง แดง เหลือง เขียว', 'LED 10 mm สามดวงเรียงกันบนแผ่นเดียว พร้อมตัวต้านทาน', ['R', 'Y', 'G'], { pcb: 'black', part: 'led', tag: 'R Y G' }, {
    each: { on: 1, labels: ['แดง', 'เหลือง', 'เขียว'] },
  }),
  outn('stepper', '28BYJ-48 สเต็ปเปอร์ + ULN2003', 'มอเตอร์สเต็ป 5V ขับด้วย ULN2003 · หมุนเมื่อส่งลำดับ 1000 → 0100 → 0010 → 0001 วนไป', ['IN1', 'IN2', 'IN3', 'IN4'], { pcb: 'green', part: 'motor', tag: 'ULN2003' }, {
    each: { on: 1, labels: ['ขดลวด A', 'ขดลวด B', 'ขดลวด C', 'ขดลวด D'] },
  }),
];

export const moduleById = (id: string | undefined) => MODULES.find((m) => m.id === id);

/** The board part type a catalogue module is placed as. */
export function modType(m: ModuleDef): 'MODI' | 'MODS' | 'MODA' | 'MODO' | 'MOD2' | 'MOD3' | 'MOD4' {
  if (m.kind === 'outn') return `MOD${m.inputs!.length}` as 'MOD2' | 'MOD3' | 'MOD4';
  return ({ in: 'MODI', sw: 'MODS', ain: 'MODA', out: 'MODO' } as const)[m.kind];
}

/** What an output module with several inputs is doing, given its input levels (IN1 first); null while any floats. */
export function modOutState(m: ModuleDef, levels: (0 | 1 | null)[]): { text: string; on: boolean } | null {
  if (levels.some((l) => l == null)) return null;
  if (m.each) {
    const on = m.each.labels.filter((_, i) => levels[i] === m.each!.on);
    return { text: on.length ? `ทำงาน: ${on.join(', ')}` : 'ไม่มีช่องทำงาน', on: on.length > 0 };
  }
  const pattern = levels.join('');
  const idle = m.states?.['0'.repeat(levels.length)];
  const text = m.states?.[pattern] ?? '—';
  return { text, on: text !== idle };
}

/** The quantity an analog module reads at knob position `pos` (0–1). */
export const modQty = (m: ModuleDef, pos: number) => m.q!.min + (m.q!.max - m.q!.min) * pos;
/** Its AO voltage at that position. */
export const modVolts = (m: ModuleDef, pos: number) => m.q!.v0 + (m.q!.v1 - m.q!.v0) * pos;
/** Knob position for a quantity. */
export const modPos = (m: ModuleDef, qty: number) => Math.min(1, Math.max(0, (qty - m.q!.min) / (m.q!.max - m.q!.min)));
