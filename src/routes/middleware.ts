import type { MiddlewareHandler } from 'hono'
import type { CloudflareBindings } from '../types'

export const apiKeyAuth: MiddlewareHandler<{ Bindings: CloudflareBindings }> = async (c, next) => {
  if (c.req.method === 'OPTIONS') return next()

  const expected = c.env.API_KEY?.trim()
  if (!expected) {
    return c.json({ ok: false, error: 'API_KEY not configured' }, 500)
  }

  const headerKey = c.req.header('x-api-key')?.trim()
  const auth = c.req.header('authorization')?.trim()
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined
  const provided = headerKey ?? bearer

  if (!provided || provided !== expected) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }

  return next()
}
