import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 使用 Node.js 内置 sqlite（node:sqlite，Node 22.5+）。
 * 相比 better-sqlite3 这类原生插件，它不存在 NODE_MODULE_VERSION/ABI 绑定：
 * 机器上切换 Node 版本（nvm / Homebrew / 系统自带）不需要重新编译。
 *
 * 这里只封装仓储层用到的同步 API 子集；若将来要换回 better-sqlite3，
 * 只需重新实现 Db / Statement 两个接口。
 */
type SqlValue = string | number | bigint | null | Uint8Array;
type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

export interface Statement {
  run(...params: SqlValue[]): RunResult;
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
}

type SqliteModule = typeof import("node:sqlite");

const nodeRequire = createRequire(import.meta.url);
let DatabaseSync: SqliteModule["DatabaseSync"];
try {
  DatabaseSync = (nodeRequire("node:sqlite") as SqliteModule).DatabaseSync;
} catch {
  throw new Error(
    `本项目使用 Node.js 内置 SQLite，需要 Node.js >= 22.5（推荐 24 LTS），当前为 ${process.version}。` +
      " 请切换 Node 版本后重试。",
  );
}

class SqliteDatabase implements Db {
  private savepointCounter = 0;

  constructor(private readonly handle: InstanceType<SqliteModule["DatabaseSync"]>) {}

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  prepare(sql: string): Statement {
    return this.handle.prepare(sql) as unknown as Statement;
  }

  close(): void {
    this.handle.close();
  }

  /**
   * 用 SAVEPOINT 实现事务，天然支持嵌套（例如「删除账号」内部再删进度）。
   * 最外层 SAVEPOINT 位于事务外时，RELEASE 会提交整个事务。
   */
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      const name = `kosync_sp_${++this.savepointCounter}`;
      this.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn(...args);
        this.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        try {
          this.exec(`ROLLBACK TO ${name}`);
          this.exec(`RELEASE ${name}`);
        } catch {
          // 回滚失败时保留原始异常，避免掩盖真正的错误。
        }
        throw error;
      }
    };
  }
}

function schemaPath(): string {
  // 源码运行（tsx）与编译产物运行（dist/db）都能找到 schema.sql；
  // npm run build 会把 schema.sql 复制到 dist/db/。
  const alongside = fileURLToPath(new URL("./schema.sql", import.meta.url));
  if (existsSync(alongside)) return alongside;
  return fileURLToPath(new URL("../../src/db/schema.sql", import.meta.url));
}

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }
  const handle = new DatabaseSync(dbPath);
  handle.exec("PRAGMA busy_timeout = 5000");
  handle.exec("PRAGMA foreign_keys = ON");
  // 优先 WAL；某些受限文件系统（沙箱、部分网络盘）不允许 SQLite 删除
  // journal 文件，此时回退到 TRUNCATE，事务原子性不受影响。
  try {
    handle.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    handle.exec("PRAGMA journal_mode = TRUNCATE");
    console.warn(
      `[db] WAL 不可用，已回退到 TRUNCATE 日志模式：${(error as Error).message}`,
    );
  }
  handle.exec(readFileSync(schemaPath(), "utf8"));
  return new SqliteDatabase(handle);
}
