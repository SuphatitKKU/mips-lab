import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BASE,
  OUT,
  TEACHER,
  STUDENT,
  CLASS_NAME,
  record,
  click,
  clickCodeLine,
  selectByText,
  mark,
  type,
  paste,
  setCode,
  login,
  dismissTour,
  scrollTo,
  sleep,
} from "./lib.mjs";

const PROBLEM = {
  title: "Demo — บวกเลขสองจำนวน",
  statement: "เขียนฟังก์ชัน add เพื่อคืนผลรวมของจำนวนเต็มสองจำนวน",
  params: '[["a0","a","จำนวนเต็ม"],["a1","b","จำนวนเต็ม"]]',
  starter: "int add(int a, int b) {\n    return 0;\n}",
  wrong: "int add(int a, int b) {\n    return a - b;\n}",
  answer: "int add(int a, int b) {\n    return a + b;\n}",
  tests:
    '[\n  { "args": [2, 3], "expect": { "v0": 5 } },\n' +
    '  { "args": [-4, 9], "expect": { "v0": 5 }, "hidden": true }\n]',
};

const Z80 = {
  title: "ไฟวิ่ง 8 ดวงบนบอร์ด Z80",
  detail: "ต่อวงจรให้ LED 8 ดวงติดเรียงกัน แล้วส่งทั้งวงจรและโค้ดให้อาจารย์ตรวจ",
};

const statePath = join(OUT, "state.json");
const state = () =>
  existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const saveState = (patch) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(statePath, JSON.stringify({ ...state(), ...patch }, null, 2));
};

const teacherIn = async (page) => {
  await login(page, TEACHER.user, TEACHER.pass, "อาจารย์");
  await page.goto(`${BASE}/teacher`, { waitUntil: "networkidle" });
  await dismissTour(page);
  await sleep(800);
  mark("ready");
};

