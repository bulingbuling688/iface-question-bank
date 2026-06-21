import worker from '../worker/src/index.ts'

interface Failure {
  name: string
  message: string
}

interface SnapshotRow {
  user_id: string
  payload: string
  payload_hash: string
  updated_at: string
}

interface MockDbState {
  accountSnapshots: SnapshotRow[]
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
    accountSnapshots: [],
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

        if (normalizedSql.includes('FROM user_snapshots WHERE user_id = ?')) {
          return (state.accountSnapshots.find((row) => row.user_id === values[0]) ??
            null) as T | null
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

        if (normalizedSql.startsWith('INSERT INTO user_snapshots')) {
          const [userId, payload, payloadHash, updatedAt] = values as [
            string,
            string,
            string,
            string,
          ]
          const existing = state.accountSnapshots.find((row) => row.user_id === userId)
          if (existing) {
            existing.payload = payload
            existing.payload_hash = payloadHash
            existing.updated_at = updatedAt
          } else {
            state.accountSnapshots.push({
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
          state.accountSnapshots = state.accountSnapshots.filter((row) => row.user_id !== userId)
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
const env = {
  DB: db,
  IFACE_SESSION_SECRET: 'unit-test-session-secret',
  IFACE_AUTH_USERS: JSON.stringify([
    {
      id: 'user_a',
      username: 'alpha',
      password: 'alpha-password',
      displayName: '账号 A',
    },
    {
      id: 'user_b',
      username: 'beta',
      password: 'beta-password',
      displayName: '账号 B',
    },
  ]),
}

const register = await request(env, '/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'new-user', password: 'new-password' }),
})
assertEqual('register endpoint is disabled', register.status, 404)

const loginA = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: ' alpha ', password: 'alpha-password' }),
})
const loginAJson = await readJson(loginA)
const cookieA = getSessionCookie(loginA)
assertEqual('fixed account login status', loginA.status, 200)
assertEqual(
  'login returns fixed account id',
  (loginAJson.user as Record<string, unknown>)?.id,
  'user_a',
)
assertEqual(
  'login returns display name',
  (loginAJson.user as Record<string, unknown>)?.displayName,
  '账号 A',
)
assert(
  'login does not expose password',
  !JSON.stringify(loginAJson).includes('alpha-password'),
  'password leaked in login response',
)
assert('login sets httpOnly cookie', cookieA.length > 0, 'missing iface_session cookie')
assert(
  'login cookie is httpOnly',
  (loginA.headers.get('set-cookie') ?? '').includes('HttpOnly'),
  'cookie is not httpOnly',
)

const wrongPassword = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'alpha', password: 'wrong-password' }),
})
const wrongPasswordJson = await readJson(wrongPassword)
assertEqual('wrong password rejected', wrongPassword.status, 401)
assertEqual('wrong password generic message', wrongPasswordJson.error, '账号或密码不正确')

const unknownUser = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'missing', password: 'alpha-password' }),
})
const unknownUserJson = await readJson(unknownUser)
assertEqual('unknown user rejected', unknownUser.status, 401)
assertEqual('unknown user generic message', unknownUserJson.error, '账号或密码不正确')

const meA = await request(env, '/api/auth/me', {
  headers: { cookie: cookieA },
})
const meAJson = await readJson(meA)
assertEqual('me status', meA.status, 200)
assertEqual(
  'me returns current fixed account',
  (meAJson.user as Record<string, unknown>)?.id,
  'user_a',
)

const loginB = await request(env, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'beta', password: 'beta-password' }),
})
const cookieB = getSessionCookie(loginB)
assertEqual('second fixed account login status', loginB.status, 200)

const pushA = await request(env, '/api/account/snapshot', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieA },
  body: JSON.stringify({ payload: makeSnapshotPayload('alpha') }),
})
assertEqual('account A snapshot push status', pushA.status, 200)

const pushB = await request(env, '/api/account/snapshot', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieB },
  body: JSON.stringify({ payload: makeSnapshotPayload('beta') }),
})
assertEqual('account B snapshot push status', pushB.status, 200)
assertEqual('server stores one snapshot per account', state.accountSnapshots.length, 2)

const pullA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieA },
})
const pullAJson = await readJson(pullA)
assertEqual('account A snapshot pull status', pullA.status, 200)
assert(
  'account snapshots are isolated',
  JSON.stringify(pullAJson).includes('alpha-question') &&
    !JSON.stringify(pullAJson).includes('beta-question'),
  'snapshot leaked across accounts',
)

const deleteA = await request(env, '/api/account/snapshot', {
  method: 'DELETE',
  headers: { cookie: cookieA },
})
assertEqual('account A snapshot delete status', deleteA.status, 200)

const pullAfterDeleteA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieA },
})
const pullAfterDeleteAJson = await readJson(pullAfterDeleteA)
assertEqual('deleted account snapshot pull status', pullAfterDeleteA.status, 200)
assertEqual('deleted account snapshot is null', pullAfterDeleteAJson.snapshot, null)

const pullBAfterDeleteA = await request(env, '/api/account/snapshot', {
  headers: { cookie: cookieB },
})
const pullBAfterDeleteAJson = await readJson(pullBAfterDeleteA)
assert(
  'delete only removes current account snapshot',
  JSON.stringify(pullBAfterDeleteAJson).includes('beta-question'),
  'deleting account A removed account B snapshot',
)

const logoutA = await request(env, '/api/auth/logout', {
  method: 'POST',
  headers: { cookie: cookieA },
})
assertEqual('logout status', logoutA.status, 200)
assert(
  'logout clears cookie',
  (logoutA.headers.get('set-cookie') ?? '').includes('Max-Age=0'),
  'cookie not cleared',
)

const meAfterLogout = await request(env, '/api/auth/me')
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

console.log('账号认证检查通过：固定账密登录、会话、退出和账号快照隔离正常')
