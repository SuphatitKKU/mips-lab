import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PROBLEMS } from "../src/data/problems";
import { grade } from "../src/lib/grader";
import { hashPassword, randomToken } from "../cloudflare/password";
import { academicYearNow } from "../cloudflare/domain";
const remote = process.argv.includes("--remote"),
  mode = remote ? "remote" : "local";
mkdirSync("private", { recursive: true });
const credentialPath = `private/${mode}-admin.json`;
const credentials = existsSync(credentialPath)
  ? JSON.parse(readFileSync(credentialPath, "utf8"))
  : { username: "admin", password: randomToken().slice(0, 24) };
if (!existsSync(credentialPath))
  writeFileSync(credentialPath, JSON.stringify(credentials, null, 2) + "\n");
const quote = (v: string) => "'" + v.replace(/'/g, "''") + "'";
const hash = await hashPassword(credentials.password),
  now = Date.now();
const lines = [
  `INSERT OR IGNORE INTO users (student_id,name,role,pw_hash,created_at) VALUES ('admin','ผู้ดูแล MIPS Lab','teacher',${quote(hash)},${now});`,
];
for (const p of PROBLEMS) {
  const source = p.answer.code.find((c) => c.lang === p.kind)!.lines.join("\n"),
    result = grade(p, source, true);
  if (result.errors.length || result.passed !== result.total)
    throw new Error(`Reference answer #${p.id} failed`);
  lines.push(
    `INSERT OR IGNORE INTO problems (id,body,published,section,created_at,updated_at) VALUES (${p.id},${quote(JSON.stringify(p))},1,'',${now},${now});`,
  );
}
lines.push(
  `UPDATE settings SET value=${quote(String(academicYearNow()))} WHERE key='academicYear';`,
);
const sqlPath = `private/seed-${mode}.sql`;
writeFileSync(sqlPath, lines.join("\n") + "\n");
const result = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "mips-lab-db",
    remote ? "--remote" : "--local",
    "--file",
    sqlPath,
    "--yes",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  `Seeded ${PROBLEMS.length} exercises. Admin credentials: ${credentialPath} (gitignored). Existing accounts are never overwritten.`,
);
