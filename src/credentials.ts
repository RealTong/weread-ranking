import type { CloudflareBindings } from './types'

export type WeReadCredentials = {
  vid: string
  skey: string
  basever: string
  v: string
  channelId: string
  userAgent: string
}

const DEFAULT_BASEVER = '10.0.3.79'
const DEFAULT_CHANNEL_ID = 'AppStore'
const DEFAULT_USER_AGENT = 'WeRead/10.0.3 (iPhone; iOS 26.2.1; Scale/3.00)'

const CREDENTIALS_ROW_ID = 'default'

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getAesKey(env: CloudflareBindings): Promise<CryptoKey> {
  const raw = env.CRED_ENC_KEY?.trim()
  if (!raw) throw new Error('Missing env: CRED_ENC_KEY')

  const keyBytes = base64ToBytes(raw)
  if (keyBytes.length !== 32) {
    throw new Error('Invalid CRED_ENC_KEY: expected 32 bytes base64')
  }

  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptJson(env: CloudflareBindings, payload: unknown): Promise<string> {
  const key = await getAesKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))

  const packed = new Uint8Array(iv.length + ciphertext.length)
  packed.set(iv, 0)
  packed.set(ciphertext, iv.length)
  return `v1:${bytesToBase64(packed)}`
}

async function decryptJson<T>(env: CloudflareBindings, value: string): Promise<T> {
  const key = await getAesKey(env)
  const trimmed = value.trim()

  if (!trimmed.startsWith('v1:')) throw new Error('Unsupported credentials payload version')
  const packed = base64ToBytes(trimmed.slice(3))
  if (packed.length < 13) throw new Error('Invalid credentials payload')

  const iv = packed.slice(0, 12)
  const ciphertext = packed.slice(12)
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
  const text = new TextDecoder().decode(plaintext)
  return JSON.parse(text) as T
}

export type WeReadCredentialsStatus =
  | { source: 'd1'; updatedAt: number }
  | { source: 'env' }
  | { source: 'none' }

export async function getWeReadCredentialsStatus(env: CloudflareBindings): Promise<WeReadCredentialsStatus> {
  try {
    const row = await env.DB.prepare('SELECT updated_at as updatedAt FROM credentials WHERE id = ?1')
      .bind(CREDENTIALS_ROW_ID)
      .first<{ updatedAt: number }>()
    if (row?.updatedAt) return { source: 'd1', updatedAt: row.updatedAt }
  } catch {
    // ignore (e.g. migrations not applied yet)
  }

  if (env.WEREAD_VID?.trim() && env.WEREAD_SKEY?.trim()) return { source: 'env' }

  return { source: 'none' }
}

export async function getWeReadCredentials(env: CloudflareBindings): Promise<WeReadCredentials> {
  try {
    const row = await env.DB.prepare('SELECT payload_enc as payloadEnc FROM credentials WHERE id = ?1')
      .bind(CREDENTIALS_ROW_ID)
      .first<{ payloadEnc: string }>()

    if (row?.payloadEnc) {
      const payload = await decryptJson<Partial<WeReadCredentials>>(env, row.payloadEnc)
      return normalizeWeReadCredentials({
        vid: payload.vid ?? '',
        skey: payload.skey ?? '',
        basever: payload.basever,
        v: payload.v,
        channelId: payload.channelId,
        userAgent: payload.userAgent,
      })
    }
  } catch {
    // ignore (e.g. migrations not applied yet)
  }

  if (env.WEREAD_VID?.trim() && env.WEREAD_SKEY?.trim()) {
    return normalizeWeReadCredentials({
      vid: env.WEREAD_VID,
      skey: env.WEREAD_SKEY,
      basever: env.WEREAD_BASEVER,
      v: env.WEREAD_V,
      channelId: env.WEREAD_CHANNEL_ID,
      userAgent: env.WEREAD_USER_AGENT,
    })
  }

  throw new Error('No WeRead credentials configured (set WEREAD_VID/WEREAD_SKEY or POST /api/admin/credentials)')
}

export async function setWeReadCredentials(
  env: CloudflareBindings,
  input: {
    vid: string
    skey: string
    basever?: string
    v?: string
    channelId?: string
    userAgent?: string
  },
): Promise<{ updatedAt: number }> {
  const creds = normalizeWeReadCredentials(input)
  const payloadEnc = await encryptJson(env, creds)
  const updatedAt = Date.now()

  await env.DB.prepare(
    `INSERT INTO credentials (id, payload_enc, updated_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET payload_enc = excluded.payload_enc, updated_at = excluded.updated_at`,
  )
    .bind(CREDENTIALS_ROW_ID, payloadEnc, updatedAt)
    .run()

  return { updatedAt }
}
