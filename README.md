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
- `WEREAD_VID`
- `WEREAD_SKEY`
- (optional) `CRED_ENC_KEY` (for rotating skey via API)
- (optional) `CORS_ORIGIN` (for calling API from a separate web origin)

Prod: use `wrangler secret put`:

```bash
bunx wrangler secret put API_KEY
bunx wrangler secret put WEREAD_VID
bunx wrangler secret put WEREAD_SKEY
bunx wrangler secret put CRED_ENC_KEY
```

### Optional: rotate skey without redeploy

If `skey` expires frequently, the simplest approach is updating `WEREAD_SKEY` via `wrangler secret put`.

If you want to update it via HTTP (no redeploy), set `CRED_ENC_KEY` and call:

```bash
curl -X POST "http://127.0.0.1:8787/api/admin/credentials" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"vid":"<your vid>","skey":"<new skey>","resetSync":true}'
```

This stores credentials encrypted in D1 and refresh jobs will prefer the D1-stored credentials.

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
- `GET /api/admin/credentials` credentials status (requires `API_KEY`)
- `POST /api/admin/credentials` set encrypted credentials in D1 (requires `API_KEY`)

## Notes

- The cron schedule is configured in `wrangler.jsonc` under `triggers.crons` (default: hourly).
- If you find `synckey/syncver` must start from a non-zero cursor, set `WEREAD_FRIEND_*` vars once; after the first successful refresh they are persisted in D1.
