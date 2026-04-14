# weread-ranking

[中文说明](./README_ZH.md)

`weread-ranking` is a Cloudflare Workers service for syncing WeRead data into D1 and serving stable cached APIs.

It is designed around a practical workflow:

- WeRead credentials expire quickly and should not be hard-coded as long-lived environment variables.
- An Android device can periodically refresh those credentials by opening a proxy app and WeRead.
- The Worker stores the latest credential payload in D1, reuses it for sync jobs, and serves only local cached data to consumers.

## Features

- Store exactly one current WeRead credential set in D1
- Sync friend reading time snapshots
- Sync friend ranking snapshots
- Sync your `/mine/readbook` history into D1
- Expose cached HTTP APIs for friends, ranking, and read books
- Support both manual credential upload and Android-based automatic credential capture

## End-to-End Flow

1. An Android automation launches the proxy app and then launches WeRead.
2. The bundled rewrite script captures the WeRead `/login` response and selected request headers.
3. The script forwards that payload to `POST /api/admin/weread/credentials`.
4. The Worker stores the latest credential set in D1.
5. Scheduled cron runs or `POST /api/admin/refresh` reuse the stored credentials to sync WeRead data into D1.
6. Your frontend or scripts read only from this project's cached APIs such as `/api/aio` and `/api/readbooks`.

## Repository Files

- [`src/`](./src): Worker routes, services, D1 access, and WeRead integration code
- [`migrations/`](./migrations): D1 schema migrations
- [`http/`](./http): Bruno collection for local and remote API requests
- [`weread-rewrite.js`](./weread-rewrite.js): rewrite script that forwards WeRead credentials to the Worker
- [`weread-rewrite.macro`](./weread-rewrite.macro): Android automation macro export that opens the proxy app and WeRead on an interval
- [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro): fallback MacroDroid export for devices with screen power / lock-state automation issues
- [`test.http`](./test.http): simple raw HTTP examples kept for quick manual checks

## Prerequisites

