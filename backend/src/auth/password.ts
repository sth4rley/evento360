import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const saltLength = 16;
const keyLength = 64;
const dummyPasswordHash = `scrypt$${Buffer.alloc(saltLength).toString("base64url")}$${Buffer.alloc(keyLength).toString("base64url")}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;

  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!password || password.length > 128) return false;
  const safeHash = storedHash ?? dummyPasswordHash;
  const [algorithm, encodedSalt, encodedKey] = safeHash.split("$");

  if (algorithm !== "scrypt" || !encodedSalt || !encodedKey) {
    await scrypt(password, Buffer.alloc(saltLength), keyLength);
    return false;
  }

  const salt = Buffer.from(encodedSalt, "base64url");
  const expectedKey = Buffer.from(encodedKey, "base64url");

  if (salt.length !== saltLength || expectedKey.length !== keyLength) {
    await scrypt(password, Buffer.alloc(saltLength), keyLength);
    return false;
  }

  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
  const matches = timingSafeEqual(derivedKey, expectedKey);

  return Boolean(storedHash) && matches;
}
