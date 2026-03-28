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

export type WeReadReadBookFacet = {
  id: number | string
  title: string
  type: number
}

export type WeReadYearPreference = {
  year: number
  count: number
  preference: string
}

export type WeReadReadBook = {
  bookId: string
  startReadingTime: number
  finishTime?: number
  markStatus: number
  progress?: number
  readtime?: number
  title: string
  author?: string
  cover?: string
}

export type MineReadBooksResponse = {
  stars: WeReadReadBookFacet[]
  years: WeReadReadBookFacet[]
  ratings: WeReadReadBookFacet[]
  readBooks: WeReadReadBook[]
  yearPreference: WeReadYearPreference[]
  hasMore: number
  totalCount: number
  synckey?: number
}

export async function fetchMineReadBooksPage(
  creds: WeReadCredentials,
  params?: {
    count?: number
    listType?: number
    rating?: number
    star?: number
    yearRange?: string
    synckey?: number
  },
): Promise<MineReadBooksResponse> {
  return fetchJson(creds, {
    path: '/mine/readbook',
    query: {
      count: params?.count ?? 50,
      listType: params?.listType ?? 3,
      rating: params?.rating ?? 0,
      star: params?.star ?? 0,
      yearRange: params?.yearRange ?? '0_0',
      vid: creds.vid,
      synckey: params?.synckey,
    },
  })
}

export async function fetchAllMineReadBooks(
  creds: WeReadCredentials,
  options?: {
    count?: number
    listType?: number
    rating?: number
    star?: number
    yearRange?: string
    maxPages?: number
  },
): Promise<{
  stars: WeReadReadBookFacet[]
  years: WeReadReadBookFacet[]
  ratings: WeReadReadBookFacet[]
  readBooks: WeReadReadBook[]
  yearPreference: WeReadYearPreference[]
  totalCount: number
  sourceSynckey: number | null
}> {
  const pagesMax = options?.maxPages ?? 100
  const bookMap = new Map<string, WeReadReadBook>()
  const seenSynckeys = new Set<number>()

  let nextSynckey: number | undefined
  let pageCount = 0
  let stars: WeReadReadBookFacet[] = []
  let years: WeReadReadBookFacet[] = []
  let ratings: WeReadReadBookFacet[] = []
  let yearPreference: WeReadYearPreference[] = []
  let totalCount = 0
  let sourceSynckey: number | null = null

  while (pageCount < pagesMax) {
    const page = await fetchMineReadBooksPage(creds, {
      count: options?.count,
      listType: options?.listType,
      rating: options?.rating,
      star: options?.star,
      yearRange: options?.yearRange,
      synckey: nextSynckey,
    })
    pageCount++

    if (pageCount === 1) {
      stars = page.stars ?? []
      years = page.years ?? []
      ratings = page.ratings ?? []
      yearPreference = page.yearPreference ?? []
      totalCount = page.totalCount ?? 0
    }

    for (const book of page.readBooks ?? []) {
      bookMap.set(book.bookId, book)
    }

    sourceSynckey = page.synckey ?? sourceSynckey

    if (!page.hasMore) {
      return {
        stars,
        years,
        ratings,
        readBooks: Array.from(bookMap.values()),
        yearPreference,
        totalCount,
        sourceSynckey,
      }
    }

    if (!page.synckey) {
      throw new Error('WeRead mine/readbook pagination returned hasMore without synckey')
    }
    if (seenSynckeys.has(page.synckey)) {
      throw new Error(`WeRead mine/readbook pagination loop detected at synckey ${page.synckey}`)
    }

    seenSynckeys.add(page.synckey)
    nextSynckey = page.synckey
  }

  throw new Error(`WeRead mine/readbook exceeded max pages (${pagesMax})`)
}
