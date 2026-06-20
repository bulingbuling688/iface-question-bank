interface Env {
  DB: D1Database
  AUTH_PEPPER?: string
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

interface UserRow {
  id: string
  email: string
  email_normalized: string
  display_name: string
  password_hash: string
  password_salt: string
  password_algo: string
  password_iterations: number
}

interface SessionUserRow {
  session_id: string
  user_id: string
  email: string
  display_name: string
  expires_at: string
}

const PROFILE_HEADER = 'x-iface-profile-id'
const SECRET_HEADER = 'x-iface-sync-secret'
const SESSION_COOKIE = 'iface_session'
const MAX_PAYLOAD_BYTES = 950_000
const PASSWORD_ALGO = 'pbkdf2-sha256'
const PASSWORD_ITERATIONS = 210_000
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
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

function randomId(prefix: string): string {
  return `${prefix}_${randomToken(18)}`
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed.toLowerCase()
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 40) return null
  return trimmed
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length < 8 || value.length > 160) return null
  return value
}

function getAuthPepper(env: Env): string {
  const pepper = env.AUTH_PEPPER?.trim()
  if (!pepper) {
    throw new Error('AUTH_PEPPER is not configured')
  }
  return pepper
}

async function hashPassword(
  password: string,
  salt: string,
  pepper: string,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${pepper}:${password}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  )
  return toBase64Url(new Uint8Array(bits))
}

function parseCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join('; ')
}

function clearSessionCookie(): string {
  return [`${SESSION_COOKIE}=`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0'].join(
    '; ',
  )
}

function authResponse(body: unknown, cookie?: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (cookie) headers.append('set-cookie', cookie)
  return jsonResponse(body, { ...init, headers })
}

function sanitizeUser(row: Pick<UserRow, 'id' | 'email' | 'display_name'>) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  }
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

async function createSession(request: Request, env: Env, userId: string): Promise<string> {
  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  const userAgent = request.headers.get('user-agent')

  await env.DB.prepare(
    `INSERT INTO user_sessions
       (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(randomId('ses'), userId, tokenHash, nowIso, expiresAt, nowIso, userAgent)
    .run()

  await env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso, nowIso, userId)
    .run()

  return token
}

async function requireUser(request: Request, env: Env): Promise<SessionUserRow | Response> {
  const token = parseCookie(request, SESSION_COOKIE)
  if (!token) return errorResponse(401, '请先登录')

  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT
       user_sessions.id AS session_id,
       users.id AS user_id,
       users.email,
       users.display_name,
       user_sessions.expires_at
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<SessionUserRow>()

  if (!row) return errorResponse(401, '请先登录')

  const now = new Date()
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(tokenHash).run()
    return errorResponse(401, '登录已过期')
  }

  await env.DB.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?')
    .bind(now.toISOString(), row.session_id)
    .run()

  return row
}

async function handleAccountRegister(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (err) {
    return errorResponse(400, err instanceof Error ? err.message : '请求体不正确')
  }

  if (!isRecord(body)) return errorResponse(400, '请求体不正确')

  const emailRaw = typeof body.email === 'string' ? body.email.trim() : ''
  const emailNormalized = normalizeEmail(body.email)
  const displayName = normalizeDisplayName(body.displayName)
  const password = normalizePassword(body.password)

  if (!emailNormalized) return errorResponse(400, '邮箱格式不正确')
  if (!displayName) return errorResponse(400, '昵称长度应为 1-40 个字符')
  if (!password) return errorResponse(400, '密码长度至少 8 位')

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(emailNormalized)
    .first<{ id: string }>()
  if (existing) return errorResponse(409, '该邮箱已注册')

  const now = new Date().toISOString()
  const userId = randomId('usr')
  const salt = randomToken(18)
  const passwordHash = await hashPassword(password, salt, getAuthPepper(env), PASSWORD_ITERATIONS)

  await env.DB.prepare(
    `INSERT INTO users
       (id, email, email_normalized, display_name, password_hash, password_salt,
        password_algo, password_iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      emailRaw,
      emailNormalized,
      displayName,
      passwordHash,
      salt,
      PASSWORD_ALGO,
      PASSWORD_ITERATIONS,
      now,
      now,
    )
    .run()

  const token = await createSession(request, env, userId)

  return authResponse(
    {
      ok: true,
      user: {
        id: userId,
        email: emailRaw,
        displayName,
      },
    },
    sessionCookie(token),
  )
}

async function handleAccountLogin(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (err) {
    return errorResponse(400, err instanceof Error ? err.message : '请求体不正确')
  }

  if (!isRecord(body)) return errorResponse(400, '请求体不正确')

  const emailNormalized = normalizeEmail(body.email)
  const password = normalizePassword(body.password)
  if (!emailNormalized || !password) return errorResponse(401, '邮箱或密码不正确')

  const user = await env.DB.prepare(
    `SELECT id, email, email_normalized, display_name, password_hash, password_salt,
            password_algo, password_iterations
     FROM users WHERE email_normalized = ?`,
  )
    .bind(emailNormalized)
    .first<UserRow>()

  if (!user || user.password_algo !== PASSWORD_ALGO) {
    return errorResponse(401, '邮箱或密码不正确')
  }

  const providedHash = await hashPassword(
    password,
    user.password_salt,
    getAuthPepper(env),
    user.password_iterations,
  )

  if (!timingSafeEqual(providedHash, user.password_hash)) {
    return errorResponse(401, '邮箱或密码不正确')
  }

  const token = await createSession(request, env, user.id)
  return authResponse({ ok: true, user: sanitizeUser(user) }, sessionCookie(token))
}

async function handleAccountLogout(request: Request, env: Env): Promise<Response> {
  const token = parseCookie(request, SESSION_COOKIE)
  if (token) {
    await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run()
  }
  return authResponse({ ok: true }, clearSessionCookie())
}

async function handleAccountMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (user instanceof Response) return user
  return jsonResponse({
    ok: true,
    user: {
      id: user.user_id,
      email: user.email,
      displayName: user.display_name,
    },
  })
}

