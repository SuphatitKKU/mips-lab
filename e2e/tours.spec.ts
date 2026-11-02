import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const admin = JSON.parse(readFileSync("private/local-admin.json", "utf8"));
const keys = [
  "home",
  "code-convert",
  "code-run",
  "problems",
  "solve",
  "answer",
  "leaderboard",
  "z80",
  "teacher",
  "settings",
];
async function teacher(page: Page) {
  const r = await page.request.post("/api/auth/password", { data: admin });
  expect(r.status()).toBe(200);
  const session = await r.json();
  await page.addInitScript(
    ({ session, keys }) => {
      localStorage.setItem("mipslab.token", session.token);
      localStorage.setItem("mipslab.user", JSON.stringify(session.user));
      keys.forEach((k) => localStorage.setItem("mipslab.tour." + k, "1"));
    },
    { session, keys },
  );
}
async function openGuide(page: Page) {
  const button = page
    .getByRole("button", { name: "แนะนำหน้านี้", exact: true })
    .first();
  await button.click();
  const guide = page.getByRole("dialog", { name: "แนะนำการใช้งาน" });
  await expect(guide).toBeVisible();
  await expect(guide.locator("b")).not.toBeEmpty();
  await expect(guide.locator("p")).not.toBeEmpty();
  const rect = await guide.locator(".tour-tip").boundingBox(),
    vp = page.viewportSize()!;
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(vp.height + 1);
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  await expect(button).toBeFocused();
}
for (const mobile of [false, true])
  test(`help opens on every workspace route and can be replayed (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await teacher(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of [
      "/teacher",
      "/settings",
      "/",
      "/problems",
      "/problems/14",
      "/problems/14/answer",
      "/leaderboard",
      "/code?mode=convert",
      "/code?mode=run",
      "/z80",
      "/unknown-page",
      "/z80/terminal",
    ]) {
      await page.goto(path);
      await openGuide(page);
    }
    await page.goto("/teacher");
    await page
      .getByRole("radio", { name: "นักศึกษาและคะแนน", exact: true })
      .click();
    const button = page
      .getByRole("button", { name: "แนะนำหน้านี้", exact: true })
      .first();
    await button.click();
    const guide = page.getByRole("dialog", { name: "แนะนำการใช้งาน" }),
      titles: string[] = [];
    while (await guide.count()) {
      titles.push(await guide.locator("b").innerText());
      const next = guide.getByRole("button", { name: "ถัดไป", exact: true });
      if (await next.count()) await next.click();
      else
        await guide
          .getByRole("button", { name: "เข้าใจแล้ว", exact: true })
          .click();
    }
    expect(titles).toContain("รายชื่อและคะแนน");
    expect(titles).toContain("กรองรายชื่อ");
    await openGuide(page);
    expect(errors).toEqual([]);
  });
test("guest landing guide works and Google login is the last action in the login modal", async ({page}) => {
  await page.setViewportSize({width:390,height:844});await page.goto('/welcome');await openGuide(page);
  await page.goto('/login');const login=page.getByRole('dialog',{name:'เข้าสู่ระบบ',exact:true});
  await expect(login.getByRole('button',{name:'แนะนำหน้านี้'})).toHaveCount(0);
  await expect(login.getByText('แนะนำการเข้าสู่ระบบ',{exact:true})).toHaveCount(0);
  const google=login.getByRole('button',{name:'เข้าสู่ระบบด้วย Google',exact:true});await expect(google).toBeVisible();
  await expect(login.locator('.login-content > :last-child')).toHaveAccessibleName('เข้าสู่ระบบด้วย Google');
  const passwordButton=await login.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).boundingBox();const googleButton=await google.boundingBox();
  expect(googleButton!.y).toBeGreaterThan(passwordButton!.y+passwordButton!.height);
});
test("invalid Google tokens cannot create a D1 session", async ({
  request,
}) => {
  const response = await request.post("/api/auth/google", {
    data: { idToken: "forged", role: "teacher" },
  });
  expect(response.status()).toBe(401);
  expect((await response.json()).token).toBeUndefined();
  const config = await (await request.get("/api/auth/config")).json();
  expect(config.googleEnabled).toBe(true);
  expect(config.firebase.projectId).toBe("muton-2802c");
});

test("a student awaiting their ID and class gets a working onboarding guide", async ({
  page,
}) => {
  const user = {
    studentId: "g_onboarding_tour",
    name: "นักศึกษา Google",
    initials: "นG",
    role: "student",
    email: "student@example.com",
    section: "",
    classId: null,
    needsClass: true,
    googleLinked: true,
    hasPassword: false,
  };
  await page.route("**/api/profile", (route) =>
    route.fulfill({ json: { user, sections: [] } }),
  );
  await page.addInitScript((user) => {
    localStorage.setItem("mipslab.token", "tour-only-local-session");
    localStorage.setItem("mipslab.user", JSON.stringify(user));
  }, user);
  await page.goto("/problems");
  await expect(
    page.getByText("เข้าห้องเรียนก่อนเริ่มใช้งาน", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "แนะนำหน้านี้", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "แนะนำการใช้งาน" });
  await expect(guide.locator("b")).toHaveText("ตรวจรหัสนักศึกษา");
  await guide.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await expect(guide.locator("b")).toHaveText("เข้าห้องด้วยรหัสจากอาจารย์");
  await guide.getByRole("button", { name: "เข้าใจแล้ว", exact: true }).click();
  await expect(guide).toHaveCount(0);
});
