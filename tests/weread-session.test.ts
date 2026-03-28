import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import worker from '../src/index'
import { refreshAll } from '../src/workflows/refresh'
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

      throw new Error(`Unexpected fetch: ${url.toString()}`)
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('persists sync cursors in D1 and reuses them on the next refresh', async () => {
    const env = createEnv()

    expect((await updateSession(env, { vid: '123', skey: 'new-skey' })).status).toBe(200)

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
})
