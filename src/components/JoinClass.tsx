// Students type the join code their teacher hands out to land in that class
// (one section in one term). Used on the home page and in profile settings.

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth, type Me } from '../auth';
import { CODE_LEN } from '../lib/terms';
import { Icon, ICON } from './Icon';
import { usePopup } from './Popup';

export function JoinClass({ label = 'เข้าห้อง', onJoined }: { label?: string; onJoined?: (u: Me) => void }) {
  const { updateUser } = useAuth();
  const popup = usePopup();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ user: Me }>('/profile/class', { body: { code } });
      updateUser(r.user);
      setCode('');
      popup.toast(`เข้าห้อง ${r.user.section} แล้ว`, 'ok');
      onJoined?.(r.user);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={join} aria-label="ใส่รหัสเข้าห้องเรียน" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="รหัสเข้าห้อง"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="รหัส 6 ตัว เช่น K7Q2XM"
          maxLength={CODE_LEN + 2}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          // the Thai placeholder stays in the body font; the typed code is spaced mono
          style={{ flex: '1 1 180px', ...(code ? { fontFamily: 'var(--mono)', letterSpacing: '.12em' } : {}) }}
        />
        <button type="submit" className="btn btn-primary" style={{ height: 48, padding: '0 24px' }} disabled={busy || !code.trim()} aria-busy={busy}>
          {label}
        </button>
      </div>
      {err && (
        <div role="alert" className="notice err">
          <Icon d={ICON.alert} size={18} style={{ marginTop: 2 }} />
          <span>{err}</span>
        </div>
      )}
    </form>
  );
}
