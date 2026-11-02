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
assert.ok(overview.problems.length >= PROBLEMS.length);
const studentsBefore = overview.students.filter((s: any) => s.role === 'student').length;
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
const extendedSource = 'void calculate(int*p,int n){int a=1;for(int i=2;i<=n;i++)a*=i;*p=a;} int fact(int n){int m[2][2]={{n,0},{1,0}};int value=0;calculate(&value,m[0][0]);switch(sizeof(m)/sizeof(m[0][0])){case 4:return value;default:return 0;}}';
const extended = await request('/problems/3/submit', token, {code:extendedSource});
assert.equal(extended.pass,true,'Extended C features must grade on the production edge');
assert.equal(extended.awarded,null,'Instructor validation must not award student points');
assert.equal((await request('/teacher/overview',token)).students.filter((s:any)=>s.role==='student').length,studentsBefore);
console.log(`Production switch/sizeof/address/matrix and hidden cases: ${extended.passed}/${extended.total} passed`);
await request("/auth/logout", token, {});
console.log(
  "Production D1, password login, instructor dashboard, MIPS/C/Z80 grading and logout verified. No student accounts or scores created.",
);
