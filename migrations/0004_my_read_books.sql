CREATE TABLE IF NOT EXISTS my_read_books (
  book_id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  mark_status INTEGER NOT NULL,
  progress INTEGER,
  readtime INTEGER,
  start_reading_time INTEGER NOT NULL,
  finish_time INTEGER,
  payload_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_my_read_books_active_start
  ON my_read_books(is_active, start_reading_time DESC, book_id ASC);

CREATE INDEX IF NOT EXISTS idx_my_read_books_active_mark_status
  ON my_read_books(is_active, mark_status, start_reading_time DESC, book_id ASC);

CREATE TABLE IF NOT EXISTS my_read_books_state (
  id TEXT PRIMARY KEY NOT NULL,
  stars_json TEXT NOT NULL,
  years_json TEXT NOT NULL,
  ratings_json TEXT NOT NULL,
  year_preference_json TEXT NOT NULL,
  total_count INTEGER NOT NULL,
  source_synckey INTEGER,
  updated_at INTEGER NOT NULL
);
