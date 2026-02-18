import type { WeReadCredentials } from './credentials'

const WEREAD_ORIGIN = 'https://i.weread.qq.com'

type FetchJsonOptions = {
  path: string
  query?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number
}

function buildHeaders(creds: WeReadCredentials): HeadersInit {
  return {
    accept: '*/*',
    vid: creds.vid,
    skey: creds.skey,
    basever: creds.basever,
    v: creds.v,
    channelId: creds.channelId,
    'user-agent': creds.userAgent,
  }
}

async function fetchJson<T>(creds: WeReadCredentials, options: FetchJsonOptions): Promise<T> {
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
      headers: buildHeaders(creds),
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
  creds: WeReadCredentials,
  params: { synckey: number; syncver: number; userClick?: 0 | 1 },
): Promise<FriendWechatResponse> {
  return fetchJson(creds, {
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
  creds: WeReadCredentials,
  params: { synckey: number },
): Promise<FriendRankingResponse> {
  return fetchJson(creds, {
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

export async function fetchUser(creds: WeReadCredentials, userVid: number): Promise<WeReadUserResponse> {
  return fetchJson(creds, { path: '/user', query: { userVid } })
}
