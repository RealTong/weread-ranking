export type CloudflareBindings = {
  API_KEY?: string
  CORS_ORIGIN?: string

  DB: D1Database
  AVATARS?: R2Bucket
}

export type RefreshSource = 'api' | 'cron'

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

export type WeReadCredentialsStatus =
  | {
      configured: true
      source: 'd1'
      vid: string
      updatedAt: number
      updatedAtIso: string
    }
  | {
      configured: false
      source: 'none'
    }
