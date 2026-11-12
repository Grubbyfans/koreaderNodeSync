import type { IncomingHttpHeaders } from "node:http";
import { bodyNotObject, invalidFields } from "./errors.js";

export const MAX_USERNAME_LENGTH = 128;
export const MAX_DOCUMENT_LENGTH = 256;
export const MAX_PROGRESS_LENGTH = 8192;
export const MAX_DEVICE_LENGTH = 256;
export const MAX_CREDENTIAL_LENGTH = 512;
export const MAX_METADATA_LENGTH = 16 * 1024;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** K-BODY-1：有请求体时必须是 JSON 对象；数组返回 400 / 104。 */
export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null || body === "") return {};
  if (!isPlainObject(body)) throw bodyNotObject();
  return body;
}

export function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_USERNAME_LENGTH &&
    !value.includes(":")
  );
}

/** document 为不透明 id：非空、不含冒号/斜杠，长度受限（K-FLD-1）。 */
export function isValidDocument(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DOCUMENT_LENGTH &&
    !value.includes(":") &&
    !value.includes("/")
  );
}

export function isValidCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CREDENTIAL_LENGTH
  );
}

/** progress 必须作为字符串原样存储，数字页码也转成字符串（K-FLD-2/3）。 */
export function normalizeProgress(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.length <= MAX_PROGRESS_LENGTH ? value : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(value);
    return text.length <= MAX_PROGRESS_LENGTH ? text : undefined;
  }
  return undefined;
}

/** 参考服务端用 tonumber 且不做范围检查；这里做有限性校验并夹到 [0,1]。 */
export function normalizePercentage(value: unknown): number | undefined {
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && value.trim() !== "") parsed = Number(value);
  else return undefined;
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(1, Math.max(0, parsed));
}

export function normalizeOptionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}

export function requireDevice(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DEVICE_LENGTH) {
    throw invalidFields();
  }
  return value;
}

/** metadata 是可选对象，服务端留存但不参与协议响应；省略时不能清空旧值。 */
export function normalizeMetadata(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  // 参考服务端完全忽略 metadata；非对象值也按忽略处理，避免整次同步失败。
  if (!isPlainObject(value)) return null;
  const json = JSON.stringify(value);
  return json.length <= MAX_METADATA_LENGTH ? json : undefined;
}
