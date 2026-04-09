CREATE TABLE IF NOT EXISTS weread_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  vid TEXT NOT NULL,
  skey TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  basever TEXT NOT NULL,
  appver TEXT NOT NULL,
  v TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  osver TEXT NOT NULL,
  baseapi INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
