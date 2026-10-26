import { CheckCircle2, MapPin, XCircle } from 'lucide-react'
import type { ScheduleItem } from './types'
import { statusClass, statusLabel } from './status'

export function StatusMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 truncate font-semibold text-slate-700">{value}</p>
    </div>
  )
}

export function MetricCard({ label, value, detail, hint }: { label: string; value: string; detail: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
      {hint ? <p className="mt-1 text-xs text-[#6B7A5A]">{hint}</p> : null}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#F5F1EA]">
        <div className="h-full rounded-full bg-[#6B7A5A]" style={{ width: value.endsWith('%') ? value : '0%' }} />
      </div>
    </div>
  )
}

export function ScheduleCard({
  item,
  onCheckin,
  onUndo,
  onComplete,
  onDeleteStep,
  onDeleteTask,
  onDeleteCourse,
}: {
  item: ScheduleItem
  onCheckin: (taskId: number) => Promise<void>
  onUndo: (taskId: number) => Promise<void>
  onComplete: (stepId: number) => Promise<void>
  onDeleteStep: (stepId: number) => Promise<void>
  onDeleteTask: (taskId: number) => Promise<void>
  onDeleteCourse: (courseId: number) => Promise<void>
}) {
  const badge = {
    step: { label: '规划', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
    course: { label: '课程', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    task: { label: '任务', cls: 'border-slate-300 bg-slate-100 text-slate-600' },
  }[item.kind]

  return (
    <div className="snap-start shrink-0 w-[260px] rounded-xl border border-[#E6DED3] bg-white p-2.5 md:w-auto">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
            {item.kind === 'task' && (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${item.checkedIn ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-100 text-slate-500'}`}>
                {item.checkedIn ? '已打卡' : '待打卡'}
              </span>
            )}
            {item.kind === 'step' && item.status !== 'pending' && (
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{item.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {item.time}
            {item.subtitle ? ` / ${item.subtitle}` : ''}
          </p>
          {item.kind === 'course' && item.course.location ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
              <MapPin className="h-3 w-3" />{item.course.location}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
          onClick={() => {
            if (item.kind === 'step') onDeleteStep(item.step.id)
            else if (item.kind === 'task') onDeleteTask(item.task.id)
            else onDeleteCourse(item.course.id)
          }}
          aria-label="删除"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      {item.kind === 'step' ? (
        <div className="mt-2">
          <button type="button" onClick={() => onComplete(item.step.id)} className="button-primary text-[11px] h-8 w-full">
            <CheckCircle2 className="h-3 w-3" />完成
          </button>
        </div>
      ) : item.kind === 'task' && !item.checkedIn ? (
        <div className="mt-2">
          <button type="button" onClick={() => onCheckin(item.task.id)} className="button-primary text-[11px] h-8 w-full">
            <CheckCircle2 className="h-3 w-3" />打卡
          </button>
        </div>
      ) : item.kind === 'task' ? (
        <div className="mt-2">
          <button type="button" onClick={() => onUndo(item.task.id)} className="button-secondary text-[11px] h-8 w-full">
            撤销
          </button>
        </div>
      ) : null}
    </div>
  )
}
