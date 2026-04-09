import { Hono } from 'hono'
import {
  getWeReadCredentialsStatus,
  normalizeWeReadCredentialsPayload,
  saveWeReadCredentials,
  WeReadCredentialsValidationError,
} from '../services/credentials'
import type { CloudflareBindings } from '../types'

export const admin = new Hono<{ Bindings: CloudflareBindings }>()

admin.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next()

  const expected = c.env.API_KEY
  if (!expected) return next()

  const headerKey = c.req.header('x-api-key')?.trim()
  const auth = c.req.header('authorization')?.trim()
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined
  const provided = headerKey ?? bearer

  if (!provided || provided !== expected) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  return next()
})

admin.get('/admin/weread/credentials', async (c) => {
  if (!c.env.API_KEY) return c.json({ ok: false, error: 'API_KEY not configured' }, 400)

  const status = await getWeReadCredentialsStatus(c.env)
  return c.json({ ok: true, status })
})

admin.post('/admin/weread/credentials', async (c) => {
  if (!c.env.API_KEY) return c.json({ ok: false, error: 'API_KEY not configured' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  try {
    const credentials = normalizeWeReadCredentialsPayload(body)
    const status = await saveWeReadCredentials(c.env, credentials)
    return c.json({ ok: true, status })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof WeReadCredentialsValidationError) {
      return c.json({ ok: false, error: message }, 400)
    }
    return c.json({ ok: false, error: message }, 500)
  }
})
