import type { CloudflareBindings } from './types'

export type WeReadCredentials = {
  vid: string
  skey: string
  basever: string
  v: string
  channelId: string
  userAgent: string
}

const DEFAULT_BASEVER = '10.1.0.80'
const DEFAULT_CHANNEL_ID = 'AppStore'
const DEFAULT_USER_AGENT = 'WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)'

const SESSION_ROW_ID = 'current'

export type StoredWeReadSession = WeReadCredentials & {
  updatedAt: number
  validatedAt: number
}

export function normalizeWeReadCredentials(input: {
  vid: string
  skey: string
  basever?: string
  v?: string
  channelId?: string
  userAgent?: string
}): WeReadCredentials {
  const vid = input.vid.trim()
  const skey = input.skey.trim()
  if (!vid) throw new Error('Missing vid')
  if (!skey) throw new Error('Missing skey')

  const basever = (input.basever ?? input.v ?? DEFAULT_BASEVER).trim() || DEFAULT_BASEVER
  const v = (input.v ?? basever).trim() || basever
  const channelId = (input.channelId ?? DEFAULT_CHANNEL_ID).trim() || DEFAULT_CHANNEL_ID
  const userAgent = (input.userAgent ?? DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT

  return { vid, skey, basever, v, channelId, userAgent }
}

export async function getStoredWeReadSession(env: CloudflareBindings): Promise<StoredWeReadSession | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT
          vid,
          skey,
          basever,
          v,
          channel_id as channelId,
          user_agent as userAgent,
          updated_at as updatedAt,
          validated_at as validatedAt
       FROM weread_session
       WHERE id = ?1`,
    )
      .bind(SESSION_ROW_ID)
      .first<{
        vid: string
        skey: string
        basever: string
        v: string
        channelId: string
        userAgent: string
        updatedAt: number
        validatedAt: number
      }>()

    if (!row) return null

    return {
      ...normalizeWeReadCredentials(row),
      updatedAt: row.updatedAt,
      validatedAt: row.validatedAt,
    }
  } catch {
    return null
  }
}

export async function getWeReadCredentials(env: CloudflareBindings): Promise<WeReadCredentials> {
  const session = await getStoredWeReadSession(env)
  if (!session) throw new Error('No WeRead session configured (POST /api/admin/weread/session first)')
  return session
}

export type WeReadCredentialsStatus =
  | { configured: true; source: 'd1'; vid: string; updatedAt: number; validatedAt: number }
  | { source: 'none' }

export async function getWeReadCredentialsStatus(env: CloudflareBindings): Promise<WeReadCredentialsStatus> {
  const session = await getStoredWeReadSession(env)
  if (session) {
    return {
      configured: true,
      source: 'd1',
      vid: session.vid,
      updatedAt: session.updatedAt,
      validatedAt: session.validatedAt,
    }
  }

  return { source: 'none' }
}

export function shouldResetWeReadSyncState(previousVid: string | null | undefined, nextVid: string, requested: boolean) {
  if (requested) return true
  if (!previousVid) return false
  return previousVid !== nextVid
}

export async function setWeReadSession(
  env: CloudflareBindings,
  input: {
    vid: string
    skey: string
    basever?: string
    v?: string
    channelId?: string
    userAgent?: string
  },
  options?: {
    validatedAt?: number
  },
): Promise<StoredWeReadSession> {
  const creds = normalizeWeReadCredentials(input)
  const updatedAt = Date.now()
  const validatedAt = options?.validatedAt ?? updatedAt
  await env.DB.prepare(
    `INSERT INTO weread_session (
        id,
        vid,
        skey,
        basever,
        v,
        channel_id,
        user_agent,
        updated_at,
        validated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
      )
      ON CONFLICT(id) DO UPDATE SET
        vid = excluded.vid,
        skey = excluded.skey,
        basever = excluded.basever,
        v = excluded.v,
        channel_id = excluded.channel_id,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at,
        validated_at = excluded.validated_at`,
  )
    .bind(
      SESSION_ROW_ID,
      creds.vid,
      creds.skey,
      creds.basever,
      creds.v,
      creds.channelId,
      creds.userAgent,
      updatedAt,
      validatedAt,
    )
    .run()

  return { ...creds, updatedAt, validatedAt }
}

export const setWeReadCredentials = setWeReadSession
