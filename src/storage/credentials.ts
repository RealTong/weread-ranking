import type { WeReadCredentials } from '../types'

const CURRENT_CREDENTIALS_ID = 'current'

export type StoredWeReadCredentials = WeReadCredentials & {
  updatedAt: number
}

type WeReadCredentialRow = {
  vid: string
  skey: string
  accessToken: string
  refreshToken: string
  basever: string
  appver: string
  v: string
  channelId: string
  userAgent: string
  osver: string
  baseapi: number
  updatedAt: number
}

export async function getCurrentWeReadCredentials(db: D1Database): Promise<StoredWeReadCredentials | null> {
  const row = await db
    .prepare(
      `SELECT
          vid,
          skey,
          access_token as accessToken,
          refresh_token as refreshToken,
          basever,
          appver,
          v,
          channel_id as channelId,
          user_agent as userAgent,
          osver,
          baseapi,
          updated_at as updatedAt
       FROM weread_credentials
       WHERE id = ?1`,
    )
    .bind(CURRENT_CREDENTIALS_ID)
    .first<WeReadCredentialRow>()

  if (!row) return null

  return {
    vid: row.vid,
    skey: row.skey,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    basever: row.basever,
    appver: row.appver,
    v: row.v,
    channelId: row.channelId,
    userAgent: row.userAgent,
    osver: row.osver,
    baseapi: Number(row.baseapi),
    updatedAt: Number(row.updatedAt),
  }
}

export async function setCurrentWeReadCredentials(
  db: D1Database,
  credentials: WeReadCredentials,
): Promise<StoredWeReadCredentials> {
  const updatedAt = Date.now()

  await db
    .prepare(
      `INSERT INTO weread_credentials (
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
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
        )
        ON CONFLICT(id) DO UPDATE SET
          vid = excluded.vid,
          skey = excluded.skey,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          basever = excluded.basever,
          appver = excluded.appver,
          v = excluded.v,
          channel_id = excluded.channel_id,
          user_agent = excluded.user_agent,
          osver = excluded.osver,
          baseapi = excluded.baseapi,
          updated_at = excluded.updated_at`,
    )
    .bind(
      CURRENT_CREDENTIALS_ID,
      credentials.vid,
      credentials.skey,
      credentials.accessToken,
      credentials.refreshToken,
      credentials.basever,
      credentials.appver,
      credentials.v,
      credentials.channelId,
      credentials.userAgent,
      credentials.osver,
      credentials.baseapi,
      updatedAt,
    )
    .run()

  return {
    ...credentials,
    updatedAt,
  }
}
