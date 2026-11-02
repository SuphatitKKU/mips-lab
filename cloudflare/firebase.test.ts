import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyFirebaseGoogle } from "./firebase";

describe("Firebase Google token verification", () => {
  let privateKey: CryptoKey;
  let keys: ReturnType<typeof createLocalJWKSet>;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    keys = createLocalJWKSet({
      keys: [
        {
          ...(await exportJWK(pair.publicKey)),
          kid: "test-key",
          alg: "RS256",
          use: "sig",
        },
      ],
    });
  });
  const token = async (change: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: "firebase-uid-42",
      email: "student@example.com",
      email_verified: true,
      name: "นักศึกษาทดสอบ",
      firebase: { sign_in_provider: "google.com" },
      auth_time: now,
      iat: now,
      exp: now + 3600,
      aud: "test-project",
      iss: "https://securetoken.google.com/test-project",
      ...change,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
  };
  it("accepts a signed, verified Google identity from the configured project", async () => {
    await expect(
      verifyFirebaseGoogle(await token(), keys, "test-project"),
    ).resolves.toEqual({
      uid: "firebase-uid-42",
      email: "student@example.com",
      name: "นักศึกษาทดสอบ",
    });
  });
  it.each([
    { aud: "another-project" },
    { iss: "https://securetoken.google.com/another-project" },
    { email_verified: false },
    { firebase: { sign_in_provider: "password" } },
    { sub: "" },
    { email: "not-an-email" },
    { exp: 1 },
    { auth_time: 1 },
    { auth_time: Math.floor(Date.now() / 1000) + 3600 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
  ])("rejects an invalid identity or token claim: %j", async (claims) => {
    await expect(
      verifyFirebaseGoogle(await token(claims), keys, "test-project"),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects a forged signature and an unsigned token", async () => {
    const jwt = await token();
    const parts = jwt.split(".");
    parts[2] = "AAAA";
    await expect(
      verifyFirebaseGoogle(parts.join("."), keys, "test-project"),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyFirebaseGoogle("not-a-token", keys, "test-project"),
    ).rejects.toMatchObject({ status: 401 });
  });
});
