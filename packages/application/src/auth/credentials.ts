import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const PARAMETERS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/**
 * Password hashes are self-describing (`scrypt$N$salt$key`, base64url) so the
 * cost factor can be raised later without a migration: verification reads N
 * from the stored value.
 */
export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMETERS);
  return ["scrypt", String(PARAMETERS.N), salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !salt || !expected) return false;
  const N = Number(cost);
  if (!Number.isInteger(N) || N < 2) return false;
  const expectedKey = Buffer.from(expected, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), expectedKey.length, {
    ...PARAMETERS,
    N,
  });
  return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
}
