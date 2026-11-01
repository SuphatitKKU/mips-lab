// What the guided tour points at on each page. Targets are CSS selectors (mostly
// the sections' aria-labels); a step whose target isn't on screen is skipped.

export interface TourStep {
  target: string;
  title: string;
  text: string;
}

const HELP: TourStep = { target: '[data-tour="help"]', title: 'ดูแนะนำอีกครั้ง', text: 'กดปุ่ม ? นี้ได้ทุกเมื่อ เพื่อดูว่าหน้าที่เปิดอยู่ทำอะไรได้บ้าง' };

export const TOURS: Record<string, TourStep[]> = {
  home: [
    { target: '[aria-label="ทำต่อจากครั้งก่อน"]', title: 'เริ่มจากตรงนี้', text: 'โจทย์ที่ทำค้างไว้ หรือข้อถัดไปที่ควรทำ จะอยู่ในการ์ดนี้ กดปุ่มในการ์ดเพื่อไปทำได้ทันที' },
    { target: '[aria-label="ความคืบหน้า"]', title: 'ความคืบหน้า', text: 'ดูว่าผ่านโจทย์ไปแล้วกี่ข้อจากทั้งหมด' },
    { target: '[aria-label="อันดับ"]', title: 'อันดับสัปดาห์นี้', text: 'อันดับของคุณในกลุ่ม ลูกศรบอกว่าขึ้นหรือลงจากสัปดาห์ก่อน' },
    { target: 'section[aria-label="เครื่องมือ"]', title: 'เครื่องมือ', text: 'แปลงโค้ด C ⇄ MIPS, รันทีละคำสั่ง, ทำโจทย์ และต่อบอร์ด Z80' },
    { target: 'nav.rail', title: 'เมนูหลัก', text: 'ไปหน้าอื่นได้ทุกเมื่อจากแถบนี้' },
    HELP,
  ],
  'code-convert': [
    { target: '.mode-tabs', title: 'เลือกโหมด', text: '“แปลงโค้ด” ดูว่าโค้ดกลายเป็นคำสั่งอะไร · “รันทีละขั้น” ให้ CPU ทำทีละคำสั่ง' },
    { target: 'section[aria-label="โค้ด"]', title: 'เขียนโค้ดตรงนี้', text: 'สลับภาษา C / MIPS ได้ และเลือกโค้ดตัวอย่างจากเมนู คลิกบรรทัดไหนก็ได้เพื่อดูผล' },
    { target: '.ws-out', title: 'ผลแปลง', text: 'บรรทัดสีชมพูคือคำสั่งที่มาจากบรรทัดที่เลือก · เมนู ⋯ เปิด machine code ได้' },
    { target: '.ws-detail', title: 'คำสั่งนี้ทำอะไร', text: 'อธิบายคำสั่งที่เลือกเป็นภาษาไทย และดูเลขฐานสองที่ CPU อ่านจริงได้' },
  ],
  'code-run': [
    { target: '[data-tour="args"]', title: 'ค่าที่ส่งให้ฟังก์ชัน', text: 'แก้ค่าแล้วโปรแกรมเริ่มใหม่ให้เอง อาร์เรย์เขียนแบบ [3, 9, 4]' },
    { target: 'section[aria-label="คำสั่งที่ CPU รัน"]', title: 'คำสั่งที่ CPU รัน', text: 'ป้าย “ถัดไป” คือคำสั่งที่จะทำ · บรรทัดเดียวกันในโค้ดด้านซ้ายจะเป็นสีชมพู' },
    { target: '.player', title: 'ควบคุมการรัน', text: 'กด “ถัดไป” (หรือ →) ทีละขั้น · ⋯ มีเล่นอัตโนมัติ (Space), รันจนจบ และเริ่มใหม่ (R)' },
    { target: 'section[aria-label="รายละเอียดขั้นนี้"]', title: 'ดูว่าเกิดอะไรขึ้น', text: '“อธิบาย” เป็นภาพค่าเข้า → คำนวณ → ผลออก · ดู Registers, Memory และประวัติได้จากแท็บ' },
  ],
  problems: [
    { target: '[aria-label="ความคืบหน้า"]', title: 'ความคืบหน้า', text: 'ผ่านไปแล้วกี่ข้อ และได้คะแนนเท่าไร' },
    { target: '[aria-label="หัวข้อ"]', title: 'เลือกหัวข้อ', text: 'กรองโจทย์ตามเรื่องที่อยากฝึก' },
    { target: '[aria-label="ค้นหาโจทย์"]', title: 'ค้นหา', text: 'พิมพ์ชื่อโจทย์หรือคำที่เกี่ยวข้อง' },
    { target: '[aria-label="รายการโจทย์"]', title: 'รายการโจทย์', text: 'วงกลมด้านหน้าบอกสถานะ (ผ่านแล้ว / กำลังทำ / ยังไม่ทำ) และด้านขวาคือคะแนนที่จะได้ · คลิกเพื่อเริ่มทำ' },
  ],
  solve: [
    { target: 'section[aria-label="โจทย์"]', title: 'อ่านโจทย์', text: 'โจทย์ ตัวอย่างค่าเข้า-ออก และกติกาของข้อนี้' },
    { target: 'section[aria-label="คำตอบของคุณ"]', title: 'เขียนคำตอบ', text: 'โค้ดบันทึกอัตโนมัติ · กดทดสอบแล้วผลจะขึ้นเป็นหน้าต่าง' },
    { target: '[data-tour="test"]', title: 'ทดสอบ', text: 'รันโค้ดของคุณกับเคสตัวอย่าง ถ้าผ่านครบจะส่งคำตอบให้อัตโนมัติ' },
    { target: '[data-tour="submit"]', title: 'ส่งคำตอบ', text: 'ส่งเพื่อเก็บคะแนน ผ่านในการส่งครั้งแรกได้โบนัส' },
    { target: '[data-tour="answer"]', title: 'ดูเฉลย', text: 'ปลดล็อกหลังส่งผ่านข้อนี้แล้ว' },
  ],
  answer: [
    { target: '[aria-label="แนวคิด"]', title: 'แนวคิด', text: 'สรุปวิธีคิดของข้อนี้ก่อนดูโค้ด' },
    { target: '[aria-label^="เฉลยภาษา"]', title: 'โค้ดเฉลย', text: 'โค้ดที่ถูกต้อง กดรันทีละขั้นเพื่อดูการทำงานจริงได้' },
    { target: '[aria-label="อธิบายทีละขั้น"]', title: 'อธิบายทีละขั้น', text: 'แต่ละส่วนของโค้ดทำอะไร' },
    { target: '[aria-label="จุดที่มักพลาด"]', title: 'จุดที่มักพลาด', text: 'ข้อผิดพลาดที่เจอบ่อยในข้อนี้' },
  ],
  leaderboard: [
    { target: '[aria-label="ช่วงเวลา"]', title: 'ช่วงเวลา', text: 'ดูอันดับสัปดาห์นี้ เดือนนี้ หรือตลอดกาล' },
    { target: '[aria-label="กลุ่ม"]', title: 'กลุ่ม', text: 'เทียบเฉพาะในกลุ่มเรียนของคุณ หรือทั้งหมด' },
    { target: '[aria-label="3 อันดับแรก"]', title: '3 อันดับแรก', text: 'คนที่ได้คะแนนสูงสุดในช่วงนี้' },
    { target: '[aria-label="อันดับของคุณ"]', title: 'อันดับของคุณ', text: 'อันดับ คะแนน และอีกกี่คะแนนจะแซงคนถัดไป' },
  ],
  z80: [
    { target: 'aside[aria-label="อุปกรณ์"]', title: 'อุปกรณ์', text: 'ลากชิ้นส่วนไปวางบนบอร์ด หรือคลิกเพื่อเพิ่ม · “ต่อไฟเลี้ยงทุกชิป” ต่อ VCC / GND ให้' },
    { target: '[role="toolbar"][aria-label="เครื่องมือ"]', title: 'เครื่องมือ', text: 'เลือก/ย้าย · ต่อสายขาต่อขา · ต่อบัสทีละหลายขา · หมุน · ลบ' },
    { target: 'section[aria-label="พื้นที่ต่อวงจร"]', title: 'บอร์ด', text: 'ชี้ที่ขาเพื่อดูชื่อขาและว่าต่อกับอะไร · ต่อสายจากขาไปขา หรือไปรางไฟ + / −' },
    { target: '[aria-label="มุมมองชิป"]', title: 'โปรแกรมของ CPU', text: 'เขียนโปรแกรม Z80 · ดู Registers และขาของ CPU' },
    { target: '[data-tour="assemble"]', title: 'Assemble ลง ROM', text: 'แปลงโปรแกรมเป็นเลขฐานสองแล้วเขียนลง EPROM บนบอร์ด' },
    { target: '[data-tour="z80-run"]', title: 'เริ่มจำลอง', text: 'ให้ CPU รันโปรแกรม แล้วดู LED บนบอร์ดเปลี่ยนตาม' },
  ],
};

/** Which tour belongs to the page at this address. */
export function tourKey(pathname: string, search: string): string | null {
  if (pathname === '/') return 'home';
  if (pathname === '/code') return new URLSearchParams(search).get('mode') === 'run' ? 'code-run' : 'code-convert';
  if (pathname === '/problems') return 'problems';
  if (/^\/problems\/\d+$/.test(pathname)) return 'solve';
  if (/^\/problems\/\d+\/answer$/.test(pathname)) return 'answer';
  if (pathname === '/leaderboard') return 'leaderboard';
  if (pathname === '/z80') return 'z80';
  return null;
}
