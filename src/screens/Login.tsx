import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth, type Role } from '../auth';
import { Icon, ICON } from '../components/Icon';
import { usePopup } from '../components/Popup';
import { Segmented, useTitle } from '../components/ui';

const LOGIN_BG_CODE = `sum:   addi $t0, $zero, 0        loop:  slt  $t2, $a0, $t1        add  $t0, $t0, $t1        sll  $t2, $t0, 2
       addi $t1, $zero, 1               bne  $t2, $zero, done      addi $t1, $t1, 1          lw   $t3, 0($t2)
loop:  slt  $t2, $a0, $t1        done:  add  $v0, $t0, $zero      j    loop                 slt  $t4, $v0, $t3
       bne  $t2, $zero, done            jr   $ra                   sll  $t2, $t0, 2          beq  $t4, $zero, skip
       add  $t0, $t0, $t1        max:   lw   $v0, 0($a0)          lw   $t3, 0($t2)          move $v0, $t3
       addi $t1, $t1, 1                 addi $t0, $zero, 1         slt  $t4, $v0, $t3        jr   $ra`;

interface AuthConfig {
  googleClientId: string | null;
  googleDomain: string | null;
  devLogin: boolean;
}

export function Login() {
  const { loginGoogle, loginPassword, loginDev, loggedIn } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const popup = usePopup();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const gBtn = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Role>('student');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  /** Runs a sign-in and handles the shared busy / error / redirect steps. */
  const attempt = async (fn: () => Promise<boolean>, to: string, msg: (created: boolean) => string) => {
    setErr('');
    setBusy(true);
    try {
      const created = await fn();
      navigate(to, { replace: true });
      popup.toast(msg(created), 'ok');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void attempt(() => loginPassword(username, password), from === '/' ? '/teacher' : from, () => 'เข้าสู่ระบบแล้ว');
  };

  useEffect(() => {
    api<AuthConfig>('/auth/config')
      .then(setConfig)
      .catch((e: ApiError) => setErr(e.message));
  }, []);

  // render the official Google button once we know the client id
  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!clientId || !gBtn.current) return;
    let cancelled = false;
    loadGis()
      .then((gis) => {
        if (cancelled || !gBtn.current) return;
        gis.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          ...(config?.googleDomain ? { hd: config.googleDomain } : {}),
          callback: ({ credential }) =>
            void attempt(() => loginGoogle(credential), from, (created) => (created ? 'สร้างบัญชีให้แล้ว ยินดีต้อนรับ!' : 'เข้าสู่ระบบแล้ว')),
        });
        // Google's button has a fixed pixel width — size it to the card so it never overflows a phone
        const width = Math.round(Math.min(340, Math.max(200, gBtn.current.clientWidth || 340)));
        gis.renderButton(gBtn.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'th', width });
      })
      .catch(() => setErr('โหลดปุ่มเข้าสู่ระบบด้วย Google ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, tab]);

  useTitle('เข้าสู่ระบบ');

  if (loggedIn) return <Navigate to={from} replace />;

  return (
    <main style={{ position: 'relative', minHeight: '100vh', background: 'var(--page)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px 48px' }}>
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 380, background: 'linear-gradient(rgba(30,12,12,.4), rgba(30,12,12,.4)), var(--m)', borderRadius: '0 0 48px 48px', overflow: 'hidden' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 15, lineHeight: 2.2, color: 'rgba(255,255,255,.24)', padding: '28px 40px', whiteSpace: 'pre' }}>{LOGIN_BG_CODE}</div>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 56, gap: 10, color: '#fff', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 48, height: 48, borderRadius: 16, background: '#fff', color: 'var(--m)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon d={ICON.chip} size={26} />
          </span>
          <span style={{ fontFamily: 'var(--head)', fontSize: 30, fontWeight: 500 }}>MIPS Lab</span>
        </div>
        <span style={{ fontSize: 17, color: 'var(--m-on)' }}>เรียน C ⇄ MIPS ทีละคำสั่ง</span>
      </div>

      <section
        aria-label="เข้าสู่ระบบ"
        className="login-card"
        style={{
          position: 'relative',
          marginTop: 36,
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          borderRadius: 32,
          boxShadow: '0 2px 4px rgba(42,31,31,.05), 0 30px 60px rgba(42,31,31,.16)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <h1 style={{ fontSize: 26 }}>เข้าสู่ระบบ</h1>
        <Segmented
          label="เข้าสู่ระบบในฐานะ"
          role="tablist"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setErr('');
          }}
          options={[
            { value: 'student', label: 'นักศึกษา' },
            { value: 'teacher', label: 'อาจารย์' },
          ]}
          btnStyle={{ flex: 1 }}
        />

        {tab === 'student' ? (
          <>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--body-alt)' }}>
              ใช้บัญชี Google{config?.googleDomain ? ` @${config.googleDomain}` : ''} — ล็อกอินครั้งแรกระบบจะสร้างบัญชีให้อัตโนมัติ
            </p>
            {config?.googleClientId ? (
              <div ref={gBtn} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1 }} />
            ) : (
              <>
                <button type="button" className="btn btn-secondary" style={{ height: 52, gap: 10 }} disabled>
                  <GoogleG />
                  เข้าสู่ระบบด้วย Google
                </button>
                {config && !config.devLogin && (
                  <div role="status" className="notice warn">
                    <Icon d={ICON.info} size={18} style={{ marginTop: 2 }} />
                    <span>
                      ยังไม่ได้ตั้งค่า Google — ผู้ดูแลต้องใส่ <code>GOOGLE_CLIENT_ID</code> ในไฟล์ <code>.env</code> ของเซิร์ฟเวอร์ แล้วรีสตาร์ท
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <form onSubmit={submitPassword} aria-label="เข้าสู่ระบบอาจารย์" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label className="field">
              ชื่อผู้ใช้
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
            </label>
            <label className="field">
              รหัสผ่าน
              <span style={{ position: 'relative', display: 'flex' }}>
                <input
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: 52 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPw ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  onClick={() => setShowPw((v) => !v)}
                  style={{ position: 'absolute', right: 6, top: 5, width: 40, height: 40, borderRadius: 10 }}
                >
                  <Icon d={showPw ? ICON.eyeOff : ICON.eye} size={18} />
                </button>
              </span>
            </label>
            <button type="submit" className="btn btn-primary" style={{ height: 52 }} disabled={busy || !username || !password} aria-busy={busy}>
              เข้าสู่ระบบ
            </button>
            <span style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>ลืมรหัสผ่าน? ให้อาจารย์ท่านอื่นหรือผู้ดูแลระบบตั้งใหม่ให้</span>
          </form>
        )}

        {config?.devLogin && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 44 }}
            disabled={busy}
            onClick={() => void attempt(() => loginDev(tab), tab === 'teacher' ? '/teacher' : from, () => 'เข้าแบบทดลองแล้ว')}
          >
            เข้าแบบทดลอง{tab === 'teacher' ? 'เป็นอาจารย์' : ''} (dev)
          </button>
        )}
        {busy && <span style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>กำลังเข้าสู่ระบบ…</span>}
        {err && (
          <div role="alert" className="notice err">
            <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
            <span>{err}</span>
          </div>
        )}
      </section>
    </main>
  );
}

interface Gis {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; hd?: string }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
}

let gisPromise: Promise<Gis> | null = null;

/** Loads Google Identity Services once. */
function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: { accounts: { id: Gis } } };
  if (w.google?.accounts?.id) return Promise.resolve(w.google.accounts.id);
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google?.accounts?.id ? resolve(w.google.accounts.id) : reject(new Error('gis')));
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('gis'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
