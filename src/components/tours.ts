// What the guided tour points at on each page. Targets are CSS selectors (mostly
// the sections' aria-labels); a step whose target isn't on screen is skipped.

export interface TourStep {
  target: string;
  title: string;
  text: string;
}

const HELP: TourStep = {
  target: '[data-tour="help"]',
  title: "ดูแนะนำอีกครั้ง",
  text: "กดปุ่ม ? นี้ได้ทุกเมื่อ เพื่อดูว่าหน้าที่เปิดอยู่ทำอะไรได้บ้าง",
};

export const FALLBACK_TOUR: TourStep[] = [
  {
    target: '.page-header, main, [data-tour="help"]',
    title: "เริ่มใช้งานหน้านี้",
    text: "ดูหัวข้อและเครื่องมือของหน้านี้ ใช้เมนูหลักเพื่อเปลี่ยนหน้า และกดแนะนำหน้านี้เพื่อดูคำแนะนำซ้ำได้ทุกเมื่อ",
  },
  HELP,
];
// Preserve the existing first-visit tours. New screens open their guides on request.
export const AUTO_TOURS = new Set([
  "home",
  "code-convert",
  "code-run",
  "problems",
  "solve",
  "answer",
  "leaderboard",
  "z80",
]);

export const TOURS: Record<string, TourStep[]> = {
  teacher: [
    {
      target: ".classroom-tabs",
      title: "เลือกงานที่ต้องการจัดการ",
      text: "สลับระหว่างห้องเรียน ภาพรวม โปรเจกต์ Z80 นักศึกษาและคะแนน และจัดการโจทย์ คำแนะนำต่อไปนี้จะแสดงตามแท็บที่เปิดอยู่",
    },
    {
      target: 'section[aria-label="ห้องเรียน"]',
      title: "สร้างและดูแลห้องเรียน",
      text: "สร้างห้องแยกตามปีและภาคเรียน คัดลอกรหัสเข้าห้อง เพิ่มรายชื่อ และมอบหมายโจทย์ได้จากแต่ละห้อง ปิดห้องเพื่อเก็บคะแนนและประวัติไว้",
    },
    {
      target: 'section[aria-label="งานโปรเจกต์บอร์ด Z80"]',
      title: "สั่งงานและตรวจโปรเจกต์",
      text: "สั่งงานให้ห้อง เปิดดูงานที่ส่ง ทดลองวงจร ให้คะแนน และเขียนความเห็นถึงนักศึกษา",
    },
    {
      target: '[aria-label="กรองห้องเรียน"]',
      title: "กรองรายชื่อ",
      text: "เลือกห้อง บทบาท หรือชั้นปี เพื่อดูเฉพาะนักศึกษาที่ต้องการ",
    },
    {
      target: 'section[aria-label="รายชื่อและคะแนน"]',
      title: "รายชื่อและคะแนน",
      text: "ค้นหาชื่อหรือรหัส กดหัวคอลัมน์เพื่อเรียงลำดับ เลือกจำนวนแถวหรือคอลัมน์ และส่งออกข้อมูลที่กรองไว้ ปุ่มแก้ไขและดูผลรายคนอยู่ด้านขวา",
    },
    {
      target: 'section[aria-label="ผลการทำโจทย์"]',
      title: "ผลการทำโจทย์",
      text: "ดูว่าแต่ละข้อเริ่มทำและผ่านกี่คน ค้นหา เรียงลำดับ และส่งออกผลได้จากตาราง",
    },
    {
      target: '[data-tour="problem-bank"]',
      title: "จัดการโจทย์",
      text: "สร้างหรือแก้โจทย์ พร้อมเฉลยและเคสทดสอบ เผยแพร่เมื่อพร้อมให้นักศึกษาทำ",
    },
    {
      target: ".teacher-stats",
      title: "สรุปข้อมูลห้องเรียน",
      text: "ดูจำนวนนักศึกษา การเข้าใช้งาน คะแนนเฉลี่ย และโจทย์ที่เผยแพร่ กดรีเฟรชข้อมูลเมื่อต้องการข้อมูลล่าสุด",
    },
    HELP,
  ],
  settings: [
    {
      target: 'section[aria-label="บัญชี"]',
      title: "บัญชีของคุณ",
      text: "ตรวจชื่อ บทบาท และห้องเรียนของบัญชีที่กำลังใช้อยู่",
    },
    {
      target: 'form[aria-label="แก้ไขโปรไฟล์"]',
      title: "แก้ไขโปรไฟล์",
      text: "แก้ชื่อแล้วกดบันทึก รหัสนักศึกษาที่ตั้งแล้วต้องให้อาจารย์แก้ให้",
    },
    {
      target: 'section[aria-label="เชื่อมต่อ Google"]',
      title: "เชื่อมต่อ Google",
      text: "เชื่อมบัญชี Google กับบัญชีนี้ เพื่อใช้ Google เข้าบัญชีเดิมพร้อมคะแนนและบทบาทเดิม",
    },
    {
      target: 'section[aria-label="ห้องเรียน"]',
      title: "ย้ายห้องเรียน",
      text: "ใส่รหัสห้องที่อาจารย์ให้เพื่อเข้าหรือย้ายห้อง คะแนนเดิมยังอยู่",
    },
    {
      target: 'form[aria-label="เปลี่ยนรหัสผ่าน"]',
      title: "เปลี่ยนรหัสผ่าน",
      text: "ใส่รหัสผ่านปัจจุบันและรหัสผ่านใหม่ แล้วกดบันทึก",
    },
    {
      target: 'section[aria-label="ออกจากระบบ"]',
      title: "ออกจากระบบ",
      text: "ออกจากบัญชีบนเครื่องนี้เมื่อเลิกใช้งาน โดยเฉพาะเครื่องที่ใช้ร่วมกัน",
    },
    HELP,
  ],
  landing: [
    {
      target: ".land-hero",
      title: "เริ่มฝึก C และ MIPS",
      text: "ทำความรู้จักห้องทดลอง แล้วเลื่อนลงเพื่อลองแก้โค้ด C และดูผลแปลงเป็น MIPS",
    },
    {
      target: "#demo",
      title: "ลองแก้โค้ดได้ทันที",
      text: "เลือกตัวอย่างหรือแก้ C ทางซ้าย ผล MIPS จะเปลี่ยนตาม เลือกบรรทัดเพื่อดูความสัมพันธ์ของโค้ดทั้งสองฝั่ง",
    },
    {
      target: ".land-nav-action",
      title: "เข้าสู่ห้องทดลอง",
      text: "เข้าสู่ระบบเพื่อเข้าห้องเรียน ทำโจทย์ ส่งงาน และบันทึกคะแนน",
    },
  ],
  login: [
    {
      target: ".login-content",
      title: "เข้าสู่ระบบ",
      text: "ใช้ Google หรือบัญชีรหัสผ่านที่อาจารย์สร้างให้ หากมีคะแนนอยู่แล้ว ให้เข้าบัญชีเดิมแล้วเชื่อมต่อ Google ในหน้าตั้งค่า",
    },
  ],
  "class-join": [
    {
      target: '[aria-label="ขั้นที่ 1: รหัสนักศึกษา"]',
      title: "ตรวจรหัสนักศึกษา",
      text: "ระบุรหัสนักศึกษาให้ถูกต้องก่อนเข้าห้อง หากใช้รหัสนี้กับบัญชีเดิมอยู่แล้ว ให้เข้าบัญชีเดิมและเชื่อม Google ในหน้าตั้งค่า",
    },
    {
      target: '[aria-label="ขั้นที่ 2: รหัสเข้าห้อง"]',
      title: "เข้าห้องด้วยรหัสจากอาจารย์",
      text: "ใส่รหัสห้อง 6 ตัวที่อาจารย์แจก ห้องเรียน โจทย์ และงานมอบหมายจะปรากฏหลังเข้าห้องสำเร็จ",
    },
  ],
  terminal: [
    {
      target: ".term-page-bar",
      title: "Serial terminal ของบอร์ด Z80",
      text: "เปิดหน้าบอร์ด Z80 ค้างไว้ในอีกแท็บ Terminal นี้จะแสดงข้อมูลที่บอร์ดส่งมา และส่งข้อความกลับไปยังบอร์ดได้",
    },
    {
      target: ".term-page",
      title: "ตรวจการเชื่อมต่อ",
      text: "สถานะด้านบนบอกว่าพบหน้าบอร์ดหรือไม่ หากขาดการเชื่อมต่อ ให้เปิดหน้าบอร์ด Z80 อีกครั้ง",
    },
  ],
  home: [
    {
      target: '[aria-label="ทำต่อจากครั้งก่อน"]',
      title: "เริ่มจากตรงนี้",
      text: "โจทย์ที่ทำค้างไว้ หรือข้อถัดไปที่ควรทำ จะอยู่ในการ์ดนี้ กดปุ่มในการ์ดเพื่อไปทำได้ทันที",
    },
    {
      target: '[aria-label="ความคืบหน้า"]',
      title: "ความคืบหน้า",
      text: "ดูว่าผ่านโจทย์ไปแล้วกี่ข้อจากทั้งหมด",
    },
    {
      target: '[aria-label="อันดับ"]',
      title: "อันดับสัปดาห์นี้",
      text: "อันดับของคุณในกลุ่ม ลูกศรบอกว่าขึ้นหรือลงจากสัปดาห์ก่อน",
    },
    {
      target: 'section[aria-label="เครื่องมือ"]',
      title: "เครื่องมือ",
      text: "แปลงโค้ด C ⇄ MIPS, รันทีละคำสั่ง, ทำโจทย์ และต่อบอร์ด Z80",
    },
    {
      target: "nav.rail",
      title: "เมนูหลัก",
      text: "ไปหน้าอื่นได้ทุกเมื่อจากแถบนี้",
    },
    HELP,
  ],
  "code-convert": [
    {
      target: ".mode-tabs",
      title: "เลือกโหมด",
      text: "“แปลงโค้ด” ดูว่าโค้ดกลายเป็นคำสั่งอะไร · “รันทีละขั้น” ให้ CPU ทำทีละคำสั่ง",
    },
    {
      target: 'section[aria-label="โค้ด"]',
      title: "เขียนโค้ดตรงนี้",
      text: "สลับภาษา C / MIPS ได้ และเลือกโค้ดตัวอย่างจากเมนู คลิกบรรทัดไหนก็ได้เพื่อดูผล",
    },
    {
      target: ".ws-out",
      title: "ผลแปลง",
      text: "บรรทัดสีชมพูคือคำสั่งที่มาจากบรรทัดที่เลือก · เมนู ⋯ เปิด machine code ได้",
    },
    {
      target: ".ws-detail",
      title: "คำสั่งนี้ทำอะไร",
      text: "อธิบายคำสั่งที่เลือกเป็นภาษาไทย และดูเลขฐานสองที่ CPU อ่านจริงได้",
    },
  ],
  "code-run": [
    {
      target: '[data-tour="args"]',
      title: "ค่าที่ส่งให้ฟังก์ชัน",
      text: "แก้ค่าแล้วโปรแกรมเริ่มใหม่ให้เอง อาร์เรย์เขียนแบบ [3, 9, 4]",
    },
    {
      target: 'section[aria-label="คำสั่งที่ CPU รัน"]',
      title: "คำสั่งที่ CPU รัน",
      text: "ป้าย “ถัดไป” คือคำสั่งที่จะทำ · บรรทัดเดียวกันในโค้ดด้านซ้ายจะเป็นสีชมพู",
    },
    {
      target: ".player",
      title: "ควบคุมการรัน",
      text: "กด “ถัดไป” (หรือ →) ทีละขั้น · ⋯ มีเล่นอัตโนมัติ (Space), รันจนจบ และเริ่มใหม่ (R)",
    },
    {
      target: 'section[aria-label="รายละเอียดขั้นนี้"]',
      title: "ดูว่าเกิดอะไรขึ้น",
      text: "“อธิบาย” เป็นภาพค่าเข้า → คำนวณ → ผลออก · ดู Registers, Memory และประวัติได้จากแท็บ",
    },
  ],
  problems: [
    {
      target: '[aria-label="ความคืบหน้า"]',
      title: "ความคืบหน้า",
      text: "ผ่านไปแล้วกี่ข้อ และได้คะแนนเท่าไร",
    },
    {
      target: '[aria-label="หัวข้อ"]',
      title: "เลือกหัวข้อ",
      text: "กรองโจทย์ตามเรื่องที่อยากฝึก",
    },
    {
      target: '[aria-label="ค้นหาโจทย์"]',
      title: "ค้นหา",
      text: "พิมพ์ชื่อโจทย์หรือคำที่เกี่ยวข้อง",
    },
    {
      target: '[aria-label="รายการโจทย์"]',
      title: "รายการโจทย์",
      text: "วงกลมด้านหน้าบอกสถานะ (ผ่านแล้ว / กำลังทำ / ยังไม่ทำ) และด้านขวาคือคะแนนที่จะได้ · คลิกเพื่อเริ่มทำ",
    },
  ],
  solve: [
    {
      target: 'section[aria-label="โจทย์"]',
      title: "อ่านโจทย์",
      text: "โจทย์ ตัวอย่างค่าเข้า-ออก และกติกาของข้อนี้",
    },
    {
      target: 'section[aria-label="คำตอบของคุณ"]',
      title: "เขียนคำตอบ",
      text: "โค้ดบันทึกอัตโนมัติ · กดทดสอบแล้วผลจะขึ้นเป็นหน้าต่าง",
    },
    {
      target: '[data-tour="test"]',
      title: "ทดสอบ",
      text: "รันโค้ดของคุณกับเคสตัวอย่าง ถ้าผ่านครบจะส่งคำตอบให้อัตโนมัติ",
    },
    {
      target: '[data-tour="submit"]',
      title: "ส่งคำตอบ",
      text: "ส่งเพื่อเก็บคะแนน ผ่านในการส่งครั้งแรกได้โบนัส",
    },
    {
      target: '[data-tour="answer"]',
      title: "ดูเฉลย",
      text: "ปลดล็อกหลังส่งผ่านข้อนี้แล้ว",
    },
  ],
  answer: [
    {
      target: '[aria-label="แนวคิด"]',
      title: "แนวคิด",
      text: "สรุปวิธีคิดของข้อนี้ก่อนดูโค้ด",
    },
    {
      target: '[aria-label^="เฉลยภาษา"]',
      title: "โค้ดเฉลย",
      text: "โค้ดที่ถูกต้อง กดรันทีละขั้นเพื่อดูการทำงานจริงได้",
    },
    {
      target: '[aria-label="อธิบายทีละขั้น"]',
      title: "อธิบายทีละขั้น",
      text: "แต่ละส่วนของโค้ดทำอะไร",
    },
    {
      target: '[aria-label="จุดที่มักพลาด"]',
      title: "จุดที่มักพลาด",
      text: "ข้อผิดพลาดที่เจอบ่อยในข้อนี้",
    },
  ],
  leaderboard: [
    {
      target: '[aria-label="ช่วงเวลา"]',
      title: "ช่วงเวลา",
      text: "ดูอันดับสัปดาห์นี้ เดือนนี้ หรือตลอดกาล",
    },
    {
      target: '[aria-label="กลุ่ม"]',
      title: "กลุ่ม",
      text: "เทียบเฉพาะในกลุ่มเรียนของคุณ หรือทั้งหมด",
    },
    {
      target: '[aria-label="3 อันดับแรก"]',
      title: "3 อันดับแรก",
      text: "คนที่ได้คะแนนสูงสุดในช่วงนี้",
    },
    {
      target: '[aria-label="อันดับของคุณ"]',
      title: "อันดับของคุณ",
      text: "อันดับ คะแนน และอีกกี่คะแนนจะแซงคนถัดไป",
    },
  ],
  z80: [
    {
      target: 'aside[aria-label="อุปกรณ์"]',
      title: "อุปกรณ์",
      text: "ลากชิ้นส่วนไปวางบนบอร์ด หรือคลิกเพื่อเพิ่ม · “ต่อไฟเลี้ยงทุกชิป” ต่อ VCC / GND ให้",
    },
    {
      target: '[role="toolbar"][aria-label="เครื่องมือ"]',
      title: "เครื่องมือ",
      text: "เลือก/ย้าย · ต่อสายขาต่อขา · ต่อบัสทีละหลายขา · หมุน · ลบ",
    },
    {
      target: 'section[aria-label="พื้นที่ต่อวงจร"]',
      title: "บอร์ด",
      text: "ชี้ที่ขาเพื่อดูชื่อขาและว่าต่อกับอะไร · ต่อสายจากขาไปขา หรือไปรางไฟ + / −",
    },
    {
      target: '[aria-label="มุมมองชิป"]',
      title: "โปรแกรมของ CPU",
      text: "เขียนโปรแกรม Z80 · ดู Registers และขาของ CPU",
    },
    {
      target: '[data-tour="assemble"]',
      title: "Assemble ลง ROM",
      text: "แปลงโปรแกรมเป็นเลขฐานสองแล้วเขียนลง EPROM บนบอร์ด",
    },
    {
      target: '[data-tour="z80-run"]',
      title: "เริ่มจำลอง",
      text: "ให้ CPU รันโปรแกรม แล้วดู LED บนบอร์ดเปลี่ยนตาม",
    },
  ],
};

/** Which tour belongs to the page at this address. */
export function tourKey(pathname: string, search: string): string | null {
  if (pathname === "/teacher") return "teacher";
  if (pathname === "/settings") return "settings";
  if (pathname === "/welcome") return "landing";
  if (pathname === "/login") return "login";
  if (pathname === "/z80/terminal") return "terminal";
  if (pathname === "/") return "home";
  if (pathname === "/code")
    return new URLSearchParams(search).get("mode") === "run"
      ? "code-run"
      : "code-convert";
  if (pathname === "/problems") return "problems";
  if (/^\/problems\/\d+$/.test(pathname)) return "solve";
  if (/^\/problems\/\d+\/answer$/.test(pathname)) return "answer";
  if (pathname === "/leaderboard") return "leaderboard";
  if (pathname === "/z80") return "z80";
  return "page";
}
