import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import worker from '../src/index'
import { refreshAll } from '../src/services/sync'
import { createTestD1Database } from './helpers/test-db'

type TestEnv = {
  API_KEY: string
  DB: ReturnType<typeof createTestD1Database>
  CORS_ORIGIN?: string
  AVATARS?: R2Bucket
}

function createEnv(): TestEnv {
  return {
    API_KEY: 'test-api-key',
    DB: createTestD1Database(),
  }
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  })
}

function toUrl(input: string | URL | Request) {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof Request) return new URL(input.url)
  return new URL(input.toString())
}

async function updateSession(env: TestEnv, body: Record<string, unknown>) {
  return await worker.fetch(
    new Request('http://worker.test/api/admin/weread/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.API_KEY,
      },
      body: JSON.stringify(body),
    }),
    env as never,
  )
}

async function uploadCredentials(env: TestEnv, body: Record<string, unknown>) {
  return await worker.fetch(
    new Request('http://worker.test/api/admin/weread/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.API_KEY,
      },
      body: JSON.stringify(body),
    }),
    env as never,
  )
}

const fullPayload = {
  vid: '123',
  skey: 'test-skey',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  basever: '10.1.0.80',
  appver: '8.2.4.101',
  v: '10.1.0.80',
  channelId: 'AppStore',
  userAgent: 'WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)',
  osver: '16.7.12',
  baseapi: 303,
}

async function seedSyncState(db: TestEnv['DB']) {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?1, ?2, ?3), (?4, ?5, ?6), (?7, ?8, ?9)`,
    )
    .bind(
      'friend_wechat_synckey',
      '9',
      now,
      'friend_wechat_syncver',
      '10',
      now,
      'friend_ranking_synckey',
      '11',
      now,
    )
    .run()
}

async function readSyncState(db: TestEnv['DB']) {
  const syncRows = await db
    .prepare(
      `SELECT key, value
       FROM sync_state
       WHERE key IN (?1, ?2, ?3)
       ORDER BY key ASC`,
    )
    .bind('friend_ranking_synckey', 'friend_wechat_synckey', 'friend_wechat_syncver')
    .all<{ key: string; value: string }>()

  return Object.fromEntries(syncRows.results.map((row) => [row.key, row.value]))
}

const originalFetch = globalThis.fetch

describe('WeRead session management', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = toUrl(input)
      if (url.pathname === '/user') {
        return jsonResponse({
          userVid: Number(url.searchParams.get('userVid') ?? 0),
          name: 'self',
        })
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('stores the active session in D1 and exposes it from the new admin endpoint', async () => {
    const env = createEnv()

    const updateResponse = await updateSession(env, {
      vid: '123',
      skey: 'new-skey',
    })

    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      ok: true,
      session: {
        vid: '123',
      },
    })

    const statusResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/weread/session', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(statusResponse.status).toBe(200)
    await expect(statusResponse.json()).resolves.toMatchObject({
      ok: true,
      status: {
        configured: true,
        vid: '123',
        source: 'd1',
      },
    })
  })

  test('resets incremental sync cursors when the bound vid changes', async () => {
    const env = createEnv()

    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?1, ?2, ?3), (?4, ?5, ?6), (?7, ?8, ?9)`,
    )
      .bind(
        'friend_wechat_synckey',
        '9',
        Date.now(),
        'friend_wechat_syncver',
        '10',
        Date.now(),
        'friend_ranking_synckey',
        '11',
        Date.now(),
      )
      .run()

    expect((await updateSession(env, { vid: '123', skey: 'first-skey' })).status).toBe(200)
    expect((await updateSession(env, { vid: '456', skey: 'second-skey' })).status).toBe(200)

    const syncRows = await env.DB.prepare(
      `SELECT key, value
       FROM sync_state
       WHERE key IN (?1, ?2, ?3)
       ORDER BY key ASC`,
    )
      .bind('friend_ranking_synckey', 'friend_wechat_synckey', 'friend_wechat_syncver')
      .all<{ key: string; value: string }>()

    expect(syncRows.results).toEqual([
      { key: 'friend_ranking_synckey', value: '0' },
      { key: 'friend_wechat_synckey', value: '0' },
      { key: 'friend_wechat_syncver', value: '0' },
    ])
  })
})

