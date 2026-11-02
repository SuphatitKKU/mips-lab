import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { EDUCATION_EXAMPLES } from "../src/lib/cc/examples";
test("new C examples convert, explain and run in the actual browser workspace", async ({
  page,
  request,
}) => {
  const account = JSON.parse(readFileSync("private/local-admin.json", "utf8"));
  const response = await request.post("/api/auth/password", { data: account });
  expect(response.status()).toBe(200);
  const { token, user } = await response.json();
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem("mipslab.token", token);
      localStorage.setItem("mipslab.user", JSON.stringify(user));
      for (const key of ["home", "code-convert", "code-run"])
        localStorage.setItem("mipslab.tour." + key, "1");
    },
    { token, user },
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/code?mode=convert");
  await expect(page.getByLabel("โค้ดตัวอย่าง")).toBeVisible();
  // The introductory tour is optional and must not obscure the controls under test.
  const skip = page.getByRole("button", { name: "ข้าม", exact: true });
  if (await skip.isVisible()) await skip.click();
  for (const example of EDUCATION_EXAMPLES) {
    await page.getByLabel("โค้ดตัวอย่าง").selectOption(example.key);
    await expect(
      page.getByRole("textbox", { name: "โค้ด C", exact: true }),
    ).toHaveValue(example.source);
    await expect(
      page.getByRole("region", { name: "MIPS ที่ได้" }),
    ).toContainText("jr");
  }
  await page.getByRole("tab", { name: /รันทีละขั้น/ }).click();
  await page
    .getByRole("button", { name: "ตัวเลือกการรัน", exact: true })
    .click();
  await page.getByText("รันจนจบ", { exact: true }).click();
  await expect(
    page.getByText("จบแล้ว", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: /แปลงโค้ด/ }).click();
  await page
    .getByRole("textbox", { name: "โค้ด C", exact: true })
    .fill("int f(){\n  float x=1.5;\n  return 0;\n}");
  await expect(page.getByText(/ยังไม่รองรับ float/).first()).toBeVisible();
  expect(errors).toEqual([]);
  await request.post("/api/auth/logout", {
    headers: { authorization: "Bearer " + token },
    data: {},
  });
});
