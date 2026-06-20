import worker from '../worker/src/index.ts'

interface Failure {
  name: string
  message: string
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
  created_at: string
  updated_at: string
  last_login_at: string | null
}

interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  created_at: string
  expires_at: string
  last_seen_at: string
  user_agent: string | null
}

interface SnapshotRow {
  user_id: string
  payload: string
  payload_hash: string
  updated_at: string
}

interface MockDbState {
  users: UserRow[]
  sessions: SessionRow[]
  snapshots: SnapshotRow[]
  syncProfiles: Array<{
    profile_id: string
    secret_hash: string
    created_at: string
    updated_at: string
  }>
  syncSnapshots: Array<{
    profile_id: string
    payload: string
    payload_hash: string
    updated_at: string
  }>
}

interface D1Result {
  success: boolean
}

const failures: Failure[] = []

function assert(name: string, condition: boolean, message: string): void {
  if (!condition) failures.push({ name, message })
}

function assertEqual<T>(name: string, actual: T, expected: T): void {
  assert(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

function makeSnapshotPayload(label: string) {
  return {
    version: 8,
    exportedAt: new Date('2026-06-20T00:00:00.000Z').toISOString(),
    records: { ids: [`${label}-question`], statuses: [1], times: [1781913600], counts: [1] },
    questionNotes: [],
    questionAnswerAnnotations: [],
    questionAnswerOverrides: [],
    questionFlags: [],
    aiSessions: [],
    customQuestions: [],
    customCategories: {},
    customSources: [],
  }
}

function createMockD1() {
  const state: MockDbState = {
    users: [],
    sessions: [],
    snapshots: [],
    syncProfiles: [],
    syncSnapshots: [],
  }

  function prepare(sql: string) {
    let values: unknown[] = []
    return {
      bind(...args: unknown[]) {
        values = args
        return this
      },
      async first<T>() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim()

        if (normalizedSql.includes('FROM users WHERE email_normalized = ?')) {
          return (state.users.find((row) => row.email_normalized === values[0]) ?? null) as T | null
        }

        if (
          normalizedSql.includes('FROM user_sessions') &&
          normalizedSql.includes('token_hash = ?')
        ) {
          const session = state.sessions.find((row) => row.token_hash === values[0])
          if (!session) return null
          const user = state.users.find((row) => row.id === session.user_id)
          if (!user) return null
          return {
            session_id: session.id,
            user_id: user.id,
            email: user.email,
            display_name: user.display_name,
            expires_at: session.expires_at,
          } as T
        }

        if (normalizedSql.includes('FROM user_snapshots WHERE user_id = ?')) {
          return (state.snapshots.find((row) => row.user_id === values[0]) ?? null) as T | null
        }

        if (normalizedSql.includes('FROM sync_profiles WHERE profile_id = ?')) {
          return (state.syncProfiles.find((row) => row.profile_id === values[0]) ??
            null) as T | null
        }

        if (normalizedSql.includes('FROM sync_snapshots WHERE profile_id = ?')) {
          return (state.syncSnapshots.find((row) => row.profile_id === values[0]) ??
            null) as T | null
        }

        throw new Error(`Unhandled first SQL: ${normalizedSql}`)
      },
      async run(): Promise<D1Result> {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim()

        if (normalizedSql.startsWith('INSERT INTO users')) {
          const [
            id,
            email,
            emailNormalized,
            displayName,
            passwordHash,
            passwordSalt,
            passwordAlgo,
            passwordIterations,
            createdAt,
            updatedAt,
          ] = values as [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            number,
            string,
            string,
          ]
          state.users.push({
            id,
            email,
            email_normalized: emailNormalized,
            display_name: displayName,
            password_hash: passwordHash,
            password_salt: passwordSalt,
            password_algo: passwordAlgo,
            password_iterations: passwordIterations,
            created_at: createdAt,
            updated_at: updatedAt,
            last_login_at: null,
          })
          return { success: true }
        }

        if (normalizedSql.startsWith('INSERT INTO user_sessions')) {
          const [id, userId, tokenHash, createdAt, expiresAt, lastSeenAt, userAgent] = values as [
            string,
            string,
            string,
            string,
            string,
            string,
            string | null,
          ]
          state.sessions.push({
            id,
            user_id: userId,
            token_hash: tokenHash,
            created_at: createdAt,
            expires_at: expiresAt,
            last_seen_at: lastSeenAt,
            user_agent: userAgent,
          })
          return { success: true }
        }

        if (normalizedSql.startsWith('UPDATE users SET last_login_at = ?')) {
          const [lastLoginAt, updatedAt, userId] = values as [string, string, string]
          const user = state.users.find((row) => row.id === userId)
          if (user) {
            user.last_login_at = lastLoginAt
            user.updated_at = updatedAt
          }
          return { success: true }
        }

        if (normalizedSql.startsWith('UPDATE user_sessions SET last_seen_at = ?')) {
          const [lastSeenAt, sessionId] = values as [string, string]
          const session = state.sessions.find((row) => row.id === sessionId)
          if (session) session.last_seen_at = lastSeenAt
          return { success: true }
        }

        if (normalizedSql.startsWith('DELETE FROM user_sessions WHERE token_hash = ?')) {
          const tokenHash = values[0] as string
          state.sessions = state.sessions.filter((row) => row.token_hash !== tokenHash)
          return { success: true }
        }

        if (normalizedSql.startsWith('DELETE FROM user_sessions WHERE expires_at <= ?')) {
          const now = values[0] as string
          state.sessions = state.sessions.filter((row) => row.expires_at > now)
          return { success: true }
        }

        if (normalizedSql.startsWith('INSERT INTO user_snapshots')) {
          const [userId, payload, payloadHash, updatedAt] = values as [
            string,
            string,
            string,
            string,
          ]
          const existing = state.snapshots.find((row) => row.user_id === userId)
          if (existing) {
            existing.payload = payload
            existing.payload_hash = payloadHash
            existing.updated_at = updatedAt
          } else {
            state.snapshots.push({
              user_id: userId,
              payload,
              payload_hash: payloadHash,
              updated_at: updatedAt,
            })
          }
          return { success: true }
        }

        if (normalizedSql.startsWith('DELETE FROM user_snapshots WHERE user_id = ?')) {
          const userId = values[0] as string
          state.snapshots = state.snapshots.filter((row) => row.user_id !== userId)
          return { success: true }
        }

        if (normalizedSql.startsWith('INSERT INTO sync_profiles')) {
          const [profileId, secretHash, createdAt, updatedAt] = values as [
            string,
            string,
            string,
            string,
          ]
          state.syncProfiles.push({
            profile_id: profileId,
            secret_hash: secretHash,
            created_at: createdAt,
            updated_at: updatedAt,
          })
          return { success: true }
        }

        if (normalizedSql.startsWith('INSERT INTO sync_snapshots')) {
          const [profileId, payload, payloadHash, updatedAt] = values as [
            string,
            string,
            string,
            string,
          ]
          const existing = state.syncSnapshots.find((row) => row.profile_id === profileId)
          if (existing) {
            existing.payload = payload
            existing.payload_hash = payloadHash
            existing.updated_at = updatedAt
          } else {
            state.syncSnapshots.push({
              profile_id: profileId,
              payload,
              payload_hash: payloadHash,
              updated_at: updatedAt,
            })
          }
          return { success: true }
        }

        if (
          normalizedSql.startsWith('UPDATE sync_profiles SET updated_at = ? WHERE profile_id = ?')
        ) {
          const [updatedAt, profileId] = values as [string, string]
          const profile = state.syncProfiles.find((row) => row.profile_id === profileId)
          if (profile) profile.updated_at = updatedAt
          return { success: true }
        }

        if (normalizedSql.startsWith('DELETE FROM sync_snapshots WHERE profile_id = ?')) {
          const profileId = values[0] as string
          state.syncSnapshots = state.syncSnapshots.filter((row) => row.profile_id !== profileId)
          return { success: true }
        }

        throw new Error(`Unhandled run SQL: ${normalizedSql}`)
      },
    }
  }

  return {
    db: { prepare },
    state,
  }
}

async function request(env: unknown, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://iface-question-bank.chatapi.fun${path}`, init), env)
}

function getSessionCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie') ?? ''
  const match = cookie.match(/iface_session=([^;]+)/)
  return match ? `iface_session=${match[1]}` : ''
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

const { db, state } = createMockD1()
const env = { DB: db, AUTH_PEPPER: 'unit-test-pepper' }

const registerA = await request(env, '/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: ' Alice@Example.COM ',
    displayName: 'Alice',
    password: 'password-123',
  }),
})
const registerAJson = await readJson(registerA)
const cookieA = getSessionCookie(registerA)
assertEqual('register status', registerA.status, 200)
assert(
  'register returns user',
  Boolean((registerAJson.user as Record<string, unknown>)?.id),
  'missing user id',
)
assert('register sets httpOnly cookie', cookieA.length > 0, 'missing iface_session cookie')
assertEqual('email normalized in db', state.users[0]?.email_normalized, 'alice@example.com')
assert(
  'password is hashed',
  state.users[0]?.password_hash !== 'password-123',
  'password stored as plaintext',
)

