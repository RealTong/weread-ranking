# WeRead Service Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Worker into a minimal WeRead service layer that stores one current MITM-uploaded credential set, reuses it for cron/manual sync, and serves only authenticated D1-backed read APIs.

**Architecture:** Replace the monolithic `api.ts` and `credentials.ts` flow with separate admin/query routes, a dedicated credential service/storage path, and a sync orchestrator. Move the WeRead HTTP client behind a new integration module that uses the full captured credential payload, remove `/user` profile enrichment and R2 avatar caching from refresh, and keep query response envelopes stable for existing clients.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1, Bun test, Wrangler migrations

---

## Execution Notes

- The current workspace is dirty (`package.json`, `request.http`, `src/credentials.ts`). Do not revert unrelated user changes.
- Start implementation in a clean branch or worktree before touching source files.
- Preserve the top-level response envelopes for `/api/aio`, `/api/friends`, `/api/ranking`, and `/api/readbooks`.
- Keep `POST /api/refresh` as a compatibility alias for the new canonical admin refresh route.
- Leave legacy `weread_session` and `credentials` tables in place for this refactor unless a cleanup step is required later; do not add a backfill requirement to this plan.

## File Map

**Create**

- `migrations/0005_weread_credentials.sql`
  Single-row `weread_credentials` table.
- `src/storage/credentials.ts`
  D1 read/write helpers for the current credential row.
- `src/services/credentials.ts`
  Request-body parsing, normalization, response shaping, and sync-reset decision logic.
- `src/services/sync.ts`
  Shared cron/manual refresh orchestration.
- `src/routes/admin.ts`
  Credential upload, credential status, manual refresh, and refresh alias handlers.
- `src/routes/query.ts`
  D1-backed read endpoints only.
- `src/routes/middleware.ts`
  Shared `x-api-key` authentication middleware.
- `src/integrations/weread.ts`
  WeRead HTTP client using the full credential payload.

**Modify**

- `src/index.ts`
  Register new routes and point `scheduled` at the new sync service.
- `src/types.ts`
  Remove `AVATARS` from bindings and keep only active runtime types.
- `src/storage/db.ts`
  Remove avatar-only helper usage, keep friend/ranking/reading snapshot helpers, and simplify refresh counters if needed.
- `tests/weread-session.test.ts`
  Rewrite integration tests around the new credential route, new sync behavior, and compatibility alias.
- `README.md`
  Update the setup flow and admin endpoints.
- `request.http`
  Update example requests to use the new credential payload and routes.
- `wrangler.jsonc`
  Remove the obsolete `AVATARS` binding so deployment config matches runtime code.

**Delete after replacements are wired**

- `src/routes/api.ts`
- `src/credentials.ts`
- `src/workflows/refresh.ts`
- `src/weread.ts`

### Task 1: Create Isolation and Lock the New Credential Contract

**Files:**
- Modify: `tests/weread-session.test.ts`
- Create: `migrations/0005_weread_credentials.sql`
- Create: `src/storage/credentials.ts`
- Create: `src/services/credentials.ts`
- Create: `src/routes/admin.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Create a clean branch or worktree before editing**

Run:

```bash
git worktree add ../weread-ranking-refactor -b codex/weread-service-layer-refactor
```

Expected: a new worktree is created on branch `codex/weread-service-layer-refactor`.

- [ ] **Step 2: Write failing tests for the new credential upload and status routes**

Replace the old session-oriented assertions in `tests/weread-session.test.ts` with a full-payload credential flow:

```ts
const fullPayload = {
  vid: '123',
  skey: 'new-skey',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  basever: '10.1.0.80',
  appver: '8.4.0',
  v: '10.1.0.80',
  channelId: '10086',
  userAgent: 'Android Weread',
  osver: 'Android 14',
  baseapi: 1,
}

