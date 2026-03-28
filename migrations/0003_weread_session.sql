CREATE TABLE IF NOT EXISTS weread_session (
  id TEXT PRIMARY KEY NOT NULL,
  vid TEXT NOT NULL,
  skey TEXT NOT NULL,
  basever TEXT NOT NULL,
  v TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  validated_at INTEGER NOT NULL
);

INSERT INTO weread_session (
  id,
  vid,
  skey,
  basever,
  v,
  channel_id,
  user_agent,
  updated_at,
  validated_at
)
SELECT
  'current',
  json_extract(payload_enc, '$.vid'),
  json_extract(payload_enc, '$.skey'),
  COALESCE(NULLIF(json_extract(payload_enc, '$.basever'), ''), COALESCE(NULLIF(json_extract(payload_enc, '$.v'), ''), '10.1.0.80')),
  COALESCE(NULLIF(json_extract(payload_enc, '$.v'), ''), COALESCE(NULLIF(json_extract(payload_enc, '$.basever'), ''), '10.1.0.80')),
  COALESCE(NULLIF(json_extract(payload_enc, '$.channelId'), ''), 'AppStore'),
  COALESCE(NULLIF(json_extract(payload_enc, '$.userAgent'), ''), 'WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)'),
  updated_at,
  updated_at
FROM credentials
WHERE id = 'default'
  AND json_extract(payload_enc, '$.vid') IS NOT NULL
  AND json_extract(payload_enc, '$.skey') IS NOT NULL
ON CONFLICT(id) DO NOTHING;
