import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
const admin = JSON.parse(readFileSync("private/local-admin.json", "utf8"));
const stamp = Date.now();
const password = "Classroom-local-test-42";
const sid = "69" + String(stamp).slice(-8);
const name = `ห้องทดสอบ ${stamp}`;
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function login(request: APIRequestContext, username: string, pw: string) {
  const r = await request.post("/api/auth/password", {
    data: { username, password: pw },
  });
  expect(r.status()).toBe(200);
  return await r.json();
}
test("D1 classes, pending rosters, assignments, Z80 hand-ins, grading and archives work together", async ({
  request,
  page,
}) => {
  const teacher = await login(request, admin.username, admin.password),
    h = headers(teacher.token);
  const create = async (term: number) => {
    const r = await request.post("/api/teacher/classes", {
      headers: h,
      data: { name, year: 2569, term },
    });
    expect(r.status()).toBe(201);
    return (await r.json()).class;
  };
  const c = await create(2),
    other = await create(1);
  expect(c.id).not.toBe(other.id);
  expect(
    (
      await request.post("/api/teacher/classes", {
        headers: h,
        data: { name, year: 2569, term: 2 },
      })
    ).status(),
  ).toBe(409);
  const invalidSid = "68" + String(stamp).slice(-8);
  expect(
    (
      await request.post("/api/teacher/students", {
        headers: h,
        data: {
          studentId: invalidSid,
          name: "ห้องไม่ถูกต้อง",
          password,
          classId: 999999,
        },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/auth/password", {
        data: { username: invalidSid, password },
      })
    ).status(),
  ).toBe(401);
  const roster = await request.post(`/api/teacher/classes/${c.id}/roster`, {
    headers: h,
    data: { text: sid + "\ninvalid" },
  });
  expect(await roster.json()).toMatchObject({
    pending: 1,
    invalid: ["invalid"],
  });
  const created = await request.post("/api/teacher/students", {
    headers: h,
    data: {
      studentId: sid,
      name: "กานต์ทดสอบ Classroom",
      password,
      classId: null,
    },
  });
  expect(created.status()).toBe(201);
  const student = (await created.json()).user;
  expect(student.classId).toBe(c.id);
  const session = await login(request, sid, password),
    sh = headers(session.token);
  expect(session.user.needsClass).toBe(false);
  expect(
    (await request.get("/api/teacher/classes", { headers: sh })).status(),
  ).toBe(403);
  const exercises = await (
    await request.get("/api/problems", { headers: sh })
  ).json();
  const pid =
    exercises.problems.find((p: { id: number; kind: string }) => p.id === 14)
      ?.id ?? exercises.problems[0].id;
  const due = Date.now() + 86400000;
  expect(
    (
      await request.put(`/api/teacher/classes/${c.id}/assignments`, {
        headers: h,
        data: { assignments: [{ problemId: pid, dueAt: due }] },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (await request.get("/api/problems", { headers: sh })).json()
    ).problems.find((p: { id: number }) => p.id === pid).dueAt,
  ).toBe(due);
  expect(
    (await (await request.get(`/api/problems/${pid}`, { headers: sh })).json())
      .dueAt,
  ).toBe(due);
  expect(
    (
      await request.put(`/api/teacher/classes/${c.id}/assignments`, {
        headers: h,
        data: { assignments: [{ problemId: 999999, dueAt: due }] },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await (
        await request.get(`/api/teacher/classes/${c.id}/assignments`, {
          headers: h,
        })
      ).json()
    ).assignments,
  ).toHaveLength(1);
  const p = await request.post("/api/teacher/projects", {
    headers: h,
    data: {
      classId: c.id,
      title: `วงจร E2E ${stamp}`,
      detail: "ต่อวงจรและเขียนโค้ด",
      dueAt: due,
    },
  });
  expect(p.status()).toBe(201);
  const project = (await p.json()).project;
  const stranger = await request.post("/api/teacher/projects", {
    headers: h,
    data: { classId: other.id, title: "งานต่างห้อง" },
  });
  const op = (await stranger.json()).project;
  const work = {
    name: "วงจรทดสอบ",
    board: { parts: [], wires: [] },
    code: "LD A,42\nHALT",
    note: "ข้อความถึงอาจารย์",
  };
  expect(
    (
      await request.post(`/api/projects/${op.id}/submit`, {
        headers: sh,
        data: work,
      })
    ).status(),
  ).toBe(404);
  const send = await request.post(`/api/projects/${project.id}/submit`, {
    headers: sh,
    data: work,
  });
  expect(send.status()).toBe(200);
  const submission = (await send.json()).project.submission;
  expect(submission.late).toBe(false);
  const hand = await (
    await request.get(`/api/teacher/submissions/${submission.id}`, {
      headers: h,
    })
  ).json();
  expect(hand.submission.code).toBe(work.code);
  expect(
    (
      await request.get(`/api/teacher/submissions/${submission.id}`, {
        headers: sh,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.patch(`/api/teacher/submissions/${submission.id}`, {
        headers: h,
        data: { score: -1 },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch(`/api/teacher/submissions/${submission.id}`, {
        headers: h,
        data: { score: 87.5, feedback: "วงจรถูกต้อง" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/projects/${project.id}/submit`, {
        headers: sh,
        data: { ...work, code: "HALT" },
      })
    ).status(),
  ).toBe(409);
  const mine = await (
    await request.get("/api/projects", { headers: sh })
  ).json();
  expect(mine.projects[0].submission).toMatchObject({
    score: 87.5,
    feedback: "วงจรถูกต้อง",
  });
  const ro = await (
    await request.get(`/api/teacher/projects/${project.id}/submissions`, {
      headers: h,
    })
  ).json();
  expect(
    ro.rows.find((r: { user: { id: number } }) => r.user.id === student.id)
      .submission.score,
  ).toBe(87.5);
  expect(
    (
      await request.delete(`/api/teacher/classes/${c.id}`, { headers: h })
    ).status(),
  ).toBe(409);
  await request.patch(`/api/teacher/classes/${c.id}`, {
    headers: h,
    data: { archived: true },
  });
  expect((await request.get("/api/problems", { headers: sh })).status()).toBe(
    403,
  );
  expect(
    (await (await request.get("/api/profile", { headers: sh })).json()).user
      .needsClass,
  ).toBe(true);
  expect(
    (
      await request.post("/api/profile/class", {
        headers: sh,
        data: { code: c.code },
      })
    ).status(),
  ).toBe(400);
  await request.patch(`/api/teacher/classes/${c.id}`, {
    headers: h,
    data: { archived: false, newCode: true },
  });
  expect(
    (
      await request.post("/api/profile/class", {
        headers: sh,
        data: { code: c.code },
      })
    ).status(),
  ).toBe(400);
  expect((await request.get("/api/projects", { headers: sh })).status()).toBe(
    200,
  );
  const progress = await (
    await request.get(`/api/teacher/users/${student.id}/progress`, {
      headers: h,
    })
  ).json();
  expect(progress.problems.length).toBeGreaterThan(0);
  expect(
    (
      await request.post("/api/teacher/stats", {
        headers: h,
        data: { ids: [student.id] },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (await request.get("/api/teacher/audit", { headers: h })).json()
    ).log.some((r: { action: string }) => r.action === "ให้คะแนนโปรเจกต์"),
  ).toBe(true);
  await page.goto("/");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
  }, teacher);
  await page.goto("/teacher");
  await page
    .getByRole("radio", { name: "นักศึกษาและคะแนน", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "ค้นหานักศึกษา", exact: true })
    .fill(sid);
  const table = page.getByRole("table", {
    name: "รายชื่อและคะแนน",
    exact: true,
  });
  await expect(table.getByText("กานต์ทดสอบ Classroom")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "ค้นหานักศึกษา", exact: true })
    .fill("ไม่มีคนนี้แน่นอน");
  await expect(page.getByText("ไม่พบข้อมูลที่ตรงกับการค้นหา")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "ค้นหานักศึกษา", exact: true })
    .fill(sid);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("student-scores.csv");
  const wordDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word", exact: true }).click();
  const word = await wordDownload;
  expect(word.suggestedFilename()).toMatch(/\.docx$/);
  expect(
    readFileSync((await word.path())!)
      .subarray(0, 2)
      .toString(),
  ).toBe("PK");
  await page.getByRole("radio", { name: "โปรเจกต์ Z80", exact: true }).click();
  const projectLine = page
    .getByText(`วงจร E2E ${stamp}`, { exact: true })
    .locator("..")
    .locator("..");
  await projectLine.getByRole("button", { name: "ดูงานที่ส่ง" }).click();
  const submissions = page.getByRole("table", {
    name: `งานที่ส่ง วงจร E2E ${stamp}`,
  });
  await expect(submissions).toContainText("87.5");
  await submissions
    .getByRole("textbox", { name: "คะแนน", exact: true })
    .fill("91.25");
  await submissions
    .getByRole("button", { name: "บันทึก", exact: true })
    .click();
  await expect(submissions).toContainText("91.25");
  expect(
    (await (await request.get("/api/projects", { headers: sh })).json())
      .projects[0].submission.score,
  ).toBe(91.25);
  const boardTab = page.waitForEvent("popup");
  await submissions.getByRole("link", { name: "เปิดบนบอร์ด" }).click();
  const board = await boardTab;
  await expect(
    board.getByRole("region", { name: "งานที่นักศึกษาส่ง" }),
  ).toContainText("กานต์ทดสอบ Classroom");
  await board.close();
  // A student sees graded feedback through the actual submit dialog on the board.
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
    localStorage.setItem("mipslab.tour.z80", "1");
  }, session);
  await page.goto("/z80");
  await page
    .getByRole("button", { name: "ส่งให้อาจารย์", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("91.25");
  await expect(page.getByRole("dialog")).toContainText("วงจรถูกต้อง");
});

test("data tables sort numerically, paginate, hide columns and fit mobile", async ({
  request,
  page,
}) => {
  const teacher = await login(request, admin.username, admin.password);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
  }, teacher);
  await page.goto("/teacher");
  await page.getByRole("radio", { name: "ภาพรวม", exact: true }).click();
  const section = page.getByRole("region", {
      name: "ผลการทำโจทย์",
      exact: true,
    }),
    table = section.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(11);
  await section
    .getByRole("button", { name: "เรียงตามข้อ", exact: true })
    .click();
  await expect(table.locator("th").first()).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  const first = Number(
    await table.locator("tbody tr").first().locator("td").first().innerText(),
  );
  await section
    .getByRole("button", { name: "หน้าถัดไป ผลการทำโจทย์", exact: true })
    .click();
  const second = Number(
    await table.locator("tbody tr").first().locator("td").first().innerText(),
  );
  expect(first).toBeGreaterThan(second);
  await section.getByRole("searchbox").fill("ไม่พบโจทย์นี้");
  await expect(section.getByRole("status")).toContainText("0 รายการ");
  await section.getByRole("button", { name: "ล้างการค้นหา" }).click();
  await section.locator("summary").click();
  await section.getByRole("checkbox", { name: "กลุ่ม", exact: true }).uncheck();
  await expect(
    table.getByRole("columnheader", { name: "กลุ่ม", exact: true }),
  ).toHaveCount(0);
  await section.locator("summary").click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "private/classroom-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "private/classroom-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("teacher creates a class and assignment in the UI; an unassigned student joins with its code", async ({
  page,
  request,
}) => {
  const teacher = await login(request, admin.username, admin.password),
    h = headers(teacher.token);
  const className = `ห้องแบบฟอร์ม ${Date.now()}`;
  await page.goto("/");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
  }, teacher);
  await page.goto("/teacher");
  await page.getByRole("button", { name: "สร้างห้อง", exact: true }).click();
  const form = page.getByRole("form", { name: "สร้างห้องใหม่" });
  await form.getByLabel("ชื่อห้อง / กลุ่ม").fill(className);
  await form.getByLabel("ปีการศึกษา (พ.ศ.)").selectOption("2569");
  await form.getByLabel("ภาคเรียน", { exact: true }).selectOption("2");
  await form.getByRole("button", { name: "สร้างห้อง", exact: true }).click();
  await expect(page.getByText(className, { exact: true })).toBeVisible();
  const line = page
    .getByText(className, { exact: true })
    .locator("..")
    .locator("..");
  await line.getByRole("button", { name: "มอบหมายโจทย์", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const cls = (
    await (await request.get("/api/teacher/classes", { headers: h })).json()
  ).classes.find((c: { name: string }) => c.name === className);
  expect(cls.assigned).toBe(1);
  const newId = "67" + String(Date.now()).slice(-8);
  expect(
    (
      await request.post("/api/teacher/students", {
        headers: h,
        data: {
          studentId: newId,
          name: "นักศึกษาเข้าห้องด้วยรหัส",
          password,
          classId: null,
        },
      })
    ).status(),
  ).toBe(201);
  const student = await login(request, newId, password);
  expect(student.user.needsClass).toBe(true);
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("mipslab.token", token);
    localStorage.setItem("mipslab.user", JSON.stringify(user));
    localStorage.setItem("mipslab.tour.problems", "1");
  }, student);
  await page.goto("/problems");
  await expect(
    page.getByText("เข้าห้องเรียนก่อนเริ่มใช้งาน", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "รหัสเข้าห้อง", exact: true })
    .fill(cls.code);
  await page.getByRole("button", { name: "เข้าห้อง", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "โจทย์ฝึก", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "งานที่ได้รับมอบหมาย" }),
  ).toBeVisible();
});
