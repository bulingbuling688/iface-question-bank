const API_BASE = '/api'

export interface AccountUser {
  id: string
  email: string
  displayName: string
}

export interface AccountSnapshot {
  payload: unknown
  payloadHash: string
  updatedAt: string
}

interface ApiOk<T> {
  ok: true
  user?: AccountUser
  snapshot?: T
  payloadHash?: string
  updatedAt?: string
}

interface ApiError {
  ok: false
  error?: string
}

export interface AccountAuthInput {
  email: string
  password: string
}

export interface AccountRegisterInput extends AccountAuthInput {
  displayName: string
}

async function accountFetch<T>(path: string, options: RequestInit = {}): Promise<ApiOk<T>> {
  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (options.body) headers.set('content-type', 'application/json')

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })
  const data = (await res.json().catch(() => ({}))) as ApiOk<T> | ApiError
  if (!res.ok) {
    throw new Error((data.ok === false ? data.error : undefined) || `账号服务 HTTP ${res.status}`)
  }
  if (!data.ok) throw new Error(data.error || '账号服务返回失败')
  return data
}

function requireUser(data: ApiOk<unknown>): AccountUser {
  if (!data.user) throw new Error('账号服务没有返回用户信息')
  return data.user
}

export async function registerAccount(input: AccountRegisterInput): Promise<AccountUser> {
  const data = await accountFetch<never>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return requireUser(data)
}

export async function loginAccount(input: AccountAuthInput): Promise<AccountUser> {
  const data = await accountFetch<never>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return requireUser(data)
}

export async function logoutAccount(): Promise<void> {
  await accountFetch<never>('/auth/logout', { method: 'POST' })
}

export async function getCurrentAccount(): Promise<AccountUser | null> {
  try {
    const data = await accountFetch<never>('/auth/me')
    return requireUser(data)
  } catch {
    return null
  }
}

export async function pullAccountSnapshot(): Promise<AccountSnapshot | null> {
  const data = await accountFetch<AccountSnapshot | null>('/account/snapshot')
  return data.snapshot ?? null
}

export async function pushAccountSnapshot(payload: unknown): Promise<{
  payloadHash?: string
  updatedAt?: string
}> {
  const data = await accountFetch<never>('/account/snapshot', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  })
  return {
    payloadHash: data.payloadHash,
    updatedAt: data.updatedAt,
  }
}

export async function deleteAccountSnapshot(): Promise<void> {
  await accountFetch<never>('/account/snapshot', { method: 'DELETE' })
}
