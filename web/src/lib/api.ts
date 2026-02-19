import type { AppSettings } from './settings'

export type ApiOk<T> = T & { ok: true }
export type ApiErr = { ok: false; error: string }

export type Friend = {
  userVid: number
  name: string | null
  gender: number | null
  avatarUrl: string | null
  avatarR2Key: string | null
  location: string | null
  isWeChatFriend: number | null
  isHide: number | null
  signature: string | null
  updatedAt: number
  latestTotalReadingTime: number | null
  latestMetaCapturedAt: number | null
  latestRanking: null | {
    capturedAt: number | null
    readingTime: number
    rankWeek: number
    orderIndex: number
  }
}

export type AioResponse = ApiOk<{
  generatedAt: string
  latest: { metaCapturedAt: number | null; rankingCapturedAt: number | null }
  friends: Friend[]
  ranking: {
    capturedAt: number | null
    rows: Array<{
      userVid: number
      readingTime: number
      rankWeek: number
      orderIndex: number
      name: string | null
      avatarUrl: string | null
      avatarR2Key: string | null
    }>
  }
}>

export type FriendHistoryResponse = ApiOk<{
  history: {
    userVid: number
    meta: Array<{ capturedAt: number; totalReadingTime: number }>
    ranking: Array<{ capturedAt: number; readingTime: number; rankWeek: number; orderIndex: number }>
  }
}>

export type RefreshResponse = {
  ok: boolean
  source: 'api' | 'cron'
  startedAt: string
  finishedAt: string
  counts: { friendsMeta: number; profiles: number; ranking: number; avatarsStored: number }
  sync: {
    friendWechat: { synckey: number; syncver: number }
    friendRanking: { synckey: number }
  }
  error?: string
}

function buildUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return path
  return new URL(path, trimmed.endsWith('/') ? trimmed : `${trimmed}/`).toString()
}

export async function apiFetch<T>(
  settings: AppSettings,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = buildUrl(settings.apiBaseUrl, path)
  const headers = new Headers(init.headers)

  if (settings.apiKey.trim()) headers.set('x-api-key', settings.apiKey.trim())
  if (!headers.has('accept')) headers.set('accept', 'application/json')

  const res = await fetch(url, { ...init, headers })
  const text = await res.text()

  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }

  if (!res.ok) {
    const apiErr = json as Partial<ApiErr> | null
    const message = apiErr?.error ? String(apiErr.error) : text || `${res.status} ${res.statusText}`
    throw new Error(message)
  }

  return json as T
}

