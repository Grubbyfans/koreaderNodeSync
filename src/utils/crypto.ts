import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * KOReader 在客户端把明文密码做 MD5 后作为 x-auth-key 发送（K-AUTH-2）。
 * 服务端必须把该值当作不透明凭据，不能再按明文密码处理；同时也不能把
 * 这个摘要明文存库 —— 一旦泄露即可直接冒充用户。这里用带随机盐的 scrypt
 * 对收到的凭据再做一次慢哈希（K-AUTH-3 允许的加固方式），协议线上行为不变。
 */
export function hashCredential(credential: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(credential, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyCredential(credential: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== KEY_LENGTH || salt.length === 0) return false;
  const actual = scryptSync(credential, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}

/** 仅供测试与工具脚本使用：模拟 KOReader 客户端生成 x-auth-key。 */
export function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}
