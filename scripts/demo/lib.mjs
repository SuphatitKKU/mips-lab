import { chromium } from "@playwright/test";
import {
  mkdirSync,
  renameSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8789";
export const OUT = process.env.DEMO_OUT ?? "./out";
export const W = 1920;
export const H = 1080;

export const TEACHER = { user: "admin", pass: process.env.DEMO_ADMIN_PASS };
export const STUDENT = {
  id: process.env.DEMO_STUDENT_ID ?? "653040123-4",
  pass: process.env.DEMO_STUDENT_PASS ?? "Demo-student-2569",
  name: "สมชาย ใจดี",
};
export const CLASS_NAME = "ComArch Demo";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let MARKS = [];
let T0 = 0;
/** Stamp the moment a beat starts, so captions can be hung off real time. */
export function mark(label) {
  MARKS.push({ label, t: (Date.now() - T0) / 1000 });
}

/** Launch a recording context. Each segment gets its own video file. */
export async function record(name, fn) {
  mkdirSync(OUT, { recursive: true });
  const raw = join(OUT, "raw", name);
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const browser = await chromium.launch({
    args: [`--window-size=${W},${H}`, "--force-device-scale-factor=1"],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: raw, size: { width: W, height: H } },
    deviceScaleFactor: 1,
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  await inject(page);
  MARKS = [];
  T0 = Date.now();
  let err;
  try {
    await fn(page, ctx, browser);
    await sleep(900);
  } catch (e) {
    err = e;
  }
  await ctx.close();
  await browser.close();
  const file = readdirSync(raw).find((f) => f.endsWith(".webm"));
  if (file) renameSync(join(raw, file), join(OUT, `${name}.webm`));
  mkdirSync(join(OUT, "marks"), { recursive: true });
  writeFileSync(join(OUT, "marks", `${name}.json`), JSON.stringify(MARKS));
  if (err) throw err;
  console.log(`✓ ${name}`);
}

/** Cursor dot + click ring so the recording reads as a guided demo. */
async function inject(page) {
  await page.addInitScript(() => {
    // the guided tours pop over the UI on first visit — mark them all seen
    try {
      for (const k of [
        "home", "code-convert", "code-run", "problems", "solve", "answer",
        "leaderboard", "z80", "teacher", "settings", "landing", "login",
        "terminal", "page",
      ])
        localStorage.setItem("mipslab.tour." + k, "1");
    } catch {}
    const ready = () => {
      if (document.getElementById("__demo_cursor")) return;
      const d = document.createElement("div");
      d.id = "__demo_cursor";
      d.style.cssText =
        "position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;" +
        "background:rgba(220,38,38,.35);border:2px solid #dc2626;pointer-events:none;" +
        "left:-50px;top:-50px;transition:left .28s ease,top .28s ease;";
      document.body.appendChild(d);
      window.__demoMove = (x, y) => {
        d.style.left = x - 11 + "px";
        d.style.top = y - 11 + "px";
      };
      window.__demoPing = (x, y) => {
        const r = document.createElement("div");
        r.style.cssText =
          "position:fixed;z-index:2147483646;left:" +
          (x - 10) +
          "px;top:" +
          (y - 10) +
          "px;width:20px;height:20px;border-radius:50%;border:3px solid #dc2626;" +
          "pointer-events:none;animation:__demoPing .6s ease-out forwards;";
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 620);
      };
      const s = document.createElement("style");
      s.textContent =
        "@keyframes __demoPing{to{transform:scale(3.2);opacity:0}}" +
        "*{scrollbar-width:thin}";
      document.head.appendChild(s);
    };
    if (document.body) ready();
    else document.addEventListener("DOMContentLoaded", ready);
  });
}

async function point(page, loc) {
  const box = await loc.boundingBox();
  if (!box) throw new Error("element not visible");
  const x = Math.round(box.x + box.width / 2),
    y = Math.round(box.y + box.height / 2);
  await page.evaluate(([x, y]) => window.__demoMove?.(x, y), [x, y]);
  await page.mouse.move(x, y);
  return [x, y];
}

/** Move the pointer to a target, pause, then click — readable on video. */
export async function click(page, loc, pause = 700) {
  const target = loc.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(320);
  const [x, y] = await point(page, target);
  await sleep(pause);
  await page.evaluate(([x, y]) => window.__demoPing?.(x, y), [x, y]);
  await target.click();
  await sleep(420);
}

/** Type at a human pace so viewers can follow. */
export async function type(page, loc, text, delay = 55) {
  const target = loc.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await point(page, target);
  await sleep(260);
  await target.click();
  await target.fill("");
  await target.type(text, { delay });
  await sleep(500);
}

/** Drop a long value in at once — typing JSON char by char kills the pace. */
export async function paste(page, loc, text) {
  const target = loc.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await point(page, target);
  await sleep(300);
  await target.fill(text);
  await sleep(800);
}

/** Replace a code editor's contents in one paste-like step. */
export async function setCode(page, loc, code) {
  const target = loc.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await point(page, target);
  await sleep(300);
  await target.click();
  await page.keyboard.press("Control+A");
  await sleep(200);
  await target.type(code, { delay: 18 });
  await sleep(600);
}

/** Click line `n` of a CodeEditor — it maps the click's y back to a line. */
export async function clickCodeLine(page, loc, n) {
  const PAD = 10,
    LH = 26;
  const target = loc.first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(300);
  const box = await target.boundingBox();
  if (!box) throw new Error("code editor not visible");
  const x = Math.round(box.x + Math.min(240, box.width * 0.4)),
    y = Math.round(box.y + PAD + (n - 0.5) * LH);
  await page.evaluate(([x, y]) => window.__demoMove?.(x, y), [x, y]);
  await page.mouse.move(x, y);
  await sleep(650);
  await page.evaluate(([x, y]) => window.__demoPing?.(x, y), [x, y]);
  await page.mouse.click(x, y);
  await sleep(900);
}

/** Pick the option whose visible text contains `needle`. */
export async function selectByText(loc, needle) {
  const sel = loc.first();
  const value = await sel.evaluate((el, needle) => {
    const hit = [...el.options].find((o) => o.textContent.includes(needle));
    if (!hit) throw new Error("no option matching " + needle);
    return hit.value;
  }, needle);
  await sel.selectOption(value);
  await sleep(700);
}

export async function login(page, user, pass, role) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await sleep(900);
  await click(page, page.getByRole("radio", { name: role }), 400);
  const form = page.getByRole("form", { name: /เข้าสู่ระบบด้วยรหัสผ่าน/ });
  await type(page, form.getByRole("textbox"), user, 60);
  await type(page, form.locator('input[type="password"]'), pass, 30);
  await click(page, form.getByRole("button", { name: "เข้าสู่ระบบ" }), 500);
  await page.waitForLoadState("networkidle");
  await sleep(1200);
}

export async function dismissTour(page) {
  for (const name of ["ปิด", "ข้าม", "เสร็จสิ้น"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.first().isVisible().catch(() => false)) {
      await b.first().click().catch(() => {});
      await sleep(400);
    }
  }
}

/** Slow page scroll — used for landing / dashboard beauty passes. */
export async function scrollTo(page, y, ms = 1400) {
  await page.evaluate(
    ([y, ms]) =>
      new Promise((done) => {
        const start = window.scrollY,
          d = y - start,
          t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms),
            e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + d * e);
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [y, ms],
  );
  await sleep(300);
}
