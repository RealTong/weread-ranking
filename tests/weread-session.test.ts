import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import worker from '../src/index'
import { refreshAll } from '../src/services/sync'
import { upsertFriend } from '../src/storage/db'
import { createTestD1Database } from './helpers/test-db'

type TestEnv = {
  API_KEY: string
  DB: ReturnType<typeof createTestD1Database>
  CORS_ORIGIN?: string
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

const capturedAndroidPayload = {
  vid: '449518091',
  skey: '',
  accessToken: '6aq6u4hw',
  refreshToken: '',
  basever: '7.5.2.10162694',
  appver: '7.5.2.10162694',
  v: '',
  channelId: '1',
  userAgent: 'WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)',
  osver: '13',
  baseapi: '33',
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

describe('WeRead credential management', () => {
  test('stores uploaded credentials in D1 and exposes them from the canonical admin endpoint', async () => {
    const env = createEnv()

    const updateResponse = await uploadCredentials(env, fullPayload)

    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      ok: true,
      status: {
        configured: true,
        vid: '123',
        source: 'd1',
      },
    })

    const statusResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/weread/credentials', {
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

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)
    expect((await uploadCredentials(env, { ...fullPayload, vid: '456' })).status).toBe(200)

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

  test('accepts captured weread payloads with empty string fields and string baseapi', async () => {
    const env = createEnv()

    const response = await uploadCredentials(env, capturedAndroidPayload)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: {
        configured: true,
        source: 'd1',
        vid: '449518091',
      },
    })

    const stored = await env.DB
      .prepare(
        `SELECT
          vid,
          skey,
          access_token as accessToken,
          refresh_token as refreshToken,
          basever,
          appver,
          v,
          channel_id as channelId,
          user_agent as userAgent,
          osver,
          baseapi
         FROM weread_credentials
         WHERE id = 'current'`,
      )
      .first<{
        vid: string
        skey: string
        accessToken: string
        refreshToken: string
        basever: string
        appver: string
        v: string
        channelId: string
        userAgent: string
        osver: string
        baseapi: string
      }>()

    expect(stored).toEqual({
      vid: '449518091',
      skey: '',
      accessToken: '6aq6u4hw',
      refreshToken: '',
      basever: '7.5.2.10162694',
      appver: '7.5.2.10162694',
      v: '',
      channelId: '1',
      userAgent: 'WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)',
      osver: '13',
      baseapi: '33',
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

      if (url.pathname === '/user/profile') {
        return jsonResponse({
          totalReadingTime: 100,
          totalLikedCount: 1,
          name: 'friend',
          gender: 2,
          isHide: 0,
        })
      }

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

  test('reuses stored credentials for refresh and enriches friends from profile endpoints', async () => {
    const env = createEnv()
    const seenHeaders: string[] = []
    const fetchedProfiles: string[] = []

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const url = new URL(request.url)

      if (url.pathname === '/user/profile') {
        fetchedProfiles.push(`profile:${url.searchParams.get('userVid') ?? ''}`)
        expect(request.headers.get('accessToken')).toBe('access-token')
        expect(request.headers.get('user-agent')).toBe('WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)')
        return jsonResponse({
          totalReadingTime: 100,
          totalLikedCount: 74,
          name: 'profile-friend',
          gender: 2,
          isHide: 1,
        })
      }

      if (url.pathname === '/user') {
        fetchedProfiles.push(`user:${url.searchParams.get('userVid') ?? ''}`)
        expect(request.headers.get('accessToken')).toBe('access-token')
        expect(request.headers.get('baseapi')).toBe('303')
        return jsonResponse({
          userVid: 888,
          name: 'user-friend',
          gender: 2,
          avatar: 'https://example.com/avatar-888.png',
          isWeChatFriend: 1,
          isHide: 1,
          signature: 'hello world',
          location: 'Beijing',
          publish: 0,
        })
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
    expect(result.counts).toEqual({
      friendsMeta: 1,
      profiles: 1,
      ranking: 1,
    })
    expect(seenHeaders).toEqual(['access-token'])
    expect(fetchedProfiles).toEqual(['profile:888', 'user:888'])
  })

  test('fails refresh cleanly when no current credentials exist', async () => {
    const env = createEnv()

    const result = await refreshAll(env as never, { source: 'api' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('No credentials configured')
  })

  test('fills wechat-only friends in the API response with profile and avatar data', async () => {
    const env = createEnv()

    globalThis.fetch = (async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/user/profile') {
        const userVid = Number(url.searchParams.get('userVid') ?? 0)
        return jsonResponse({
          totalReadingTime: userVid === 999 ? 42 : 100,
          totalLikedCount: userVid === 999 ? 74 : 11,
          name: userVid === 999 ? 'hidden-friend' : 'ranked-friend',
          gender: 2,
          isHide: userVid === 999 ? 1 : 0,
        })
      }

      if (url.pathname === '/user') {
        const userVid = Number(url.searchParams.get('userVid') ?? 0)
        return jsonResponse({
          userVid,
          name: userVid === 999 ? 'hidden-friend' : 'ranked-friend',
          gender: 2,
          avatar: userVid === 999 ? 'https://example.com/avatar-999.png' : null,
          isWeChatFriend: 1,
          isHide: userVid === 999 ? 1 : 0,
          signature: userVid === 999 ? 'secret reader' : '',
          location: userVid === 999 ? '北京 海淀' : '',
          publish: 0,
        })
      }

      if (url.pathname === '/friend/wechat') {
        return jsonResponse({
          synckey: 11,
          syncver: 22,
          usersMeta: [
            { userVid: 888, totalReadingTime: 100 },
            { userVid: 999, totalReadingTime: 42 },
          ],
        })
      }

      if (url.pathname === '/friend/ranking') {
        return jsonResponse({
          synckey: 55,
          ranking: [
            {
              user: {
                userVid: 888,
                name: 'ranked-friend',
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

      throw new Error(`Unexpected fetch: ${url.toString()}`)
    }) as typeof fetch

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)
    expect((await refreshAll(env as never, { source: 'api' })).ok).toBe(true)

    const response = await worker.fetch(
      new Request('http://worker.test/api/friends', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({ ok: true })
    expect(json.friends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userVid: 999,
          latestTotalReadingTime: 42,
          name: 'hidden-friend',
          avatarUrl: 'https://example.com/avatar-999.png',
          location: '北京 海淀',
          signature: 'secret reader',
          isWeChatFriend: 1,
          isHide: 1,
        }),
      ]),
    )
  })
})

describe('My read books sync', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/user/profile') {
        return jsonResponse({
          totalReadingTime: 100,
          totalLikedCount: 1,
          name: 'reader',
          gender: 2,
          isHide: 0,
        })
      }

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

describe('Route split compatibility', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input) => {
      const url = toUrl(input)

      if (url.pathname === '/user/profile') {
        return jsonResponse({
          totalReadingTime: 100,
          totalLikedCount: 1,
          name: 'friend',
          gender: 2,
          isHide: 0,
        })
      }

      if (url.pathname === '/user') {
        return jsonResponse({
          userVid: Number(url.searchParams.get('userVid') ?? 0),
          name: 'friend',
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

  test('supports both /api/admin/refresh and legacy /api/refresh', async () => {
    const env = createEnv()

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)

    const adminResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/refresh', {
        method: 'POST',
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const legacyResponse = await worker.fetch(
      new Request('http://worker.test/api/refresh', {
        method: 'POST',
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(adminResponse.status).toBe(200)
    expect(legacyResponse.status).toBe(200)
  })

  test('does not expose removed legacy credential compatibility endpoints', async () => {
    const env = createEnv()

    const requests = [
      new Request('http://worker.test/api/admin/weread/session', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      new Request('http://worker.test/api/admin/weread/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.API_KEY,
        },
        body: JSON.stringify(fullPayload),
      }),
      new Request('http://worker.test/api/admin/credentials', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      new Request('http://worker.test/api/admin/credentials', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.API_KEY,
        },
        body: JSON.stringify(fullPayload),
      }),
    ]

    const responses = await Promise.all(requests.map((request) => worker.fetch(request, env as never)))

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404])
  })

  test('rejects unauthorized admin and query requests after the route split', async () => {
    const env = createEnv()

    const adminResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/weread/credentials'),
      env as never,
    )
    const queryResponse = await worker.fetch(
      new Request('http://worker.test/api/friends'),
      env as never,
    )

    expect(adminResponse.status).toBe(401)
    expect(queryResponse.status).toBe(401)
  })

  test('includes CORS headers on unauthorized API responses for allowed origins', async () => {
    const env = {
      ...createEnv(),
      CORS_ORIGIN: 'https://app.example.com',
    }

    const response = await worker.fetch(
      new Request('http://worker.test/api/friends', {
        headers: {
          origin: 'https://app.example.com',
        },
      }),
      env as never,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unauthorized',
    })
  })

  test('fails closed when API_KEY is not configured', async () => {
    const envWithoutKey = { DB: createTestD1Database() }

    const response = await worker.fetch(
      new Request('http://worker.test/api/friends'),
      envWithoutKey as never,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'API_KEY not configured',
    })
  })

  test('fails closed for OPTIONS requests when API_KEY is not configured', async () => {
    const envWithoutKey = { DB: createTestD1Database() }

    const response = await worker.fetch(
      new Request('http://worker.test/api/friends', {
        method: 'OPTIONS',
      }),
      envWithoutKey as never,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'API_KEY not configured',
    })
  })

  test('preserves query response envelopes after the route split', async () => {
    const env = createEnv()

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)
    expect(
      (
        await worker.fetch(
          new Request('http://worker.test/api/admin/refresh', {
            method: 'POST',
            headers: { 'x-api-key': env.API_KEY },
          }),
          env as never,
        )
      ).status,
    ).toBe(200)

    const aioResponse = await worker.fetch(
      new Request('http://worker.test/api/aio?limit=10&offset=0', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const friendsResponse = await worker.fetch(
      new Request('http://worker.test/api/friends?limit=10&offset=0', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const historyResponse = await worker.fetch(
      new Request('http://worker.test/api/friends/888/history?limit=10', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const readBooksResponse = await worker.fetch(
      new Request('http://worker.test/api/readbooks?limit=10&offset=0', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const rankingResponse = await worker.fetch(
      new Request('http://worker.test/api/ranking', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(aioResponse.status).toBe(200)
    await expect(aioResponse.json()).resolves.toMatchObject({
      ok: true,
      latest: {
        metaCapturedAt: expect.any(Number),
        rankingCapturedAt: expect.any(Number),
      },
      friends: expect.any(Array),
      ranking: {
        rows: expect.any(Array),
      },
    })

    expect(friendsResponse.status).toBe(200)
    await expect(friendsResponse.json()).resolves.toMatchObject({
      ok: true,
      friends: expect.any(Array),
    })

    expect(historyResponse.status).toBe(200)
    await expect(historyResponse.json()).resolves.toMatchObject({
      ok: true,
      history: {
        userVid: 888,
        meta: expect.any(Array),
        ranking: expect.any(Array),
      },
    })

    expect(readBooksResponse.status).toBe(200)
    await expect(readBooksResponse.json()).resolves.toMatchObject({
      ok: true,
      latest: {
        sourceSynckey: 77,
      },
      readBooks: expect.any(Array),
    })

    expect(rankingResponse.status).toBe(200)
    await expect(rankingResponse.json()).resolves.toMatchObject({
      ok: true,
      ranking: {
        capturedAt: expect.any(Number),
        rows: expect.any(Array),
      },
    })
  })

  test('reads refreshed data back from D1 through the query API', async () => {
    const env = createEnv()

    expect((await uploadCredentials(env, fullPayload)).status).toBe(200)

    const refreshResponse = await worker.fetch(
      new Request('http://worker.test/api/admin/refresh', {
        method: 'POST',
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )
    const rankingResponse = await worker.fetch(
      new Request('http://worker.test/api/ranking', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(refreshResponse.status).toBe(200)
    expect(rankingResponse.status).toBe(200)
    await expect(rankingResponse.json()).resolves.toMatchObject({
      ok: true,
      ranking: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            userVid: 888,
            readingTime: 10,
          }),
        ]),
      },
    })
  })

  test('does not expose the removed avatar endpoint', async () => {
    const env = createEnv()

    await upsertFriend(env.DB as never, { userVid: 888 })

    const response = await worker.fetch(
      new Request('http://worker.test/api/avatars/888', {
        headers: { 'x-api-key': env.API_KEY },
      }),
      env as never,
    )

    expect(response.status).toBe(404)
  })
})
