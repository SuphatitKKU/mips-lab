import { TOUR_EVENT } from "./Tour";
// Shown instead of the app to a student who isn't in an open class: new students,
// and everyone whose class the teacher closed or deleted. Two steps, in order:
//   1. student id (set once) — if the teacher already listed that id, this alone
//      puts them in the class and the gate disappears
//   2. the class join code
// The server also refuses a join code until a student id is set.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, type Me } from "../auth";
import { Icon, ICON } from "./Icon";
import { JoinClass } from "./JoinClass";
import { usePopup } from "./Popup";

/** Matches server STUDENT_ID_RE. */
export const STUDENT_ID_RE = /^\d[\d-]{4,18}\d$/;

export function ClassGate() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const hasId = !!user && STUDENT_ID_RE.test(user.studentId);
  const closedClass = hasId ? user?.section : undefined;

  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <main
      data-tour-page="class-join"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        background: "var(--page)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 44,
              height: 44,
              flex: "none",
              borderRadius: 14,
              background: "var(--m)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon d={ICON.chip} size={24} />
          </span>
          <div
            style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
          >
            <b
              style={{
                fontFamily: "var(--head)",
                fontSize: 22,
                fontWeight: 500,
              }}
            >
              เข้าห้องเรียนก่อนเริ่มใช้งาน
            </b>
            <span
              style={{
                fontSize: 14,
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {user?.name}
              {user?.email ? ` · ${user.email}` : ""}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          data-tour="help"
          aria-label="แนะนำหน้านี้"
          onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
        >
          แนะนำการเข้าห้องเรียน
        </button>
        {closedClass && (
          <div className="notice info">
            <Icon d={ICON.info} size={18} style={{ marginTop: 2 }} />
            <span>
              ห้องเดิม <b>{closedClass}</b> ปิดแล้ว — ถ้าลงเรียนเทอมนี้
              ใส่รหัสห้องใหม่จากอาจารย์
            </span>
          </div>
        )}

        <Step n={1} title="รหัสนักศึกษา" done={hasId}>
          {hasId ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 16 }}>
                {user!.studentId}
              </span>
              <Icon d={ICON.lock} size={14} color="var(--muted)" />
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                ถ้าผิด ติดต่ออาจารย์ให้แก้
              </span>
            </span>
          ) : (
            <StudentIdForm />
          )}
        </Step>

        <Step n={2} title="รหัสเข้าห้อง" done={false} locked={!hasId}>
          {hasId ? (
            <>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>
                รหัส 6 ตัวที่อาจารย์แจกในคาบ หรือดูจากประกาศของรายวิชา
              </span>
              <JoinClass />
            </>
          ) : (
            <span style={{ fontSize: 14, color: "var(--muted)" }}>
              ใส่รหัสนักศึกษาในขั้นที่ 1 ก่อน
            </span>
          )}
        </Step>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: "center", height: 40, gap: 8 }}
          onClick={signOut}
        >
          <Icon d={ICON.logout} size={16} />
          ออกจากระบบ / ใช้บัญชีอื่น
        </button>
      </div>
    </main>
  );
}

function Step({
  n,
  title,
  done,
  locked,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="card"
      aria-label={`ขั้นที่ ${n}: ${title}`}
      style={{
        padding: "22px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: locked ? 0.6 : 1,
      }}
    >
      <h2
        style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 10 }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            background: done
              ? "var(--ok)"
              : locked
                ? "var(--soft)"
                : "var(--m)",
            color: locked && !done ? "var(--muted)" : "#fff",
          }}
        >
          {done ? <Icon d={ICON.check} size={15} stroke={3} /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Sets the student id (once). If a teacher listed that id, the server places them in the class right away. */
function StudentIdForm() {
  const { updateUser } = useAuth();
  const popup = usePopup();
  const [sid, setSid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = STUDENT_ID_RE.test(sid.trim());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!valid)
      return setErr(
        "รหัสนักศึกษาต้องเป็นตัวเลข 6–20 หลัก (มีขีดได้ เช่น 653040123-4)",
      );
    if (
      !(await popup.confirm({
        title: `รหัสนักศึกษา ${sid.trim()} ถูกต้องไหม?`,
        body: "ตั้งได้ครั้งเดียว ถ้าผิดต้องให้อาจารย์แก้ให้",
        ok: "ถูกต้อง บันทึก",
      }))
    )
      return;
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ user: Me }>("/profile", {
        method: "PUT",
        body: { studentId: sid },
      });
      updateUser(r.user);
      // listed by the teacher already → in the class, the gate closes by itself
      popup.toast(
        r.user.needsClass
          ? "บันทึกรหัสนักศึกษาแล้ว — ใส่รหัสเข้าห้องต่อได้เลย"
          : `พบชื่อในรายชื่อห้อง — เข้าห้อง ${r.user.section} แล้ว`,
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
      onSubmit={save}
      aria-label="ตั้งรหัสนักศึกษา"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          className="input"
          aria-label="รหัสนักศึกษา"
          value={sid}
          onChange={(e) => {
            setSid(e.target.value);
            setErr("");
          }}
          inputMode="numeric"
          placeholder="เช่น 653040123-4"
          maxLength={20}
          autoFocus
          style={{ flex: "1 1 180px" }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ height: 48, padding: "0 24px" }}
          disabled={busy || !sid.trim()}
          aria-busy={busy}
        >
          บันทึก
        </button>
      </div>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        ตั้งได้ครั้งเดียว ตรวจให้ถูกก่อนกด · ถ้าอาจารย์มีรายชื่อคุณอยู่แล้ว
        จะเข้าห้องให้อัตโนมัติ
      </span>
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
    </form>
  );
}
