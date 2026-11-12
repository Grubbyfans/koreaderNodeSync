import "dotenv/config";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  logLevel: string;
  allowRegister: boolean;
  maxHistoryPerBook: number;
  strictAccept: boolean;
  bodyLimitBytes: number;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function readInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 读取环境变量；测试可传入 overrides 覆盖任意配置，避免依赖全局环境。 */
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  return {
    host: env.HOST ?? "0.0.0.0",
    port: readInt(env.PORT, 8787),
    dbPath: env.DB_PATH ?? "./data/koreader.db",
    logLevel: env.LOG_LEVEL ?? "info",
    allowRegister: readBool(env.ALLOW_REGISTER, true),
    maxHistoryPerBook: readInt(env.MAX_HISTORY_PER_BOOK, 100),
    strictAccept: readBool(env.STRICT_ACCEPT, false),
    bodyLimitBytes: readInt(env.BODY_LIMIT_BYTES, 1024 * 1024),
    ...overrides,
  };
}
