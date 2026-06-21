const ACTIVE_ACCOUNT_KEY = 'iface_active_account_id'
const ACCOUNT_CHANGED_EVENT = 'iface:account-changed'
const FALLBACK_ACCOUNT_ID = 'anonymous'

export function sanitizeAccountId(value: string | null | undefined): string {
  const normalized = value?.trim() || FALLBACK_ACCOUNT_ID
  return normalized.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || FALLBACK_ACCOUNT_ID
}

export function getActiveAccountId(): string {
  try {
    return sanitizeAccountId(localStorage.getItem(ACTIVE_ACCOUNT_KEY))
  } catch {
    return FALLBACK_ACCOUNT_ID
  }
}

export function setActiveAccountId(accountId: string | null): void {
  try {
    if (accountId) {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, sanitizeAccountId(accountId))
    } else {
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
    }
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT, { detail: accountId }))
  }
}

export function getAccountScopedStorageKey(key: string, accountId = getActiveAccountId()): string {
  return `${key}:${sanitizeAccountId(accountId)}`
}

export function onActiveAccountChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(ACCOUNT_CHANGED_EVENT, listener)
  return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, listener)
}
