-- Sync state (synckey/syncver, etc.)
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Friend profile (name/avatar/etc.)
CREATE TABLE IF NOT EXISTS friends (
  user_vid INTEGER PRIMARY KEY NOT NULL,
  name TEXT,
  gender INTEGER,
  avatar_url TEXT,
  avatar_r2_key TEXT,
  location TEXT,
  is_wechat_friend INTEGER,
  is_hide INTEGER,
  signature TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Snapshot: total reading time (lifetime) from /friend/wechat
CREATE TABLE IF NOT EXISTS friend_meta_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_vid INTEGER NOT NULL,
  total_reading_time INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  FOREIGN KEY (user_vid) REFERENCES friends(user_vid)
);
CREATE INDEX IF NOT EXISTS idx_friend_meta_user_time
  ON friend_meta_snapshots(user_vid, captured_at);

-- Snapshot: weekly ranking from /friend/ranking
CREATE TABLE IF NOT EXISTS ranking_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_vid INTEGER NOT NULL,
  reading_time INTEGER NOT NULL,
  rank_week INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  FOREIGN KEY (user_vid) REFERENCES friends(user_vid)
);
CREATE INDEX IF NOT EXISTS idx_ranking_time
  ON ranking_snapshots(captured_at, order_index);
CREATE INDEX IF NOT EXISTS idx_ranking_user_time
  ON ranking_snapshots(user_vid, captured_at);

-- Refresh run logs (debugging & monitoring)
CREATE TABLE IF NOT EXISTS refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  scheduled_time TEXT,
  ok INTEGER,
  error TEXT,
  friends_meta_count INTEGER,
  profiles_count INTEGER,
  ranking_count INTEGER,
  avatars_stored_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_started_at
  ON refresh_runs(started_at);

