import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Store, type User } from "../cloudflare/store";
import { StudentRegistration } from "../cloudflare/registration";
import { checkPassword, digest } from "../cloudflare/password";
import { onRequest } from "../functions/api/[[path]]";
import { GoogleAccounts, type GoogleIdentity } from "../cloudflare/firebase";

describe("Firebase identities use the existing D1 classroom accounts", () => {
  let db: DatabaseSync, s: Store;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    for (const f of [
      "0001_d1.sql",
      "0002_classroom.sql",
      "0003_firebase_google.sql",
    ])
      db.exec(readFileSync(`migrations/${f}`, "utf8"));
    const adapter = {
      prepare: (sql: string) => ({
        bind: (...args: (string | number | null)[]) => ({
          first: async () => db.prepare(sql).get(...args) ?? null,
          all: async () => ({ results: db.prepare(sql).all(...args) }),
          run: async () => {
            const r = db.prepare(sql).run(...args);
            return {
              meta: {
                last_row_id: Number(r.lastInsertRowid),
                changes: Number(r.changes),
              },
            };
          },
        }),
      }),
    };
    s = new Store(adapter as unknown as ConstructorParameters<typeof Store>[0]);
  });
  const identity: GoogleIdentity = {
    uid: "google-uid-42",
    email: "student@example.com",
    name: "นักศึกษา Google",
  };
  const account = async (
    role = "student",
    email: string | null = null,
    studentId?: string,
  ) => {
    await s
      .stmt(
        "INSERT INTO users(student_id,name,role,pw_hash,email,created_at) VALUES(?,?,?,?,?,?)",
        studentId ?? (role === "teacher" ? "teacher.test" : "663040999-1"),
        "บัญชีเดิม",
        role,
        "existing-password-hash",
        email,
        1,
      )
      .run();
    return (await s.first<User>(
      "SELECT * FROM users ORDER BY id DESC LIMIT 1",
    ))!;
  };
  it("creates only student accounts and recognizes the same Firebase UID on later sign-ins", async () => {
    const google = new GoogleAccounts(s, async () => identity),
      first = await google.login("verified-token"),
      second = await google.login("verified-token");
    expect(first.created).toBe(true);
    expect(first.user.role).toBe("student");
    expect(first.user.pw_hash).toBe("");
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(db.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
  });
  it("links a signed-in existing account without changing its scores, password, or identity", async () => {
    const user = await account();
    db.exec(
      "INSERT INTO problems(id,body,created_at,updated_at) VALUES(1,'{}',1,1)",
    );
    db.prepare(
      "INSERT INTO solves(user_id,problem_id,points,first_try,solved_at) VALUES(?,1,35,1,1)",
    ).run(user.id);
    const google = new GoogleAccounts(s, async () => identity),
      linked = await google.link(user, "verified-token"),
      login = await google.login("verified-token");
    expect(linked.id).toBe(user.id);
    expect(linked.student_id).toBe(user.student_id);
    expect(login.user.id).toBe(user.id);
    expect(login.user.pw_hash).toBe("existing-password-hash");
    expect(
      db.prepare("SELECT points FROM solves WHERE user_id=?").get(user.id)
        ?.points,
    ).toBe(35);
  });
  it("does not take over an existing account based on email alone", async () => {
    const user = await account("student", identity.email),
      google = new GoogleAccounts(s, async () => identity);
    await expect(google.login("verified-token")).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await s.first<User>("SELECT * FROM users WHERE id=?", user.id))
        ?.firebase_uid,
    ).toBeNull();
  });
  it("requires passwords for teachers, including accounts linked to Google before this policy", async () => {
    const teacher = await account("teacher"),
      google = new GoogleAccounts(s, async () => identity);
    await expect(google.link(teacher, "verified-token")).rejects.toMatchObject({
      status: 403,
    });
    await s
      .stmt(
        "UPDATE users SET firebase_uid=? WHERE id=?",
        identity.uid,
        teacher.id,
      )
      .run();
    await expect(google.login("verified-token")).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await s.first<User>("SELECT * FROM users WHERE id=?", teacher.id))?.role,
    ).toBe("teacher");
  });
  it("rejects a second account trying to link a UID and rejects disabled accounts", async () => {
    const first = await account(),
      google = new GoogleAccounts(s, async () => identity);
    await google.link(first, "verified-token");
    const second = await account("student", null, "663040998-1");
    await expect(google.link(second, "verified-token")).rejects.toMatchObject({
      status: 409,
    });
    await s.stmt("UPDATE users SET active=0 WHERE id=?", first.id).run();
    await expect(google.login("verified-token")).rejects.toMatchObject({
      status: 403,
    });
  });
  it("lets a new Google student set their student ID once and claim the pending class", async () => {
    const google = new GoogleAccounts(s, async () => identity),
      created = await google.login("verified-token");
    db.exec(
      "INSERT INTO classes(id,name,year,term,code,created_at) VALUES(1,'SEC TEST',2569,2,'K7Q2XM',1)",
    );
    db.prepare("INSERT INTO roster(ident,class_id,added_at) VALUES(?,1,1)").run(
      "6630401111",
    );
    const session = await s.session(created.user);
    const call = async (studentId: string) => {
      const request = new Request("http://localhost/api/profile", {
        method: "PUT",
        headers: {
          authorization: "Bearer " + session,
          "content-type": "application/json",
        },
        body: JSON.stringify({ studentId }),
      });
      return await onRequest({ request, env: { DB: s.db } } as Parameters<
        typeof onRequest
      >[0]);
    };
    const response = await call("6630401111");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { classId: number; needsClass: boolean; hasPassword: boolean };
    };
    expect(body.user).toMatchObject({
      classId: 1,
      needsClass: false,
      hasPassword: false,
    });
    expect((await call("6630401112")).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) n FROM roster").get()?.n).toBe(0);
  });
  it("never merges a new Google account into someone else's existing student ID", async () => {
    const existing = await account(),
      google = new GoogleAccounts(s, async () => identity),
      created = await google.login("verified-token"),
      session = await s.session(created.user);
    const request = new Request("http://localhost/api/profile", {
      method: "PUT",
      headers: {
        authorization: "Bearer " + session,
        "content-type": "application/json",
      },
      body: JSON.stringify({ studentId: existing.student_id }),
    });
    const response = await onRequest({
      request,
      env: { DB: s.db },
    } as Parameters<typeof onRequest>[0]);
    expect(response.status).toBe(409);
    expect(
      (await s.first<User>("SELECT * FROM users WHERE id=?", existing.id))
        ?.firebase_uid,
    ).toBeNull();
  });
  it("self-registration hashes passwords, grants student permissions only, and joins an open class", async () => {
    db.exec(
      "INSERT INTO classes(id,name,year,term,code,created_at) VALUES(1,'SEC REGISTER',2569,2,'K7Q2XM',1)",
    );
    const signup = new StudentRegistration(s);
    await expect(
      signup.create(
        {
          name: "ทดสอบ",
          studentId: "663040111-1",
          password: "Registration-test-42",
          role: "teacher",
        },
        "test-ip",
      ),
    ).rejects.toMatchObject({ status: 400 });
    const user = await signup.create(
      {
        name: "นักศึกษาสมัครเอง",
        studentId: "663040111-1",
        password: "Registration-test-42",
        classCode: "k7q2xm",
        firebase_uid: "cannot-set-this",
        active: false,
      },
      "test-ip",
    );
    expect(user).toMatchObject({
      student_id: "6630401111",
      role: "student",
      class_id: 1,
      active: 1,
      firebase_uid: null,
    });
    expect(user.pw_hash).not.toBe("Registration-test-42");
    expect(await checkPassword("Registration-test-42", user.pw_hash)).toBe(
      true,
    );
  });
  it("rejects duplicate student IDs with or without a dash and rejects bad class codes without creating accounts", async () => {
    const original = await account(),
      signup = new StudentRegistration(s);
    await expect(
      signup.create(
        {
          name: "ผู้สมัคร",
          studentId: original.student_id.replace(/-/g, ""),
          password: "Registration-test-42",
        },
        "test-ip",
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      signup.create(
        {
          name: "ผู้สมัคร",
          studentId: "6630401111",
          password: "Registration-test-42",
          classCode: "BAD123",
        },
        "test-ip",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(1);
  });
  it("claims a pending roster on registration and permits joining the class later when no code is provided", async () => {
    db.exec(
      "INSERT INTO classes(id,name,year,term,code,created_at) VALUES(1,'SEC REGISTER',2569,2,'K7Q2XM',1)",
    );
    db.prepare("INSERT INTO roster(ident,class_id,added_at) VALUES(?,1,1)").run(
      "6630401111",
    );
    const signup = new StudentRegistration(s),
      listed = await signup.create(
        {
          name: "มีรายชื่อ",
          studentId: "6630401111",
          password: "Registration-test-42",
        },
        "test-ip",
      );
    expect(listed.class_id).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM roster").get()?.n).toBe(0);
    const unassigned = await signup.create(
      {
        name: "ยังไม่มีห้อง",
        studentId: "6630401112",
        password: "Registration-test-42",
      },
      "test-ip",
    );
    expect(unassigned.class_id).toBeNull();
  });
  it("validates password length and limits registration attempts", async () => {
    const signup = new StudentRegistration(s);
    await expect(
      signup.create(
        { name: "ผู้สมัคร", studentId: "6630401111", password: "short" },
        "test-ip",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await s
      .stmt(
        "INSERT INTO login_limits VALUES(?,100,?)",
        await digest("signup|test-ip"),
        Date.now() + 3600000,
      )
      .run();
    await expect(
      signup.create(
        {
          name: "ผู้สมัคร",
          studentId: "6630401111",
          password: "Registration-test-42",
        },
        "test-ip",
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(db.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
  });
});