test('stores the current credentials and hides sensitive fields from responses', async () => {
  const updateResponse = await worker.fetch(
    new Request('http://worker.test/api/admin/weread/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.API_KEY,
      },
      body: JSON.stringify(fullPayload),
    }),
    env as never,
  )

  expect(updateResponse.status).toBe(200)
  await expect(updateResponse.json()).resolves.toMatchObject({
    ok: true,
    credentials: {
      vid: '123',
    },
    syncReset: {
      applied: false,
      reason: null,
    },
  })

  const statusResponse = await worker.fetch(
    new Request('http://worker.test/api/admin/weread/credentials', {
      headers: { 'x-api-key': env.API_KEY },
    }),
    env as never,
  )

  const statusBody = await statusResponse.json()
  expect(statusBody.status).toEqual({
    configured: true,
    source: 'd1',
    vid: '123',
    updatedAt: expect.any(Number),
    updatedAtIso: expect.any(String),
  })
  expect(JSON.stringify(statusBody)).not.toContain('access-token')
  expect(JSON.stringify(statusBody)).not.toContain('refresh-token')
})

test('rejects invalid credential payloads with 400', async () => {
  const response = await worker.fetch(
    new Request('http://worker.test/api/admin/weread/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.API_KEY,
      },
      body: JSON.stringify({ vid: '123' }),
    }),
    env as never,
  )

  expect(response.status).toBe(400)
})
```

- [ ] **Step 3: Run the focused test and confirm it fails for the right reason**

Run:

```bash
bun test tests/weread-session.test.ts --filter "stores the current credentials"
bun test tests/weread-session.test.ts --filter "rejects invalid credential payloads"
```

Expected: FAIL because `/api/admin/weread/credentials` is missing and the response body still follows the old session schema.

- [ ] **Step 4: Implement the new current-credentials slice**

Add the new migration and minimal storage/service/route wiring.

`migrations/0005_weread_credentials.sql`

```sql
CREATE TABLE IF NOT EXISTS weread_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  vid TEXT NOT NULL,
  skey TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  basever TEXT NOT NULL,
  appver TEXT NOT NULL,
  v TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  osver TEXT NOT NULL,
  baseapi INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`src/storage/credentials.ts`

```ts
const CURRENT_CREDENTIALS_ROW_ID = 'current'

export async function getCurrentWeReadCredentials(db: D1Database) {
  return await db
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
         baseapi,
         updated_at as updatedAt
       FROM weread_credentials
       WHERE id = ?1`,
    )
    .bind(CURRENT_CREDENTIALS_ROW_ID)
    .first()
}
```

`src/services/credentials.ts`

```ts
export type WeReadCredentials = {
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
  baseapi: number
}

export function normalizeWeReadCredentials(input: Record<string, unknown>): WeReadCredentials {
  const value = {
    vid: String(input.vid ?? '').trim(),
    skey: String(input.skey ?? '').trim(),
    accessToken: String(input.accessToken ?? '').trim(),
    refreshToken: String(input.refreshToken ?? '').trim(),
    basever: String(input.basever ?? '').trim(),
    appver: String(input.appver ?? '').trim(),
    v: String(input.v ?? '').trim(),
    channelId: String(input.channelId ?? '').trim(),
    userAgent: String(input.userAgent ?? '').trim(),
    osver: String(input.osver ?? '').trim(),
    baseapi: Number(input.baseapi),
  }

  if (!value.vid) throw new Error('Missing vid')
  if (!value.skey) throw new Error('Missing skey')
  if (!value.accessToken) throw new Error('Missing accessToken')
  if (!value.refreshToken) throw new Error('Missing refreshToken')
  if (!value.basever) throw new Error('Missing basever')
  if (!value.appver) throw new Error('Missing appver')
  if (!value.v) throw new Error('Missing v')
  if (!value.channelId) throw new Error('Missing channelId')
  if (!value.userAgent) throw new Error('Missing userAgent')
  if (!value.osver) throw new Error('Missing osver')
  if (!Number.isFinite(value.baseapi)) throw new Error('Invalid baseapi')

  return value
}
```

`src/routes/admin.ts`

```ts
admin.get('/weread/credentials', async (c) => {
  const status = await getWeReadCredentialsStatus(c.env.DB)
  return c.json({ ok: true, status })
})

