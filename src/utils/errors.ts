/**
 * KOSync 原生协议错误模型。
 * 错误体固定为 { "code": number, "message": string }，code 为框架级整数码，
 * 与 HTTP 状态码不同。参考 kosync-conformance SPEC.md §6 / 官方 config/errors.lua。
 */
export class KosyncError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "KosyncError";
  }
}

export const ERROR_CODES = {
  acceptMissing: 100,
  acceptInvalid: 101,
  acceptUnsupportedVersion: 102,
  invalidJson: 103,
  bodyNotObject: 104,
  redisUnavailable: 1000,
  internal: 2000,
  unauthorized: 2001,
  userExists: 2002,
  invalidFields: 2003,
  documentMissing: 2004,
  registrationDisabled: 2005,
  accountNotFound: 2006,
} as const;

export const unauthorized = () =>
  new KosyncError(401, ERROR_CODES.unauthorized, "Unauthorized");

export const userExists = () =>
  new KosyncError(402, ERROR_CODES.userExists, "Username is already registered.");

export const invalidFields = () =>
  new KosyncError(403, ERROR_CODES.invalidFields, "Invalid request");

export const documentMissing = () =>
  new KosyncError(403, ERROR_CODES.documentMissing, "Field 'document' not provided.");

export const registrationDisabled = () =>
  new KosyncError(402, ERROR_CODES.registrationDisabled, "User registration is disabled.");

export const accountNotFound = () =>
  new KosyncError(404, ERROR_CODES.accountNotFound, "Account not found.");

export const invalidJson = () =>
  new KosyncError(400, ERROR_CODES.invalidJson, "Could not parse JSON in body.");

export const bodyNotObject = () =>
  new KosyncError(400, ERROR_CODES.bodyNotObject, "Body should be a JSON hash.");

export const invalidAccept = () =>
  new KosyncError(412, ERROR_CODES.acceptInvalid, "Invalid Accept header format.");

export const acceptMissing = () =>
  new KosyncError(412, ERROR_CODES.acceptMissing, "Accept header not set.");

export const internalError = () =>
  new KosyncError(502, ERROR_CODES.internal, "Unknown server error.");
