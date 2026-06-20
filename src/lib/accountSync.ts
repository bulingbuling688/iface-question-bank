import type { AISession } from '@/store/useAIStore'
import {
  deleteAccountSnapshot as deleteRemoteAccountSnapshot,
  pullAccountSnapshot,
  pushAccountSnapshot,
} from './accountApi'
import {
  buildGistBackupPayload,
  type GistBackup,
  mergeGistBackupData,
  parseGistBackupPayload,
  type SyncResult,
} from './gistSync'
import { applySyncData, collectLocalSyncData, resultFromBackup } from './syncSnapshot'

export interface AccountSyncResult extends SyncResult {
  remoteUpdatedAt?: string
}

async function loadFromAccount(): Promise<{
  backup: GistBackup | null
  updatedAt?: string
}> {
  const snapshot = await pullAccountSnapshot()
  if (!snapshot) return { backup: null }
  return {
    backup: parseGistBackupPayload(JSON.stringify(snapshot.payload)),
    updatedAt: snapshot.updatedAt,
  }
}

export async function pushToAccount(aiSessions: AISession[] = []): Promise<AccountSyncResult> {
  try {
    const localBackup = await collectLocalSyncData(aiSessions)
    const remote = await loadFromAccount()
    const merged = mergeGistBackupData(localBackup, remote.backup)
    const payload = buildGistBackupPayload(merged.backup)
    const saved = await pushAccountSnapshot(payload)
    const result = resultFromBackup(merged.backup, payload.exportedAt, merged.stats)
    await applySyncData(merged.backup)
    return {
      ...result,
      remoteUpdatedAt: saved.updatedAt,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function pullFromAccount(
  localAISessions: AISession[] = [],
): Promise<AccountSyncResult | null> {
  try {
    const remote = await loadFromAccount()
    if (!remote.backup) return null

    const localBackup = await collectLocalSyncData(localAISessions)
    const merged = mergeGistBackupData(localBackup, remote.backup)
    await applySyncData(merged.backup)

    return {
      ...resultFromBackup(merged.backup, remote.backup.exportedAt, merged.stats),
      remoteUpdatedAt: remote.updatedAt,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function deleteAccountCloudSnapshot(): Promise<AccountSyncResult> {
  try {
    await deleteRemoteAccountSnapshot()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
