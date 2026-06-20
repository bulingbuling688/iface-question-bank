import type { AISession } from '@/store/useAIStore'
import {
  buildGistBackupPayload,
  type GistBackup,
  mergeGistBackupData,
  parseGistBackupPayload,
  type SyncData,
  type SyncMergeStats,
  type SyncResult,
} from './gistSync'
import { applySyncData, collectLocalSyncData, resultFromBackup } from './syncSnapshot'

const PROFILE_KEY = 'iface_d1_sync_profile'
const API_BASE = '/api/sync'

export interface D1SyncProfile {
  profileId: string
  secret: string
  createdAt?: string
}

export interface D1SyncResult extends SyncResult {
  profile?: D1SyncProfile
  syncCode?: string
  remoteUpdatedAt?: string
}

interface D1ApiOk<T> {
  ok: true
  profileId?: string
  secret?: string
  createdAt?: string
  payloadHash?: string
  updatedAt?: string
  snapshot?: T
}

interface D1ApiError {
  ok: false
  error?: string
}

interface D1Snapshot {
  payload: unknown
  payloadHash: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function normalizeProfile(value: unknown): D1SyncProfile | null {
  if (!isRecord(value)) return null
  const profileId = typeof value.profileId === 'string' ? value.profileId.trim() : ''
  const secret = typeof value.secret === 'string' ? value.secret.trim() : ''
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : undefined
  if (!/^[a-zA-Z0-9_-]{16,96}$/.test(profileId)) return null
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(secret)) return null
  return { profileId, secret, createdAt }
}

function saveProfile(profile: D1SyncProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {}
}

export function getD1SyncProfile(): D1SyncProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    return normalizeProfile(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearD1SyncProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {}
}

export function buildD1SyncCode(profile = getD1SyncProfile()): string {
  if (!profile) return ''
  return `iface-d1:${toBase64Url(JSON.stringify({ v: 1, ...profile }))}`
}

export function importD1SyncCode(code: string): D1SyncProfile {
  const trimmed = code.trim()
  const payload = trimmed.startsWith('iface-d1:') ? trimmed.slice('iface-d1:'.length) : trimmed
  const decoded = JSON.parse(fromBase64Url(payload))
  const profile = normalizeProfile(decoded)
  if (!profile) throw new Error('同步码格式不正确')
  saveProfile(profile)
  return profile
}

async function d1Fetch<T>(
  path: string,
  options: RequestInit = {},
  profile?: D1SyncProfile,
): Promise<D1ApiOk<T>> {
  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (options.body) headers.set('content-type', 'application/json')
  if (profile) {
    headers.set('x-iface-profile-id', profile.profileId)
    headers.set('x-iface-sync-secret', profile.secret)
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = (await res.json().catch(() => ({}))) as D1ApiOk<T> | D1ApiError
  if (!res.ok) {
    throw new Error((data.ok === false ? data.error : undefined) || `同步服务 HTTP ${res.status}`)
  }
  if (!data.ok) {
    throw new Error(data.error || '同步服务返回失败')
  }
  return data
}

export async function createD1SyncProfile(): Promise<D1SyncProfile> {
  const data = await d1Fetch<never>('/register', { method: 'POST' })
  if (!data.profileId || !data.secret) {
    throw new Error('同步服务没有返回身份信息')
  }
  const profile = {
    profileId: data.profileId,
    secret: data.secret,
    createdAt: data.createdAt,
  }
  saveProfile(profile)
  return profile
}

export async function ensureD1SyncProfile(): Promise<D1SyncProfile> {
  return getD1SyncProfile() ?? createD1SyncProfile()
}

async function loadFromD1(profile: D1SyncProfile): Promise<{
  backup: GistBackup | null
  updatedAt?: string
}> {
  const data = await d1Fetch<D1Snapshot | null>('/pull', { method: 'GET' }, profile)
  if (!data.snapshot) return { backup: null }
  return {
    backup: parseGistBackupPayload(JSON.stringify(data.snapshot.payload)),
    updatedAt: data.snapshot.updatedAt,
  }
}

async function saveToD1(
  profile: D1SyncProfile,
  backup: SyncData,
  stats?: SyncMergeStats,
): Promise<D1SyncResult> {
  const payload = buildGistBackupPayload(backup)
  const data = await d1Fetch<never>(
    '/push',
    {
      method: 'POST',
      body: JSON.stringify({ payload }),
    },
    profile,
  )
  const result = resultFromBackup(backup, payload.exportedAt, stats)
  return {
    ...result,
    profile,
    syncCode: buildD1SyncCode(profile),
    remoteUpdatedAt: data.updatedAt,
  }
}

export async function pushToD1(aiSessions: AISession[] = []): Promise<D1SyncResult> {
  try {
    const profile = await ensureD1SyncProfile()
    const localBackup = await collectLocalSyncData(aiSessions)
    const remote = await loadFromD1(profile)
    const merged = mergeGistBackupData(localBackup, remote.backup)
    const result = await saveToD1(profile, merged.backup, merged.stats)
    if (result.ok) {
      await applySyncData(merged.backup)
    }
    return result
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function pullFromD1(localAISessions: AISession[] = []): Promise<D1SyncResult | null> {
  try {
    const profile = getD1SyncProfile()
    if (!profile) {
      return { ok: false, error: '还没有数据库同步身份，请先保存一次或导入同步码' }
    }

    const remote = await loadFromD1(profile)
    if (!remote.backup) return null

    const localBackup = await collectLocalSyncData(localAISessions)
    const merged = mergeGistBackupData(localBackup, remote.backup)
    await applySyncData(merged.backup)

    return {
      ...resultFromBackup(merged.backup, remote.backup.exportedAt, merged.stats),
      profile,
      syncCode: buildD1SyncCode(profile),
      remoteUpdatedAt: remote.updatedAt,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function deleteD1Snapshot(): Promise<D1SyncResult> {
  try {
    const profile = getD1SyncProfile()
    if (!profile) {
      return { ok: false, error: '还没有数据库同步身份' }
    }
    await d1Fetch<never>('/snapshot', { method: 'DELETE' }, profile)
    return { ok: true, profile, syncCode: buildD1SyncCode(profile) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
