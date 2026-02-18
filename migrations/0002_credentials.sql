-- Encrypted credentials for WeRead (avoid storing plaintext tokens in D1)
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY NOT NULL,
  payload_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

