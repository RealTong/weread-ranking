import { Hono, type Context } from 'hono'
import {
  getWeReadCredentialsStatus,
  normalizeLegacyWeReadSessionPayload,
  normalizeWeReadCredentialsPayload,
  saveWeReadCredentials,
  toWeReadCredentialsStatus,
  WeReadCredentialsValidationError,
} from '../services/credentials'
import { refreshAll } from '../services/sync'
import type { CloudflareBindings } from '../types'
import { fetchUser } from '../integrations/weread'

export const admin = new Hono<{ Bindings: CloudflareBindings }>()
type AdminContext = Context<{ Bindings: CloudflareBindings }>

function formatLegacySessionStatus(
  status: Awaited<ReturnType<typeof getWeReadCredentialsStatus>>,
): { configured: false; source: 'none' } | {
  configured: true
  source: 'd1'
  vid: string
  updatedAt: number
  updatedAtIso: string
  validatedAt: number
  validatedAtIso: string
} {
  if (status.source === 'none') return { configured: false, source: 'none' }

  return {
    configured: true,
    source: 'd1',
    vid: status.vid,
    updatedAt: status.updatedAt,
    updatedAtIso: new Date(status.updatedAt).toISOString(),
    validatedAt: status.updatedAt,
    validatedAtIso: new Date(status.updatedAt).toISOString(),
  }
}

async function getLegacySessionStatus(c: AdminContext) {
  const status = await getWeReadCredentialsStatus(c.env)
  return c.json({ ok: true, status: formatLegacySessionStatus(status) })
}

async function postLegacySession(c: AdminContext) {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  try {
    const credentials = normalizeLegacyWeReadSessionPayload(body)
    const selfUserVid = Number.parseInt(credentials.vid, 10)
    if (!Number.isFinite(selfUserVid)) {
      return c.json({ ok: false, error: 'Invalid vid' }, 400)
    }

    try {
      await fetchUser(credentials, selfUserVid)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, error: `Credentials validation failed: ${message}` }, 400)
    }

    const resetSync = (body as Record<string, unknown>).resetSync === true
    const { credentials: stored, syncReset } = await saveWeReadCredentials(c.env, credentials, { resetSync })

    return c.json({
      ok: true,
      session: {
        vid: stored.vid,
        updatedAt: stored.updatedAt,
        updatedAtIso: new Date(stored.updatedAt).toISOString(),
        validatedAt: stored.updatedAt,
        validatedAtIso: new Date(stored.updatedAt).toISOString(),
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
}

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

  try {
    const credentials = normalizeWeReadCredentialsPayload(body)
    const resetSync = (body as Record<string, unknown>).resetSync === true
    const { credentials: stored, syncReset } = await saveWeReadCredentials(c.env, credentials, { resetSync })
    const status = toWeReadCredentialsStatus(stored)
    return c.json({ ok: true, status, syncReset })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof WeReadCredentialsValidationError) {
      return c.json({ ok: false, error: message }, 400)
    }
    return c.json({ ok: false, error: message }, 500)
  }
})

admin.get('/weread/session', getLegacySessionStatus)
admin.post('/weread/session', postLegacySession)

admin.get('/credentials', getLegacySessionStatus)
admin.post('/credentials', postLegacySession)

admin.post('/refresh', refreshHandler)
