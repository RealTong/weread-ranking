# weread-ranking worker (Cloudflare Workers + Hono)

Serverless API to fetch WeRead (微信读书) friends data, store snapshots in D1, optionally store avatars in R2, and expose an all-in-one API.

## Setup

```bash
cd worker
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

Local dev: copy `worker/.dev.vars.example` → `worker/.dev.vars` and fill:
- `API_KEY`
- `WEREAD_VID`
- `WEREAD_SKEY`

Prod: use `wrangler secret put`:

```bash
bunx wrangler secret put API_KEY
bunx wrangler secret put WEREAD_VID
bunx wrangler secret put WEREAD_SKEY
```

## Run

```bash
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

## Notes

- The cron schedule is configured in `wrangler.jsonc` under `triggers.crons` (default: hourly).
- If you find `synckey/syncver` must start from a non-zero cursor, set `WEREAD_FRIEND_*` vars once; after the first successful refresh they are persisted in D1.
