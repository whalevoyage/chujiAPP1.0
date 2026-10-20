import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { apiRequest, ApiError, type AuthResponse, type User } from './api'

type AuthContextValue = {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (user: User | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest<AuthResponse>('/api/auth/me')
      setUser(data.user)
    } catch (error) {
      // 仅 401 时清空用户；网络错误等保留当前状态，避免误登出
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 全局 401 监听：任意 API 返回 401（登录接口除外）强制清空登录状态
  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null)
    }
    window.addEventListener('auth:session-expired', handleSessionExpired)
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ message: string }>('/api/auth/logout', { method: 'POST' })
    } catch {
      // 即使服务端返回 401（已登出）也清除本地状态
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh, setUser }),
    [user, loading, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
