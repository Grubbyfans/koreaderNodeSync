import type { Db } from "../db/index.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db
    .prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
}

/**
 * 原子注册：用 INSERT OR IGNORE 判断 affected rows，
 * 不依赖具体 SQLite 驱动抛出的错误码格式（better-sqlite3 与 node:sqlite 不同）。
 */
export function insertUser(
  db: Db,
  username: string,
  passwordHash: string,
  createdAt: number,
): boolean {
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
    )
    .run(username, passwordHash, createdAt);
  return Number(result.changes) === 1;
}

export function updateUserCredential(db: Db, userId: number, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

/** 删除账号及其全部进度与历史（对应可选端点 DELETE /users/me）。 */
export const deleteUserCascade = (db: Db) =>
  db.transaction((userId: number) => {
    db.prepare("DELETE FROM progress_history WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM reading_progress WHERE user_id = ?").run(userId);
    return db.prepare("DELETE FROM users WHERE id = ?").run(userId).changes;
  });
