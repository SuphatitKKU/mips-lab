import { useState } from "react";
import { api } from "../api";
import { useAuth, type Me } from "../auth";
import { googleIdToken } from "../lib/firebaseLogin";
import { usePopup } from "./Popup";

export function GoogleAccountLink() {
  const { user, updateUser } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const popup = usePopup();
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const idToken = await googleIdToken();
      const result = await api<{ user: Me }>("/profile/google", {
        body: { idToken },
      });
      updateUser(result.user);
      popup.toast(
        "เชื่อมต่อ Google แล้ว ใช้ Google เข้าบัญชีเดิมได้ทันที",
        "ok",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (user?.role === "teacher") return null;
  return (
    <section
      aria-label="เชื่อมต่อ Google"
      className="card"
      style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <h2>เข้าสู่ระบบด้วย Google</h2>
      <p>
        {user?.googleLinked
          ? `เชื่อมต่อแล้ว · ${user.email}`
          : "เชื่อม Google กับบัญชีนี้ เพื่อเข้าบัญชีเดิมพร้อมห้องเรียน คะแนน และบทบาทเดิม"}
      </p>
      {!user?.googleLinked && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={connect}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อบัญชี Google"}
        </button>
      )}
      {error && (
        <div role="alert" className="notice err">
          {error}
        </div>
      )}
    </section>
  );
}
