import { TOUR_EVENT } from "../components/Tour";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { BrandLogo } from "../components/BrandLogo";
import { CodeEditor } from "../components/CodeEditor";
import { Icon, ICON } from "../components/Icon";
import { LoginForm } from "../components/LoginForm";
import { Modal } from "../components/Modal";
import { Rich, useTitle } from "../components/ui";
import { compileC, type CompileResult } from "../lib/cc/compile";
import "./landing.css";

const SAMPLES = [
  {
    label: "ผลรวม",
    source:
      "int add(int a, int b) {\n    int result = a + b;\n    return result;\n}",
  },
  {
    label: "เงื่อนไข",
    source:
      "int max(int a, int b) {\n    if (a > b) {\n        return a;\n    }\n    return b;\n}",
  },
  {
    label: "วนซ้ำ",
    source:
      "int sum(int n) {\n    int result = 0;\n    for (int i = 1; i <= n; i++) {\n        result += i;\n    }\n    return result;\n}",
  },
];

export function Landing({ loginOnLoad = false }: { loginOnLoad?: boolean }) {
  useTitle("ฝึกเขียน C เข้าใจ MIPS");
  const { loggedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const landing = useRef<HTMLDivElement>(null);
  const loginTrigger = useRef<HTMLAnchorElement | null>(null);
  const returnTo = (location.state as { from?: string } | null)?.from;
  const [loginIntent, setLoginIntent] = useState<{ returnTo?: string } | null>(
    () => (loginOnLoad && !loggedIn ? { returnTo } : null),
  );
  const loginOpen = loginIntent !== null && !loggedIn;
  const [loginTitle, setLoginTitle] = useState("เข้าสู่ระบบ");
  const [sample, setSample] = useState(0);
  const [source, setSource] = useState(SAMPLES[0].source);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const compiled = useMemo<CompileResult>(
    () =>
      source.trim()
        ? compileC(source)
        : { ok: true, lines: [], asm: "", funcs: [] },
    [source],
  );
  const selected = compiled.ok
    ? compiled.lines.find((line) => line.c === selectedLine && line.asm)
    : undefined;
  const marks = useMemo(
    () =>
      selectedLine == null
        ? undefined
        : new Map([[selectedLine, { bg: "#f0f0f0" }]]),
    [selectedLine],
  );

  useEffect(() => {
    if (loggedIn) setLoginIntent(null);
    else if (loginOnLoad) setLoginIntent({ returnTo });
  }, [loginOnLoad, location.key, loggedIn, returnTo]);

  useEffect(() => {
    const page = landing.current;
    if (!page || !loginOpen) return;
    page.inert = true;
    return () => {
      page.inert = false;
    };
  }, [loginOpen]);

  function showLogin(event: MouseEvent<HTMLAnchorElement>, target?: string) {
    if (
      loggedIn ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    loginTrigger.current = event.currentTarget;
    setLoginTitle("เข้าสู่ระบบ");
    setLoginIntent({ returnTo: target });
  }

  function closeLogin() {
    if (landing.current) landing.current.inert = false;
    setLoginIntent(null);
    if (loginOnLoad) navigate("/welcome", { replace: true });
  }

  function chooseSample(index: number) {
    setSample(index);
    setSource(SAMPLES[index].source);
    setSelectedLine(null);
  }

  return (
    <>
      <div ref={landing} className="landing" data-tour-page="landing">
        <a className="land-skip" href="#landing-main">
          ข้ามไปเนื้อหา
        </a>
        <header className="land-nav">
          <Link
            to="/welcome"
            className="land-brand"
            aria-label="MIPS Lab หน้าแนะนำ"
          >
            <BrandLogo />
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            data-tour="help"
            aria-label="แนะนำหน้านี้"
            onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
          >
            <Icon d={ICON.info} size={18} />
          </button>
          <nav aria-label="เมนูหน้าแนะนำ">
            <a href="#landing-main">เกี่ยวกับ</a>
            <a href="#demo">ตัวอย่าง C → MIPS</a>
            <Link
              to={loggedIn ? "/" : "/login"}
              onClick={(event) => showLogin(event)}
              aria-haspopup={loggedIn ? undefined : "dialog"}
            >
              {loggedIn ? "ห้องทดลอง" : "เข้าสู่ระบบ"}
            </Link>
          </nav>
          <Link
            className="land-nav-action"
            to={loggedIn ? "/" : "/login"}
            onClick={(event) => showLogin(event)}
            aria-haspopup={loggedIn ? undefined : "dialog"}
          >
            {loggedIn ? "เข้าห้องทดลอง" : "เริ่มฝึกเขียนโค้ด"}
          </Link>
        </header>

        <main id="landing-main">
          <section className="land-hero" aria-labelledby="land-title">
            <span className="land-eyebrow">
              <span>C → MIPS</span>เข้าใจ Assembly ผ่านโค้ดที่คุณเขียน
            </span>
            <h1 id="land-title">
              เขียน C ให้เข้าใจ.
              <br />
              แล้วไปให้ถึง{" "}
              <span className="land-focus">
                <span>MIPS</span>
                <b>.</b>
              </span>
            </h1>
            <p>
              ฝึกเขียน แปลงเป็น MIPS และรันทีละคำสั่ง
              <br className="land-wide-break" />
              เห็นว่าโค้ดของคุณทำงานใน CPU อย่างไร
            </p>
            <div className="land-hero-actions">
              <Link
                to="/code?mode=convert"
                className="land-button land-button-primary"
                onClick={(event) => showLogin(event, "/code?mode=convert")}
                aria-haspopup={loggedIn ? undefined : "dialog"}
              >
                เริ่มฝึกเขียนโค้ด
              </Link>
              <a href="#demo" className="land-button land-button-secondary">
                ดูตัวอย่างการแปลง
              </a>
            </div>
            <div className="land-topics" aria-label="หัวข้อที่ได้เรียนรู้">
              <span title="ภาษา C">
                <b>C</b>
              </span>
              <span title="MIPS">
                <Icon d={ICON.convert} size={22} />
              </span>
              <span title="CPU">
                <Icon d={ICON.chip} size={22} />
              </span>
              <span title="Registers">
                <b>$t0</b>
              </span>
              <span title="Memory">
                <Icon d={ICON.bus} size={22} />
              </span>
              <span title="โจทย์ฝึก">
                <Icon d={ICON.problems} size={22} />
              </span>
            </div>
            <span className="land-hero-caption">
              จากโค้ดที่คุณเขียน สู่คำสั่งที่คอมพิวเตอร์ทำงาน
            </span>
          </section>

          <section
            id="demo"
            className="land-section land-demo"
            aria-labelledby="land-demo-title"
          >
            <h2 id="land-demo-title" className="land-demo-title">
              ลองแก้ C แล้วดู MIPS ที่ได้
            </h2>
            <div className="land-demo-frame">
              <div className="land-demo-toolbar">
                <span>
                  <Icon d={ICON.convert} size={18} />
                  พื้นที่ทดลอง
                </span>
                <div
                  role="tablist"
                  aria-label="เลือกโค้ดตัวอย่าง"
                  onKeyDown={(event) => {
                    const offsets: Record<string, number> = {
                      ArrowRight: 1,
                      ArrowLeft: -1,
                    };
                    if (
                      !(event.key in offsets) &&
                      event.key !== "Home" &&
                      event.key !== "End"
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? SAMPLES.length - 1
                          : (sample + offsets[event.key] + SAMPLES.length) %
                            SAMPLES.length;
                    chooseSample(next);
                    event.currentTarget
                      .querySelectorAll<HTMLButtonElement>("button")
                      [next]?.focus();
                  }}
                >
                  {SAMPLES.map((item, index) => (
                    <button
                      key={item.label}
                      type="button"
                      role="tab"
                      tabIndex={sample === index ? 0 : -1}
                      aria-selected={sample === index}
                      onClick={() => chooseSample(index)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="land-demo-columns">
                <div className="land-source-pane">
                  <div className="land-pane-heading">
                    <span>
                      <b>C</b>โค้ดของคุณ
                    </span>
                    <span>แก้ไขได้</span>
                  </div>
                  <CodeEditor
                    label="ทดลองเขียน C"
                    lang="c"
                    value={source}
                    onChange={(value) => {
                      setSource(value);
                      setSelectedLine(null);
                    }}
                    onLineClick={setSelectedLine}
                    marks={marks}
                    minLines={6}
                  />
                </div>
                <div className="land-output-pane">
                  <div className="land-pane-heading">
                    <span>
                      <Icon d={ICON.chip} size={16} />
                      MIPS ที่ได้
                    </span>
                    <span>เลือกคำสั่งเพื่อดูที่มา</span>
                  </div>
                  {compiled.ok ? (
                    <div className="land-assembly" aria-label="ผลลัพธ์ MIPS">
                      {compiled.lines.length === 0 && (
                        <p className="land-empty" role="status">
                          เขียนฟังก์ชัน C หรือเลือกตัวอย่างด้านบนเพื่อดูผลแปลง
                        </p>
                      )}
                      {compiled.lines.map((line, index) => (
                        <button
                          key={index}
                          type="button"
                          className={
                            selectedLine != null && line.c === selectedLine
                              ? "selected"
                              : ""
                          }
                          aria-pressed={
                            selectedLine != null && line.c === selectedLine
                          }
                          onClick={() => setSelectedLine(line.c)}
                        >
                          <span>{index + 1}</span>
                          <code>
                            {line.lbl ? line.lbl : `    ${line.asm ?? ""}`}
                          </code>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="land-compile-error" role="alert">
                      <Icon d={ICON.alert} size={18} />
                      <div>
                        <b>ตรวจโค้ด C อีกนิด</b>
                        {compiled.errors.map((error, index) => (
                          <p key={index}>
                            บรรทัด {error.line}: {error.msg}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="land-demo-note" aria-live="polite">
                <Icon d={selected ? ICON.bulb : ICON.pointer} size={17} />
                <span>
                  {selected?.ex ? (
                    <Rich text={selected.ex} />
                  ) : selectedLine != null ? (
                    `คำสั่งที่มาจาก C บรรทัด ${selectedLine} ถูกเน้นไว้แล้ว`
                  ) : (
                    "เลือกบรรทัดใน C หรือคำสั่ง MIPS เพื่อดูว่าทั้งสองฝั่งสัมพันธ์กันอย่างไร"
                  )}
                </span>
              </div>
            </div>
            <p className="land-demo-caption">
              รองรับ C สำหรับการเรียนรู้ เช่น จำนวนเต็ม เงื่อนไข ลูป ฟังก์ชัน
              และอาร์เรย์
            </p>
          </section>
        </main>
        <footer className="land-footer">
          <Link to="/welcome" aria-label="MIPS Lab หน้าแนะนำ">
            <BrandLogo />
          </Link>
          <span>ห้องทดลอง C · MIPS · Z80</span>
          <a href="#landing-main">
            กลับด้านบน
            <Icon d={ICON.sortUp} size={14} />
          </a>
        </footer>
      </div>
      {loginOpen && (
        <Modal
          title={loginTitle}
          className="login-modal"
          onClose={closeLogin}
          focusKey={loginTitle}
          initialFocus={
            loginTitle === "สมัครสมาชิกนักศึกษา"
              ? 'input[autocomplete="name"]'
              : 'input[autocomplete="username"]'
          }
          restoreFocusTo={loginTrigger.current}
        >
          <LoginForm
            returnTo={loginIntent.returnTo}
            onTitleChange={setLoginTitle}
          />
        </Modal>
      )}
    </>
  );
}
