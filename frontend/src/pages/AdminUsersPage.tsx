import { ArrowLeft, Ban, CheckCircle2, Plus, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiRequest, ApiError, type Role, type User } from '../api'
import { useConfirm } from '../hooks/useConfirm'

export default function AdminUsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ username: '', nickname: '', password: '', role: 'user' as Role })

  async function loadUsers() {
    const data = await apiRequest<User[]>('/api/admin/users')
    setUsers(data)
  }

  useEffect(() => {
    loadUsers().catch((err) => setError(err instanceof ApiError ? err.message : '加载用户失败'))
  }, [])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await apiRequest<User>('/api/admin/users', {
        method: 'POST',
        body: { ...form, is_active: true },
      })
      setForm({ username: '', nickname: '', password: '', role: 'user' })
      setMessage('用户已创建')
      await loadUsers()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败')
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold">用户管理</h1>
            <p className="mt-1 text-sm text-slate-500">仅管理员可见</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-[#E6DED3] bg-white p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus className="h-4 w-4 text-[#6B7A5A]" />
          新增固定用户
        </h2>
        <form className="mt-4 grid gap-4 lg:grid-cols-4" onSubmit={handleCreate}>
          <Field label="用户名">
            <input
              className="input"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </Field>
          <Field label="昵称">
            <input
              className="input"
              value={form.nickname}
              onChange={(event) => setForm({ ...form, nickname: event.target.value })}
              required
            />
          </Field>
          <Field label="临时密码">
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
          </Field>
          <Field label="角色">
            <select
              className="input"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
          <button type="submit" className="button-primary lg:col-span-4 lg:max-w-xs">
            <Plus className="h-4 w-4" />
            创建用户
          </button>
        </form>
      </section>

      {message ? <p className="rounded-md border border-emerald-400/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-md border border-red-400/30 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-3">
        {users.map((item) => (
          <UserCard key={item.id} user={item} onChanged={loadUsers} />
        ))}
      </section>
    </div>
  )
}

function UserCard({ user, onChanged }: { user: User; onChanged: () => Promise<void> }) {
  const [nickname, setNickname] = useState(user.nickname)
  const [role, setRole] = useState<Role>(user.role)
  const [isActive, setIsActive] = useState(user.is_active)
  const [resetPassword, setResetPassword] = useState('')
  const [error, setError] = useState('')
  const { confirm, dialog } = useConfirm()

  useEffect(() => {
    setNickname(user.nickname)
    setRole(user.role)
    setIsActive(user.is_active)
  }, [user])

  async function saveUser() {
    setError('')
    try {
      await apiRequest<User>(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: { nickname, role, is_active: isActive },
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    }
  }

  async function toggleActive() {
    const action = user.is_active ? '禁用' : '启用'
    const ok1 = await confirm({ title: `${action}用户`, message: `确认${action}用户 ${user.username}？` })
    if (!ok1) {
      return
    }
    setError('')
    try {
      await apiRequest<User>(`/api/admin/users/${user.id}/${user.is_active ? 'disable' : 'enable'}`, {
        method: 'POST',
      })
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${action}失败`)
    }
  }

  async function resetUserPassword() {
    if (!resetPassword) {
      setError('请先输入新临时密码')
      return
    }
    const ok2 = await confirm({ title: '重置密码', message: `确认重置用户 ${user.username} 的密码？` })
    if (!ok2) {
      return
    }
    setError('')
    try {
      await apiRequest<User>(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        body: { new_password: resetPassword },
      })
      setResetPassword('')
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置失败')
    }
  }

  return (
    <article className="rounded-2xl border border-[#E6DED3] bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{user.username}</h3>
          <p className="text-sm text-slate-500">
            {user.role === 'admin' ? '管理员' : '普通用户'} / {user.is_active ? '启用' : '禁用'} /{' '}
            {user.must_change_password ? '需改密' : '密码正常'}
          </p>
        </div>
        <button type="button" onClick={toggleActive} className={user.is_active ? 'button-danger' : 'button-secondary'}>
          {user.is_active ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {user.is_active ? '禁用' : '启用'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Field label="昵称">
          <input className="input" value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </Field>
        <Field label="角色">
          <select className="input" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </Field>
        <Field label="启用状态">
          <select
            className="input"
            value={isActive ? 'active' : 'disabled'}
            onChange={(event) => setIsActive(event.target.value === 'active')}
          >
            <option value="active">启用</option>
            <option value="disabled">禁用</option>
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={saveUser} className="button-secondary">
          <Save className="h-4 w-4" />
          保存
        </button>
        <input
          type="password"
          className="input sm:max-w-xs"
          placeholder="新临时密码"
          value={resetPassword}
          onChange={(event) => setResetPassword(event.target.value)}
        />
        <button type="button" onClick={resetUserPassword} className="button-secondary">
          <RotateCcw className="h-4 w-4" />
          重置密码
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {dialog}
    </article>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  )
}
