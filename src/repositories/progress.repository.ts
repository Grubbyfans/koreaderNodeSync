import type { Db } from "../db/index.js";

export interface ProgressRow {
  user_id: number;
  document: string;
  progress: string;
  percentage: number;
  device: string | null;
  device_id: string | null;
  metadata: string | null;
  version: number;
  updated_at: number;
}

export interface SaveProgressInput {
  userId: number;
  document: string;
  progress: string;
  percentage: number;
  device: string;
  deviceId: string | null;
  metadata: string | null;
}

export function findProgress(
  db: Db,
  userId: number,
  document: string,
): ProgressRow | undefined {
  return db
    .prepare(
      `SELECT user_id, document, progress, percentage, device, device_id,
              metadata, version, updated_at
       FROM reading_progress WHERE user_id = ? AND document = ?`,
    )
    .get(userId, document) as ProgressRow | undefined;
}

export function listHistory(db: Db, userId: number, document: string): unknown[] {
  return db
    .prepare(
      `SELECT id, progress, percentage, device_id, created_at
       FROM progress_history WHERE user_id = ? AND document = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(userId, document);
}

/**
 * 写入当前进度，并把被覆盖的旧值记入历史；两者处于同一事务。
 * beforeWrite 用于在同一事务内重新校验凭据（K-PUT-6：认证与写入原子化）。
 */
export const commitProgress = (db: Db) =>
  db.transaction(
    (
      input: SaveProgressInput,
      timestamp: number,
      maxHistoryPerBook: number,
      beforeWrite: () => void,
    ): number => {
      beforeWrite();

      const previous = findProgress(db, input.userId, input.document);
      if (previous) {
        db.prepare(
          `INSERT INTO progress_history
             (user_id, document, progress, percentage, device_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          previous.user_id,
          previous.document,
          previous.progress,
          previous.percentage,
          previous.device_id,
          previous.updated_at,
        );
      }

      db.prepare(
        `INSERT INTO reading_progress
           (user_id, document, progress, percentage, device, device_id, metadata, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(user_id, document) DO UPDATE SET
           progress   = excluded.progress,
           percentage = excluded.percentage,
           device     = excluded.device,
           device_id  = COALESCE(excluded.device_id, reading_progress.device_id),
           metadata   = COALESCE(excluded.metadata, reading_progress.metadata),
           version    = reading_progress.version + 1,
           updated_at = excluded.updated_at`,
      ).run(
        input.userId,
        input.document,
        input.progress,
        input.percentage,
        input.device,
        input.deviceId,
        input.metadata,
        timestamp,
      );

      // 每本书仅保留最近 N 条历史，按写入时间倒序。
      db.prepare(
        `DELETE FROM progress_history
         WHERE user_id = ? AND document = ? AND id NOT IN (
           SELECT id FROM progress_history
           WHERE user_id = ? AND document = ?
           ORDER BY created_at DESC, id DESC LIMIT ?
         )`,
      ).run(input.userId, input.document, input.userId, input.document, maxHistoryPerBook);

      return timestamp;
    },
  );
