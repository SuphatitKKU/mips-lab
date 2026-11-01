import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PROBLEMS } from "../src/data/problems";
const base = "https://mips-lab-kku.pages.dev";
const account = JSON.parse(readFileSync("private/remote-admin.json", "utf8"));
async function request(path: string, token?: string, body?: unknown) {
  const response = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`);
  return data as any;
}
assert.equal((await request("/health")).database, "D1");
const config = await request("/auth/config");
assert.equal(config.googleClientId, null);
assert.equal(config.devLogin, false);
const { token } = await request("/auth/password", undefined, account);
// The login contract is username/password. Never print credentials or session tokens.
const overview = await request("/teacher/overview", token);
assert.equal(overview.problems.length, 24);
assert.equal(
  overview.students.filter((s: any) => s.role === "student").length,
  0,
);
for (const id of [1, 2, 3, 4, 7, 24]) {
  const p = PROBLEMS.find((p) => p.id === id)!;
  const result = await request(`/problems/${id}/test`, token, {
    code: p.answer.code.find((c) => c.lang === p.kind)!.lines.join("\n"),
  });
  assert.equal(result.pass, true, `Reference #${id} failed on production`);
  console.log(
    `Production grading #${id} ${p.kind}: ${result.passed}/${result.total} passed`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
}
await request("/auth/logout", token, {});
console.log(
  "Production D1, password login, instructor dashboard, MIPS/C/Z80 grading and logout verified. No student accounts or scores created.",
);
