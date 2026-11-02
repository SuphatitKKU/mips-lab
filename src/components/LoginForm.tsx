import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../auth";
import { Icon, ICON } from "./Icon";
import { usePopup } from "./Popup";
import { Segmented } from "./ui";
import { googleIdToken } from "../lib/firebaseLogin";

export function LoginForm({
  returnTo,
  onTitleChange,
}: {
  returnTo?: string;
  onTitleChange?: (title: string) => void;
}) {
  const { loginPassword, loginGoogle, registerStudent } = useAuth();
  const navigate = useNavigate();
  const popup = usePopup();
  const [role, setRole] = useState<Role>("student");
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [classCode, setClassCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function changeMode(register: boolean) {
    setSignup(register);
    setError("");
    setPassword("");
    setConfirmPassword("");
    onTitleChange?.(register ? "สมัครสมาชิกนักศึกษา" : "เข้าสู่ระบบ");
  }

  async function google() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await loginGoogle(await googleIdToken());
      navigate(
        returnTo?.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : "/",
        { replace: true },
      );
      popup.toast("เข้าสู่ระบบด้วย Google แล้ว", "ok");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (signup) {
        if (password !== confirmPassword)
          throw new Error("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
        await registerStudent({
          name,
          studentId: username,
          password,
          classCode,
        });
      } else await loginPassword(username, password);
      const destination =
        returnTo?.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : role === "teacher"
            ? "/teacher"
            : "/";
      navigate(destination, { replace: true });
      popup.toast(signup ? "สมัครสมาชิกสำเร็จแล้ว" : "เข้าสู่ระบบแล้ว", "ok");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-content" data-tour-page="login">
      <p className="login-description">
        {role === "teacher"
          ? "อาจารย์ใช้ชื่อผู้ใช้และรหัสผ่านเท่านั้น"
          : signup
            ? "สมัครด้วยรหัสนักศึกษา แล้วเข้าห้องเรียนด้วยรหัสจากอาจารย์"
            : "เข้าสู่ระบบ สมัครสมาชิกใหม่ หรือใช้บัญชี Google"}
      </p>
      <Segmented
        label="ประเภทบัญชี"
        value={role}
        onChange={(value) => {
          setRole(value);
          changeMode(false);
        }}
        options={[
          { value: "student", label: "นักศึกษา", disabled: busy },
          { value: "teacher", label: "อาจารย์", disabled: busy },
        ]}
      />
      <form
        onSubmit={submit}
        className="login-form"
        aria-label={signup ? "สมัครสมาชิกนักศึกษา" : "เข้าสู่ระบบด้วยรหัสผ่าน"}
      >
        {signup && (
          <label className="field">
            ชื่อ–นามสกุล
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>
        )}
        <label className="field">
          {role === "student" ? "รหัสนักศึกษา" : "ชื่อผู้ใช้"}
          <input
            className="input"
            aria-label={role === "student" ? "รหัสนักศึกษา" : "ชื่อผู้ใช้"}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            maxLength={signup ? 14 : 64}
            pattern={signup ? "[0-9]{9,12}(-[0-9])?" : undefined}
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
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 10 : undefined}
            maxLength={128}
            required
          />
        </label>
        {signup && (
          <>
            <span className="login-field-help">รหัสผ่าน 10–128 ตัวอักษร</span>
            <label className="field">
              ยืนยันรหัสผ่าน
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            <label className="field">
              รหัสเข้าห้อง (ไม่บังคับ)
              <input
                className="input"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                autoComplete="off"
                maxLength={6}
                minLength={6}
                placeholder="รหัส 6 ตัวจากอาจารย์"
              />
              <span className="login-field-help">
                เว้นว่างไว้ แล้วเข้าห้องภายหลังได้
              </span>
            </label>
          </>
        )}
        {error && (
          <div className="notice err" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          aria-busy={busy}
        >
          {busy
            ? signup
              ? "กำลังสมัครสมาชิก…"
              : "กำลังเข้าสู่ระบบ…"
            : signup
              ? "สมัครสมาชิก"
              : "เข้าสู่ระบบ"}
          {!busy && <Icon d={ICON.arrowRight} size={18} />}
        </button>
      </form>
      {role === "student" && (
        <p className="login-switch">
          {signup ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?"}{" "}
          <button
            type="button"
            className="login-link"
            disabled={busy}
            onClick={() => changeMode(!signup)}
          >
            {signup ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </button>
        </p>
      )}
      {role === "student" && (
        <p className="login-help">
          มีบัญชีและคะแนนเดิมอยู่แล้ว? เข้าด้วยรหัสผ่าน แล้วเชื่อม Google
          ในหน้าตั้งค่า
        </p>
      )}
      {role === "student" && (
        <>
          <div className="login-divider" aria-hidden="true">
            <span>หรือ</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary login-google"
            disabled={busy}
            aria-busy={busy}
            onClick={google}
          >
            <img
              src="/branding/google-g-logo.png"
              width="20"
              height="20"
              alt=""
              aria-hidden="true"
            />
            เข้าสู่ระบบด้วย Google
          </button>
        </>
      )}
    </div>
  );
}
