import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config/index.js";
import { openDatabase, type Db } from "../src/db/index.js";
import { md5 } from "../src/utils/crypto.js";

export const ACCEPT = "application/vnd.koreader.v1+json";

export function authHeaders(username: string, password: string, extra: Record<string, string> = {}) {
  return {
    "x-auth-user": username,
    "x-auth-key": md5(password),
    accept: ACCEPT,
    ...extra,
  };
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  dbPath = ":memory:",
): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDatabase(dbPath);
  const app = await buildApp({
    db,
    config: { logLevel: "silent", allowRegister: true, ...overrides },
  });
  await app.ready();
  return { app, db };
}

export async function registerUser(
  app: FastifyInstance,
  username: string,
  password: string,
) {
  return app.inject({
    method: "POST",
    url: "/users/create",
    headers: { accept: ACCEPT },
    payload: { username, password: md5(password) },
  });
}

export function progressPayload(document: string, overrides: Record<string, unknown> = {}) {
  return {
    document,
    progress: "/body/DocFragment[20]/body/p[22]/text().123",
    percentage: 0.352,
    device: "Kobo Clara BW",
    device_id: "kobo-001",
    ...overrides,
  };
}
