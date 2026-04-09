import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { admin, refreshHandler } from './routes/admin'
import { apiKeyAuth } from './routes/middleware'
import { query } from './routes/query'
import { refreshAll } from './services/sync'
import type { CloudflareBindings } from './types'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('/', (c) => c.text('weread-ranking worker'))
app.get('/health', (c) => c.json({ ok: true }))

app.use('/api/*', async (c, next) => {
  const raw = c.env.CORS_ORIGIN?.trim()
  if (!raw) return next()

  const allowed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return cors({
    origin: (origin) => {
      if (!origin) return null
      if (allowed.includes('*')) return origin
      return allowed.includes(origin) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    maxAge: 60 * 60 * 24,
  })(c, next)
})

app.use('/api/*', apiKeyAuth)

app.route('/api/admin', admin)
app.post('/api/refresh', refreshHandler)
app.route('/api', query)

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) => {
    const scheduledTime = event.scheduledTime ? new Date(event.scheduledTime).toISOString() : null
    ctx.waitUntil(refreshAll(env, { source: 'cron', scheduledTime }))
  },
}
