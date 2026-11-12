-- KOReader 局域网进度同步服务数据库结构
-- 兼容技术方案第 7 节；metadata 为 KOSync 协议可选字段（服务端留存但不参与响应）。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  document TEXT NOT NULL,
  progress TEXT NOT NULL,
  percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
  device TEXT,
  device_id TEXT,
  metadata TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, document),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS progress_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  document TEXT NOT NULL,
  progress TEXT NOT NULL,
  percentage REAL NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_history_book
ON progress_history(user_id, document, created_at);
