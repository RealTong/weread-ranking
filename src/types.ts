export type CloudflareBindings = {
  API_KEY?: string
  CRED_ENC_KEY?: string
  CORS_ORIGIN?: string

  WEREAD_VID?: string
  WEREAD_SKEY?: string
  WEREAD_BASEVER?: string
  WEREAD_V?: string
  WEREAD_CHANNEL_ID?: string
  WEREAD_USER_AGENT?: string

  WEREAD_FRIEND_WECHAT_SYNCKEY?: string
  WEREAD_FRIEND_WECHAT_SYNCVER?: string
  WEREAD_FRIEND_RANKING_SYNCKEY?: string

  DB: D1Database
  AVATARS?: R2Bucket
}

export type RefreshSource = 'api' | 'cron'
