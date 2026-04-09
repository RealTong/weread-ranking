# WeRead Service Layer Refactor Design

## Overview

This refactor reduces the Worker to two responsibilities:

1. Accept a full set of WeRead credentials from an external MITM pipeline and persist the latest set temporarily in D1.
2. Reuse the latest stored credentials for scheduled and manual sync jobs, then serve cached data from D1 through authenticated API endpoints.

The current implementation already contains most of the data-sync and query behavior, but the credential flow is inconsistent and more complex than the actual operating model. This design aligns the codebase with the real workflow: Android captures credentials, Cloudflare Worker stores the latest set, sync jobs consume it, and clients read only from local storage.

## Goals

- Store exactly one active WeRead credential set in D1.
- Allow the Android MITM flow to overwrite the stored credential set through an authenticated API endpoint.
- Keep cron-based sync and manual sync using the same service path.
- Continue serving friend, ranking, and read-book data from D1 only.
- Keep all API endpoints protected by `x-api-key`.
- Preserve incremental sync state and sync run logs.
- Keep the design small enough to implement as one focused refactor.

## Non-Goals

- No live validation call when new credentials are uploaded.
- No use of `refreshToken` to renew expired credentials.
- No multi-account or multi-session support.
- No public read endpoints.
- No friend delta or trend API in this refactor.
- No avatar caching in R2 as part of the refactor.

Friend reading changes remain derivable from snapshots in the future. For example, if `/friend/wechat` returns cumulative `totalReadingTime`, the service can compare adjacent snapshots to compute net change between syncs. That capability remains out of scope for this refactor.

## Operating Model

### Credential Capture

An Android device opens WeRead periodically. The MITM setup captures the login response and forwards the required values to the Worker.

The uploaded payload must include:

- `vid`
- `skey`
- `accessToken`
- `refreshToken`
- `basever`
- `appver`
- `v`
- `channelId`
- `userAgent`
- `osver`
- `baseapi`

The Worker treats this payload as opaque application credentials for later API requests. It does not attempt to confirm they are valid at upload time.

### Sync and Query

Scheduled cron runs and a manual admin endpoint both trigger the same sync service. The sync service:

1. Loads the current stored credential set from D1.
2. Calls the WeRead APIs needed for friend metadata, ranking, and read-book data.
3. Writes normalized snapshots into D1.
4. Updates incremental sync cursors in D1.
5. Records run status in `refresh_runs`.

Client-facing query endpoints read only from D1 and never proxy requests directly to WeRead.

## Architecture

The refactor should move the code toward four clear layers:

### Routes

- Admin routes for credential upload, credential status, and manual refresh.
- Query routes for cached read APIs.
- Shared API-key authentication middleware.

### Services

- Credential service for request parsing, validation, status shaping, and overwrite behavior.
- Sync service for the full refresh workflow and shared cron/manual execution path.

### Storage

- Credential storage for reading and overwriting the current credential row.
- Existing D1 access helpers for sync cursors, snapshots, read-books data, and run logs.

### Integration

- WeRead HTTP client with request header construction based on the stored credential set.

This split keeps HTTP concerns out of storage code and prevents sync orchestration from leaking into route handlers.

## Data Model

### Current Credentials Table

The Worker stores exactly one current credential record. The row identifier is fixed to `current`.

Recommended table shape:

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

Behavior:

- Every upload is an upsert to the `current` row.
- A new upload fully replaces the previous stored values.
- No credential history is retained.

### Existing Business Tables

The refactor continues using the existing tables for cached business data:

- `friends`
- `friend_meta_snapshots`
- `ranking_snapshots`
- `my_read_books`
- `my_read_books_state`
- `sync_state`
- `refresh_runs`

These tables already match the desired operating model and do not require a conceptual redesign.

For `friends`, the refactor should narrow active population to the fields already available from sync sources used in scope:

- actively populated: `user_vid`, `name`, `gender`, `avatar_url`, `is_wechat_friend`, `is_hide`
- retained but not actively refreshed in this refactor: `avatar_r2_key`, `location`, `signature`

This keeps schema churn small while making the new sync behavior explicit. Legacy nullable columns may remain in the table until a later cleanup migration.

## API Design

All endpoints remain protected with `x-api-key`.

### `POST /api/admin/weread/credentials`

Purpose:

- Accept a full credential payload from the MITM pipeline.
- Overwrite the current credential row.
- Optionally reset sync cursors.

Request body:

```json
{
  "vid": "449518091",
  "skey": "example",
  "accessToken": "example",
  "refreshToken": "example",
  "basever": "10.1.0.80",
  "appver": "8.4.0",
  "v": "10.1.0.80",
  "channelId": "example",
  "userAgent": "example",
  "osver": "Android 14",
  "baseapi": 1,
  "resetSync": false
}
```

Rules:

- All credential fields are required.
- `baseapi` must be a number.
- `resetSync` is optional and defaults to `false`.
- The service does not call WeRead during upload.

Response shape:

- `ok`
- stored credential metadata safe to return, such as `vid` and `updatedAt`
- sync reset status

Sensitive tokens must not be echoed back in the response.

### `GET /api/admin/weread/credentials`

Purpose:

- Report whether current credentials exist and when they were last updated.

Response should include:

- whether credentials are configured
- `vid`
- `updatedAt`
- `updatedAtIso`

The response must not include raw `skey`, `accessToken`, or `refreshToken`.

### `POST /api/admin/refresh`

Purpose:

- Manually trigger the same sync service used by cron.