admin.post('/weread/credentials', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>
  const credentials = normalizeWeReadCredentials(body)
  const previous = await getCurrentWeReadCredentials(c.env.DB)
  const resetSync = body.resetSync === true
  const shouldReset = shouldResetWeReadSyncState(previous?.vid, credentials.vid, resetSync)
  const stored = await setCurrentWeReadCredentials(c.env.DB, credentials)

  if (shouldReset) {
    await resetWeReadSyncState(c.env.DB)
  }

  return c.json({
    ok: true,
    credentials: {
      vid: stored.vid,
      updatedAt: stored.updatedAt,
      updatedAtIso: new Date(stored.updatedAt).toISOString(),
    },
    syncReset: {
      applied: shouldReset,
      reason: resetSync ? 'requested' : previous?.vid && previous.vid !== credentials.vid ? 'vid_changed' : null,
    },
  })
})
```

Update `src/index.ts` to register the new admin router at `/api/admin`.

- [ ] **Step 5: Re-run the targeted test and the typechecker**

Run:

```bash
bun test tests/weread-session.test.ts --filter "stores the current credentials"
bun test tests/weread-session.test.ts --filter "rejects invalid credential payloads"
bun run typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the credential slice**

Run:

```bash
git add migrations/0005_weread_credentials.sql src/storage/credentials.ts src/services/credentials.ts src/routes/admin.ts src/index.ts src/types.ts tests/weread-session.test.ts
git commit -m "feat: add current weread credentials admin flow"
```

### Task 2: Replace Session Reset Logic and Preserve the New Admin Surface

**Files:**
- Modify: `tests/weread-session.test.ts`
- Modify: `src/storage/credentials.ts`
- Modify: `src/services/credentials.ts`
- Modify: `src/routes/admin.ts`
- Delete: `src/credentials.ts`

- [ ] **Step 1: Add failing tests for sync reset and compatibility behavior**

Add or update tests so they cover:

```ts
test('resets incremental sync cursors when the uploaded vid changes', async () => {
  await seedSyncState(env.DB)
  await postCredentials(env, { ...fullPayload, vid: '123' })
  await postCredentials(env, { ...fullPayload, vid: '456' })
  expect(await readSyncState(env.DB)).toEqual({
    friend_wechat_synckey: '0',
    friend_wechat_syncver: '0',
    friend_ranking_synckey: '0',
  })
})

test('resets incremental sync cursors when resetSync is true', async () => {
  await seedSyncState(env.DB)
  await postCredentials(env, { ...fullPayload, resetSync: true })
  expect(await readSyncState(env.DB)).toEqual({
    friend_wechat_synckey: '0',
    friend_wechat_syncver: '0',
    friend_ranking_synckey: '0',
  })
})
```

- [ ] **Step 2: Run the focused reset tests**

Run:

```bash
bun test tests/weread-session.test.ts --filter "resets incremental sync cursors"
```

Expected: FAIL because the route still uses mixed session-era behavior or legacy helpers.

- [ ] **Step 3: Collapse the last session-era helpers into the new service/storage path**

Move all remaining `getWeReadCredentialsStatus`, `shouldResetWeReadSyncState`, and `setCurrentWeReadCredentials` logic into the new split modules so the deleted `src/credentials.ts` file is no longer imported anywhere.

Representative target shape:

```ts
export async function getWeReadCredentialsStatus(db: D1Database) {
  const current = await getCurrentWeReadCredentials(db)
  if (!current) return { configured: false, source: 'none' } as const

  return {
    configured: true,
    source: 'd1' as const,
    vid: current.vid,
    updatedAt: current.updatedAt,
    updatedAtIso: new Date(current.updatedAt).toISOString(),
  }
}
```

Delete `src/credentials.ts` once the new imports are wired and tests compile against the new modules only.

- [ ] **Step 4: Re-run the focused reset tests and a full admin-route pass**

Run:

```bash
bun test tests/weread-session.test.ts --filter "WeRead"
```

Expected: PASS for the credential/status/reset scenarios.

- [ ] **Step 5: Commit the session-to-credentials cleanup**

Run:

