import { resetWeReadSyncState } from '../storage/db'
import {
  getCurrentWeReadCredentials,
  requireCurrentWeReadCredentials,
  setCurrentWeReadCredentials,
  type StoredWeReadCredentials,
} from '../storage/credentials'
import type { CloudflareBindings, WeReadCredentials, WeReadCredentialsStatus } from '../types'

export class WeReadCredentialsValidationError extends Error {}

export type SyncResetReason = 'requested' | 'vid_changed' | null
export type SaveWeReadCredentialsResult = {
  credentials: StoredWeReadCredentials
  syncReset: {
    applied: boolean
    reason: SyncResetReason
  }
}

function normalizeCredentialString(value: unknown, field: keyof WeReadCredentials): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    throw new WeReadCredentialsValidationError(`Invalid ${field}`)
  }
  return String(value).trim()
}

export function normalizeWeReadCredentialsPayload(body: unknown): WeReadCredentials {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WeReadCredentialsValidationError('Invalid credential payload')
  }

  const input = body as Record<string, unknown>

  return {
    vid: normalizeCredentialString(input.vid, 'vid'),
    skey: normalizeCredentialString(input.skey, 'skey'),
    accessToken: normalizeCredentialString(input.accessToken, 'accessToken'),
    refreshToken: normalizeCredentialString(input.refreshToken, 'refreshToken'),
    basever: normalizeCredentialString(input.basever, 'basever'),
    appver: normalizeCredentialString(input.appver, 'appver'),
    v: normalizeCredentialString(input.v, 'v'),
    channelId: normalizeCredentialString(input.channelId, 'channelId'),
    userAgent: normalizeCredentialString(input.userAgent, 'userAgent'),
    osver: normalizeCredentialString(input.osver, 'osver'),
    baseapi: normalizeCredentialString(input.baseapi, 'baseapi'),
  }
}

export function toWeReadCredentialsStatus(
  credentials: Awaited<ReturnType<typeof getCurrentWeReadCredentials>>,
): WeReadCredentialsStatus {
  if (!credentials) {
    return {
      configured: false,
      source: 'none',
    }
  }

  return {
    configured: true,
    source: 'd1',
    vid: credentials.vid,
    updatedAt: credentials.updatedAt,
    updatedAtIso: new Date(credentials.updatedAt).toISOString(),
  }
}

export async function getWeReadCredentialsStatus(env: CloudflareBindings): Promise<WeReadCredentialsStatus> {
  const credentials = await getCurrentWeReadCredentials(env.DB)
  return toWeReadCredentialsStatus(credentials)
}

export async function getWeReadCredentials(env: CloudflareBindings): Promise<WeReadCredentials> {
  return await requireCurrentWeReadCredentials(env.DB)
}

export function shouldResetWeReadSyncState(previousVid: string | null | undefined, nextVid: string, requested: boolean) {
  if (requested) return true
  if (!previousVid) return false
  return previousVid !== nextVid
}

export async function saveWeReadCredentials(
  env: CloudflareBindings,
  credentials: WeReadCredentials,
  options?: {
    resetSync?: boolean
  },
): Promise<SaveWeReadCredentialsResult> {
  const previous = await getCurrentWeReadCredentials(env.DB)
  const requestedReset = options?.resetSync === true
  const shouldResetSync = shouldResetWeReadSyncState(previous?.vid, credentials.vid, requestedReset)
  const syncResetReason: SyncResetReason =
    requestedReset ? 'requested' : previous?.vid && previous.vid !== credentials.vid ? 'vid_changed' : null

  const stored = await setCurrentWeReadCredentials(env.DB, credentials)
  if (shouldResetSync) {
    await resetWeReadSyncState(env.DB)
  }

  return {
    credentials: stored,
    syncReset: {
      applied: shouldResetSync,
      reason: shouldResetSync ? syncResetReason : null,
    },
  }
}
