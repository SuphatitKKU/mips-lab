// Verifies Google Identity Services ID tokens (RS256 JWTs) against Google's
// published keys — no client library needed.

import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  hd?: string;
}

type Jwk = JsonWebKey & { kid: string };
export type KeySource = (refresh: boolean) => Promise<Jwk[]>;

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let cache: { keys: Jwk[]; until: number } | null = null;

/** Google's signing keys, cached for as long as the response's max-age allows. */
export const googleKeys: KeySource = async (refresh) => {
  if (!refresh && cache && cache.until > Date.now()) return cache.keys;
  const res = await fetch(CERTS);
  if (!res.ok) throw new GoogleAuthError('ติดต่อ Google เพื่อตรวจสอบการเข้าสู่ระบบไม่ได้');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  cache = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
};

export class GoogleAuthError extends Error {}

const json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export async function verifyGoogleToken(
  idToken: string,
  opts: { clientId: string; domain?: string; keys?: KeySource; now?: number },
): Promise<GoogleProfile> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleAuthError('token จาก Google ไม่ถูกต้อง');
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = json(h);
    claims = json(p);
  } catch {
    throw new GoogleAuthError('token จาก Google ไม่ถูกต้อง');
  }
  if (header.alg !== 'RS256') throw new GoogleAuthError('token จาก Google ไม่ถูกต้อง');

  const source = opts.keys ?? googleKeys;
  let key = (await source(false)).find((k) => k.kid === header.kid);
  if (!key) key = (await source(true)).find((k) => k.kid === header.kid); // keys rotate
  if (!key) throw new GoogleAuthError('ไม่พบกุญแจที่ใช้เซ็น token');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new GoogleAuthError('ลายเซ็นของ token ไม่ถูกต้อง');

  const now = (opts.now ?? Date.now()) / 1000;
  if (claims.aud !== opts.clientId) throw new GoogleAuthError('token นี้ไม่ได้ออกให้แอปนี้');
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') throw new GoogleAuthError('token ไม่ได้มาจาก Google');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new GoogleAuthError('token หมดอายุ ลองเข้าสู่ระบบใหม่');
  if (typeof claims.email !== 'string' || claims.email_verified !== true) throw new GoogleAuthError('บัญชี Google นี้ยังไม่ยืนยันอีเมล');

  const email = claims.email.toLowerCase();
  if (opts.domain) {
    const domain = opts.domain.toLowerCase().replace(/^@/, '');
    if (claims.hd !== domain && !email.endsWith('@' + domain)) throw new GoogleAuthError(`ใช้ได้เฉพาะบัญชี @${domain}`);
  }
  return { sub: String(claims.sub), email, name: typeof claims.name === 'string' ? claims.name : '', hd: claims.hd as string | undefined };
}
