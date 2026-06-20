import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { SettingsDrawer } from '@/components/layout/SettingsDrawer'
import { pushToAccount } from '@/lib/accountSync'
import { preloadPath } from '@/lib/routePreload'
import { useAccountStore } from '@/store/useAccountStore'
import { useAIStore } from '@/store/useAIStore'
import { useStudyStore } from '@/store/useStudyStore'

const navItems = [
  { path: '/', label: '概览' },
  { path: '/questions', label: '题库' },
  { path: '/practice', label: '练习' },
  { path: '/weak', label: '薄弱点' },
  { path: '/import', label: '导入' },
  { path: '/tools', label: '工具', activePaths: ['/mock-interview', '/prompt'] },
]

export function Navbar() {
  const location = useLocation()
  const { theme, toggleTheme } = useStudyStore()
  const { sessions } = useAIStore()
  const { user, isLoggedIn, loading: accountLoading, logout } = useAccountStore()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const scrolledRef = useRef(false)
  const locationKey = `${location.pathname}${location.search}`

  useEffect(() => {
    let frame = 0

    const updateScrolled = () => {
      frame = 0
      const next = window.scrollY > 4
      if (scrolledRef.current === next) return
      scrolledRef.current = next
      setScrolled(next)
    }

    const handler = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateScrolled)
    }

    updateScrolled()
    window.addEventListener('scroll', handler, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', handler)
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mobileOpen])

  useEffect(() => {
    if (!locationKey) return
    setAccountOpen(false)
    setAccountMessage(null)
  }, [locationKey])

  useEffect(() => {
    if (!mobileOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileOpen])

  const isActive = (item: (typeof navItems)[number]) => {
    if (item.path === '/') return location.pathname === '/'
    return [item.path, ...(item.activePaths ?? [])].some((path) =>
      location.pathname.startsWith(path),
    )
  }

  const loginState = { from: `${location.pathname}${location.search}` }
  const accountLabel = user?.displayName || user?.email.split('@')[0] || '账号'

  const handleAccountSync = async () => {
    if (!isLoggedIn || accountBusy) return
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      const result = await pushToAccount(Object.values(sessions))
      setAccountMessage(result.ok ? '已同步到云端' : result.error || '同步失败')
    } catch (err) {
      setAccountMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setAccountBusy(false)
    }
  }

  const handleLogout = async () => {
    if (accountBusy) return
    setAccountBusy(true)
    setAccountMessage(null)
    try {
      await logout()
      setAccountOpen(false)
      setMobileOpen(false)
    } catch (err) {
      setAccountMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setAccountBusy(false)
    }
  }

  return (
    <>
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          height: 'var(--navbar-h)',
          borderBottom: scrolled ? '1px solid var(--border-subtle)' : '1px solid transparent',
          background: scrolled ? 'var(--surface-glass)' : 'transparent',
          backdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
          WebkitBackdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
          transition: 'background 0.25s, border-color 0.25s, backdrop-filter 0.25s',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            height: '100%',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Logo */}
          <Link
            to="/"
            onPointerEnter={() => preloadPath('/')}
            onFocus={() => preloadPath('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              marginRight: 8,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
              }}
            >
              iFace
            </span>
          </Link>

          {/* Desktop nav */}
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flex: 1,
            }}
            className="hidden-mobile"
          >
            {navItems.map((item) => {
              const active = isActive(item)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onPointerEnter={() => preloadPath(item.path)}
                  onFocus={() => preloadPath(item.path)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: active ? 'var(--primary)' : 'var(--text-2)',
                    background: active ? 'var(--primary-light)' : 'transparent',
                    letterSpacing: '0.003em',
                    textDecoration: 'none',
                    transition: 'color 0.15s, background 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                      ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
                      ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                    }
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div style={{ flex: 1 }} className="show-mobile" />

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            {/* Settings button */}
            {accountLoading ? (
              <div
                aria-hidden="true"
                style={{
                  width: 54,
                  height: 28,
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            ) : isLoggedIn ? (
              <div style={{ position: 'relative' }} className="hidden-mobile">
                <button
                  type="button"
                  onClick={() => setAccountOpen((v) => !v)}
                  aria-expanded={accountOpen}
                  style={{
                    height: 32,
                    maxWidth: 132,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: accountOpen ? 'var(--surface-2)' : 'transparent',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    {accountLabel.slice(0, 1).toUpperCase()}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {accountLabel}
                  </span>
                </button>

                {accountOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 38,
                      width: 220,
                      padding: 8,
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--surface)',
                      boxShadow: 'var(--shadow-lg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ padding: '7px 8px 9px' }}>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {accountLabel}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--text-3)',
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {user?.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAccountSync}
                      disabled={accountBusy}
                      style={{
                        padding: '8px 9px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-2)',
                        textAlign: 'left',
                        cursor: accountBusy ? 'wait' : 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {accountBusy ? '同步中…' : '同步到云端'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsOpen(true)
                        setAccountOpen(false)
                      }}
                      style={{
                        padding: '8px 9px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-2)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      云同步设置
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={accountBusy}
                      style={{
                        padding: '8px 9px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--danger)',
                        textAlign: 'left',
                        cursor: accountBusy ? 'wait' : 'pointer',
                        fontSize: 12,
                      }}
                    >
                      退出登录
                    </button>
                    {accountMessage && (
                      <p style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-3)' }}>
                        {accountMessage}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                state={loginState}
                onPointerEnter={() => preloadPath('/login')}
                onFocus={() => preloadPath('/login')}
                className="hidden-mobile"
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(var(--primary-rgb),0.24)',
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                登录
              </Link>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="设置"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换亮色' : '切换暗色'}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
              }}
            >
              {theme === 'dark' ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="菜单"
              aria-expanded={mobileOpen}
              className="show-mobile"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: mobileOpen ? 'var(--surface-2)' : 'transparent',
                color: 'var(--text-2)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {mobileOpen ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭菜单"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'rgba(0,0,0,0.2)',
            border: 'none',
            padding: 0,
            margin: 0,
            cursor: 'pointer',
          }}
        />
      )}

      {/* Mobile menu */}
      <div
        style={{
          position: 'fixed',
          top: 'var(--navbar-h)',
          left: 0,
          right: 0,
          zIndex: 45,
          background: 'var(--surface-glass)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '8px 16px 16px',
          display: 'none',
          flexDirection: 'column',
          gap: 2,
          boxShadow: 'var(--shadow-lg)',
          animation: 'slide-down 0.2s var(--ease-out) both',
        }}
        className={mobileOpen ? 'mobile-menu-open' : ''}
      >
        {navItems.map((item) => {
          const active = isActive(item)
          return (
            <Link
              key={item.path}
              to={item.path}
              onPointerEnter={() => preloadPath(item.path)}
              onFocus={() => preloadPath(item.path)}
              onClick={() => setMobileOpen(false)}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--primary)' : 'var(--text)',
                background: active ? 'var(--primary-light)' : 'transparent',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {item.label}
              {active && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--primary)',
                  }}
                />
              )}
            </Link>
          )
        })}

        {/* Settings entry in mobile menu */}
        {accountLoading ? (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              color: 'var(--text-3)',
              fontSize: 14,
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 4,
            }}
          >
            账号加载中…
          </div>
        ) : isLoggedIn ? (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{accountLabel}</p>
              <p
                style={{
                  marginTop: 3,
                  fontSize: 12,
                  color: 'var(--text-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.email}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleAccountSync}
                disabled={accountBusy}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface)',
                  color: 'var(--text-2)',
                  fontSize: 12,
                  cursor: accountBusy ? 'wait' : 'pointer',
                }}
              >
                {accountBusy ? '同步中…' : '同步'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={accountBusy}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.24)',
                  background: 'var(--danger-light)',
                  color: 'var(--danger)',
                  fontSize: 12,
                  cursor: accountBusy ? 'wait' : 'pointer',
                }}
              >
                退出
              </button>
            </div>
            {accountMessage && (
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>{accountMessage}</p>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            state={loginState}
            onPointerEnter={() => preloadPath('/login')}
            onFocus={() => preloadPath('/login')}
            onClick={() => setMobileOpen(false)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--primary)',
              background: 'var(--primary-light)',
              textDecoration: 'none',
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 4,
            }}
          >
            登录账号
          </Link>
        )}

        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            setSettingsOpen(true)
          }}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 400,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            textAlign: 'left',
            marginTop: 4,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--text-2)' }}
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          设置
        </button>
      </div>

      {/* Settings Drawer */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <style>{`
        @media (max-width: 640px) {
          .hidden-mobile { display: none !important; }
          .show-mobile { display: flex !important; }
          .mobile-menu-open { display: flex !important; }
        }
        @media (min-width: 641px) {
          .show-mobile { display: none !important; }
        }
      `}</style>
    </>
  )
}
