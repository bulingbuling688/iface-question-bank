import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { pushToAccount } from '@/lib/accountSync'
import { useAIStore } from '@/store/useAIStore'
import { useAccountStore } from '@/store/useAccountStore'

type Mode = 'login' | 'register'

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
  const { login, register, loading } = useAccountStore()
  const { sessions } = useAIStore()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const redirectPath = useMemo(() => getRedirectPath(location.state), [location.state])
  const isRegister = mode === 'register'
  const busy = loading || syncing

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)

      const normalizedEmail = email.trim()
      if (!normalizedEmail) {
        setError('请输入邮箱')
        return
      }
      if (password.length < 8) {
        setError('密码至少 8 位')
        return
      }
      if (isRegister && !displayName.trim()) {
        setError('请输入昵称')
        return
      }
      if (isRegister && password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }

      try {
        if (isRegister) {
          await register({
            email: normalizedEmail,
            displayName: displayName.trim(),
            password,
          })
        } else {
          await login({ email: normalizedEmail, password })
        }

        setSyncing(true)
        await pushToAccount(Object.values(sessions))
        navigate(redirectPath, { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSyncing(false)
      }
    },
    [
      confirmPassword,
      displayName,
      email,
      isRegister,
      login,
      navigate,
      password,
      redirectPath,
      register,
      sessions,
    ],
  )

  return (
    <div
      style={{
        minHeight: 'calc(100dvh - var(--navbar-h))',
        padding: 'calc(var(--navbar-h) + 48px) 20px 48px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-3)',
            textDecoration: 'none',
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          <span aria-hidden="true">←</span>
          返回 iFace
        </Link>

        <section
          style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-sm)',
            borderRadius: 12,
            padding: 22,
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, lineHeight: 1.2, fontWeight: 700, color: 'var(--text)' }}>
              {isRegister ? '创建账号' : '登录账号'}
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--text-3)' }}>
              {isRegister
                ? '把本地刷题记录、笔记和自定义题库保存到你的云端账号。'
                : '登录后同步你的刷题记录、笔记和自定义题库。'}
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isRegister && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>昵称</span>
                <input
                  className="input-base"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="你的名字"
                  autoComplete="name"
                  disabled={busy}
                />
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>邮箱</span>
              <input
                className="input-base"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
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
                placeholder="至少 8 位"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                disabled={busy}
              />
            </label>

            {isRegister && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                  确认密码
                </span>
                <input
                  className="input-base"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再输入一次"
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
            )}

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
              {syncing ? '同步本地数据…' : isRegister ? '注册并同步' : '登录并同步'}
            </button>
          </form>

          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--text-3)',
            }}
          >
            <span>{isRegister ? '已有账号？' : '还没有账号？'}</span>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setMode(isRegister ? 'login' : 'register')
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--primary)',
                fontSize: 13,
                fontWeight: 600,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              {isRegister ? '去登录' : '创建账号'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
