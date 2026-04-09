import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import {
  getFriendHistory,
  getFriendsWithLatestMeta,
  getLatestFriendMetaCapturedAt,
  getLatestRanking,
} from '../storage/db'
import { getMyReadBooksPage, getMyReadBooksState } from '../storage/readbooks'

export const query = new Hono<{ Bindings: CloudflareBindings }>()

query.get('/aio', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '200', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0

  const [friends, metaCapturedAt, ranking] = await Promise.all([
    getFriendsWithLatestMeta(c.env.DB, { limit, offset }),
    getLatestFriendMetaCapturedAt(c.env.DB),
    getLatestRanking(c.env.DB),
  ])

  const rankingMap = new Map<number, (typeof ranking.rows)[number]>()
  for (const row of ranking.rows) rankingMap.set(row.userVid, row)

  return c.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    latest: { metaCapturedAt, rankingCapturedAt: ranking.capturedAt },
    friends: friends.map((friend) => {
      const latestRanking = rankingMap.get(friend.userVid)
      return {
        ...friend,
        latestRanking: latestRanking
          ? {
              capturedAt: ranking.capturedAt,
              readingTime: latestRanking.readingTime,
              rankWeek: latestRanking.rankWeek,
              orderIndex: latestRanking.orderIndex,
            }
          : null,
      }
    }),
    ranking,
  })
})

query.get('/friends', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '200', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0
  const friends = await getFriendsWithLatestMeta(c.env.DB, { limit, offset })
  return c.json({ ok: true, friends })
})

query.get('/ranking', async (c) => {
  const ranking = await getLatestRanking(c.env.DB)
  return c.json({ ok: true, ranking })
})

query.get('/readbooks', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const markStatusRaw = c.req.query('markStatus')
  const markStatus = markStatusRaw === undefined ? undefined : Number.parseInt(markStatusRaw, 10)

  if (markStatusRaw !== undefined && !Number.isFinite(markStatus)) {
    return c.json({ ok: false, error: 'Invalid markStatus' }, 400)
  }

  const [state, books] = await Promise.all([
    getMyReadBooksState(c.env.DB),
    getMyReadBooksPage(c.env.DB, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
      markStatus,
    }),
  ])

  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  return c.json({
    ok: true,
    latest: {
      syncedAt: state.updatedAt,
      syncedAtIso: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
      sourceSynckey: state.sourceSynckey,
      totalCount: state.totalCount,
      stars: state.stars,
      years: state.years,
      ratings: state.ratings,
      yearPreference: state.yearPreference,
    },
    totalCount: books.totalCount,
    hasMore: offset + books.rows.length < books.totalCount,
    limit,
    offset,
    readBooks: books.rows,
  })
})

query.get('/friends/:userVid/history', async (c) => {
  const userVid = Number.parseInt(c.req.param('userVid'), 10)
  if (!Number.isFinite(userVid)) return c.json({ ok: false, error: 'Invalid userVid' }, 400)

  const limitRaw = Number.parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200
  const history = await getFriendHistory(c.env.DB, userVid, { limit })
  return c.json({ ok: true, history })
})
