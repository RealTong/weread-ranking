import type { RefreshSource } from '../types'

export type SyncStateKey =
  | 'friend_wechat_synckey'
  | 'friend_wechat_syncver'
  | 'friend_ranking_synckey'

export async function getSyncState(db: D1Database, key: SyncStateKey): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM sync_state WHERE key = ?1')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

export async function setSyncState(db: D1Database, key: SyncStateKey, value: string): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run()
}

export type FriendUpsert = {
  userVid: number
  name?: string | null
  gender?: number | null
  avatarUrl?: string | null
  avatarR2Key?: string | null
  location?: string | null
  isWeChatFriend?: number | null
  isHide?: number | null
  signature?: string | null
}

export async function upsertFriend(db: D1Database, friend: FriendUpsert): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO friends (
          user_vid, name, gender, avatar_url, avatar_r2_key, location,
          is_wechat_friend, is_hide, signature, created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6,
          ?7, ?8, ?9, ?10, ?11
        )
        ON CONFLICT(user_vid) DO UPDATE SET
          name = COALESCE(excluded.name, friends.name),
          gender = COALESCE(excluded.gender, friends.gender),
          avatar_url = COALESCE(excluded.avatar_url, friends.avatar_url),
          avatar_r2_key = COALESCE(excluded.avatar_r2_key, friends.avatar_r2_key),
          location = COALESCE(excluded.location, friends.location),
          is_wechat_friend = COALESCE(excluded.is_wechat_friend, friends.is_wechat_friend),
          is_hide = COALESCE(excluded.is_hide, friends.is_hide),
          signature = COALESCE(excluded.signature, friends.signature),
          updated_at = excluded.updated_at`,
    )
    .bind(
      friend.userVid,
      friend.name ?? null,
      friend.gender ?? null,
      friend.avatarUrl ?? null,
      friend.avatarR2Key ?? null,
      friend.location ?? null,
      friend.isWeChatFriend ?? null,
      friend.isHide ?? null,
      friend.signature ?? null,
      now,
      now,
    )
    .run()
}

export async function getFriendAvatarInfo(
  db: D1Database,
  userVid: number,
): Promise<{ avatarUrl: string | null; avatarR2Key: string | null } | null> {
  return await db
    .prepare('SELECT avatar_url as avatarUrl, avatar_r2_key as avatarR2Key FROM friends WHERE user_vid = ?1')
    .bind(userVid)
    .first<{ avatarUrl: string | null; avatarR2Key: string | null }>()
}

export type FriendMetaSnapshot = {
  userVid: number
  totalReadingTime: number
  capturedAt: number
}

export async function insertFriendMetaSnapshots(
  db: D1Database,
  snapshots: FriendMetaSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) return
  const stmts = snapshots.map((s) =>
    db
      .prepare(
        'INSERT INTO friend_meta_snapshots (user_vid, total_reading_time, captured_at) VALUES (?1, ?2, ?3)',
      )
      .bind(s.userVid, s.totalReadingTime, s.capturedAt),
  )
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100))
  }
}

export type RankingSnapshot = {
  userVid: number
  readingTime: number
  rankWeek: number
  orderIndex: number
  capturedAt: number
}

export async function insertRankingSnapshots(db: D1Database, snapshots: RankingSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return
  const stmts = snapshots.map((s) =>
    db
      .prepare(
        `INSERT INTO ranking_snapshots (user_vid, reading_time, rank_week, order_index, captured_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(s.userVid, s.readingTime, s.rankWeek, s.orderIndex, s.capturedAt),
  )
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100))
  }
}

export type CreateRefreshRun = {
  source: RefreshSource
  startedAt: number
  scheduledTime?: string | null
}

export async function createRefreshRun(db: D1Database, run: CreateRefreshRun): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO refresh_runs (source, started_at, scheduled_time, ok)
       VALUES (?1, ?2, ?3, NULL)`,
    )
    .bind(run.source, run.startedAt, run.scheduledTime ?? null)
    .run()
  return Number(res.meta.last_row_id)
}

export async function finishRefreshRun(
  db: D1Database,
  params: {
    id: number
    finishedAt: number
    ok: 0 | 1
    error?: string | null
    friendsMetaCount?: number
    profilesCount?: number
    rankingCount?: number
    avatarsStoredCount?: number
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE refresh_runs
       SET finished_at = ?2,
           ok = ?3,
           error = ?4,
           friends_meta_count = ?5,
           profiles_count = ?6,
           ranking_count = ?7,
           avatars_stored_count = ?8
       WHERE id = ?1`,
    )
    .bind(
      params.id,
      params.finishedAt,
      params.ok,
      params.error ?? null,
      params.friendsMetaCount ?? null,
      params.profilesCount ?? null,
      params.rankingCount ?? null,
      params.avatarsStoredCount ?? null,
    )
    .run()
}

