# weread-ranking

- `src/`：Cloudflare Workers + Hono（serverless API）
- `web/`：shadcn/ui + Vite 的 Web UI（展示朋友阅读数据与历史变化）
- `private/captures/`：抓包得到的请求/响应（已忽略，不要提交到 Git）

## Setup

```bash
bun install
```

### 1) Create D1 + R2

```bash
bunx wrangler d1 create weread-ranking
bunx wrangler r2 bucket create weread-avatars
```

Update `wrangler.jsonc`:
- set `d1_databases[0].database_id`
- adjust bucket name if you used a different one

### 2) Run migrations

Local (for `wrangler dev`):

```bash
bun run migrate:local
```

Remote (your Cloudflare account):

```bash
bun run migrate:remote
```

### 3) Configure secrets

Local dev: copy `.dev.vars.example` → `.dev.vars` and fill:
- `API_KEY`
- (optional) `CORS_ORIGIN` (for calling API from a separate web origin)

Prod: use `wrangler secret put`:

```bash
bunx wrangler secret put API_KEY
```

### Configure WeRead session

After deployment, push the current `vid` + `skey` into the Worker through the admin API:

```bash
curl -X POST "https://<your-worker>/api/admin/weread/session" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{"vid":"449518091","skey":"your-latest-skey"}'
```

When `skey` rotates, call the same API again. The Worker caches the newest session in D1 and all refresh jobs reuse it.

## Run

```bash
bun run dev
```

## Web UI (local)

```bash
cd web
bun install
bun run dev
```

## API

All endpoints below require `x-api-key: <API_KEY>` if `API_KEY` is set.

- `POST /api/refresh` refresh & persist data
- `GET /api/aio` all-in-one payload (friends + latest ranking)
- `GET /api/friends?limit=200&offset=0` friends with latest lifetime reading time
- `GET /api/ranking` latest weekly ranking snapshot
- `GET /api/friends/:userVid/history?limit=200` per-friend history
- `GET /api/avatars/:userVid` R2 avatar (or redirect to original URL)
- `GET /api/admin/weread/session` current WeRead session status (requires `API_KEY`)
- `POST /api/admin/weread/session` update cached `vid` + `skey` in D1 (requires `API_KEY`)

## Notes

- The cron schedule is configured in `wrangler.jsonc` under `triggers.crons` (default: hourly).
- Incremental sync cursors (`synckey` / `syncver`) live in D1 and are reused across refresh runs.
- If the bound `vid` changes, the Worker automatically resets incremental sync cursors before the next sync.