async function handleAccountSnapshotPull(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (user instanceof Response) return user

  const snapshot = await env.DB.prepare(
    'SELECT payload, payload_hash, updated_at FROM user_snapshots WHERE user_id = ?',
  )
    .bind(user.user_id)
    .first<SyncSnapshotRow>()

  if (!snapshot) return jsonResponse({ ok: true, snapshot: null })

  return jsonResponse({
    ok: true,
    snapshot: {
      payload: JSON.parse(snapshot.payload),
      payloadHash: snapshot.payload_hash,
      updatedAt: snapshot.updated_at,
    },
  })
}

async function handleAccountSnapshotPush(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (user instanceof Response) return user

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
    `INSERT INTO user_snapshots (user_id, payload, payload_hash, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = excluded.payload,
       payload_hash = excluded.payload_hash,
       updated_at = excluded.updated_at`,
  )
    .bind(user.user_id, validated.payload, payloadHash, now)
    .run()

  return jsonResponse({ ok: true, payloadHash, updatedAt: now })
}

async function handleAccountSnapshotDelete(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (user instanceof Response) return user

  await env.DB.prepare('DELETE FROM user_snapshots WHERE user_id = ?').bind(user.user_id).run()
  return jsonResponse({ ok: true })
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
      if (pathname === '/api/auth/register' && request.method === 'POST') {
        return await handleAccountRegister(request, env)
      }
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleAccountLogin(request, env)
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleAccountLogout(request, env)
      }
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return await handleAccountMe(request, env)
      }
      if (pathname === '/api/account/snapshot' && request.method === 'GET') {
        return await handleAccountSnapshotPull(request, env)
      }
      if (pathname === '/api/account/snapshot' && request.method === 'POST') {
        return await handleAccountSnapshotPush(request, env)
      }
      if (pathname === '/api/account/snapshot' && request.method === 'DELETE') {
        return await handleAccountSnapshotDelete(request, env)
      }
      if (pathname === '/api/sync/register' && request.method === 'POST') {
        return await handleRegister(env)
      }
      if (pathname === '/api/sync/pull' && request.method === 'GET') {
        return await handlePull(request, env)
      }
      if (pathname === '/api/sync/push' && request.method === 'POST') {
        return await handlePush(request, env)
      }
      if (pathname === '/api/sync/snapshot' && request.method === 'DELETE') {
        return await handleDelete(request, env)
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
