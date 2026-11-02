import { initializeApp, getApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  browserPopupRedirectResolver,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: inMemoryPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
export async function googleIdToken(): Promise<string> {
  try {
    const result = await signInWithPopup(auth, provider);
    return await result.user.getIdToken(true);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    )
      throw new Error("ปิดหน้าต่าง Google แล้ว ลองอีกครั้งได้เมื่อต้องการ");
    if (code === "auth/popup-blocked")
      throw new Error(
        "เบราว์เซอร์บล็อกหน้าต่าง Google กรุณาอนุญาตป๊อปอัปแล้วลองใหม่",
      );
    if (code === "auth/unauthorized-domain")
      throw new Error(
        "โดเมนนี้ยังไม่ได้รับอนุญาตให้เข้าสู่ระบบด้วย Google กรุณาติดต่อผู้ดูแล",
      );
    if (code === "auth/network-request-failed")
      throw new Error(
        "เชื่อมต่อ Google ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่",
      );
    throw new Error("เข้าสู่ Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  } finally {
    // Firebase establishes identity; the application continues with its own D1 session.
    await signOut(auth).catch(() => undefined);
  }
}
