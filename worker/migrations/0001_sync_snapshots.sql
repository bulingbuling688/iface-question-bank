CREATE TABLE IF NOT EXISTS sync_profiles (
  profile_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_snapshots (
  profile_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES sync_profiles(profile_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_profiles_updated_at
ON sync_profiles(updated_at);
