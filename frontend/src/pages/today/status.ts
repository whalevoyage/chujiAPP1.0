export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    delayed: '已延期',
    skipped: '已跳过',
  }
  return labels[status] ?? status
}

export function statusClass(status: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'delayed') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'skipped') return 'border-stone-200 bg-stone-100 text-stone-500'
  if (status === 'in_progress') return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-stone-200 bg-stone-50 text-stone-600'
}
