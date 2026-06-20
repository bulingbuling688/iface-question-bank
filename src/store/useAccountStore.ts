import { useCallback, useEffect, useReducer } from 'react'
import {
  type AccountAuthInput,
  type AccountRegisterInput,
  type AccountUser,
  getCurrentAccount,
  loginAccount,
  logoutAccount,
  registerAccount,
} from '@/lib/accountApi'

interface AccountState {
  user: AccountUser | null
  loading: boolean
  initialized: boolean
  error: string | null
}

type AccountAction =
  | { type: 'INIT_START' }
  | { type: 'SET_USER'; user: AccountUser | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'LOGOUT' }

const listeners = new Set<(action: AccountAction) => void>()
let globalUser: AccountUser | null = null
let initialized = false
let initializingPromise: Promise<AccountUser | null> | null = null

function broadcast(action: AccountAction) {
  for (const listener of listeners) listener(action)
}

function reducer(state: AccountState, action: AccountAction): AccountState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, loading: true, error: null }
    case 'SET_USER':
      return {
        ...state,
        user: action.user,
        loading: false,
        initialized: true,
        error: null,
      }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_ERROR':
      return { ...state, loading: false, initialized: true, error: action.error }
    case 'LOGOUT':
      return { user: null, loading: false, initialized: true, error: null }
    default:
      return state
  }
}

async function initAccountOnce(): Promise<AccountUser | null> {
  if (initialized) return globalUser
  if (!initializingPromise) {
    initialized = true
    broadcast({ type: 'INIT_START' })
    initializingPromise = getCurrentAccount()
      .then((user) => {
        globalUser = user
        broadcast({ type: 'SET_USER', user })
        return user
      })
      .catch(() => {
        globalUser = null
        broadcast({ type: 'SET_USER', user: null })
        return null
      })
      .finally(() => {
        initializingPromise = null
      })
  }
  return initializingPromise
}

export function useAccountStore() {
  const [state, dispatch] = useReducer(reducer, {
    user: globalUser,
    loading: !initialized,
    initialized,
    error: null,
  })

  useEffect(() => {
    const listener = (action: AccountAction) => dispatch(action)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    void initAccountOnce()
  }, [])

  const refreshUser = useCallback(async () => {
    broadcast({ type: 'INIT_START' })
    const user = await getCurrentAccount()
    globalUser = user
    broadcast({ type: 'SET_USER', user })
    return user
  }, [])

  const login = useCallback(async (input: AccountAuthInput) => {
    broadcast({ type: 'SET_LOADING', loading: true })
    try {
      const user = await loginAccount(input)
      globalUser = user
      initialized = true
      broadcast({ type: 'SET_USER', user })
      return user
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      broadcast({ type: 'SET_ERROR', error: message })
      throw err
    }
  }, [])

  const register = useCallback(async (input: AccountRegisterInput) => {
    broadcast({ type: 'SET_LOADING', loading: true })
    try {
      const user = await registerAccount(input)
      globalUser = user
      initialized = true
      broadcast({ type: 'SET_USER', user })
      return user
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      broadcast({ type: 'SET_ERROR', error: message })
      throw err
    }
  }, [])

  const logout = useCallback(async () => {
    broadcast({ type: 'SET_LOADING', loading: true })
    try {
      await logoutAccount()
    } finally {
      globalUser = null
      initialized = true
      broadcast({ type: 'LOGOUT' })
    }
  }, [])

  return {
    user: state.user,
    loading: state.loading,
    initialized: state.initialized,
    error: state.error,
    isLoggedIn: Boolean(state.user),
    login,
    register,
    logout,
    refreshUser,
  }
}