describe('WeRead credential contract', () => {
  test('stores uploaded credentials and exposes only safe status metadata', async () => {
    const env = createEnv()

    const uploadResponse = await uploadCredentials(env, fullPayload)

    expect(uploadResponse.status).toBe(200)
    const uploadJson = await uploadResponse.json()
    expect(uploadJson).toMatchObject({
      ok: true,
      status: {
        configured: true,
        source: 'd1',
        vid: '123',
      },
    })
    expect(JSON.stringify(uploadJson)).not.toContain('access-token')
    expect(JSON.stringify(uploadJson)).not.toContain('refresh-token')

    const statusResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/weread/credentials', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(statusResponse.status).toBe(200)
    const statusJson = await statusResponse.json()
    expect(statusJson).toMatchObject({
      ok: true,
      status: {
        configured: true,
        source: 'd1',
        vid: '123',
      },
    })
    expect(statusJson.status.updatedAt).toEqual(expect.any(Number))
    expect(statusJson.status.updatedAtIso).toEqual(expect.any(String))
    expect(JSON.stringify(statusJson)).not.toContain('access-token')
    expect(JSON.stringify(statusJson)).not.toContain('refresh-token')
  })

  test('rejects invalid credential payloads with HTTP 400', async () => {
    const env = createEnv()

    const response = await uploadCredentials(env, {
      ...fullPayload,
      baseapi: '303',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('baseapi'),
    })
  })

  test('rejects weread credential rows whose id is not current', async () => {
    const env = createEnv()

    await expect(
      env.DB.prepare(
        `INSERT INTO weread_credentials (
          id,
          vid,
          skey,
          access_token,
          refresh_token,
          basever,
          appver,
          v,
          channel_id,
          user_agent,
          osver,
          baseapi,
          updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
        )`,
      )
        .bind(
          'not-current',
          '123',
          'test-skey',
          'access-token',
          'refresh-token',
          '10.1.0.80',
          '8.2.4.101',
          '10.1.0.80',
          'AppStore',
          'WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)',
          '16.7.12',
          303,
          Date.now(),
        )
        .run(),
    ).rejects.toThrow(/constraint/i)
  })

  test('resets incremental sync cursors when the uploaded vid changes', async () => {
    const env = createEnv()

    await seedSyncState(env.DB)
    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)
    const secondResponse = await uploadCredentials(env, { ...fullPayload, vid: '456' })

    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      syncReset: {
        applied: true,
        reason: 'vid_changed',
      },
    })

    expect(await readSyncState(env.DB)).toEqual({
      friend_wechat_synckey: '0',
      friend_wechat_syncver: '0',
      friend_ranking_synckey: '0',
    })
  })

  test('resets incremental sync cursors when resetSync is true', async () => {
    const env = createEnv()

    await seedSyncState(env.DB)
    const response = await uploadCredentials(env, { ...fullPayload, resetSync: true })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      syncReset: {
        applied: true,
        reason: 'requested',
      },
    })

    expect(await readSyncState(env.DB)).toEqual({
      friend_wechat_synckey: '0',
      friend_wechat_syncver: '0',
      friend_ranking_synckey: '0',
    })
  })
})

