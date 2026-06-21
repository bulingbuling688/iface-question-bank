interface Env {
  DB: D1Database
  IFACE_AUTH_USERS?: string
  IFACE_SESSION_SECRET?: string
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

interface FixedAccount {
  id: string
  username: string
  password: string
  displayName: string
}

interface SessionPayload {
  userId: string
  expiresAt: number
}

const PROFILE_HEADER = 'x-iface-profile-id'
const SECRET_HEADER = 'x-iface-sync-secret'
const SESSION_COOKIE = 'iface_session'
const MAX_PAYLOAD_BYTES = 950_000
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  headers.set('access-control-allow-headers', `${PROFILE_HEADER}, ${SECRET_HEADER}, content-type`)
  headers.set('access-control-allow-credentials', 'true')
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

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

function base64UrlEncodeText(value: string): string {
  return toBase64Url(new TextEncoder().encode(value))
}

function base64UrlDecodeText(value: string): string | null {
  const bytes = fromBase64Url(value)
  if (!bytes) return null
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!/^[a-z0-9._-]{2,64}$/.test(trimmed)) return null
  return trimmed
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length < 1 || value.length > 200) return null
  return value
}

function normalizeAccount(value: unknown): FixedAccount | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const username = normalizeUsername(value.username)
  const password = normalizePassword(value.password)
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : ''

  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) return null
  if (!username || !password) return null
  if (displayName.length < 1 || displayName.length > 40) return null

  return { id, username, password, displayName }
}

function getConfiguredAccounts(env: Env): FixedAccount[] {
  const raw = env.IFACE_AUTH_USERS?.trim()
  if (!raw) throw new Error('IFACE_AUTH_USERS is not configured')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('IFACE_AUTH_USERS must be valid JSON')
  }

  if (!Array.isArray(parsed)) throw new Error('IFACE_AUTH_USERS must be an array')

  const accounts = parsed.map(normalizeAccount)
  if (accounts.some((account) => account === null)) {
    throw new Error('IFACE_AUTH_USERS contains an invalid account')
  }

  const validAccounts = accounts as FixedAccount[]
  const ids = new Set(validAccounts.map((account) => account.id))
  const usernames = new Set(validAccounts.map((account) => account.username))
  if (ids.size !== validAccounts.length || usernames.size !== validAccounts.length) {
    throw new Error('IFACE_AUTH_USERS contains duplicate accounts')
  }

  return validAccounts
}

function findAccountByUsername(env: Env, username: string): FixedAccount | null {
  return getConfiguredAccounts(env).find((account) => account.username === username) ?? null
}

function findAccountById(env: Env, userId: string): FixedAccount | null {
  return getConfiguredAccounts(env).find((account) => account.id === userId) ?? null
}

function publicAccount(account: FixedAccount) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
  }
}

function getSessionSecret(env: Env): string {
  const secret = env.IFACE_SESSION_SECRET?.trim()
  if (!secret) throw new Error('IFACE_SESSION_SECRET is not configured')
  return secret
}

async function hmacSha256Base64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return toBase64Url(new Uint8Array(signature))
}

async function createSessionToken(env: Env, account: FixedAccount): Promise<string> {
  const payload: SessionPayload = {
    userId: account.id,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  }
  const payloadText = JSON.stringify(payload)
  const encodedPayload = base64UrlEncodeText(payloadText)
  const signature = await hmacSha256Base64Url(getSessionSecret(env), encodedPayload)
  return `${encodedPayload}.${signature}`
}

async function readSessionAccount(request: Request, env: Env): Promise<FixedAccount | null> {
  const token = parseCookie(request, SESSION_COOKIE)
  if (!token) return null

  const [encodedPayload, signature, ...extra] = token.split('.')
  if (!encodedPayload || !signature || extra.length > 0) return null

  const expectedSignature = await hmacSha256Base64Url(getSessionSecret(env), encodedPayload)
  if (!timingSafeEqual(signature, expectedSignature)) return null

  const payloadText = base64UrlDecodeText(encodedPayload)
  if (!payloadText) return null

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return null
  }

  if (!isRecord(payload)) return null
  const userId = typeof payload.userId === 'string' ? payload.userId : ''
  const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : 0
  if (!userId || expiresAt <= Date.now()) return null

  return findAccountById(env, userId)
}

async function requireUser(request: Request, env: Env): Promise<FixedAccount | Response> {
  const account = await readSessionAccount(request, env)
  if (!account) return errorResponse(401, '请先登录')
  return account
}

async function handleAccountLogin(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (err) {
    return errorResponse(400, err instanceof Error ? err.message : '请求体不正确')
  }

  if (!isRecord(body)) return errorResponse(400, '请求体不正确')

  const username = normalizeUsername(body.username)
  const password = normalizePassword(body.password)
  if (!username || !password) return errorResponse(401, '账号或密码不正确')

  const account = findAccountByUsername(env, username)
  if (!account || !timingSafeEqual(password, account.password)) {
    return errorResponse(401, '账号或密码不正确')
  }

  const token = await createSessionToken(env, account)
  return authResponse({ ok: true, user: publicAccount(account) }, sessionCookie(token))
}

async function handleAccountLogout(): Promise<Response> {
  return authResponse({ ok: true }, clearSessionCookie())
}

async function handleAccountMe(request: Request, env: Env): Promise<Response> {
  const account = await requireUser(request, env)
  if (account instanceof Response) return account
  return jsonResponse({ ok: true, user: publicAccount(account) })
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

async function handleAccountSnapshotPull(request: Request, env: Env): Promise<Response> {
  const account = await requireUser(request, env)
  if (account instanceof Response) return account

  const snapshot = await env.DB.prepare(
    'SELECT payload, payload_hash, updated_at FROM user_snapshots WHERE user_id = ?',
  )
    .bind(account.id)
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
  const account = await requireUser(request, env)
  if (account instanceof Response) return account

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
    .bind(account.id, validated.payload, payloadHash, now)
    .run()

  return jsonResponse({ ok: true, payloadHash, updatedAt: now })
}

async function handleAccountSnapshotDelete(request: Request, env: Env): Promise<Response> {
  const account = await requireUser(request, env)
  if (account instanceof Response) return account

  await env.DB.prepare('DELETE FROM user_snapshots WHERE user_id = ?').bind(account.id).run()
  return jsonResponse({ ok: true })
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
  if (!timingSafeEqual(providedHash, row.secret_hash)) {
    return errorResponse(401, '同步密钥不正确')
  }

  return profileId
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
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleAccountLogin(request, env)
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleAccountLogout()
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
