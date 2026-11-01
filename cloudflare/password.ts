const hex = (a: ArrayBuffer | Uint8Array) =>
  Array.from(a instanceof Uint8Array ? a : new Uint8Array(a), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const randomToken = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export async function hashPassword(
  password: string,
  salt = hex(crypto.getRandomValues(new Uint8Array(16))),
) {
  if (password.length < 10 || password.length > 128)
    throw new Error("รหัสผ่านต้องยาว 10–128 ตัว");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return `pbkdf2$100000$${salt}$${hex(bits)}`;
}
export async function checkPassword(password: string, stored: string) {
  if (password.length < 10 || password.length > 128) return false;
  const [, iterations, salt] = stored.split("$");
  if (iterations !== "100000" || !salt) return false;
  const got = await hashPassword(password, salt);
  let diff = got.length ^ stored.length;
  for (let i = 0; i < got.length; i++)
    diff |= got.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
