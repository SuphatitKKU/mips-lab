import { lazy, Suspense } from "react";
import { JoinClass } from "../components/JoinClass";
import { useEffect, useState, type FormEvent } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { api, ApiError, useApi } from "../api";
import { ROLE_LABEL, useAuth, type Me } from "../auth";
import { Icon, ICON } from "../components/Icon";
import { usePopup } from "../components/Popup";
import { ErrorBox, PageHeader, Skeleton } from "../components/ui";

/** Matches server STUDENT_ID_RE: a real student id is locked once set. */
const STUDENT_ID_RE = /^\d[\d-]{4,18}\d$/;

const GoogleAccountLink = lazy(() =>
  import("../components/GoogleAccountLink").then((m) => ({
    default: m.GoogleAccountLink,
  })),
);

export function Settings() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const popup = usePopup();
  const { data, error, reload } = useApi<{ user: Me; sections: string[] }>(
    "/profile",
  );
  const me = data?.user ?? user;
  const isTeacher = me?.role === "teacher";
  const idLocked = isTeacher || (!!me && STUDENT_ID_RE.test(me.studentId));

  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reloading, setReloading] = useState(false); // saved, waiting for the fresh profile

  // fill the form once the fresh profile arrives
  useEffect(() => {
    if (!data) return;
    setReloading(false);
    setName(data.user.name);
    // teachers edit their username here; students only see a real student id (not the email fallback)
    setStudentId(
      data.user.role === "teacher" || STUDENT_ID_RE.test(data.user.studentId)
        ? data.user.studentId
        : "",
    );
    setSection(data.user.section);
  }, [data]);

  const dirty =
    !!data &&
    (name.trim() !== data.user.name ||
      (!isTeacher && section.trim() !== data.user.section) ||
      (!idLocked &&
        studentId.trim() !== "" &&
        studentId.trim().toLowerCase() !== data.user.studentId.toLowerCase()));

  // leaving with unsaved edits asks first (signing out never does — that's its own confirm)
  const guard = dirty && !busy && !reloading;
  const blocker = useBlocker(
    ({ nextLocation }) => guard && nextLocation.pathname !== "/login",
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void popup
      .confirm({
        title: "ออกโดยไม่บันทึก?",
        body: "ข้อมูลที่แก้ไว้ในหน้านี้จะหายไป",
        ok: "ออกโดยไม่บันทึก",
        cancel: "อยู่ต่อ",
      })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);
  useEffect(() => {
    if (!guard) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || busy) return;
    setErr("");
    setBusy(true);
    try {
      const body: Record<string, string> = { name };

      if (!idLocked && studentId.trim()) body.studentId = studentId;
      const r = await api<{ user: Me }>("/profile", { method: "PUT", body });
      updateUser(r.user);
      setReloading(true);
      reload();
      popup.toast("บันทึกโปรไฟล์แล้ว", "ok");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (
      !(await popup.confirm({
        title: "ออกจากระบบ?",
        body: `${me?.name ?? ""} · ${me?.email ?? me?.studentId ?? ""}`,
        ok: "ออกจากระบบ",
      }))
    )
      return;
    await logout();
    navigate("/login");
    popup.toast("ออกจากระบบแล้ว");
  };

  return (
    <>
      <PageHeader
        title="ตั้งค่าโปรไฟล์"
        sub="ข้อมูลที่อาจารย์และเพื่อนในกระดานอันดับเห็น"
      />
      <main className="main" style={{ maxWidth: 760 }}>
        {error && <ErrorBox error={error} onRetry={reload} />}

        <section
          aria-label="บัญชี"
          className="card"
          style={{
            padding: "24px 28px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              width: 64,
              height: 64,
              flex: "none",
              borderRadius: "50%",
              background: "var(--m)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--head)",
              fontSize: 22,
              fontWeight: 500,
            }}
          >
            {me?.initials ?? ""}
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <b
                style={{
                  fontSize: 19,
                  fontFamily: "var(--head)",
                  fontWeight: 500,
                }}
              >
                {me?.name}
              </b>
              {me && <RoleChip role={me.role} />}
            </span>
            <span
              style={{
                fontSize: 14,
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {isTeacher
                ? `ชื่อผู้ใช้ ${me?.studentId ?? ""}`
                : "รหัสนักศึกษา " + (me?.studentId ?? "")}
              {!isTeacher && me?.section ? ` · ${me.section}` : ""}
            </span>
          </div>
        </section>

        {!data && !error ? (
          <Skeleton h={320} />
        ) : (
          <form
            aria-label="แก้ไขโปรไฟล์"
            className="card"
            onSubmit={save}
            style={{
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <h2 style={{ fontSize: 20 }}>ข้อมูลส่วนตัว</h2>

            <label className="field">
              ชื่อ–นามสกุล
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoComplete="name"
              />
            </label>

            {isTeacher && (
              <label className="field">
                ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)
                <input
                  className="input"
                  value={studentId}
                  disabled
                  onChange={(e) => setStudentId(e.target.value.toLowerCase())}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={32}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--muted)",
                  }}
                >
                  ติดต่ออาจารย์เพื่อแก้ชื่อผู้ใช้
                </span>
              </label>
            )}

            {!isTeacher && (
              <label className="field">
                รหัสนักศึกษา
                <input
                  className="input"
                  value={idLocked ? me!.studentId : studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={idLocked}
                  inputMode="numeric"
                  placeholder="เช่น 653040123-4"
                  maxLength={20}
                  style={idLocked ? { color: "var(--muted)" } : undefined}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--muted)",
                  }}
                >
                  {idLocked ? (
                    <>
                      <Icon
                        d={ICON.lock}
                        size={13}
                        style={{ verticalAlign: "-2px", marginRight: 4 }}
                      />
                      ตั้งแล้ว — ถ้าต้องแก้ ติดต่ออาจารย์
                    </>
                  ) : (
                    "ตั้งได้ครั้งเดียว ตรวจให้ถูกก่อนบันทึก"
                  )}
                </span>
              </label>
            )}

            {!isTeacher && (
              <label className="field">
                กลุ่มเรียน (section)
                <input
                  className="input"
                  value={section}
                  disabled
                  onChange={(e) => setSection(e.target.value)}
                  list="sections"
                  maxLength={40}
                  placeholder="เช่น SEC 1"
                />
                <datalist id="sections">
                  {data?.sections.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--muted)",
                  }}
                >
                  อาจารย์เป็นผู้กำหนดกลุ่มเรียน
                </span>
              </label>
            )}

            {!isTeacher && (
              <label className="field">
                อีเมล
                <input
                  className="input"
                  value={me?.email ?? "—"}
                  disabled
                  style={{ color: "var(--muted)" }}
                />
              </label>
            )}

            {err && (
              <div role="alert" className="notice err">
                <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
                <span>{err}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ height: 48, padding: "0 28px" }}
                disabled={!dirty || busy}
                aria-busy={busy}
              >
                บันทึก
              </button>
            </div>
          </form>
        )}

        {!isTeacher && data && (
          <section
            className="card"
            style={{
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
            aria-label="ห้องเรียน"
          >
            <h2>ห้องเรียน</h2>
            <p>
              {me?.section || "ยังไม่ได้เข้าห้อง"} · ใส่รหัสใหม่เพื่อย้ายห้อง
              คะแนนเดิมยังอยู่
            </p>
            <JoinClass label="ย้ายห้อง" onJoined={() => reload()} />
          </section>
        )}
        {data && !isTeacher && (
          <Suspense fallback={<Skeleton h={120} />}>
            <GoogleAccountLink />
          </Suspense>
        )}
        {data && me?.hasPassword !== false && <ChangePassword />}

        <section
          aria-label="ออกจากระบบ"
          className="card"
          style={{
            padding: "20px 28px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: 1, minWidth: 200, color: "var(--body-alt)" }}>
            ออกจากระบบบนเครื่องนี้
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: 44, gap: 8 }}
            onClick={signOut}
          >
            <Icon d={ICON.logout} size={18} />
            ออกจากระบบ
          </button>
        </section>
      </main>
    </>
  );
}

