import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'

type Props = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  loading?: boolean
  error?: string
  onCancel: () => void
  onConfirm: (password: string) => void
}

export default function DeletePasswordDialog({
  open,
  title,
  description,
  confirmLabel = '确认删除',
  loading = false,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setPassword('')
      // auto-focus after render
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[#E6DED3] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-500">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <input
            ref={inputRef}
            className="w-full rounded-xl border border-[#E6DED3] bg-[#FFFDF8] px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#6B7A5A] focus:ring-1 focus:ring-[#6B7A5A]/20"
            type="password"
            placeholder="请输入删除密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && password.trim()) onConfirm(password)
              if (event.key === 'Escape') onCancel()
            }}
          />
          {error ? (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-[#E6DED3] bg-white px-4 py-2 text-sm text-slate-600 hover:bg-[#F5F1EA] transition"
            onClick={onCancel}
            disabled={loading}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
            onClick={() => onConfirm(password)}
            disabled={loading || !password.trim()}
          >
            {loading ? '验证中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
