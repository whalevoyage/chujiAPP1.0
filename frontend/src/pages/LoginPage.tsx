import { Loader2, LockKeyhole } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api'
import { useAuth } from '../auth'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user) {
      navigate('/today', { replace: true })
    }
  }, [user, navigate])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/today', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#F7F4EE] px-4 py-8 text-slate-900">
      <section className="w-full max-w-md rounded-2xl border border-[#E6DED3] bg-white p-6">
        <div className="flex items-center gap-3">
          <img src="/vault-icon.svg" alt="初记" className="h-12 w-12 rounded-2xl" />
          <div>
            <p className="text-xl font-extrabold tracking-wide text-slate-900">初记</p>
            <p className="text-xs text-slate-500">日记与规划</p>
          </div>
        </div>

        <div className="mt-8 border-t border-[#E6DED3] pt-6">
          <h1 className="text-3xl font-extrabold tracking-wide text-slate-900">登录初记</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">本地私有使用，不开放注册。</p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="input"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="input"
              required
            />
          </label>
          {error ? (
            <p className="rounded-xl border border-red-400/30 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={submitting} className="button-primary h-12 w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            进入系统
          </button>
        </form>

        <p className="mt-5 border-t border-[#E6DED3] pt-4 text-xs leading-5 text-slate-400">
          安全提示：固定用户登录，不开放注册，不配置公网入口。
        </p>
        <p className="mt-2 text-center text-[11px] text-slate-300">本项目由王鑫焱独立开发</p>
      </section>
    </div>
  )
}