const duplicate = await request(env, '/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'alice@example.com',
    displayName: 'Alice Again',
    password: 'password-456',
  }),
})
assertEqual('duplicate register rejected', duplicate.status, 409)

const meA = await request(env, '/api/auth/me', {
  headers: { cookie: cookieA },
})
const meAJson = await readJson(meA)
assertEqual('me status', meA.status, 200)
assertEqual(
  'me returns sanitized account',
  (meAJson.user as Record<string, unknown>)?.email,
  'Alice@Example.COM',
)
assert(
  'me does not expose password hash',
  !JSON.stringify(meAJson).includes('password_hash'),
  'password hash leaked',
)

const wrongPassword = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'wrong-password' }),
})
const wrongPasswordJson = await readJson(wrongPassword)
assertEqual('wrong password rejected', wrongPassword.status, 401)
assertEqual('wrong password generic message', wrongPasswordJson.error, '邮箱或密码不正确')

const loginA = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'password-123' }),
})
const cookieALogin = getSessionCookie(loginA)
assertEqual('login status', loginA.status, 200)
assert('login sets new cookie', cookieALogin.length > 0, 'missing login cookie')

const registerB = await request(env, '/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'bob@example.com',
    displayName: 'Bob',
    password: 'password-123',
  }),
})
const cookieB = getSessionCookie(registerB)
assertEqual('second register status', registerB.status, 200)

