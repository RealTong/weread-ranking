import { Hono } from 'hono'
import type { CloudflareBindings } from '../types'
import {
  getFriendAvatarInfo,
  getFriendHistory,
  getFriendsWithLatestMeta,
  getLatestFriendMetaCapturedAt,
  getLatestRanking,
  setSyncState,
} from '../storage/db'
import { getWeReadCredentialsStatus, normalizeWeReadCredentials, setWeReadCredentials } from '../credentials'
import { refreshAll } from '../workflows/refresh'
import { fetchUser } from '../weread'

export const api = new Hono<{ Bindings: CloudflareBindings }>()

api.use('*', async (c, next) => {
  const expected = c.env.API_KEY
  if (!expected) return next()

  const headerKey = c.req.header('x-api-key')?.trim()
  const auth = c.req.header('authorization')?.trim()
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined
  const provided = headerKey ?? bearer

  if (!provided || provided !== expected) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  return next()
})

api.get('/aio', async (c) => {
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
    friends: friends.map((f) => {
      const r = rankingMap.get(f.userVid)
      return {
        ...f,
        latestRanking: r
          ? { capturedAt: ranking.capturedAt, readingTime: r.readingTime, rankWeek: r.rankWeek, orderIndex: r.orderIndex }
          : null,
      }
    }),
    ranking,
  })
})

api.get('/friends', async (c) => {
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '200', 10)
  const offsetRaw = Number.parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0
  const friends = await getFriendsWithLatestMeta(c.env.DB, { limit, offset })
  return c.json({ ok: true, friends })
})

api.get('/ranking', async (c) => {
  const ranking = await getLatestRanking(c.env.DB)
  return c.json({ ok: true, ranking })
})

api.get('/friends/:userVid/history', async (c) => {
  const userVid = Number.parseInt(c.req.param('userVid'), 10)
  if (!Number.isFinite(userVid)) return c.json({ ok: false, error: 'Invalid userVid' }, 400)
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200
  const history = await getFriendHistory(c.env.DB, userVid, { limit })
  return c.json({ ok: true, history })
})

api.get('/avatars/:userVid', async (c) => {
  const userVid = Number.parseInt(c.req.param('userVid'), 10)
  if (!Number.isFinite(userVid)) return c.json({ ok: false, error: 'Invalid userVid' }, 400)

  const info = await getFriendAvatarInfo(c.env.DB, userVid)
  if (!info) return c.json({ ok: false, error: 'Not found' }, 404)

  if (c.env.AVATARS && info.avatarR2Key) {
    const obj = await c.env.AVATARS.get(info.avatarR2Key)
    if (obj) {
      const headers = new Headers()
      obj.writeHttpMetadata(headers)
      headers.set('etag', obj.httpEtag)
      return new Response(obj.body, { headers })
    }
  }

  if (info.avatarUrl) return c.redirect(info.avatarUrl, 302)
  return c.json({ ok: false, error: 'No avatar' }, 404)
})

api.post('/refresh', async (c) => {
  const result = await refreshAll(c.env, { source: 'api' })
  return c.json(result, result.ok ? 200 : 500)
})

api.get('/admin/credentials', async (c) => {
  if (!c.env.API_KEY) return c.json({ ok: false, error: 'API_KEY not configured' }, 400)
  const status = await getWeReadCredentialsStatus(c.env)
  return c.json({ ok: true, status })
})

api.post('/admin/credentials', async (c) => {
  if (!c.env.API_KEY) return c.json({ ok: false, error: 'API_KEY not configured' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  const b = body as Record<string, unknown>
  let creds
  try {
    creds = normalizeWeReadCredentials({
      vid: typeof b.vid === 'string' ? b.vid : '',
      skey: typeof b.skey === 'string' ? b.skey : '',
      basever: typeof b.basever === 'string' ? b.basever : undefined,
      v: typeof b.v === 'string' ? b.v : undefined,
      channelId: typeof b.channelId === 'string' ? b.channelId : undefined,
      userAgent: typeof b.userAgent === 'string' ? b.userAgent : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ ok: false, error: message }, 400)
  }

  const selfUserVid = Number.parseInt(creds.vid, 10)
  if (!Number.isFinite(selfUserVid)) return c.json({ ok: false, error: 'Invalid vid' }, 400)

  try {
    await fetchUser(creds, selfUserVid)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ ok: false, error: `Credentials validation failed: ${message}` }, 400)
  }

  const resetSync = b.resetSync === true
  if (resetSync) {
    await Promise.all([
      setSyncState(c.env.DB, 'friend_wechat_synckey', '0'),
      setSyncState(c.env.DB, 'friend_wechat_syncver', '0'),
      setSyncState(c.env.DB, 'friend_ranking_synckey', '0'),
    ])
  }

  try {
    const { updatedAt } = await setWeReadCredentials(c.env, creds)
    return c.json({
      ok: true,
      updatedAt,
      updatedAtIso: new Date(updatedAt).toISOString(),
      resetSync,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ ok: false, error: message }, 500)
  }
})