function ChangePassword() {
  const popup = usePopup();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next.length < 10) return setErr("รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัว");
    if (next !== again) return setErr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setErr("");
    setBusy(true);
    try {
      await api("/profile/password", {
        method: "PUT",
        body: { current, next },
      });
      setCurrent("");
      setNext("");
      setAgain("");
      popup.toast(
        "เปลี่ยนรหัสผ่านแล้ว — เครื่องอื่นที่ล็อกอินไว้จะถูกออกจากระบบ",
        "ok",
      );
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="เปลี่ยนรหัสผ่าน"
      className="card"
      onSubmit={save}
      style={{
        padding: "28px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <h2 style={{ fontSize: 20 }}>เปลี่ยนรหัสผ่าน</h2>
      <label className="field">
        รหัสผ่านปัจจุบัน
        <input
          className="input"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 20,
        }}
      >
        <label className="field">
          รหัสผ่านใหม่
          <input
            className="input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        <label className="field">
          ยืนยันรหัสผ่านใหม่
          <input
            className="input"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
      </div>
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ height: 48, padding: "0 28px" }}
          disabled={busy || !current || !next || !again}
          aria-busy={busy}
        >
          เปลี่ยนรหัสผ่าน
        </button>
      </div>
    </form>
  );
}

export function RoleChip({ role }: { role: Me["role"] }) {
  return (
    <span
      className="chip"
      style={
        role === "teacher"
          ? { background: "var(--m)", color: "#fff" }
          : { background: "var(--soft)", color: "var(--body-alt)" }
      }
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
