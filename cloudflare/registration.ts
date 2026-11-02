import { Store, type User } from "./store";
import { Classroom, ClassroomError } from "./classroom";
import { digest, hashPassword } from "./password";

export class StudentRegistration {
  constructor(readonly s: Store) {}
  async create(body: Record<string, unknown>, ip: string): Promise<User> {
    if (body.role !== undefined && body.role !== "student")
      throw new ClassroomError(400, "สมัครสมาชิกได้เฉพาะบัญชีนักศึกษา");
    const name = typeof body.name === "string" ? body.name.trim() : "",
      rawId = typeof body.studentId === "string" ? body.studentId.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
      throw new ClassroomError(400, "กรอกชื่อ–นามสกุลไม่เกิน 80 ตัวอักษร");
    if (!/^\d{9,12}(?:-\d)?$/.test(rawId))
      throw new ClassroomError(
        400,
        "รหัสนักศึกษาต้องเป็นตัวเลข 9–12 หลัก อนุญาตขีดและเลขตรวจสอบ",
      );
    if (password.length < 10 || password.length > 128)
      throw new ClassroomError(400, "รหัสผ่านต้องยาว 10–128 ตัว");
    const now = Date.now(),
      key = await digest("signup|" + ip);
    const count = await this.s.first<{ failures: number }>(
      `INSERT INTO login_limits(key,failures,until_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_at>? THEN failures+1 ELSE 1 END,
      until_at=CASE WHEN until_at>? THEN until_at ELSE excluded.until_at END RETURNING failures`,
      key,
      now + 3600000,
      now,
      now,
    );
    if (count && count.failures > 100)
      throw new ClassroomError(429, "สมัครสมาชิกบ่อยเกินไป กรุณารอแล้วลองใหม่");
    const studentId = rawId.replace(/-/g, "");
    if (
      await this.s.first(
        "SELECT id FROM users WHERE REPLACE(student_id,'-','')=?",
        studentId,
      )
    )
      throw new ClassroomError(
        409,
        "สมัครบัญชีนี้ไม่ได้ กรุณาเข้าสู่ระบบด้วยบัญชีเดิมหรือติดต่ออาจารย์",
      );
    const classroom = new Classroom(this.s),
      code =
        typeof body.classCode === "string"
          ? body.classCode.trim().toUpperCase()
          : "";
    let selected: { id: number; name: string } | null = null;
    if (code) {
      selected = await this.s.first(
        "SELECT id,name FROM classes WHERE code=? AND archived=0",
        code,
      );
      if (!selected)
        throw new ClassroomError(400, "รหัสเข้าห้องไม่ถูกต้องหรือห้องปิดแล้ว");
    }
    const hash = await hashPassword(password);
    const result = await this.s
      .stmt(
        `INSERT OR IGNORE INTO users(student_id,name,section,role,pw_hash,class_id,created_at) VALUES(?,?,?,'student',?,?,?)`,
        studentId,
        name,
        selected?.name ?? "",
        hash,
        selected?.id ?? null,
        now,
      )
      .run();
    if (!result.meta.changes)
      throw new ClassroomError(
        409,
        "สมัครบัญชีนี้ไม่ได้ กรุณาเข้าสู่ระบบด้วยบัญชีเดิมหรือติดต่ออาจารย์",
      );
    const user = (await this.s.first<User>(
      "SELECT * FROM users WHERE id=?",
      result.meta.last_row_id,
    ))!;
    if (selected)
      await this.s.stmt("DELETE FROM roster WHERE ident=?", studentId).run();
    return await classroom.claim(user);
  }
}