const pushA = await request(env, '/api/account/snapshot', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieALogin },
  body: JSON.stringify({ payload: makeSnapshotPayload('alice') }),
})
assertEqual('account snapshot push status', pushA.status, 200)

const pushB = await request(env, '/api/account/snapshot', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieB },
  body: JSON.stringify({ payload: makeSnapshotPayload('bob') }),
})
assertEqual('second account snapshot push status', pushB.status, 200)

const pullA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieALogin },
})
const pullAJson = await readJson(pullA)
assertEqual('account snapshot pull status', pullA.status, 200)
assert(
  'account snapshots are isolated',
  JSON.stringify(pullAJson).includes('alice-question') &&
    !JSON.stringify(pullAJson).includes('bob-question'),
  'snapshot leaked across users',
)

const deleteA = await request(env, '/api/account/snapshot', {
  method: 'DELETE',
  headers: { cookie: cookieALogin },
})
assertEqual('account snapshot delete status', deleteA.status, 200)

const pullAfterDeleteA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieALogin },
})
const pullAfterDeleteAJson = await readJson(pullAfterDeleteA)
assertEqual('deleted account snapshot pull status', pullAfterDeleteA.status, 200)
assertEqual('deleted account snapshot is null', pullAfterDeleteAJson.snapshot, null)

const pullBAfterDeleteA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieB },
})
const pullBAfterDeleteAJson = await readJson(pullBAfterDeleteA)
assert(
  'delete only removes current user snapshot',
  JSON.stringify(pullBAfterDeleteAJson).includes('bob-question'),
  'deleting user A removed user B snapshot',
)

const logoutA = await request(env, '/api/auth/logout', {
  method: 'POST',
  headers: { cookie: cookieALogin },
})
assertEqual('logout status', logoutA.status, 200)
assert(
  'logout clears cookie',
  (logoutA.headers.get('set-cookie') ?? '').includes('Max-Age=0'),
  'cookie not cleared',
)

const meAfterLogout = await request(env, '/api/auth/me', {
  headers: { cookie: cookieALogin },
})
assertEqual('me after logout unauthorized', meAfterLogout.status, 401)

const snapshotLoggedOut = await request(env, '/api/account/snapshot')
assertEqual('snapshot requires auth', snapshotLoggedOut.status, 401)

if (failures.length > 0) {
  console.error(`账号认证检查失败：${failures.length} 个问题`)
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.message}`)
  }
  process.exit(1)
}

console.log('账号认证检查通过：注册、登录、会话、退出和账号快照隔离正常')
