CREATE TABLE IF NOT EXISTS user_snapshots (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
