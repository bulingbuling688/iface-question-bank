interface Env {
  DB: D1Database
}

interface SyncProfileRow {
  profile_id: string
  secret_hash: string
}

interface SyncSnapshotRow {
  payload: string
  payload_hash: string
  updated_at: string
}

const PROFILE_HEADER = 'x-iface-profile-id'
const SECRET_HEADER = 'x-iface-sync-secret'
const MAX_PAYLOAD_BYTES = 950_000

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  headers.set('access-control-allow-headers', `${PROFILE_HEADER}, ${SECRET_HEADER}, content-type`)
  return new Response(JSON.stringify(body), { ...init, headers })
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ ok: false, error: message }, { status })
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

function normalizeProfileId(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^[a-zA-Z0-9_-]{16,96}$/.test(trimmed) ? trimmed : null
}

function normalizeSecret(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(trimmed)) return null
  return trimmed
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_PAYLOAD_BYTES) {
    throw new Error('请求体过大')
  }

  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('请求体过大')
  }
  if (!raw.trim()) return null

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('JSON 格式不正确')
  }
}

async function requireProfile(request: Request, env: Env): Promise<string | Response> {
  const profileId = normalizeProfileId(request.headers.get(PROFILE_HEADER))
  const secret = normalizeSecret(request.headers.get(SECRET_HEADER))
  if (!profileId || !secret) return errorResponse(401, '缺少或无效的同步身份')

  const row = await env.DB.prepare(
    'SELECT profile_id, secret_hash FROM sync_profiles WHERE profile_id = ?',
  )
    .bind(profileId)
    .first<SyncProfileRow>()
  if (!row) return errorResponse(401, '同步身份不存在')

  const providedHash = await sha256Hex(secret)
  if (!timingSafeEqualHex(providedHash, row.secret_hash)) {
    return errorResponse(401, '同步密钥不正确')
  }

  return profileId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSnapshotPayload(
  value: unknown,
): { ok: true; payload: string } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: '同步内容必须是对象' }

  const version = value.version
  const exportedAt = value.exportedAt
  if (version !== 8) return { ok: false, error: '暂只支持 v8 同步格式' }
  if (typeof exportedAt !== 'string' || exportedAt.length < 10) {
    return { ok: false, error: '缺少导出时间' }
  }
  if (!isRecord(value.records) || !Array.isArray(value.records.ids)) {
    return { ok: false, error: '学习记录格式不正确' }
  }

  const requiredArrays = [
    'questionNotes',
    'questionAnswerAnnotations',
    'questionAnswerOverrides',
    'questionFlags',
    'aiSessions',
    'customQuestions',
    'customSources',
  ]
  for (const key of requiredArrays) {
    if (!Array.isArray(value[key])) return { ok: false, error: `${key} 格式不正确` }
  }
  if (!isRecord(value.customCategories)) {
    return { ok: false, error: 'customCategories 格式不正确' }
  }

  const payload = JSON.stringify(value)
  if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: '同步内容过大' }
  }
  return { ok: true, payload }
}

async function handleRegister(env: Env): Promise<Response> {
  const profileId = randomToken(18)
  const secret = randomToken(32)
  const secretHash = await sha256Hex(secret)
  const now = new Date().toISOString()

  await env.DB.prepare(
    'INSERT INTO sync_profiles (profile_id, secret_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
  )
    .bind(profileId, secretHash, now, now)
    .run()

  return jsonResponse({ ok: true, profileId, secret, createdAt: now })
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const profile = await requireProfile(request, env)
  if (profile instanceof Response) return profile

  const snapshot = await env.DB.prepare(
    'SELECT payload, payload_hash, updated_at FROM sync_snapshots WHERE profile_id = ?',
  )
    .bind(profile)
    .first<SyncSnapshotRow>()

  if (!snapshot) {
    return jsonResponse({ ok: true, snapshot: null })
  }

  return jsonResponse({
    ok: true,
    snapshot: {
      payload: JSON.parse(snapshot.payload),
      payloadHash: snapshot.payload_hash,
      updatedAt: snapshot.updated_at,
    },
  })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const profile = await requireProfile(request, env)
  if (profile instanceof Response) return profile

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (err) {
    return errorResponse(400, err instanceof Error ? err.message : '请求体不正确')
  }

  if (!isRecord(body) || !('payload' in body)) {
    return errorResponse(400, '缺少 payload')
  }

  const validated = validateSnapshotPayload(body.payload)
  if (!validated.ok) return errorResponse(400, validated.error)

  const payloadHash = await sha256Hex(validated.payload)
  const now = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO sync_snapshots (profile_id, payload, payload_hash, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       payload = excluded.payload,
       payload_hash = excluded.payload_hash,
       updated_at = excluded.updated_at`,
  )
    .bind(profile, validated.payload, payloadHash, now)
    .run()

  await env.DB.prepare('UPDATE sync_profiles SET updated_at = ? WHERE profile_id = ?')
    .bind(now, profile)
    .run()

  return jsonResponse({ ok: true, payloadHash, updatedAt: now })
}

async function handleDelete(request: Request, env: Env): Promise<Response> {
  const profile = await requireProfile(request, env)
  if (profile instanceof Response) return profile

  await env.DB.prepare('DELETE FROM sync_snapshots WHERE profile_id = ?').bind(profile).run()
  await env.DB.prepare('UPDATE sync_profiles SET updated_at = ? WHERE profile_id = ?')
    .bind(new Date().toISOString(), profile)
    .run()

  return jsonResponse({ ok: true })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return jsonResponse({ ok: true })

    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/+$/, '')

    try {
      if (pathname === '/api/sync/health' && request.method === 'GET') {
        return jsonResponse({ ok: true, service: 'iface-question-bank-sync' })
      }
      if (pathname === '/api/sync/register' && request.method === 'POST') {
        return handleRegister(env)
      }
      if (pathname === '/api/sync/pull' && request.method === 'GET') {
        return handlePull(request, env)
      }
      if (pathname === '/api/sync/push' && request.method === 'POST') {
        return handlePush(request, env)
      }
      if (pathname === '/api/sync/snapshot' && request.method === 'DELETE') {
        return handleDelete(request, env)
      }
      return errorResponse(404, 'Not found')
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          pathname,
          message: err instanceof Error ? err.message : String(err),
        }),
      )
      return errorResponse(500, '同步服务暂时不可用')
    }
  },
}
