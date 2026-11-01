import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGoogleToken } from './google';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const keys = async () => [jwk];
const NOW = 1_800_000_000_000;

function token(claims: Record<string, unknown>, kid = 'k1') {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b({ alg: 'RS256', kid })}.${b(claims)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}
const good = {
  iss: 'https://accounts.google.com',
  aud: 'cid',
  sub: '123',
  email: '6601234567@uni.ac.th',
  email_verified: true,
  name: 'ทดลอง',
  hd: 'uni.ac.th',
  exp: NOW / 1000 + 600,
};

describe('Google ID token', () => {
  it('accepts a valid token', async () => {
    const p = await verifyGoogleToken(token(good), { clientId: 'cid', keys, now: NOW });
    expect(p).toMatchObject({ sub: '123', email: '6601234567@uni.ac.th', name: 'ทดลอง' });
  });

  it.each([
    ['wrong audience', { ...good, aud: 'other' }, 'ไม่ได้ออกให้แอปนี้'],
    ['expired', { ...good, exp: NOW / 1000 - 3600 }, 'หมดอายุ'],
    ['unverified email', { ...good, email_verified: false }, 'ยืนยันอีเมล'],
    ['wrong issuer', { ...good, iss: 'evil.com' }, 'ไม่ได้มาจาก Google'],
  ])('rejects %s', async (_n, claims, msg) => {
    await expect(verifyGoogleToken(token(claims), { clientId: 'cid', keys, now: NOW })).rejects.toThrow(msg);
  });

  it('rejects a tampered signature and other domains', async () => {
    const t = token(good);
    const forged = t.split('.');
    forged[1] = Buffer.from(JSON.stringify({ ...good, sub: '999' })).toString('base64url');
    await expect(verifyGoogleToken(forged.join('.'), { clientId: 'cid', keys, now: NOW })).rejects.toThrow('ลายเซ็น');
    await expect(verifyGoogleToken(t, { clientId: 'cid', keys, now: NOW, domain: 'other.ac.th' })).rejects.toThrow('other.ac.th');
  });
});
