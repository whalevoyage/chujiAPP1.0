import { CheckCircle2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ImprovementAction, WeaknessRecord } from '../../api'

function snippet(value: string | null, length = 72): string {
  const text = value?.trim() ?? ''
  return text.length > length ? `${text.slice(0, length)}…` : text || '暂无'
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 truncate text-2xl font-extrabold">{value}</p>
    </div>
  )
}

export function WeaknessCard({
  record,
  onEdit,
  onResolve,
  onAction,
  onRestore,
  onDelete,
}: {
  record: WeaknessRecord
  onEdit: (record: WeaknessRecord) => void
  onResolve: (record: WeaknessRecord) => Promise<void>
  onAction: (record: WeaknessRecord) => void
  onRestore: (record: WeaknessRecord) => Promise<void>
  onDelete: (record: WeaknessRecord) => Promise<void>
}) {
  return (
    <article className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 wrap-break-word text-base font-bold">{record.title}</h3>
            <span className="rounded-lg border border-[#E6DED3] bg-white px-2 py-1 text-xs">{record.category}</span>
            <span className="rounded-lg border border-amber-400/30 bg-amber-50 px-2 py-1 text-xs text-amber-700">严重 {record.severity}</span>
            {record.is_resolved ? <span className="rounded-lg border border-emerald-400/30 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">已解决</span> : null}
            {record.is_deleted ? <span className="rounded-lg border border-red-400/30 bg-red-50 px-2 py-1 text-xs text-red-600">已删除</span> : null}
          </div>
          <p className="mt-2 text-xs text-slate-500">{record.occur_date}{record.occur_period ? ` / ${record.occur_period}` : ''}</p>
          <p className="mt-3 wrap-break-word text-sm leading-6">{snippet(record.behavior)}</p>
          {record.reason ? <p className="mt-2 wrap-break-word text-xs text-slate-500">原因：{snippet(record.reason)}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!record.is_deleted ? <button type="button" onClick={() => onEdit(record)} className="button-secondary">编辑</button> : null}
          {!record.is_deleted && !record.is_resolved ? <button type="button" onClick={() => onResolve(record)} className="button-primary"><CheckCircle2 className="h-4 w-4" />标记解决</button> : null}
          {!record.is_deleted ? <button type="button" onClick={() => onAction(record)} className="button-secondary"><Plus className="h-4 w-4" />添加措施</button> : null}
          {record.is_deleted ? (
            <button type="button" onClick={() => onRestore(record)} className="button-secondary"><RotateCcw className="h-4 w-4" />恢复</button>
          ) : (
            <button type="button" onClick={() => onDelete(record)} className="button-danger"><Trash2 className="h-4 w-4" />删除</button>
          )}
        </div>
      </div>
    </article>
  )
}

export function ActionCard({
  action,
  onComplete,
  onAddToPlan,
  onAddToTask,
}: {
  action: ImprovementAction
  onComplete: (action: ImprovementAction) => Promise<void>
  onAddToPlan: (action: ImprovementAction) => Promise<void>
  onAddToTask: (action: ImprovementAction) => Promise<void>
}) {
  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="wrap-break-word text-sm font-bold">{action.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            难度 {action.difficulty} / {action.status}
            {action.estimated_minutes ? ` / ${action.estimated_minutes} 分钟` : ''}
          </p>
          {action.description ? <p className="mt-2 wrap-break-word text-sm leading-6">{snippet(action.description, 100)}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {action.status !== '已完成' ? <button type="button" onClick={() => onComplete(action)} className="button-primary">完成</button> : null}
          <button type="button" onClick={() => onAddToPlan(action)} className="button-secondary">加入明日安排</button>
          <button type="button" onClick={() => onAddToTask(action)} className="button-secondary">加入任务</button>
        </div>
      </div>
    </div>
  )
}