- A Cloudflare account
- [Bun](https://bun.sh/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- An Android device if you want automatic credential capture
- A proxy app compatible with the bundled rewrite script

## Worker Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Create the D1 database

```bash
bunx wrangler d1 create weread-ranking
```

### 3. Update `wrangler.jsonc`

Fill in your own D1 `database_id` and review the cron schedule.

Relevant fields:

- `d1_databases[0].database_id`
- `triggers.crons`

The current Worker cron is hourly:

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

### 4. Configure local secrets

```bash
cp .dev.vars.example .dev.vars
```

Fill in:

```bash
API_KEY="replace-with-a-long-random-string"
CORS_ORIGIN="http://localhost:3000"
```

Notes:

- `API_KEY` protects all admin and query APIs.
- `CORS_ORIGIN` is optional.
- Multiple allowed origins can be provided as a comma-separated list.

### 5. Apply migrations

For local development:

```bash
bun run migrate:local
```

For the deployed Cloudflare D1 database:

```bash
bun run migrate:remote
```

### 6. Start local development

```bash
bun run dev
```

Default local URL:

```text
http://localhost:8787
```

## Android Automation for Credential Capture

This repository now includes two Android-side assets:

- [`weread-rewrite.js`](./weread-rewrite.js)
- [`weread-rewrite.macro`](./weread-rewrite.macro)
- [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro)

Important naming note:

- The user-facing workflow may refer to "Proxybin", but the bundled assets in this repository target `ProxyPin`.
- The macro launches package `com.network.proxy`, and the script comments also reference ProxyPin.

### What `weread-rewrite.js` does

The rewrite script:

- watches requests to `weread.qq.com`
- filters for the `/login` flow
- parses the WeRead login response JSON
- reads these request headers when available:
  - `v`
  - `basever`
  - `baseapi`
  - `channelId`
  - `appver`
  - `User-Agent`
  - `osver`
- asynchronously forwards the payload to your Worker at `POST /api/admin/weread/credentials`
- returns the original response unchanged so the mobile app continues working normally

Current behavior from the bundled script:

- it only forwards when both `vid` and `skey` are present in the `/login` response
- the Worker itself is more permissive and can store empty-string fields, but the script still uses `vid + skey` as its send condition

### Configure `weread-rewrite.js`

Edit these placeholders before importing it into your proxy app:

```js
var API_URL = "YOUR_API_URL/api/admin/weread/credentials";
var API_KEY = "YOUR_API_KEY";
```

Guidance:

- For local development, `API_URL` must use a LAN-reachable host such as `http://192.168.x.x:8787`, not `http://localhost:8787`.
- For production, use your deployed Worker URL such as `https://<your-worker-domain>/api/admin/weread/credentials`.
- Use the same `API_KEY` configured in `.dev.vars` locally or in Cloudflare secrets remotely.

### Import and validate the Android macro

`weread-rewrite.macro` is an Android automation export that performs the capture flow for you.

Based on the exported macro JSON, one run does this:

1. Launch `ProxyPin` (`com.network.proxy`)
2. Wait 3 seconds
3. Tap a fixed screen coordinate to start or confirm the proxy flow
4. Wait 5 seconds
5. Launch WeRead (`com.tencent.weread`) with a fresh start
6. Wait 30 seconds so the `/login` request can happen and the rewrite script can upload credentials
7. Close WeRead
8. Close ProxyPin

The bundled export currently uses:

- a regular 3600-second interval trigger
- a reference start time of `00:30` in the exported macro data
- a hard-coded tap point at `x=1286`, `y=2606`

Things to verify on your device:

- the proxy app package is really `com.network.proxy`
- the WeRead package is really `com.tencent.weread`
- the tap coordinate still hits the correct button on your screen size and DPI
- your automation app has the accessibility and background-launch permissions it needs
- your proxy app has certificate / HTTPS interception configured correctly for WeRead traffic

### Fallback MacroDroid script for screen power issues

Some Android devices do not run the normal automation reliably when the screen turns off, the lock state changes, or the automation app cannot restore the UI state cleanly.

If that happens, use [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro) instead.

This MacroDroid-oriented fallback adds extra power-state handling:

- turns the screen on before starting the proxy flow
- launches `ProxyPin`
- performs the fixed tap used to start or confirm the proxy flow
- adds extra gesture actions before and after launching apps
- launches WeRead
- waits briefly for credential upload
- closes both apps
- turns the screen off again at the end

The bundled fallback export currently uses:

- a regular 3600-second interval trigger
- a reference start time of `00:34` in the exported macro data
- the same fixed tap point at `x=1286`, `y=2606`

Use this fallback when:

- the original automation does not trigger after the screen has been off for a while
- screen wake / unlock state prevents UI actions from firing reliably
- your device kills or delays the original automation when idle

### Recommended automation workflow

1. Import `weread-rewrite.js` into ProxyPin's rewrite or scripting feature.
2. Replace `API_URL` and `API_KEY`.
3. Import `weread-rewrite.macro` into your Android automation app.
4. If your device has screen on/off or lock-state issues, import [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro) in MacroDroid and use that one instead.
5. Adjust the tap coordinate if your device layout differs.
6. Manually run the macro once.
7. Check `GET /api/admin/weread/credentials` and confirm `configured: true`.
8. Let the macro run on its interval to keep credentials fresh.

## First Use

You can use either automatic Android capture or manual upload.

### Option A: automatic credential capture

If the Android automation is configured correctly:

1. Start the macro once or wait for the next interval run.
2. If the normal macro is unstable on your device because of screen power behavior, switch to [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro).
3. Confirm the Worker has stored credentials:

```bash
curl "http://localhost:8787/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>"
```

4. Trigger the first sync:

```bash
curl -X POST "http://localhost:8787/api/admin/refresh" \
  -H "x-api-key: <API_KEY>"
```

### Option B: manual credential upload

You can also upload credentials yourself:

```bash
curl -X POST "http://localhost:8787/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "",
    "accessToken": "6aq6u4hw",
    "refreshToken": "",
    "basever": "7.5.2.10162694",
    "appver": "7.5.2.10162694",
    "v": "",
    "channelId": "1",
    "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
    "osver": "13",
    "baseapi": "33"
  }'
```

If you want to force a full cursor reset:

```json
{
  "vid": "449518091",
  "skey": "",
  "accessToken": "6aq6u4hw",
  "refreshToken": "",
  "basever": "7.5.2.10162694",
  "appver": "7.5.2.10162694",
  "v": "",
  "channelId": "1",
  "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
  "osver": "13",
  "baseapi": "33",
  "resetSync": true
}
```

### Trigger the first refresh

Canonical admin endpoint:

```bash
curl -X POST "http://localhost:8787/api/admin/refresh" \
  -H "x-api-key: <API_KEY>"
```

Compatibility alias:

```bash
curl -X POST "http://localhost:8787/api/refresh" \
  -H "x-api-key: <API_KEY>"
```

### Query cached data

```bash
curl "http://localhost:8787/api/aio" \
  -H "x-api-key: <API_KEY>"
```

## Deployment

Deploy the Worker:

```bash
bun run deploy
```

Set the production API key secret:

```bash
bunx wrangler secret put API_KEY
```

Then upload credentials against the deployed Worker:

```bash
curl -X POST "https://<your-worker-domain>/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "",
    "accessToken": "6aq6u4hw",
    "refreshToken": "",
    "basever": "7.5.2.10162694",
    "appver": "7.5.2.10162694",
    "v": "",
    "channelId": "1",
    "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
    "osver": "13",
    "baseapi": "33"
  }'
```

Upgrade notes:

- Existing deployments must re-upload credentials after upgrading to the current credential-storage model.
- Old `weread_session` rows are not migrated into `weread_credentials`.
- Deploying code without uploading a fresh credential payload will cause refresh jobs to fail with a missing-credentials error.

## Credential Payload Contract

The Worker stores credential fields as strings.

Behavior:

- missing fields become empty strings
- `baseapi` can be sent as either a number or a string
- stored `baseapi` is treated as a string when building WeRead request headers
- the Worker does not validate credentials against WeRead at upload time

Example payload:

```json
{
  "vid": "449518091",
  "skey": "",
  "accessToken": "6aq6u4hw",
  "refreshToken": "",
  "basever": "7.5.2.10162694",
  "appver": "7.5.2.10162694",
  "v": "",
  "channelId": "1",
  "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
  "osver": "13",
  "baseapi": "33"
}
```

## API Reference

All `/api/*` endpoints require:

```http
x-api-key: <API_KEY>
```

All query endpoints serve cached D1 data and do not proxy live WeRead responses back to callers.

### `GET /health`

Simple health check.

### `POST /api/admin/weread/credentials`

Stores the current WeRead credential payload.

Optional field:

- `resetSync: true` resets the stored incremental cursors

### `GET /api/admin/weread/credentials`

Returns safe credential status metadata:

- whether credentials are configured
- the current `vid`
- `updatedAt`
- `updatedAtIso`

Sensitive fields such as `skey`, `accessToken`, and `refreshToken` are never returned here.

### `POST /api/admin/refresh`

Runs a manual sync using the same service path as cron.

### `POST /api/refresh`

Compatibility alias for `POST /api/admin/refresh`.

### `GET /api/aio`

Returns aggregated friend and ranking data for one-shot frontend loading.

### `GET /api/friends`

Returns cached friend list and cumulative reading data.

Query parameters:

- `limit`
- `offset`

Example:

```bash
curl "http://localhost:8787/api/friends?limit=100&offset=0" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/ranking`

Returns the latest cached weekly ranking snapshot.

### `GET /api/friends/:userVid/history`

Returns historical reading changes for one friend.

Query parameters:

- `limit`

Example:

```bash
curl "http://localhost:8787/api/friends/123456/history?limit=100" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/readbooks`

Returns cached personal read-book data from D1.

Query parameters:

- `limit`
- `offset`
- `markStatus`

Current `markStatus` values used by this project:

- `markStatus=4` for completed books
- `markStatus=2` for books currently being read

Examples:

```bash
curl "http://localhost:8787/api/readbooks?limit=20&markStatus=4" \
  -H "x-api-key: <API_KEY>"
```

```bash
curl "http://localhost:8787/api/readbooks?limit=20&markStatus=2" \
  -H "x-api-key: <API_KEY>"
```

## Debugging Helpers

The repository includes:

- [`http/`](./http): the Bruno collection used for local and remote environments
- [`http/.env.sample`](./http/.env.sample): sample environment file for Bruno
- [`test.http`](./test.http): simple raw HTTP examples for editors that support `.http`

Recommended usage:

- use Bruno for day-to-day local and remote API calls
- keep real `BASE_URL` and `API_KEY` values in `http/.env`, which is gitignored
- paste the latest WeRead credential payload directly into the Bruno upload request when needed

## Common Commands

```bash
bun run dev
bun run test
bun run typecheck
bun run migrate:local
bun run migrate:remote
bun run deploy
```

## Operational Notes

- Refresh also syncs your `/mine/readbook` data into D1.
- `/api/readbooks` serves cached local data, not live WeRead traffic.
- Friend sync depends on incremental `synckey` / `syncver` values stored in D1.
- When `vid` changes, the Worker automatically resets incremental sync state.
- The `/mine/readbook` pagination logic follows the current WeRead `synckey + hasMore` behavior.
