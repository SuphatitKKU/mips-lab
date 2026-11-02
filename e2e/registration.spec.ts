import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const admin = JSON.parse(readFileSync("private/local-admin.json", "utf8"));
const password = "Student-registration-42";

for (const mobile of [false, true])
  test(`students can register, enter a class, and log in again (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const stamp = Date.now(),
      studentId = "69" + String(stamp).slice(-7) + "-1";
    const auth = await request.post("/api/auth/password", { data: admin });
    expect(auth.status()).toBe(200);
    const teacher = await auth.json(),
      h = { authorization: "Bearer " + teacher.token };
    const create = await request.post("/api/teacher/classes", {
      headers: h,
      data: { name: "สมัครสมาชิก " + stamp, year: 2569, term: 2 },
    });
    expect(create.status()).toBe(201);
    const cls = (await create.json()).class;
    await page.addInitScript(() =>
      localStorage.setItem("mipslab.tour.home", "1"),
    );
    await page.goto("/login");
    let dialog = page.getByRole("dialog", { name: "เข้าสู่ระบบ", exact: true });
    await dialog.getByRole("radio", { name: "อาจารย์", exact: true }).click();
    await expect(
      dialog.getByRole("button", {
        name: "เข้าสู่ระบบด้วย Google",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "สมัครสมาชิก", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("radio", { name: "นักศึกษา", exact: true }).click();
    await expect(
      dialog.getByRole("button", {
        name: "เข้าสู่ระบบด้วย Google",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "สมัครสมาชิก", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "สมัครสมาชิกนักศึกษา",
      exact: true,
    });
    await dialog
      .getByLabel("ชื่อ–นามสกุล", { exact: true })
      .fill("นักศึกษาสมัครเอง " + stamp);
    await dialog.getByLabel("รหัสนักศึกษา", { exact: true }).fill(studentId);
    await dialog.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await dialog
      .getByLabel("ยืนยันรหัสผ่าน", { exact: true })
      .fill("Different-password-42");
    await dialog
      .getByRole("button", { name: "สมัครสมาชิก", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("ไม่ตรงกัน");
    await dialog.getByLabel("ยืนยันรหัสผ่าน", { exact: true }).fill(password);
    await dialog
      .getByLabel("รหัสเข้าห้อง (ไม่บังคับ)", { exact: false })
      .fill(cls.code);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await dialog
      .getByRole("button", { name: "สมัครสมาชิก", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", {
        name: new RegExp("นักศึกษาสมัครเอง " + stamp),
      }),
    ).toBeVisible();
    const profile = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mipslab.user")!),
    );
    expect(profile).toMatchObject({
      role: "student",
      classId: cls.id,
      needsClass: false,
      studentId: studentId.replace(/-/g, ""),
    });
    const login = await request.post("/api/auth/password", {
      data: { username: studentId, password },
    });
    expect(login.status()).toBe(200);
    const student = await login.json();
    expect(
      (
        await request.get("/api/teacher/users", {
          headers: { authorization: "Bearer " + student.token },
        })
      ).status(),
    ).toBe(403);
    const users = await (
      await request.get("/api/teacher/users", { headers: h })
    ).json();
    expect(
      users.users.find(
        (u: { studentId: string }) => u.studentId === profile.studentId,
      )?.classId,
    ).toBe(cls.id);
    expect(
      (
        await request.post("/api/auth/register", {
          data: { name: "ซ้ำ", studentId, password },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.post("/api/auth/register", {
          data: { name: "ซ้ำ", studentId: profile.studentId, password },
        })
      ).status(),
    ).toBe(409);
    await page.goto("/settings");
    await expect(
      page.getByRole("region", { name: "เชื่อมต่อ Google" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

test("public signup cannot create teachers and teacher settings offer password login only", async ({
  page,
  request,
}) => {
  const rejected = await request.post("/api/auth/register", {
    data: {
      name: "attempt",
      studentId: "693040555-1",
      password,
      role: "teacher",
    },
  });
  expect(rejected.status()).toBe(400);
  const auth = await request.post("/api/auth/password", { data: admin });
  expect(auth.status()).toBe(200);
  const teacher = await auth.json();
  expect(
    (
      await request.post("/api/profile/google", {
        headers: { authorization: "Bearer " + teacher.token },
        data: { idToken: "unused-for-teachers" },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
  }, teacher);
  await page.goto("/settings");
  await expect(
    page.getByRole("form", { name: "เปลี่ยนรหัสผ่าน" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "เชื่อมต่อ Google" }),
  ).toHaveCount(0);
  const config = await (await request.get("/api/auth/config")).json();
  expect(config).toMatchObject({
    studentRegistration: true,
    teacherGoogleLogin: false,
    passwordLogin: true,
  });
});
