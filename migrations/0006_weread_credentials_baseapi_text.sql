ALTER TABLE weread_credentials RENAME TO weread_credentials_old;

CREATE TABLE weread_credentials (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
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
  baseapi TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO weread_credentials (
  id,
  vid,
  skey,
  access_token,
  refresh_token,
  basever,
  appver,
  v,
  channel_id,
  user_agent,
  osver,
  baseapi,
  updated_at
)
SELECT
  id,
  vid,
  skey,
  access_token,
  refresh_token,
  basever,
  appver,
  v,
  channel_id,
  user_agent,
  osver,
  CAST(baseapi AS TEXT),
  updated_at
FROM weread_credentials_old;

DROP TABLE weread_credentials_old;
