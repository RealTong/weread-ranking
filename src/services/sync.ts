import { fetchAllMineReadBooks, fetchFriendRanking, fetchFriendWechat } from '../integrations/weread'
import {
  createRefreshRun,
  finishRefreshRun,
  getWeReadSyncState,
  insertFriendMetaSnapshots,
  insertRankingSnapshots,
  setSyncState,
  upsertFriend,
} from '../storage/db'
import { replaceMyReadBooksSnapshot } from '../storage/readbooks'
import { getWeReadCredentials } from './credentials'
import type { CloudflareBindings, RefreshSource } from '../types'

type RefreshAllOptions = {
  source: RefreshSource
  scheduledTime?: string | null
}

export type RefreshAllResult = {
  ok: boolean
  source: RefreshSource
  startedAt: string
  finishedAt: string
  counts: {
    friendsMeta: number
    profiles: number
    ranking: number
    avatarsStored: number
  }
  sync: {
    friendWechat: { synckey: number; syncver: number }
    friendRanking: { synckey: number }
  }
  error?: string
}

function toIntOrDefault(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function requireRefreshCredentials(env: CloudflareBindings) {
  try {
    return await getWeReadCredentials(env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('No WeRead credentials configured')) {
      throw new Error('No credentials configured')
    }
    throw error
  }
}

export async function refreshAll(env: CloudflareBindings, options: RefreshAllOptions): Promise<RefreshAllResult> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()

  let runId: number | null = null
  try {
    runId = await createRefreshRun(env.DB, {
      source: options.source,
      startedAt: startedAtMs,
      scheduledTime: options.scheduledTime ?? null,
    })
  } catch {
    // best-effort only (e.g. DB not migrated yet)
  }

  const counts = { friendsMeta: 0, profiles: 0, ranking: 0, avatarsStored: 0 }
  const sync = {
    friendWechat: { synckey: 0, syncver: 0 },
    friendRanking: { synckey: 0 },
  }

  try {
    const creds = await requireRefreshCredentials(env)
    const state = await getWeReadSyncState(env.DB)

    sync.friendWechat.synckey = toIntOrDefault(state.friend_wechat_synckey, sync.friendWechat.synckey)
    sync.friendWechat.syncver = toIntOrDefault(state.friend_wechat_syncver, sync.friendWechat.syncver)
    sync.friendRanking.synckey = toIntOrDefault(state.friend_ranking_synckey, sync.friendRanking.synckey)

    const capturedAt = Date.now()

    const wechat = await fetchFriendWechat(creds, {
      synckey: sync.friendWechat.synckey,
      syncver: sync.friendWechat.syncver,
      userClick: 1,
    })

    sync.friendWechat = { synckey: wechat.synckey, syncver: wechat.syncver }
    await setSyncState(env.DB, 'friend_wechat_synckey', String(sync.friendWechat.synckey))
    await setSyncState(env.DB, 'friend_wechat_syncver', String(sync.friendWechat.syncver))

    const usersMeta = wechat.usersMeta ?? []
    counts.friendsMeta = usersMeta.length

    for (const userVid of new Set(usersMeta.map((meta) => meta.userVid))) {
      await upsertFriend(env.DB, { userVid })
    }

    await insertFriendMetaSnapshots(
      env.DB,
      usersMeta.map((meta) => ({
        userVid: meta.userVid,
        totalReadingTime: meta.totalReadingTime,
        capturedAt,
      })),
    )

    const ranking = await fetchFriendRanking(creds, { synckey: sync.friendRanking.synckey })
    sync.friendRanking = { synckey: ranking.synckey }
    await setSyncState(env.DB, 'friend_ranking_synckey', String(sync.friendRanking.synckey))

    counts.ranking = ranking.ranking?.length ?? 0

    for (const row of ranking.ranking ?? []) {
      await upsertFriend(env.DB, {
        userVid: row.user.userVid,
        name: row.user.name ?? null,
        gender: row.user.gender ?? null,
        avatarUrl: row.user.avatar ?? null,
        isWeChatFriend: row.user.isWeChatFriend ?? null,
        isHide: row.user.isHide ?? null,
      })
    }

    await insertRankingSnapshots(
      env.DB,
      (ranking.ranking ?? []).map((row) => ({
        userVid: row.user.userVid,
        readingTime: row.readingTime,
        rankWeek: row.rankWeek,
        orderIndex: row.order,
        capturedAt,
      })),
    )

    const myReadBooks = await fetchAllMineReadBooks(creds)
    await replaceMyReadBooksSnapshot(env.DB, {
      books: myReadBooks.readBooks.map((book) => ({
        bookId: book.bookId,
        startReadingTime: book.startReadingTime,
        finishTime: book.finishTime ?? null,
        markStatus: book.markStatus,
        progress: book.progress ?? null,
        readtime: book.readtime ?? null,
        title: book.title,
        author: book.author ?? null,
        cover: book.cover ?? null,
      })),
      stars: myReadBooks.stars,
      years: myReadBooks.years,
      ratings: myReadBooks.ratings,
      yearPreference: myReadBooks.yearPreference,
      totalCount: myReadBooks.totalCount,
      sourceSynckey: myReadBooks.sourceSynckey,
    })

    const finishedAtMs = Date.now()
    const finishedAt = new Date(finishedAtMs).toISOString()

    if (runId !== null) {
      await finishRefreshRun(env.DB, {
        id: runId,
        finishedAt: finishedAtMs,
        ok: 1,
        friendsMetaCount: counts.friendsMeta,
        profilesCount: counts.profiles,
        rankingCount: counts.ranking,
        avatarsStoredCount: counts.avatarsStored,
      })
    }

    return {
      ok: true,
      source: options.source,
      startedAt,
      finishedAt,
      counts,
      sync,
    }
  } catch (error) {
    const finishedAtMs = Date.now()
    const finishedAt = new Date(finishedAtMs).toISOString()
    const message = error instanceof Error ? error.message : String(error)

    if (runId !== null) {
      await finishRefreshRun(env.DB, { id: runId, finishedAt: finishedAtMs, ok: 0, error: message })
    }

    return {
      ok: false,
      source: options.source,
      startedAt,
      finishedAt,
      counts,
      sync,
      error: message,
    }
  }
}