describe('Incremental refresh cursors', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/user') {
        return jsonResponse({
          userVid: Number(url.searchParams.get('userVid') ?? 0),
          name: 'friend',
          avatar: null,
        })
      }

      if (url.pathname === '/friend/wechat') {
        const synckey = url.searchParams.get('synckey')
        const syncver = url.searchParams.get('syncver')

        if (synckey === '0' && syncver === '0') {
          return jsonResponse({
            synckey: 11,
            syncver: 22,
            usersMeta: [{ userVid: 888, totalReadingTime: 100 }],
          })
        }

        if (synckey === '11' && syncver === '22') {
          return jsonResponse({
            synckey: 33,
            syncver: 44,
            usersMeta: [{ userVid: 888, totalReadingTime: 120 }],
          })
        }
      }

      if (url.pathname === '/friend/ranking') {
        const synckey = url.searchParams.get('synckey')

        if (synckey === '0') {
          return jsonResponse({
            synckey: 55,
            ranking: [
              {
                user: {
                  userVid: 888,
                  name: 'friend',
                  avatar: null,
                },
                readingTime: 10,
                rankWeek: 1,
                order: 1,
              },
            ],
          })
        }

        if (synckey === '55') {
          return jsonResponse({
            synckey: 66,
            ranking: [
              {
                user: {
                  userVid: 888,
                  name: 'friend',
                  avatar: null,
                },
                readingTime: 12,
                rankWeek: 1,
                order: 1,
              },
            ],
          })
        }
      }

      if (url.pathname === '/mine/readbook') {
        return jsonResponse({
          stars: [],
          years: [],
          ratings: [],
          yearPreference: [],
          readBooks: [],
          hasMore: 0,
          totalCount: 0,
          synckey: 77,
        })
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('persists sync cursors in D1 and reuses them on the next refresh', async () => {
    const env = createEnv()

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)

    const firstRun = await refreshAll(env as never, { source: 'api' })
    expect(firstRun.ok).toBe(true)
    expect(firstRun.sync).toEqual({
      friendWechat: { synckey: 11, syncver: 22 },
      friendRanking: { synckey: 55 },
    })

    const secondRun = await refreshAll(env as never, { source: 'api' })
    expect(secondRun.ok).toBe(true)
    expect(secondRun.sync).toEqual({
      friendWechat: { synckey: 33, syncver: 44 },
      friendRanking: { synckey: 66 },
    })

    const syncRows = await env.DB.prepare(
      `SELECT key, value
       FROM sync_state
       WHERE key IN (?1, ?2, ?3)
       ORDER BY key ASC`,
    )
      .bind('friend_ranking_synckey', 'friend_wechat_synckey', 'friend_wechat_syncver')
      .all<{ key: string; value: string }>()

    expect(syncRows.results).toEqual([
      { key: 'friend_ranking_synckey', value: '66' },
      { key: 'friend_wechat_synckey', value: '33' },
      { key: 'friend_wechat_syncver', value: '44' },
    ])
  })

  test('reuses stored credentials for refresh and does not fetch per-friend profiles', async () => {
    const env = createEnv()
    const seenHeaders: string[] = []

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const url = new URL(request.url)

      if (url.pathname === '/user') {
        throw new Error('Unexpected fetch: /user')
      }

      if (url.pathname === '/friend/wechat') {
        seenHeaders.push(request.headers.get('accessToken') ?? '')
        expect(request.headers.get('vid')).toBe('123')
        expect(request.headers.get('skey')).toBe('test-skey')
        return jsonResponse({
          synckey: 11,
          syncver: 22,
          usersMeta: [{ userVid: 888, totalReadingTime: 100 }],
        })
      }

      if (url.pathname === '/friend/ranking') {
        expect(request.headers.get('accessToken')).toBe('access-token')
        expect(request.headers.get('refreshToken')).toBe('refresh-token')
        expect(request.headers.get('basever')).toBe('10.1.0.80')
        expect(request.headers.get('appver')).toBe('8.2.4.101')
        expect(request.headers.get('v')).toBe('10.1.0.80')
        expect(request.headers.get('channelId')).toBe('AppStore')
        expect(request.headers.get('user-agent')).toBe('WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)')
        expect(request.headers.get('osver')).toBe('16.7.12')
        expect(request.headers.get('baseapi')).toBe('303')
        return jsonResponse({
          synckey: 55,
          ranking: [
            {
              user: {
                userVid: 888,
                name: 'friend',
                avatar: null,
              },
              readingTime: 10,
              rankWeek: 1,
              order: 1,
            },
          ],
        })
      }

      if (url.pathname === '/mine/readbook') {
        return jsonResponse({
          stars: [],
          years: [],
          ratings: [],
          yearPreference: [],
          readBooks: [],
          hasMore: 0,
          totalCount: 0,
          synckey: 77,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await uploadCredentials(env, fullPayload)
    const result = await refreshAll(env as never, { source: 'api' })

    expect(result.ok).toBe(true)
    expect(seenHeaders).toEqual(['access-token'])
  })

  test('fails refresh cleanly when no current credentials exist', async () => {
    const env = createEnv()

    const result = await refreshAll(env as never, { source: 'api' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('No credentials configured')
  })
})

describe('My read books sync', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/user') {
        return jsonResponse({
          userVid: Number(url.searchParams.get('userVid') ?? 0),
          name: 'reader',
          avatar: null,
        })
      }

      if (url.pathname === '/friend/wechat') {
        return jsonResponse({
          synckey: 11,
          syncver: 22,
          usersMeta: [{ userVid: 888, totalReadingTime: 100 }],
        })
      }

      if (url.pathname === '/friend/ranking') {
        return jsonResponse({
          synckey: 55,
          ranking: [
            {
              user: {
                userVid: 888,
                name: 'friend',
                avatar: null,
              },
              readingTime: 10,
              rankWeek: 1,
              order: 1,
            },
          ],
        })
      }

      if (url.pathname === '/mine/readbook') {
        const synckey = url.searchParams.get('synckey')

        if (!synckey) {
          return jsonResponse({
            stars: [{ id: 4, title: '未点评', type: 2 }],
            years: [{ id: '0_0', title: '全部', type: 0 }],
            ratings: [{ id: 0, title: '全部', type: 1 }],
            yearPreference: [{ year: 2026, count: 2, preference: '' }],
            readBooks: [
              {
                bookId: 'book-1',
                startReadingTime: 1773220701,
                markStatus: 4,
                progress: 100,
                readtime: 7869,
                title: 'Finished Book',
                author: 'Author A',
                cover: 'https://example.com/book-1.jpg',
              },
              {
                bookId: 'book-2',
                startReadingTime: 1773220600,
                markStatus: 2,
                progress: 23,
                readtime: 1234,
                title: 'Reading Book',
                author: 'Author B',
                cover: 'https://example.com/book-2.jpg',
              },
            ],
            hasMore: 1,
            totalCount: 3,
            synckey: 9001,
          })
        }

        if (synckey === '9001') {
          return jsonResponse({
            stars: [{ id: 4, title: '未点评', type: 2 }],
            years: [{ id: '0_0', title: '全部', type: 0 }],
            ratings: [{ id: 0, title: '全部', type: 1 }],
            yearPreference: [{ year: 2026, count: 2, preference: '' }],
            readBooks: [
              {
                bookId: 'book-3',
                startReadingTime: 1773220500,
                finishTime: 1773220555,
                markStatus: 4,
                progress: 98,
                readtime: 2222,
                title: 'Finished Book 2',
                author: 'Author C',
                cover: 'https://example.com/book-3.jpg',
              },
            ],
            hasMore: 0,
            totalCount: 3,
            synckey: 9002,
          })
        }
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('syncs paged mine/readbook results into D1 and serves them from the local API', async () => {
    const env = createEnv()

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)

    const refreshResult = await refreshAll(env as never, { source: 'api' })
    expect(refreshResult.ok).toBe(true)

    const response = await worker.fetch(
      new Request('http://worker.test/api/readbooks?limit=10&markStatus=4', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      totalCount: 2,
      hasMore: false,
      latest: {
        sourceSynckey: 9002,
        totalCount: 3,
        stars: [{ id: 4, title: '未点评', type: 2 }],
      },
      readBooks: [
        {
          bookId: 'book-1',
          markStatus: 4,
          readingState: 'finished',
        },
        {
          bookId: 'book-3',
          markStatus: 4,
          readingState: 'finished',
        },
      ],
    })
  })
})
