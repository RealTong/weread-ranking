import { Hono } from 'hono'
import { api } from './routes/api'
import type { CloudflareBindings } from './types'
import { refreshAll } from './workflows/refresh'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('/', (c) => c.text('weread-ranking worker'))
app.get('/health', (c) => c.json({ ok: true }))

app.route('/api', api)

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledEvent, env: CloudflareBindings, ctx: ExecutionContext) => {
    const scheduledTime = event.scheduledTime ? new Date(event.scheduledTime).toISOString() : null
    ctx.waitUntil(refreshAll(env, { source: 'cron', scheduledTime }))
  },
}
