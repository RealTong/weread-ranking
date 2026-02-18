import type { CloudflareBindings, RefreshSource } from '../types'
import {
  createRefreshRun,
  finishRefreshRun,
  insertFriendMetaSnapshots,
  insertRankingSnapshots,
  setSyncState,
  upsertFriend,
} from '../storage/db'
import { mapWithConcurrency } from '../utils/concurrency'
import { sha256Hex } from '../utils/crypto'
import { fetchFriendRanking, fetchFriendWechat, fetchUser } from '../weread'

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

async function storeAvatarIfNeeded(
  env: CloudflareBindings,
  params: { userVid: number; avatarUrl: string },
): Promise<{ avatarR2Key: string | null; stored: boolean }> {
  if (!env.AVATARS) return { avatarR2Key: null, stored: false }

  const hash = await sha256Hex(params.avatarUrl)
  const key = `avatars/${params.userVid}/${hash}`
  const existing = await env.AVATARS.head(key)
  if (existing) return { avatarR2Key: key, stored: false }

  const res = await fetch(params.avatarUrl)
  if (!res.ok || !res.body) return { avatarR2Key: null, stored: false }

  const contentType = res.headers.get('content-type') ?? undefined
  await env.AVATARS.put(key, res.body, {
    httpMetadata: contentType ? { contentType } : undefined,
    customMetadata: { sourceUrl: params.avatarUrl },
  })

  return { avatarR2Key: key, stored: true }
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
    friendWechat: {
      synckey: toIntOrDefault(env.WEREAD_FRIEND_WECHAT_SYNCKEY, 0),
      syncver: toIntOrDefault(env.WEREAD_FRIEND_WECHAT_SYNCVER, 0),
    },
    friendRanking: { synckey: toIntOrDefault(env.WEREAD_FRIEND_RANKING_SYNCKEY, 0) },
  }

  try {
    // Load previous sync state from DB (if present), else fall back to env.
    const stateRows = await env.DB
      .prepare('SELECT key, value FROM sync_state WHERE key IN (?1, ?2, ?3)')
      .bind('friend_wechat_synckey', 'friend_wechat_syncver', 'friend_ranking_synckey')
      .all<{ key: string; value: string }>()

    const state = new Map<string, string>((stateRows.results ?? []).map((r) => [r.key, r.value]))

    sync.friendWechat.synckey = toIntOrDefault(state.get('friend_wechat_synckey'), sync.friendWechat.synckey)
    sync.friendWechat.syncver = toIntOrDefault(state.get('friend_wechat_syncver'), sync.friendWechat.syncver)
    sync.friendRanking.synckey = toIntOrDefault(state.get('friend_ranking_synckey'), sync.friendRanking.synckey)

    const capturedAt = Date.now()

    const wechat = await fetchFriendWechat(env, {
      synckey: sync.friendWechat.synckey,
      syncver: sync.friendWechat.syncver,
      userClick: 1,
    })

    sync.friendWechat = { synckey: wechat.synckey, syncver: wechat.syncver }
    await setSyncState(env.DB, 'friend_wechat_synckey', String(sync.friendWechat.synckey))
    await setSyncState(env.DB, 'friend_wechat_syncver', String(sync.friendWechat.syncver))

    const usersMeta = wechat.usersMeta ?? []
    counts.friendsMeta = usersMeta.length

    await insertFriendMetaSnapshots(
      env.DB,
      usersMeta.map((m) => ({
        userVid: m.userVid,
        totalReadingTime: m.totalReadingTime,
        capturedAt,
      })),
    )

    const ranking = await fetchFriendRanking(env, { synckey: sync.friendRanking.synckey })
    sync.friendRanking = { synckey: ranking.synckey }
    await setSyncState(env.DB, 'friend_ranking_synckey', String(sync.friendRanking.synckey))

    counts.ranking = ranking.ranking?.length ?? 0

    await insertRankingSnapshots(
      env.DB,
      (ranking.ranking ?? []).map((r) => ({
        userVid: r.user.userVid,
        readingTime: r.readingTime,
        rankWeek: r.rankWeek,
        orderIndex: r.order,
        capturedAt,
      })),
    )

    // Best-effort upsert of user info included in ranking response.
    for (const r of ranking.ranking ?? []) {
      await upsertFriend(env.DB, {
        userVid: r.user.userVid,
        name: r.user.name ?? null,
        gender: r.user.gender ?? null,
        avatarUrl: r.user.avatar ?? null,
        isWeChatFriend: r.user.isWeChatFriend ?? null,
        isHide: r.user.isHide ?? null,
      })
    }

    // Fetch friend profiles (name/avatar/location/...) and optionally store avatars to R2.
    const uniqueVids = Array.from(new Set(usersMeta.map((m) => m.userVid)))
    const concurrency = 5

    await mapWithConcurrency(uniqueVids, concurrency, async (userVid) => {
      const profile = await fetchUser(env, userVid)

      let avatarR2Key: string | null = null
      if (profile.avatar) {
        const avatar = await storeAvatarIfNeeded(env, { userVid, avatarUrl: profile.avatar })
        avatarR2Key = avatar.avatarR2Key
        if (avatar.stored) counts.avatarsStored++
      }

      await upsertFriend(env.DB, {
        userVid,
        name: profile.name ?? null,
        gender: profile.gender ?? null,
        avatarUrl: profile.avatar ?? null,
        avatarR2Key,
        location: profile.location ?? null,
        isWeChatFriend: profile.isWeChatFriend ?? null,
        isHide: profile.isHide ?? null,
        signature: profile.signature ?? null,
      })

      counts.profiles++
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
  } catch (err) {
    const finishedAtMs = Date.now()
    const finishedAt = new Date(finishedAtMs).toISOString()
    const error = err instanceof Error ? err.message : String(err)

    if (runId !== null) {
      await finishRefreshRun(env.DB, { id: runId, finishedAt: finishedAtMs, ok: 0, error })
    }

    return {
      ok: false,
      source: options.source,
      startedAt,
      finishedAt,
      counts,
      sync,
      error,
    }
  }
}
