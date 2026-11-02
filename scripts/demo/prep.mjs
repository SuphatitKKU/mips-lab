import { BASE, TEACHER, STUDENT } from "./lib.mjs";

const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, {
    ...opt,
    headers: {
      "content-type": "application/json",
      ...(opt.headers ?? {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
};

const auth = await j("/api/auth/password", {
  method: "POST",
  body: JSON.stringify({ username: TEACHER.user, password: TEACHER.pass }),
});
if (auth.status !== 200) throw new Error("admin login failed: " + JSON.stringify(auth));
const token = auth.body.token;
const h = { authorization: "Bearer " + token };

const made = await j("/api/teacher/students", {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    studentId: STUDENT.id,
    name: STUDENT.name,
    password: STUDENT.pass,
  }),
});
console.log("student:", made.status, JSON.stringify(made.body).slice(0, 300));

const check = await j("/api/auth/password", {
  method: "POST",
  body: JSON.stringify({ username: STUDENT.id, password: STUDENT.pass }),
});
console.log("student login:", check.status);
