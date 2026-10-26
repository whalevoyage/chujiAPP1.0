import { ChevronRight, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

export function LoadingIcon() {
  return <Loader2 className="h-4 w-4 animate-spin" />
}

export function MoreEntry({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3 text-left hover:border-[#6B7A5A]/30"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#6B7A5A]/20 bg-[#F5F1EA] text-[#6B7A5A]">
        {icon}
      </span>
      <span className="flex-1 truncate text-sm font-bold">{title}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  )
}

export function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 truncate text-xl font-extrabold">{value}</p>
    </div>
  )
}

export function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-600">{label}</span>
      <input type="password" className="input" value={value} onChange={(event) => onChange(event.target.value)} required />
    </label>
  )
}