export type FriendWithLatestMeta = {
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
}

export async function getFriendsWithLatestMeta(
  db: D1Database,
  params: { limit: number; offset: number },
): Promise<FriendWithLatestMeta[]> {
  const limitInput = Number.isFinite(params.limit) ? params.limit : 200
  const offsetInput = Number.isFinite(params.offset) ? params.offset : 0
  const limit = Math.min(Math.max(limitInput, 1), 500)
  const offset = Math.max(offsetInput, 0)
  const res = await db
    .prepare(
      `SELECT
          f.user_vid as userVid,
          f.name as name,
          f.gender as gender,
          f.avatar_url as avatarUrl,
          f.avatar_r2_key as avatarR2Key,
          f.location as location,
          f.is_wechat_friend as isWeChatFriend,
          f.is_hide as isHide,
          f.signature as signature,
          f.updated_at as updatedAt,
          s.total_reading_time as latestTotalReadingTime,
          s.captured_at as latestMetaCapturedAt
        FROM friends f
        LEFT JOIN friend_meta_snapshots s
          ON s.user_vid = f.user_vid
         AND s.captured_at = (
           SELECT MAX(captured_at)
           FROM friend_meta_snapshots
           WHERE user_vid = f.user_vid
         )
        ORDER BY COALESCE(s.total_reading_time, 0) DESC, f.user_vid ASC
        LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<FriendWithLatestMeta>()
  return res.results ?? []
}

export type LatestRanking = {
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

export async function getLatestRanking(db: D1Database): Promise<LatestRanking> {
  const latest = await db.prepare('SELECT MAX(captured_at) as capturedAt FROM ranking_snapshots').first<{
    capturedAt: number | null
  }>()
  const capturedAt = latest?.capturedAt ?? null
  if (!capturedAt) return { capturedAt: null, rows: [] }

  const res = await db
    .prepare(
      `SELECT
          r.user_vid as userVid,
          r.reading_time as readingTime,
          r.rank_week as rankWeek,
          r.order_index as orderIndex,
          f.name as name,
          f.avatar_url as avatarUrl,
          f.avatar_r2_key as avatarR2Key
        FROM ranking_snapshots r
        LEFT JOIN friends f ON f.user_vid = r.user_vid
        WHERE r.captured_at = ?1
        ORDER BY r.order_index ASC`,
    )
    .bind(capturedAt)
    .all<LatestRanking['rows'][number]>()

  return { capturedAt, rows: res.results ?? [] }
}

export async function getLatestFriendMetaCapturedAt(db: D1Database): Promise<number | null> {
  const latest = await db.prepare('SELECT MAX(captured_at) as capturedAt FROM friend_meta_snapshots').first<{
    capturedAt: number | null
  }>()
  return latest?.capturedAt ?? null
}

export type FriendHistory = {
  userVid: number
  meta: Array<{ capturedAt: number; totalReadingTime: number }>
  ranking: Array<{ capturedAt: number; readingTime: number; rankWeek: number; orderIndex: number }>
}

export async function getFriendHistory(
  db: D1Database,
  userVid: number,
  params: { limit: number },
): Promise<FriendHistory> {
  const limitInput = Number.isFinite(params.limit) ? params.limit : 200
  const limit = Math.min(Math.max(limitInput, 1), 500)

  const metaRes = await db
    .prepare(
      `SELECT captured_at as capturedAt, total_reading_time as totalReadingTime
       FROM friend_meta_snapshots
       WHERE user_vid = ?1
       ORDER BY captured_at DESC
       LIMIT ?2`,
    )
    .bind(userVid, limit)
    .all<{ capturedAt: number; totalReadingTime: number }>()

  const rankingRes = await db
    .prepare(
      `SELECT captured_at as capturedAt, reading_time as readingTime, rank_week as rankWeek, order_index as orderIndex
       FROM ranking_snapshots
       WHERE user_vid = ?1
       ORDER BY captured_at DESC
       LIMIT ?2`,
    )
    .bind(userVid, limit)
    .all<{ capturedAt: number; readingTime: number; rankWeek: number; orderIndex: number }>()

  return { userVid, meta: metaRes.results ?? [], ranking: rankingRes.results ?? [] }
}
