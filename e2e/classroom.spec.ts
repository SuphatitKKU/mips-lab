import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
const admin = JSON.parse(readFileSync("private/local-admin.json", "utf8"));
const problem = {
  id: 0,
  title: "E2E ผลรวมสองจำนวน",
  sub: "ตรวจครบวงจร",
  statement: "คืนผลรวม a+b",
  kind: "c",
  level: "ง่าย",
  topic: "E2E",
  fn: "add",
  params: [
    ["a0", "a", "จำนวนเต็ม"],
    ["a1", "b", "จำนวนเต็ม"],
  ],
  returns: [["v0", "ผลรวม"]],
  starter: "int add(int a,int b){return 0;}",
  tests: [
    { args: [2, 3], expect: { v0: 5 } },
    { args: [-4, 9], expect: { v0: 5 }, hidden: true },
  ],
  answer: {
    code: [{ lang: "c", lines: ["int add(int a,int b){return a+b;}"] }],
  },
  hints: [],
  example: "",
  customPoints: 30,
};
const password = "E2e-student-password-42";
const testSid = "66" + String(Date.now()).slice(-8);
const browserTitle = "โจทย์จากแบบฟอร์ม E2E " + Date.now();
async function login(request: APIRequestContext, username: string, pw: string) {
  const r = await request.post("/api/auth/password", {
    data: { username, password: pw },
  });
  expect(r.status()).toBe(200);
  return (await r.json()).token as string;
}
const headers = (token: string) => ({ authorization: "Bearer " + token });
test("D1 classroom lifecycle, role boundaries, hidden tests and atomic scoring", async ({
  request,
}) => {
  const token = await login(request, admin.username, admin.password),
    h = headers(token),
    sid = testSid;
  expect((await request.get("/api/teacher/users")).status()).toBe(401);
  const created = await request.post("/api/teacher/students", {
    headers: h,
    data: { studentId: sid, name: "นักศึกษาทดสอบ", section: "E2E A", password },
  });
  expect(created.status()).toBe(201);
  const student = (await created.json()).user;
  expect(student.year).toBe(4);
  const studentToken = await login(request, sid, password),
    sh = headers(studentToken);
  expect(
    (await request.get("/api/teacher/users", { headers: sh })).status(),
  ).toBe(403);
  expect(
    (
      await request.put("/api/profile", {
        headers: sh,
        data: { name: "นักศึกษาทดสอบ", section: "E2E B" },
      })
    ).status(),
  ).toBe(403);
  const invalid = structuredClone(problem);
  invalid.tests[1].expect.v0 = 999;
  expect(
    (
      await request.post("/api/teacher/problems", {
        headers: h,
        data: { problem: invalid, published: true },
      })
    ).status(),
  ).toBe(400);
  const create = await request.post("/api/teacher/problems", {
    headers: h,
    data: { problem, published: false, section: "E2E A" },
  });
  expect(create.status()).toBe(201);
  const id = (await create.json()).id;
  expect(
    (await request.get(`/api/problems/${id}`, { headers: sh })).status(),
  ).toBe(404);
  expect(
    (
      await request.put(`/api/teacher/problems/${id}`, {
        headers: h,
        data: { problem, published: true, section: "E2E A" },
      })
    ).status(),
  ).toBe(200);
  const detail = await (
    await request.get(`/api/problems/${id}`, { headers: sh })
  ).json();
  expect(detail.problem.tests).toHaveLength(1);
  expect(detail.problem.answer).toBeUndefined();
  expect(detail.potential.points).toBe(35);
  expect(
    (await request.get(`/api/problems/${id}/answer`, { headers: sh })).status(),
  ).toBe(403);
  expect(
    (
      await request.put(`/api/problems/${id}/draft`, {
        headers: sh,
        data: { code: problem.starter },
      })
    ).status(),
  ).toBe(200);
  const bad = await request.post(`/api/problems/${id}/submit`, {
    headers: sh,
    data: { code: problem.starter },
  });
  const badJson = await bad.json();
  expect(bad.status()).toBe(200);
  expect(badJson.pass).toBe(false);
  expect(badJson.results[1]).toMatchObject({
    hidden: true,
    input: "เคสซ่อน",
    expected: "",
    got: "",
  });
  const source = problem.answer.code[0].lines.join("\n");
  await expect
    .poll(
      async () => {
        const r = await request.post(`/api/problems/${id}/submit`, {
          headers: sh,
          data: { code: source },
        });
        if (r.status() === 429) return null;
        expect(r.status()).toBe(200);
        const j = await r.json();
        expect(j.pass).toBe(true);
        return j.awarded;
      },
      { intervals: [1100], timeout: 10000 },
    )
    .toBe(30);
  const report = await (
    await request.get(`/api/teacher/users/${student.id}/report`, { headers: h })
  ).json();
  expect(report.solves[0].points).toBe(30);
  expect(report.attempts[0].code).toBe(source);
  const changed = structuredClone(problem);
  changed.customPoints = 99;
  expect(
    (
      await request.put(`/api/teacher/problems/${id}`, {
        headers: h,
        data: { problem: changed, published: true, section: "E2E A" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await request.get(`/api/problems/${id}/answer`, { headers: sh })).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        const r = await request.post(`/api/problems/${id}/submit`, {
          headers: sh,
          data: { code: source },
        });
        return r.status() === 429 ? null : await r.json();
      },
      { intervals: [1100], timeout: 10000 },
    )
    .toMatchObject({ awarded: null, alreadySolved: true });
  expect(
    (await (await request.get("/api/me", { headers: sh })).json()).points,
  ).toBe(30);
  const newSid = "69" + String(Date.now()).slice(-8);
  const second = await request.post("/api/teacher/students", {
    headers: h,
    data: { studentId: newSid, name: "ต่างกลุ่ม", section: "E2E B", password },
  });
  expect(second.status()).toBe(201);
  const secondToken = await login(request, newSid, password);
  expect(
    (
      await request.get(`/api/problems/${id}`, {
        headers: headers(secondToken),
      })
    ).status(),
  ).toBe(404);
  const override = await request.patch(`/api/teacher/users/${student.id}`, {
    headers: h,
    data: { yearOverride: 3 },
  });
  expect((await override.json()).user.year).toBe(3);
  const deadline = await request.put(`/api/teacher/problems/${id}`, {
    headers: h,
    data: {
      problem,
      published: true,
      section: "E2E A",
      dueAt: Date.now() - 60000,
    },
  });
  expect(deadline.status()).toBe(200);
  expect(
    (
      await request.post(`/api/problems/${id}/submit`, {
        headers: sh,
        data: { code: source },
      })
    ).status(),
  ).toBe(403);
  await request.patch(`/api/teacher/users/${student.id}`, {
    headers: h,
    data: { active: false },
  });
  expect((await request.get("/api/profile", { headers: sh })).status()).toBe(
    401,
  );
  expect(
    (
      await request.post("/api/auth/dev", { data: { role: "teacher" } })
    ).status(),
  ).toBe(404);
});
test("teacher creates a published exercise in browser and sees real dashboard", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByRole("radio", { name: "อาจารย์", exact: true }).click();
  await page
    .getByRole("textbox", { name: "ชื่อผู้ใช้", exact: true })
    .fill(admin.username);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher/);
  await expect(
    page.getByRole("heading", { name: "ห้องอาจารย์" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "จัดการโจทย์", exact: true }).click();
  await page.getByRole("button", { name: "สร้างโจทย์", exact: true }).click();
  await page.getByLabel("ชื่อโจทย์", { exact: true }).fill(browserTitle);
  await page.getByLabel("คำอธิบายโจทย์", { exact: true }).fill("หาผลรวม a+b");
  await page.getByLabel("เผยแพร่ให้นักศึกษา").check();
  await page
    .getByRole("button", { name: "ตรวจเฉลยและบันทึก", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: new RegExp(browserTitle) }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "นักศึกษาและคะแนน", exact: true })
    .click();
  await page.getByRole("textbox", { name: "ค้นหานักศึกษา" }).fill(testSid);
  await expect(page.getByText("นักศึกษาทดสอบ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ดูผลรายคน" }).click();
  await expect(page.getByText("คะแนนรวม 30", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "private/teacher-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "private/teacher-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  const config = await (await request.get("/api/auth/config")).json();
  expect(config.devLogin).toBe(false);
  expect(config.googleClientId).toBeNull();
});