Behavior:

- Uses the current stored credentials.
- Returns a structured sync result object.
- Fails cleanly if no credentials are configured.

Compatibility:

- Keep `POST /api/refresh` as a compatibility alias that calls the same handler.
- Treat `/api/admin/refresh` as the canonical admin route after the refactor.

### Query Endpoints

The following endpoints remain read-only wrappers over D1:

- `GET /api/aio`
- `GET /api/friends`
- `GET /api/ranking`
- `GET /api/readbooks`
- `GET /api/friends/:userVid/history`

Each endpoint continues requiring `x-api-key`.

The avatar endpoint should be removed in this refactor because avatar caching is explicitly out of scope.

For compatibility, `/api/friends` and `/api/aio` may continue returning the existing friend object shape, but callers should expect `avatarR2Key`, `location`, and `signature` to remain nullable because this refactor no longer refreshes them.

The implementation plan should preserve current top-level response envelopes and pagination parameters for `/api/aio`, `/api/friends`, `/api/ranking`, and `/api/readbooks` unless a change is required by the explicit scope decisions in this document.

## Sync Flow

Both cron and manual refresh must call the same sync function.

### Refresh Steps

1. Start a `refresh_runs` record if possible.
2. Load the current credential row from D1.
3. If no credentials exist, finish the run as failed and return `No credentials configured`.
4. Load current sync cursors from `sync_state`, defaulting missing values to zero.
5. Call `/friend/wechat`.
6. Persist updated `friend_wechat_synckey` and `friend_wechat_syncver`.
7. Upsert friend identities and write `friend_meta_snapshots`.
8. Call `/friend/ranking`.
9. Persist updated `friend_ranking_synckey`.
10. Upsert friend identity fields available from ranking data and write `ranking_snapshots`.
11. Do not call `/user` for per-friend profile enrichment in this refactor.
12. Call `/mine/readbook` paging flow and replace the local read-book snapshot tables.
13. Finish the `refresh_runs` record with success counts.

The sync should remain incremental where the WeRead API supports cursors.

The intended friend-data behavior after refactor is:

- `name`, `gender`, `avatar_url`, `is_wechat_friend`, and `is_hide` are sourced from ranking responses when present.
- `totalReadingTime` history remains sourced from `/friend/wechat` snapshots.
- `location`, `signature`, and any R2-backed avatar data are not refreshed.

### Reset Behavior

Sync cursors reset to zero when either of the following is true:

- the upload request explicitly sets `resetSync: true`
- the stored `vid` changes between the old and new credential rows

Resetting cursors does not delete existing snapshot history. It only resets future incremental fetch state.

## Error Handling

The service should favor simple failure semantics:

- Missing credentials: return a clear configuration error and do not modify business tables.
- WeRead API failure: record the failure in `refresh_runs` and keep old cached data untouched.
- Partial sync failure: fail the current run and leave previously written snapshots as-is.
- Invalid credential upload payload: reject with HTTP 400.
- Invalid or missing API key: reject with HTTP 401.

The system should not attempt fallback validation logic, token renewal, or recovery workflows beyond a later successful credential upload.

## Testing Expectations

The refactor is ready for implementation planning only if the plan covers tests for:

- authenticated credential upload with full required payload
- credential overwrite behavior
- sync cursor reset on `vid` change
- sync cursor reset on explicit `resetSync: true`
- sync service failure when no credentials exist
- reuse of the same stored credentials by cron and manual refresh
- query endpoints continuing to read from D1 after sync
- sensitive credential fields not being returned from admin status or upload responses

## File Boundaries

Recommended file structure after refactor:

- `src/index.ts`
  Worker bootstrap, CORS, route registration, cron entrypoint.
- `src/routes/admin.ts`
  Admin credential and manual refresh endpoints.
- `src/routes/query.ts`
  Read-only cached query endpoints.
- `src/routes/middleware.ts`
  Shared API-key middleware if extracting it reduces duplication.
- `src/services/credentials.ts`
  Credential parsing, normalization, status shaping, and reset decision logic.
- `src/services/sync.ts`
  Full refresh orchestration shared by cron and manual trigger.
- `src/storage/credentials.ts`
  D1 reads and writes for the `weread_credentials` table.
- `src/storage/db.ts`
  Existing business-data storage helpers.
- `src/storage/readbooks.ts`
  Existing read-book snapshot storage helpers.
- `src/integrations/weread.ts`
  WeRead HTTP client and typed response helpers.
- `migrations/<new>.sql`
  Schema update for the new credentials table and cleanup of obsolete session storage.

The exact filenames can adapt to current repository conventions, but the implementation plan should preserve these responsibilities and keep the credential path distinct from the sync path.

## Migration Direction

The implementation should prefer a clean migration toward `weread_credentials` over preserving multiple legacy credential abstractions.

Expected migration intent:

- create the new `weread_credentials` table
- optionally copy the currently stored session row into the new table only if all newly required fields are present
- stop reading from legacy `credentials` or `weread_session` tables in application code

Because the new required payload is larger than the old schema, migration compatibility is not a hard requirement. It is acceptable for the new deployment to require one fresh credential upload from the MITM pipeline.

## Scope Guardrails

The implementation plan must stay within this refactor scope:

- align the code with the two-part operating model
- simplify credential handling
- preserve local snapshot APIs

The plan must not add:

- new analytics endpoints based on snapshot deltas
- token refresh logic
- public APIs
- additional background workflows
- avatar/R2 features
