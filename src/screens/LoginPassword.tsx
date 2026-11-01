import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../auth";
import { PageHeader, Segmented } from "../components/ui";
import { usePopup } from "../components/Popup";
export function Login() {
  const { loggedIn, loginPassword } = useAuth(),
    navigate = useNavigate(),
    popup = usePopup(),
    from = (useLocation().state as { from?: string } | null)?.from;
  const [role, setRole] = useState<Role>("student"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await loginPassword(username, password);
      navigate(from ?? (role === "teacher" ? "/teacher" : "/"), {
        replace: true,
      });
      popup.toast("เข้าสู่ระบบแล้ว", "ok");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loggedIn)
    return (
      <Navigate to={from ?? (role === "teacher" ? "/teacher" : "/")} replace />
    );
  return (
    <main className="login-page">
      <div className="login-intro">
        <span className="login-wordmark">
          MIPS Lab<span>01 / LEARN BY DOING</span>
        </span>
        <div>
          <p className="login-kicker">COMPUTER ARCHITECTURE LAB</p>
          <h1>
            จากโค้ดหนึ่งบรรทัด
            <br />
            สู่ความเข้าใจ
            <br />
            <em>ทีละคำสั่ง</em>
          </h1>
          <p>
            เขียน C แปลงเป็น MIPS และดูการทำงานของ CPU
            <br />
            ฝึกโจทย์ รับผลตรวจ และติดตามพัฒนาการของคุณ
          </p>
        </div>
        <pre aria-hidden="true">
          {
            "sum:\n  addu $v0, $a0, $a1\n  jr   $ra\n\n# Understand every instruction."
          }
        </pre>
        <span className="login-footnote">C ⇄ MIPS · CPU SIMULATOR · Z80</span>
      </div>
      <section className="login-panel">
        <div className="login-panel-inner">
          <PageHeader
            title="เข้าสู่ห้องทดลอง"
            sub="พร้อมเรียนรู้ต่อจากครั้งก่อน"
          />
          <Segmented
            label="ประเภทบัญชี"
            value={role}
            onChange={(r) => {
              setRole(r);
              setError("");
            }}
            options={[
              { value: "student", label: "นักศึกษา" },
              { value: "teacher", label: "อาจารย์" },
            ]}
          />
          <form
            onSubmit={submit}
            style={{ display: "flex", flexDirection: "column", gap: 20 }}
          >
            <label className="field">
              {role === "student" ? "รหัสนักศึกษา" : "ชื่อผู้ใช้"}
              <input
                className="input"
                aria-label={role === "student" ? "รหัสนักศึกษา" : "ชื่อผู้ใช้"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              รหัสผ่าน
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <div className="notice err" role="alert">
                {error}
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ height: 52 }}
              disabled={busy}
            >
              {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </button>
          </form>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.8 }}>
            ใช้บัญชีที่อาจารย์สร้างให้ หากยังไม่มีบัญชีหรือลืมรหัสผ่าน
            ติดต่ออาจารย์ประจำรายวิชา
          </p>
          <div className="login-google-note">
            Google login จะเปิดใช้งานภายหลัง
          </div>
        </div>
      </section>
    </main>
  );
}