```bash
git add src/storage/credentials.ts src/services/credentials.ts src/routes/admin.ts tests/weread-session.test.ts
git rm src/credentials.ts
git commit -m "refactor: replace legacy session helpers"
```

### Task 3: Refactor the WeRead Client and Shared Sync Service

**Files:**
- Modify: `tests/weread-session.test.ts`
- Create: `src/integrations/weread.ts`
- Create: `src/services/sync.ts`
- Modify: `src/storage/db.ts`
- Modify: `src/index.ts`
- Delete: `src/workflows/refresh.ts`
- Delete: `src/weread.ts`

- [ ] **Step 1: Write failing sync tests that assert full credential reuse and no `/user` profile fetch**

Replace the old refresh mocks so they prove the new service path uses the stored credential payload directly:

```ts
test('reuses stored credentials for refresh and does not fetch per-friend profiles', async () => {
  const seenHeaders: string[] = []

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)

    if (url.pathname === '/user') {
      throw new Error('Unexpected fetch: /user')
    }

    if (url.pathname === '/friend/wechat') {
      seenHeaders.push(request.headers.get('accessToken') ?? '')
      return jsonResponse({
        synckey: 11,
        syncver: 22,
        usersMeta: [{ userVid: 888, totalReadingTime: 100 }],
      })
    }

    if (url.pathname === '/friend/ranking') {
      expect(request.headers.get('refreshToken')).toBe('refresh-token')
      expect(request.headers.get('appver')).toBe('8.4.0')
      expect(request.headers.get('osver')).toBe('Android 14')
      expect(request.headers.get('baseapi')).toBe('1')
      return jsonResponse({
        synckey: 55,
        ranking: [{ user: { userVid: 888, name: 'friend', avatar: null }, readingTime: 10, rankWeek: 1, order: 1 }],
      })
    }

    if (url.pathname === '/mine/readbook') {
      return jsonResponse({ stars: [], years: [], ratings: [], yearPreference: [], readBooks: [], hasMore: 0, totalCount: 0, synckey: 77 })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  await postCredentials(env, fullPayload)
  const result = await refreshAll(env as never, { source: 'api' })
  expect(result.ok).toBe(true)
  expect(seenHeaders).toEqual(['access-token'])
})

test('fails refresh cleanly when no current credentials exist', async () => {
  const result = await refreshAll(env as never, { source: 'api' })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('No credentials configured')
})
```

- [ ] **Step 2: Run the focused sync tests**

Run:

```bash
bun test tests/weread-session.test.ts --filter "refresh"
```

Expected: FAIL because refresh still imports `src/workflows/refresh.ts`, still calls `/user`, and does not send the full credential header set.

- [ ] **Step 3: Implement the new integration and sync orchestrator**

Create `src/integrations/weread.ts` with a shared header builder:

```ts
function buildHeaders(creds: WeReadCredentials): HeadersInit {
  return {
    accept: '*/*',
    vid: creds.vid,
    skey: creds.skey,
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    basever: creds.basever,
    appver: creds.appver,
    v: creds.v,
    channelId: creds.channelId,
    'user-agent': creds.userAgent,
    osver: creds.osver,
    baseapi: String(creds.baseapi),
  }
}
```

Create `src/services/sync.ts` by moving the existing orchestration out of `src/workflows/refresh.ts`, then simplify it:

```ts
const counts = { friendsMeta: 0, ranking: 0, readBooks: 0 }

const credentials = await requireCurrentWeReadCredentials(env.DB)
const state = await loadSyncState(env.DB)
const capturedAt = Date.now()

const wechat = await fetchFriendWechat(credentials, { synckey: state.friendWechat.synckey, syncver: state.friendWechat.syncver, userClick: 1 })
await persistWechatState(env.DB, wechat)
await insertFriendMetaSnapshots(...)

const ranking = await fetchFriendRanking(credentials, { synckey: state.friendRanking.synckey })
await persistRankingState(env.DB, ranking)
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

const readBooks = await fetchAllMineReadBooks(credentials)
await replaceMyReadBooksSnapshot(env.DB, ...)
```

Delete the `storeAvatarIfNeeded` path and remove `fetchUser` imports entirely.

