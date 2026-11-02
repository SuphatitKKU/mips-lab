import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { firebaseConfig } from "../src/lib/firebaseConfig";
import { Store, type User } from "./store";
import { digest } from "./password";

const keys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
export class GoogleLoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface GoogleIdentity {
  uid: string;
  email: string;
  name: string;
}
export async function verifyFirebaseGoogle(
  idToken: string,
  keySet: JWTVerifyGetKey = keys,
  projectId: string = firebaseConfig.projectId,
): Promise<GoogleIdentity> {
  try {
    if (!idToken || idToken.length > 16000) throw new Error();
    const { payload } = await jwtVerify(idToken, keySet, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: [
        "exp",
        "iat",
        "sub",
        "auth_time",
        "email",
        "email_verified",
        "firebase",
      ],
    });
    const now = Math.floor(Date.now() / 1000),
      authTime = payload.auth_time;
    const provider = payload.firebase as { sign_in_provider?: unknown };
    if (
      !payload.sub ||
      payload.sub.length > 128 ||
      typeof payload.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      payload.email.length > 254 ||
      payload.email_verified !== true ||
      provider?.sign_in_provider !== "google.com" ||
      typeof authTime !== "number" ||
      authTime > now + 30 ||
      authTime < now - 600 ||
      !payload.iat ||
      payload.iat > now + 30
    )
      throw new Error();
    return {
      uid: payload.sub,
      email: payload.email.toLowerCase(),
      name:
        typeof payload.name === "string"
          ? payload.name.trim().slice(0, 80)
          : payload.email.split("@")[0],
    };
  } catch {
    throw new GoogleLoginError(
      401,
      "ยืนยันบัญชี Google ไม่สำเร็จ กรุณาเข้าสู่ Google ใหม่อีกครั้ง",
    );
  }
}

export class GoogleAccounts {
  constructor(
    readonly s: Store,
    readonly verify = verifyFirebaseGoogle,
  ) {}
  async login(idToken: string) {
    const identity = await this.verify(idToken);
    let user = await this.s.first<User>(
      "SELECT * FROM users WHERE firebase_uid=?",
      identity.uid,
    );
    if (user) {
      if (!user.active)
        throw new GoogleLoginError(403, "บัญชีนี้ถูกปิด กรุณาติดต่ออาจารย์");
      if (user.role === "teacher")
        throw new GoogleLoginError(
          403,
          "บัญชีอาจารย์ต้องเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านเท่านั้น",
        );
      return { user, created: false };
    }
    // An email address or student ID alone must never take over an existing account.
    if (
      await this.s.first(
        "SELECT id FROM users WHERE lower(email)=?",
        identity.email,
      )
    )
      throw new GoogleLoginError(
        409,
        "อีเมลนี้มีบัญชีเดิมอยู่แล้ว เข้าด้วยรหัสผ่านแล้วเชื่อมต่อ Google ในหน้าตั้งค่า",
      );
    const username = "g_" + (await digest(identity.uid)).slice(0, 28);
    const r = await this.s
      .stmt(
        "INSERT INTO users(student_id,name,section,email,role,pw_hash,created_at,firebase_uid) VALUES (?,?,'',?,'student','',?,?)",
        username,
        identity.name || identity.email,
        identity.email,
        Date.now(),
        identity.uid,
      )
      .run();
    user = (await this.s.first<User>(
      "SELECT * FROM users WHERE id=?",
      r.meta.last_row_id,
    ))!;
    return { user, created: true };
  }
  async link(user: User, idToken: string) {
    if (user.role === "teacher")
      throw new GoogleLoginError(
        403,
        "บัญชีอาจารย์ใช้รหัสผ่านเท่านั้น ไม่รองรับการเชื่อม Google",
      );
    const identity = await this.verify(idToken);
    if (user.firebase_uid && user.firebase_uid !== identity.uid)
      throw new GoogleLoginError(
        409,
        "บัญชีนี้เชื่อมกับ Google อีกบัญชีอยู่แล้ว",
      );
    if (
      await this.s.first(
        "SELECT id FROM users WHERE id<>? AND (firebase_uid=? OR lower(email)=?)",
        user.id,
        identity.uid,
        identity.email,
      )
    )
      throw new GoogleLoginError(
        409,
        "Google บัญชีนี้เชื่อมกับบัญชีอื่นอยู่แล้ว กรุณาติดต่ออาจารย์",
      );
    await this.s
      .stmt(
        "UPDATE users SET firebase_uid=?,email=? WHERE id=?",
        identity.uid,
        identity.email,
        user.id,
      )
      .run();
    return { ...user, firebase_uid: identity.uid, email: identity.email };
  }
}
