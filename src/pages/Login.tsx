import { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { pullFromAccount } from '@/lib/accountSync'
import { useAccountStore } from '@/store/useAccountStore'
import { useAIStore } from '@/store/useAIStore'

function getRedirectPath(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof (state as { from?: unknown }).from === 'string'
  ) {
    const from = (state as { from: string }).from
    if (from.startsWith('/') && !from.startsWith('//') && from !== '/login') return from
  }
  return '/'
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loading } = useAccountStore()
  const { sessions, upsertSessions } = useAIStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const redirectPath = useMemo(() => getRedirectPath(location.state), [location.state])
  const busy = loading || syncing

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      const normalizedUsername = username.trim()
      if (!normalizedUsername) {
        setError('请输入账号')
        return
      }
      if (!password) {
        setError('请输入密码')
        return
      }

      try {
        await login({ username: normalizedUsername, password })
        setSyncing(true)
        const result = await pullFromAccount(Object.values(sessions))
        if (result?.ok && result.aiSessions) {
          upsertSessions(result.aiSessions)
        }
        navigate(redirectPath, { replace: true })
        window.location.assign(redirectPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSyncing(false)
      }
    },
    [login, navigate, password, redirectPath, sessions, upsertSessions, username],
  )

  return (
    <div
      style={{
        minHeight: '100dvh',
        padding: '72px 20px 48px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        background: 'var(--surface)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 380,
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-sm)',
          borderRadius: 12,
          padding: 22,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
            iFace
          </p>
          <h1 style={{ fontSize: 22, lineHeight: 1.2, fontWeight: 700, color: 'var(--text)' }}>
            登录账号
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--text-3)' }}>
            使用分配好的账号进入自己的题库空间。
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>账号</span>
            <input
              className="input-base"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
              disabled={busy}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>密码</span>
            <input
              className="input-base"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              disabled={busy}
            />
          </label>

          {error && (
            <div
              style={{
                padding: '9px 11px',
                borderRadius: 9,
                border: '1px solid rgba(239,68,68,0.22)',
                background: 'var(--danger-light)',
                color: 'var(--danger)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              height: 40,
              borderRadius: 9,
              border: '1px solid var(--primary)',
              background: 'var(--primary)',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.72 : 1,
            }}
          >
            {syncing ? '进入账号空间…' : '登录'}
          </button>
        </form>
      </section>
    </div>
  )
}
