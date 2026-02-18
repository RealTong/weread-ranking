import type { CloudflareBindings } from './types'

const WEREAD_ORIGIN = 'https://i.weread.qq.com'

type FetchJsonOptions = {
  path: string
  query?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number
}

function requireEnv(env: CloudflareBindings, key: keyof CloudflareBindings): string {
  const value = env[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing env: ${String(key)}`)
  }
  return value
}

function buildHeaders(env: CloudflareBindings): HeadersInit {
  const vid = requireEnv(env, 'WEREAD_VID')
  const skey = requireEnv(env, 'WEREAD_SKEY')

  const basever = env.WEREAD_BASEVER ?? env.WEREAD_V ?? '10.0.3.79'
  const v = env.WEREAD_V ?? basever
  const channelId = env.WEREAD_CHANNEL_ID ?? 'AppStore'
  const userAgent =
    env.WEREAD_USER_AGENT ?? 'WeRead/10.0.3 (iPhone; iOS 26.2.1; Scale/3.00)'

  return {
    accept: '*/*',
    vid,
    skey,
    basever,
    v,
    channelId,
    'user-agent': userAgent,
  }
}

async function fetchJson<T>(env: CloudflareBindings, options: FetchJsonOptions): Promise<T> {
  const url = new URL(options.path, WEREAD_ORIGIN)
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v === undefined) continue
    url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: buildHeaders(env),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`WeRead HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`)
    }

    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
}

export type FriendWechatUsersMeta = {
  userVid: number
  totalReadingTime: number
}

export type FriendWechatResponse = {
  synckey: number
  syncver: number
  users?: unknown[]
  usersMeta: FriendWechatUsersMeta[]
  wxFriendSecret?: number
  currentState?: number
  redDot?: number
}

export async function fetchFriendWechat(
  env: CloudflareBindings,
  params: { synckey: number; syncver: number; userClick?: 0 | 1 },
): Promise<FriendWechatResponse> {
  return fetchJson(env, {
    path: '/friend/wechat',
    query: {
      synckey: params.synckey,
      syncver: params.syncver,
      userClick: params.userClick ?? 1,
    },
  })
}

export type FriendRankingEntry = {
  user: {
    userVid: number
    name?: string
    gender?: number
    avatar?: string
    isWeChatFriend?: number
    isHide?: number
  }
  readingTime: number
  rankWeek: number
  order: number
}

export type FriendRankingResponse = {
  synckey: number
  rankSecret?: number
  ranking: FriendRankingEntry[]
}

export async function fetchFriendRanking(
  env: CloudflareBindings,
  params: { synckey: number },
): Promise<FriendRankingResponse> {
  return fetchJson(env, {
    path: '/friend/ranking',
    query: { synckey: params.synckey },
  })
}

export type WeReadUserResponse = {
  userVid: number
  name?: string
  gender?: number
  avatar?: string
  location?: string
  isV?: number
  isDeepV?: boolean
  deepVTitle?: string
  isWeChatFriend?: number
  isHide?: number
  signature?: string
  publish?: number
}

export async function fetchUser(env: CloudflareBindings, userVid: number): Promise<WeReadUserResponse> {
  return fetchJson(env, { path: '/user', query: { userVid } })
}