- [ ] **Step 4: Re-run the sync tests, the read-books test, and the typechecker**

Run:

```bash
bun test tests/weread-session.test.ts --filter "refresh"
bun test tests/weread-session.test.ts --filter "read books"
bun run typecheck
```

Expected: PASS, with no `/user` fetches and no avatar/R2 usage in the refresh path.

- [ ] **Step 5: Commit the sync refactor**

Run:

```bash
git add src/integrations/weread.ts src/services/sync.ts src/storage/db.ts src/index.ts tests/weread-session.test.ts
git rm src/workflows/refresh.ts src/weread.ts
git commit -m "refactor: move sync flow to service layer modules"
```

### Task 4: Extract Shared Auth and Query Routes, Then Remove the Monolith

**Files:**
- Create: `src/routes/middleware.ts`
- Create: `src/routes/query.ts`
- Modify: `src/index.ts`
- Modify: `tests/weread-session.test.ts`
- Delete: `src/routes/api.ts`

- [ ] **Step 1: Write failing route-level tests for query compatibility and refresh alias**

Add explicit route assertions:

```ts
test('supports both /api/admin/refresh and legacy /api/refresh', async () => {
  await postCredentials(env, fullPayload)

  const adminResponse = await worker.fetch(new Request('http://worker.test/api/admin/refresh', { method: 'POST', headers: { 'x-api-key': env.API_KEY } }), env as never)
  const legacyResponse = await worker.fetch(new Request('http://worker.test/api/refresh', { method: 'POST', headers: { 'x-api-key': env.API_KEY } }), env as never)

  expect(adminResponse.status).toBe(200)
  expect(legacyResponse.status).toBe(200)
})

test('keeps the /api/readbooks envelope stable after the route split', async () => {
  const response = await worker.fetch(
    new Request('http://worker.test/api/readbooks?limit=10&markStatus=4', {
      headers: { 'x-api-key': env.API_KEY },
    }),
    env as never,
  )

  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    latest: expect.any(Object),
    totalCount: expect.any(Number),
    hasMore: expect.any(Boolean),
    readBooks: expect.any(Array),
  })
})

test('rejects unauthorized admin and query requests after the route split', async () => {
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

test('fails closed when API_KEY is not configured', async () => {
  const envWithoutKey = { DB: createTestD1Database() }
  const response = await worker.fetch(
    new Request('http://worker.test/api/friends'),
    envWithoutKey as never,
  )

  expect(response.status).toBe(500)
})

test('reads refreshed data back from D1 through the query API', async () => {
  await postCredentials(env, fullPayload)
  await worker.fetch(
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

  await expect(rankingResponse.json()).resolves.toMatchObject({
    ok: true,
    ranking: {
      rows: expect.any(Array),
    },
  })
})
```

- [ ] **Step 2: Run the focused route tests**

Run:

```bash
bun test tests/weread-session.test.ts --filter "supports both /api/admin/refresh and legacy /api/refresh"
bun test tests/weread-session.test.ts --filter "keeps the /api/readbooks envelope stable"
bun test tests/weread-session.test.ts --filter "rejects unauthorized admin and query requests"
bun test tests/weread-session.test.ts --filter "fails closed when API_KEY is not configured"
bun test tests/weread-session.test.ts --filter "reads refreshed data back from D1 through the query API"
```

Expected: FAIL because route registration still depends on `src/routes/api.ts`.

- [ ] **Step 3: Move auth middleware and query handlers into focused route modules**

Create `src/routes/middleware.ts`:

```ts
export async function requireApiKey(c: Context<{ Bindings: CloudflareBindings }>, next: Next) {
  if (c.req.method === 'OPTIONS') return next()
  const expected = c.env.API_KEY
  if (!expected) {
    return c.json({ ok: false, error: 'API_KEY not configured' }, 500)
  }

  const headerKey = c.req.header('x-api-key')?.trim()
  const auth = c.req.header('authorization')?.trim()
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined
  const provided = headerKey ?? bearer

  if (!provided || provided !== expected) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  return next()
}
```

