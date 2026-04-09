import type { MiddlewareHandler } from 'hono'
import type { CloudflareBindings } from '../types'

const API_CORS_ALLOW_METHODS = 'GET, POST, OPTIONS'
const API_CORS_ALLOW_HEADERS = 'Content-Type, X-API-Key, Authorization'
const API_CORS_MAX_AGE = '86400'

export function resolveApiCorsOrigin(env: CloudflareBindings, requestOrigin: string | null | undefined): string | null {
  if (!requestOrigin) return null

  const raw = env.CORS_ORIGIN?.trim()
  if (!raw) return null

  const allowed = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (allowed.includes('*')) return requestOrigin
  return allowed.includes(requestOrigin) ? requestOrigin : null
}

export function applyApiCorsHeaders(headers: Headers, env: CloudflareBindings, requestOrigin?: string | null) {
  const allowedOrigin = resolveApiCorsOrigin(env, requestOrigin)
  if (!allowedOrigin) return

  headers.set('Access-Control-Allow-Origin', allowedOrigin)
  headers.set('Access-Control-Allow-Methods', API_CORS_ALLOW_METHODS)
  headers.set('Access-Control-Allow-Headers', API_CORS_ALLOW_HEADERS)
  headers.set('Access-Control-Max-Age', API_CORS_MAX_AGE)
  headers.append('Vary', 'Origin')
}

function jsonWithApiCors(
  c: Parameters<MiddlewareHandler<{ Bindings: CloudflareBindings }>>[0],
  body: { ok: false; error: string },
  status: 401 | 500,
) {
  const response = c.json(body, status)
  applyApiCorsHeaders(response.headers, c.env, c.req.header('origin'))
  return response
}

export const apiKeyAuth: MiddlewareHandler<{ Bindings: CloudflareBindings }> = async (c, next) => {
  const expected = c.env.API_KEY?.trim()
  if (!expected) {
    return jsonWithApiCors(c, { ok: false, error: 'API_KEY not configured' }, 500)
  }

  if (c.req.method === 'OPTIONS') return next()

  const headerKey = c.req.header('x-api-key')?.trim()
  const auth = c.req.header('authorization')?.trim()
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined
  const provided = headerKey ?? bearer

  if (!provided || provided !== expected) {
    return jsonWithApiCors(c, { ok: false, error: 'Unauthorized' }, 401)
  }

  return next()
}
