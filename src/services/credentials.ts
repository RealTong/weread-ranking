import { getCurrentWeReadCredentials, setCurrentWeReadCredentials } from '../storage/credentials'
import type { CloudflareBindings, WeReadCredentials, WeReadCredentialsStatus } from '../types'

export class WeReadCredentialsValidationError extends Error {}

function requireTrimmedString(value: unknown, field: keyof WeReadCredentials): string {
  if (typeof value !== 'string') throw new WeReadCredentialsValidationError(`Missing ${field}`)
  const trimmed = value.trim()
  if (!trimmed) throw new WeReadCredentialsValidationError(`Missing ${field}`)
  return trimmed
}

function requireInteger(value: unknown, field: keyof WeReadCredentials): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WeReadCredentialsValidationError(`Invalid ${field}`)
  }
  return value
}

export function normalizeWeReadCredentialsPayload(body: unknown): WeReadCredentials {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WeReadCredentialsValidationError('Invalid credential payload')
  }

  const input = body as Record<string, unknown>

  return {
    vid: requireTrimmedString(input.vid, 'vid'),
    skey: requireTrimmedString(input.skey, 'skey'),
    accessToken: requireTrimmedString(input.accessToken, 'accessToken'),
    refreshToken: requireTrimmedString(input.refreshToken, 'refreshToken'),
    basever: requireTrimmedString(input.basever, 'basever'),
    appver: requireTrimmedString(input.appver, 'appver'),
    v: requireTrimmedString(input.v, 'v'),
    channelId: requireTrimmedString(input.channelId, 'channelId'),
    userAgent: requireTrimmedString(input.userAgent, 'userAgent'),
    osver: requireTrimmedString(input.osver, 'osver'),
    baseapi: requireInteger(input.baseapi, 'baseapi'),
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

export async function saveWeReadCredentials(
  env: CloudflareBindings,
  credentials: WeReadCredentials,
): Promise<WeReadCredentialsStatus> {
  const stored = await setCurrentWeReadCredentials(env.DB, credentials)
  return toWeReadCredentialsStatus(stored)
}