Create `src/routes/query.ts` by moving the existing `/aio`, `/friends`, `/ranking`, `/readbooks`, and `/friends/:userVid/history` handlers unchanged except for import paths. Keep `src/routes/admin.ts` mounted under `/api/admin` so the canonical endpoints remain:

- `GET /api/admin/weread/credentials`
- `POST /api/admin/weread/credentials`
- `POST /api/admin/refresh`

Preserve `POST /api/refresh` as a dedicated compatibility alias wired directly in `src/index.ts` or exported from the admin module. Wire the routers explicitly in `src/index.ts`:

```ts
app.use('/api/*', requireApiKey)
app.route('/api', queryRoutes)
app.route('/api/admin', adminRoutes)
app.post('/api/refresh', manualRefreshAlias)
```

Delete `src/routes/api.ts` after `src/index.ts` no longer imports it.

- [ ] **Step 4: Run the route tests and the full suite**

Run:

```bash
bun test tests/weread-session.test.ts
bun run typecheck
```

Expected: PASS, with the old monolithic router removed and all query envelopes preserved.

- [ ] **Step 5: Commit the route split**

Run:

```bash
git add src/routes/middleware.ts src/routes/query.ts src/routes/admin.ts src/index.ts tests/weread-session.test.ts
git rm src/routes/api.ts
git commit -m "refactor: split admin and query routes"
```

### Task 5: Remove Dead Avatar Surface, Refresh Docs, and Verify the Whole Refactor

**Files:**
- Modify: `src/types.ts`
- Modify: `src/storage/db.ts`
- Modify: `README.md`
- Modify: `request.http`
- Modify: `wrangler.jsonc`
- Modify: `tests/weread-session.test.ts`

- [ ] **Step 1: Add a failing regression test that the removed avatar endpoint is no longer part of the API surface**

Add:

```ts
test('does not expose the removed avatar endpoint', async () => {
  const response = await worker.fetch(
    new Request('http://worker.test/api/avatars/888', {
      headers: { 'x-api-key': env.API_KEY },
    }),
    env as never,
  )

  expect(response.status).toBe(404)
})
```

- [ ] **Step 2: Run the focused dead-surface regression test**

Run:

```bash
bun test tests/weread-session.test.ts --filter "does not expose the removed avatar endpoint"
```

Expected: FAIL until the old route and `AVATARS` binding are fully removed.

- [ ] **Step 3: Remove remaining avatar-only code and update operator docs**

Apply the last cleanup:

```ts
// src/types.ts
export type CloudflareBindings = {
  API_KEY?: string
  CORS_ORIGIN?: string
  DB: D1Database
}
```

Delete `getFriendAvatarInfo` from `src/storage/db.ts` if nothing imports it. Then update `README.md` and `request.http` so they document:

- `POST /api/admin/weread/credentials`
- `GET /api/admin/weread/credentials`
- `POST /api/admin/refresh`
- `POST /api/refresh` as compatibility alias
- the full credential JSON payload
- the fact that clients always read cached D1 data with `x-api-key`

Update `wrangler.jsonc` in the same commit so the removed `AVATARS` binding is deleted from the Worker config.

- [ ] **Step 4: Run the full verification pass**

Run:

```bash
bun test
bun run typecheck
```

Expected: all tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the docs and final cleanup**

Run:

```bash
git add src/types.ts src/storage/db.ts README.md request.http tests/weread-session.test.ts
git add wrangler.jsonc
git commit -m "docs: finalize weread service layer refactor"
```

## Final Verification Checklist

- [ ] `POST /api/admin/weread/credentials` stores a single current credential row.
- [ ] `GET /api/admin/weread/credentials` reports safe status metadata only.
- [ ] `POST /api/admin/refresh` and `POST /api/refresh` both call the same sync handler.
- [ ] Refresh reads credentials from D1 and never calls `/user`.
- [ ] Query routes still serve D1-backed data with the same top-level envelopes.
- [ ] `GET /api/friends/:userVid/history` still returns snapshot history from D1.
- [ ] `x-api-key` is required on admin and query routes.
- [ ] Avatar/R2 behavior is gone from runtime code.
