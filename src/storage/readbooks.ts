export type ReadBookFacet = {
  id: number | string
  title: string
  type: number
}

export type ReadBookYearPreference = {
  year: number
  count: number
  preference: string
}

export type StoredReadBook = {
  bookId: string
  startReadingTime: number
  finishTime: number | null
  markStatus: number
  progress: number | null
  readtime: number | null
  title: string
  author: string | null
  cover: string | null
}

export type UpsertReadBooksSnapshotInput = {
  books: StoredReadBook[]
  stars: ReadBookFacet[]
  years: ReadBookFacet[]
  ratings: ReadBookFacet[]
  yearPreference: ReadBookYearPreference[]
  totalCount: number
  sourceSynckey: number | null
}

const READ_BOOKS_STATE_ID = 'current'

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(limit, 1), 500)
}

function clampOffset(offset: number) {
  if (!Number.isFinite(offset)) return 0
  return Math.max(offset, 0)
}

export async function replaceMyReadBooksSnapshot(
  db: D1Database,
  input: UpsertReadBooksSnapshotInput,
): Promise<{ syncedAt: number; count: number }> {
  const syncedAt = Date.now()
  const books = input.books

  for (const book of books) {
    await db
      .prepare(
        `INSERT INTO my_read_books (
            book_id,
            title,
            author,
            cover,
            mark_status,
            progress,
            readtime,
            start_reading_time,
            finish_time,
            payload_json,
            is_active,
            last_synced_at,
            created_at,
            updated_at
          ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, ?13
          )
          ON CONFLICT(book_id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            cover = excluded.cover,
            mark_status = excluded.mark_status,
            progress = excluded.progress,
            readtime = excluded.readtime,
            start_reading_time = excluded.start_reading_time,
            finish_time = excluded.finish_time,
            payload_json = excluded.payload_json,
            is_active = 1,
            last_synced_at = excluded.last_synced_at,
            updated_at = excluded.updated_at`,
      )
      .bind(
        book.bookId,
        book.title,
        book.author ?? null,
        book.cover ?? null,
        book.markStatus,
        book.progress ?? null,
        book.readtime ?? null,
        book.startReadingTime,
        book.finishTime ?? null,
        JSON.stringify(book),
        syncedAt,
        syncedAt,
        syncedAt,
      )
      .run()
  }

  await db
    .prepare(
      `UPDATE my_read_books
       SET is_active = 0, updated_at = ?1
       WHERE last_synced_at <> ?1 AND is_active = 1`,
    )
    .bind(syncedAt)
    .run()

  await db
    .prepare(
      `INSERT INTO my_read_books_state (
          id,
          stars_json,
          years_json,
          ratings_json,
          year_preference_json,
          total_count,
          source_synckey,
          updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        )
        ON CONFLICT(id) DO UPDATE SET
          stars_json = excluded.stars_json,
          years_json = excluded.years_json,
          ratings_json = excluded.ratings_json,
          year_preference_json = excluded.year_preference_json,
          total_count = excluded.total_count,
          source_synckey = excluded.source_synckey,
          updated_at = excluded.updated_at`,
    )
    .bind(
      READ_BOOKS_STATE_ID,
      JSON.stringify(input.stars),
      JSON.stringify(input.years),
      JSON.stringify(input.ratings),
      JSON.stringify(input.yearPreference),
      input.totalCount,
      input.sourceSynckey,
      syncedAt,
    )
    .run()

  return { syncedAt, count: books.length }
}

export async function getMyReadBooksState(db: D1Database): Promise<{
  stars: ReadBookFacet[]
  years: ReadBookFacet[]
  ratings: ReadBookFacet[]
  yearPreference: ReadBookYearPreference[]
  totalCount: number
  sourceSynckey: number | null
  updatedAt: number | null
}> {
  const row = await db
    .prepare(
      `SELECT
          stars_json as starsJson,
          years_json as yearsJson,
          ratings_json as ratingsJson,
          year_preference_json as yearPreferenceJson,
          total_count as totalCount,
          source_synckey as sourceSynckey,
          updated_at as updatedAt
       FROM my_read_books_state
       WHERE id = ?1`,
    )
    .bind(READ_BOOKS_STATE_ID)
    .first<{
      starsJson: string
      yearsJson: string
      ratingsJson: string
      yearPreferenceJson: string
      totalCount: number
      sourceSynckey: number | null
      updatedAt: number
    }>()

  if (!row) {
    return {
      stars: [],
      years: [],
      ratings: [],
      yearPreference: [],
      totalCount: 0,
      sourceSynckey: null,
      updatedAt: null,
    }
  }

  return {
    stars: JSON.parse(row.starsJson) as ReadBookFacet[],
    years: JSON.parse(row.yearsJson) as ReadBookFacet[],
    ratings: JSON.parse(row.ratingsJson) as ReadBookFacet[],
    yearPreference: JSON.parse(row.yearPreferenceJson) as ReadBookYearPreference[],
    totalCount: row.totalCount,
    sourceSynckey: row.sourceSynckey,
    updatedAt: row.updatedAt,
  }
}

export async function getMyReadBooksPage(
  db: D1Database,
  params: { limit: number; offset: number; markStatus?: number },
): Promise<{
  totalCount: number
  rows: Array<StoredReadBook & { readingState: 'finished' | 'reading' | 'other' }>
}> {
  const limit = clampLimit(params.limit)
  const offset = clampOffset(params.offset)
  const hasMarkStatus = Number.isFinite(params.markStatus)

  const countSql = hasMarkStatus
    ? 'SELECT COUNT(*) as count FROM my_read_books WHERE is_active = 1 AND mark_status = ?1'
    : 'SELECT COUNT(*) as count FROM my_read_books WHERE is_active = 1'
  const countRow = hasMarkStatus
    ? await db.prepare(countSql).bind(params.markStatus).first<{ count: number }>()
    : await db.prepare(countSql).first<{ count: number }>()
  const totalCount = countRow?.count ?? 0

  const rowsSql = hasMarkStatus
    ? `SELECT
          book_id as bookId,
          start_reading_time as startReadingTime,
          finish_time as finishTime,
          mark_status as markStatus,
          progress as progress,
          readtime as readtime,
          title as title,
          author as author,
          cover as cover
       FROM my_read_books
       WHERE is_active = 1 AND mark_status = ?1
       ORDER BY start_reading_time DESC, book_id ASC
       LIMIT ?2 OFFSET ?3`
    : `SELECT
          book_id as bookId,
          start_reading_time as startReadingTime,
          finish_time as finishTime,
          mark_status as markStatus,
          progress as progress,
          readtime as readtime,
          title as title,
          author as author,
          cover as cover
       FROM my_read_books
       WHERE is_active = 1
       ORDER BY start_reading_time DESC, book_id ASC
       LIMIT ?1 OFFSET ?2`

  const res = hasMarkStatus
    ? await db.prepare(rowsSql).bind(params.markStatus, limit, offset).all<StoredReadBook>()
    : await db.prepare(rowsSql).bind(limit, offset).all<StoredReadBook>()

  return {
    totalCount,
    rows: (res.results ?? []).map((row) => ({
      ...row,
      readingState: row.markStatus === 4 ? 'finished' : row.markStatus === 2 ? 'reading' : 'other',
    })),
  }
}
