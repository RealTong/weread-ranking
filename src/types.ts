export type CloudflareBindings = {
  API_KEY?: string
  CORS_ORIGIN?: string

  DB: D1Database
  AVATARS?: R2Bucket
}

export type RefreshSource = 'api' | 'cron'
