import { Hono, type Context } from 'hono'
import {
  getWeReadCredentialsStatus,
  normalizeWeReadCredentialsPayload,
  saveWeReadCredentials,
  WeReadCredentialsValidationError,
} from '../services/credentials'
import { refreshAll } from '../services/sync'
import type { CloudflareBindings } from '../types'

export const admin = new Hono<{ Bindings: CloudflareBindings }>()
type AdminContext = Context<{ Bindings: CloudflareBindings }>

export async function refreshHandler(c: AdminContext) {
  const result = await refreshAll(c.env, { source: 'api' })
  return c.json(result, result.ok ? 200 : 500)
}

admin.get('/weread/credentials', async (c) => {
  const status = await getWeReadCredentialsStatus(c.env)
  return c.json({ ok: true, status })
})

admin.post('/weread/credentials', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }
  console.log('Received credentials update request:', JSON.stringify(body))

  try {
    const credentials = normalizeWeReadCredentialsPayload(body)
    const resetSync = (body as Record<string, unknown>).resetSync === true
    const { credentials: stored, syncReset } = await saveWeReadCredentials(c.env, credentials, { resetSync })
    return c.json({
      ok: true,
      status: {
        configured: true,
        source: 'd1',
        vid: stored.vid,
        updatedAt: stored.updatedAt,
        updatedAtIso: new Date(stored.updatedAt).toISOString(),
      },
      syncReset,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof WeReadCredentialsValidationError) {
      return c.json({ ok: false, error: message }, 400)
    }
    return c.json({ ok: false, error: message }, 500)
  }
})

admin.post('/refresh', refreshHandler)