const segments = {
  /** 0:00–0:30 — the landing page sets up what the system is for. */
  s1_landing: () =>
    record("s1_landing", async (page) => {
      await page.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
      await sleep(2600);
      mark("ready");
      await scrollTo(page, 420, 1600);
      await sleep(1500);
      await scrollTo(page, 980, 1800);
      await sleep(1200);
      const tabs = ["เงื่อนไข", "วนซ้ำ", "ผลรวม"];
      for (const t of tabs) {
        await click(page, page.getByRole("tab", { name: t }), 600);
        await sleep(1700);
      }
      await sleep(1200);
    }),

  /** 0:30–1:15 — teacher creates the demo classroom and shares its code. */
  s2_class: () =>
    record("s2_class", async (page) => {
      await teacherIn(page);
      await click(page, page.getByRole("button", { name: "สร้างห้อง" }), 800);
      await sleep(700);
      const form = page
        .locator("form")
        .filter({ has: page.getByPlaceholder("เช่น SEC 1") });
      await type(page, form.getByPlaceholder("เช่น SEC 1"), CLASS_NAME, 70);
      await form.getByLabel("ปีการศึกษา (พ.ศ.)").selectOption("2569");
      await sleep(800);
      await form.getByLabel("ภาคเรียน").selectOption("2");
      await sleep(900);
      await click(page, form.getByRole("button", { name: "สร้างห้อง" }), 800);
      await page.waitForLoadState("networkidle");
      await sleep(1800);

      const text = await page.locator("main").innerText();
      const after = text.split(CLASS_NAME)[1] ?? "";
      const code = (after.match(/\b[A-Z0-9]{6}\b/) ?? [])[0];
      if (!code) throw new Error("class code not found on screen");
      saveState({ classCode: code });
      console.log("  class code:", code);

      await click(page, page.getByRole("button", { name: "คัดลอก" }), 900);
      await sleep(2200);
    }),

  /** 1:45–3:15 — one C line at a time becomes MIPS, then the CPU runs it. */
  s4_convert: () =>
    record("s4_convert", async (page) => {
      await login(page, STUDENT.id, STUDENT.pass, "นักศึกษา");
      await page.goto(`${BASE}/code?mode=convert`, { waitUntil: "networkidle" });
      await sleep(2200);
      mark("ready");
      const editor = page.getByRole("textbox", { name: "โค้ด C" });
      for (const line of [2, 3, 4, 6]) {
        await clickCodeLine(page, editor, line);
        await sleep(1700);
      }
      await click(page, page.getByText("addu $t0, $t0, $t1").first(), 700);
      await sleep(2400);

      await click(
        page,
        page.getByRole("tab", { name: /CPU ทำทีละคำสั่ง/ }),
        800,
      );
      await page.waitForLoadState("networkidle");
      await sleep(1600);
      await type(page, page.getByPlaceholder("0").first(), "5", 220);
      await sleep(1200);
      const next = page.getByRole("button", { name: /ถัดไป/ });
      for (let i = 0; i < 6; i++) {
        await click(page, next, 420);
        await sleep(950);
      }
      for (const tab of ["Registers", "Memory", "Datapath"]) {
        await click(page, page.getByText(tab, { exact: true }).first(), 700);
        await sleep(2600);
      }
    }),

  /** 3:15–4:00 — change the input, run to the end, then show new C features. */
  s5_examples: () =>
    record("s5_examples", async (page) => {
      await login(page, STUDENT.id, STUDENT.pass, "นักศึกษา");
      await page.goto(`${BASE}/code?mode=run`, { waitUntil: "networkidle" });
      await sleep(1800);
      mark("ready");
      await type(page, page.getByPlaceholder("0").first(), "10", 220);
      await sleep(1300);
      await click(page, page.getByRole("button", { name: "ตัวเลือกการรัน" }), 700);
      await sleep(700);
      await click(page, page.getByText("รันจนจบ", { exact: true }), 700);
      await sleep(3200);

      const picker = page.getByRole("combobox").first();
      for (const [value, pause] of [
        ["switch", 4200],
        ["sizeof", 3400],
        ["matrix", 3400],
      ]) {
        await picker.selectOption(value);
        await sleep(1200);
        await click(page, page.getByRole("button", { name: "ตัวเลือกการรัน" }), 600);
        await sleep(600);
        await click(page, page.getByText("รันจนจบ", { exact: true }), 600);
        await sleep(pause);
      }
    }),

  /** 1:15–1:45 — student signs in and joins with the class code. */
  s3_join: () =>
    record("s3_join", async (page) => {
      const code = state().classCode;
      if (!code) throw new Error("run s2_class first");
      await login(page, STUDENT.id, STUDENT.pass, "นักศึกษา");
      await sleep(1600);
      mark("ready");
      const form = page.getByRole("form", { name: "ใส่รหัสเข้าห้องเรียน" });
      await type(page, form.getByLabel("รหัสเข้าห้อง"), code, 150);
      await click(page, form.getByRole("button", { name: "เข้าห้อง" }), 900);
      await page.waitForLoadState("networkidle");
      await sleep(2600);
    }),
  /** 4:00–5:15 — teacher writes the graded exercise and assigns it. */
  s6_problem: () =>
    record("s6_problem", async (page) => {
      await teacherIn(page);
      await click(page, page.getByRole("radio", { name: "จัดการโจทย์" }), 700);
      await sleep(1400);
      await click(page, page.getByRole("button", { name: "สร้างโจทย์" }), 800);
      await sleep(1200);

      const form = page.locator("form").filter({ hasText: "สร้างโจทย์ใหม่" });
      await type(page, form.getByLabel("ชื่อโจทย์"), PROBLEM.title, 45);
      await paste(page, form.getByLabel("คะแนนพื้นฐาน"), "20");
      await type(
        page,
        form.getByLabel("ชื่อฟังก์ชัน / label เริ่มต้น"),
        "add",
        150,
      );
      await type(page, form.getByLabel("หัวข้อ"), "พื้นฐาน", 60);
      await paste(page, form.getByLabel("คำอธิบายโจทย์"), PROBLEM.statement);

      await click(page, form.getByText("แก้พารามิเตอร์ (a0 ถึง a3)"), 600);
      await sleep(600);
      await paste(page, form.getByLabel("พารามิเตอร์ JSON"), PROBLEM.params);

      await setCode(page, form.getByRole("textbox", { name: "โค้ดเริ่มต้น" }), PROBLEM.starter);
      await setCode(page, form.getByRole("textbox", { name: "เฉลย" }), PROBLEM.answer);
      await paste(page, form.getByLabel("เคสทดสอบ JSON"), PROBLEM.tests);
      await sleep(1400);

      const pub = form.locator('input[type="checkbox"]').first();
      if (!(await pub.isChecked())) await click(page, pub, 600);
      await sleep(700);
      await click(
        page,
        form.getByRole("button", { name: "ตรวจเฉลยและบันทึก" }),
        900,
      );
      await page.waitForLoadState("networkidle");
      await sleep(3000);

      // hand the new exercise to the demo classroom
      await click(page, page.getByRole("radio", { name: "ห้องเรียน" }), 700);
      await sleep(1400);
      await click(page, page.getByRole("button", { name: "มอบหมายโจทย์" }), 800);
      await sleep(1800);
      const row = page.locator("li").filter({ hasText: PROBLEM.title }).first();
      await click(page, row.locator('input[type="checkbox"]').first(), 800);
      await sleep(1200);
      await click(page, page.getByRole("button", { name: "บันทึก" }), 800);
      await page.waitForLoadState("networkidle");
      await sleep(2400);
    }),

  /** 5:15–6:15 — student fails the visible case, fixes it, then submits. */
  s7_submit: () =>
    record("s7_submit", async (page) => {
      await login(page, STUDENT.id, STUDENT.pass, "นักศึกษา");
      await page.goto(`${BASE}/problems`, { waitUntil: "networkidle" });
      await sleep(2200);
      mark("ready");
      await click(page, page.getByText(PROBLEM.title).first(), 900);
      await page.waitForLoadState("networkidle");
      await sleep(2400);

      const editor = page.getByRole("textbox", { name: /คำตอบ|โค้ด/ }).first();
      await setCode(page, editor, PROBLEM.wrong);
      await sleep(1000);
      await click(page, page.getByRole("button", { name: "ทดสอบ" }).first(), 900);
      await sleep(5200);
      await click(page, page.getByRole("button", { name: "กลับไปแก้โค้ด" }), 900);
      await sleep(1600);

      await setCode(page, editor, PROBLEM.answer);
      await sleep(1000);
      await click(page, page.getByRole("button", { name: "ส่งคำตอบ" }).first(), 900);
      await sleep(5200);
    }),

  /** 6:15–7:30 — teacher reads the result, opens the code, exports the sheet. */
  s8_results: () =>
    record("s8_results", async (page) => {
      await teacherIn(page);
      await click(page, page.getByRole("button", { name: "รีเฟรชข้อมูล" }), 800);
      await sleep(2200);
      await click(page, page.getByRole("radio", { name: "นักศึกษาและคะแนน" }), 800);
      await sleep(2600);
      await selectByText(page.getByLabel("กรองห้องเรียน"), "ComArch Demo");
      await sleep(2400);
      await click(page, page.getByRole("button", { name: "ดูผลรายคน" }).first(), 900);
      await sleep(3000);
      await scrollTo(page, 620, 1500);
      await sleep(2200);

      // each attempt opens to the exact code the student ran, hidden cases included
      const attempts = page.locator("details").filter({ hasText: "ส่งคำตอบ" });
      await click(page, attempts.first().locator("summary"), 800);
      await sleep(3800);
      const tested = page.locator("details").filter({ hasText: "ทดสอบ" });
      if (await tested.first().isVisible().catch(() => false)) {
        await click(page, tested.first().locator("summary"), 800);
        await sleep(3000);
      }
      await click(page, page.getByRole("button", { name: "ปิด" }).first(), 800);
      await sleep(1600);
      await click(page, page.getByRole("button", { name: "ส่งออก CSV" }).first(), 900);
      await sleep(2800);
    }),

  /** Z80 extra — teacher sets a board project for the class. */
  s10_z80_project: () =>
    record("s10_z80_project", async (page) => {
      await teacherIn(page);
      await click(page, page.getByRole("radio", { name: "โปรเจกต์ Z80" }), 800);
      await sleep(1800);
      await click(page, page.getByRole("button", { name: "สั่งงานใหม่" }), 800);
      await sleep(1200);
      const form = page.getByRole("form", { name: "สั่งงานโปรเจกต์ใหม่" });
      await selectByText(form.getByLabel("ห้อง"), "ComArch Demo");
      await sleep(900);
      await type(page, form.getByLabel("ชื่องาน"), Z80.title, 55);
      await paste(page, form.getByLabel(/รายละเอียด/), Z80.detail);
      await sleep(900);
      await click(page, form.getByRole("button", { name: "สั่งงาน" }), 900);
      await page.waitForLoadState("networkidle");
      await sleep(2600);
    }),

  /** Z80 extra — student loads the reference circuit, runs it, sends it in. */
  s11_z80_board: () =>
    record("s11_z80_board", async (page) => {
      await login(page, STUDENT.id, STUDENT.pass, "นักศึกษา");
      await page.goto(`${BASE}/z80`, { waitUntil: "networkidle" });
      await sleep(3000);
      mark("ready");
      await click(page, page.getByRole("button", { name: "วงจรตั้งต้น" }), 900);
      await sleep(1400);
      await click(page, page.getByRole("button", { name: "คืนค่า" }), 800);
      await sleep(3000);
      await click(page, page.getByRole("button", { name: "เริ่มจำลอง" }), 900);
      await sleep(7000);
      await click(page, page.getByRole("button", { name: "ส่งให้อาจารย์" }), 900);
      await sleep(2400);
      const dialog = page.getByRole("radiogroup", { name: "งานโปรเจกต์" });
      await click(page, dialog.getByText(Z80.title).first(), 800);
      await sleep(1400);
      await click(page, page.getByRole("button", { name: /^ส่งงาน$|^ส่งใหม่$/ }).last(), 900);
      await sleep(3600);
    }),

  /** Z80 extra — teacher opens what was sent and grades it. */
  s12_z80_review: () =>
    record("s12_z80_review", async (page) => {
      await teacherIn(page);
      await click(page, page.getByRole("radio", { name: "โปรเจกต์ Z80" }), 800);
      await sleep(2600);
      await scrollTo(page, 420, 1400);
      await sleep(2400);
      const score = page.getByLabel("คะแนน").first();
      if (await score.isVisible().catch(() => false)) {
        await type(page, score, "9", 300);
        await sleep(800);
        await type(
          page,
          page.getByLabel("ความเห็นถึงนักศึกษา").first(),
          "วงจรต่อครบและรันได้ตามโจทย์",
          45,
        );
        await sleep(2200);
      }
      await sleep(2000);
    }),

  /** 7:30–8:00 — reload to show the data is really stored, then rest on the dashboard. */
  s9_persist: () =>
    record("s9_persist", async (page) => {
      await teacherIn(page);
      await sleep(1600);
      await page.reload({ waitUntil: "networkidle" });
      await sleep(3000);
      await click(page, page.getByRole("radio", { name: "ภาพรวม" }), 800);
      await sleep(3600);
      await scrollTo(page, 500, 1600);
      await sleep(2600);
    }),
};

/** Story order — several segments depend on what the earlier ones created. */
const ORDER = [
  "s1_landing", "s2_class", "s3_join", "s4_convert", "s5_examples",
  "s6_problem", "s7_submit", "s8_results", "s9_persist",
  "s10_z80_project", "s11_z80_board", "s12_z80_review",
];

const want = process.argv.slice(2);
const names = want.length ? want : ORDER;
for (const n of names) {
  if (!segments[n]) throw new Error("unknown segment: " + n);
  await segments[n]();
}
