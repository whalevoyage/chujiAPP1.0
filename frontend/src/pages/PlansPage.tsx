import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Plus, Trash2, XCircle } from 'lucide-react'

import {
  completeStep,
  createPlan,
  createStep,
  deletePlan,
  deleteStep,
  delayStep,
  getPlans,
  skipStep,
  type DailyPlan,
  type PlanStep,
} from '../api'
import { useConfirm } from '../hooks/useConfirm'

type StepAction = {
  stepId: number
  kind: 'delay' | 'skip'
}

function localDateValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    delayed: '已延期',
    skipped: '已跳过',
  }
  return labels[status] ?? status
}

function statusClass(status: string) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'delayed') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'skipped') return 'border-stone-200 bg-stone-100 text-stone-500'
  if (status === 'in_progress') return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-stone-200 bg-stone-50 text-stone-600'
}

export default function PlansPage() {
  const [date, setDate] = useState(localDateValue())
  const [plans, setPlans] = useState<DailyPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newPlanTitle, setNewPlanTitle] = useState('')
  const [newPlanGoal, setNewPlanGoal] = useState('')
  const [newPlanNote, setNewPlanNote] = useState('')
  const [stepPlanId, setStepPlanId] = useState<number | null>(null)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newStepDescription, setNewStepDescription] = useState('')
  const [newStepStart, setNewStepStart] = useState('09:00')
  const [newStepEnd, setNewStepEnd] = useState('10:00')
  const [newStepReminder, setNewStepReminder] = useState('')
  const [newStepPriority, setNewStepPriority] = useState(0)
  const [stepAction, setStepAction] = useState<StepAction | null>(null)
  const [stepReason, setStepReason] = useState('')
  const { confirm, dialog } = useConfirm()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const plansData = await getPlans(date)
      setPlans(plansData)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function resetPlanForm() {
    setNewPlanTitle('')
    setNewPlanGoal('')
    setNewPlanNote('')
    setShowNewPlan(false)
  }

  function resetStepForm() {
    setStepPlanId(null)
    setNewStepTitle('')
    setNewStepDescription('')
    setNewStepStart('09:00')
    setNewStepEnd('10:00')
    setNewStepReminder('')
    setNewStepPriority(0)
  }

  async function handleCreatePlan() {
    if (!newPlanTitle.trim()) return
    try {
      await createPlan({
        plan_date: date,
        title: newPlanTitle.trim(),
        main_goal: newPlanGoal.trim() || null,
        note: newPlanNote.trim() || null,
      })
      resetPlanForm()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleDeletePlan(plan: DailyPlan) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try {
      await deletePlan(plan.id)
      setPlans((current) => current.filter((item) => item.id !== plan.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleCreateStep(plan: DailyPlan) {
    if (!newStepTitle.trim()) return
    try {
      await createStep(plan.id, {
        title: newStepTitle.trim(),
        description: newStepDescription.trim() || null,
        start_time: newStepStart,
        end_time: newStepEnd,
        remind_time: newStepReminder || null,
        enable_reminder: Boolean(newStepReminder),
        priority: newStepPriority,
        sort_order: plan.steps.length,
      })
      resetStepForm()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleDeleteStep(stepId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try {
      await deleteStep(stepId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleCompleteStep(stepId: number) {
    try {
      await completeStep(stepId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  function openStepAction(stepId: number, kind: 'delay' | 'skip') {
    setStepAction({ stepId, kind })
    setStepReason('')
    setError('')
  }

  async function handleStepAction() {
    if (!stepAction) return
    const reason = stepReason.trim()
    if (!reason) {
      setError(stepAction.kind === 'delay' ? '请填写延期原因' : '请填写跳过原因')
      return
    }
    try {
      if (stepAction.kind === 'delay') {
        await delayStep(stepAction.stepId, reason)
      } else {
        await skipStep(stepAction.stepId, reason)
      }
      setStepAction(null)
      setStepReason('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-wide text-slate-800">规划</h1>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : null}

      {/* Date & new-plan controls */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_auto_1fr] sm:items-center">
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button type="button" onClick={() => setDate(localDateValue())} className="button-secondary">
            今天
          </button>
          {!showNewPlan ? (
            <button type="button" onClick={() => setShowNewPlan(true)} className="button-primary sm:justify-self-end">
              <Plus className="h-4 w-4" />
              添加安排
            </button>
          ) : null}
        </div>

        {showNewPlan ? (
          <div className="mt-4 grid gap-3 rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
            <input
              className="input"
              placeholder="安排标题"
              value={newPlanTitle}
              onChange={(event) => setNewPlanTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleCreatePlan()}
            />
            <input className="input" placeholder="主目标" value={newPlanGoal} onChange={(event) => setNewPlanGoal(event.target.value)} />
            <textarea
              className="input min-h-24 resize-none py-3"
              placeholder="备注"
              value={newPlanNote}
              onChange={(event) => setNewPlanNote(event.target.value)}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={handleCreatePlan} className="button-primary">
                确定
              </button>
              <button type="button" onClick={resetPlanForm} className="button-secondary">
                取消
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {plans.length === 0 ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-8 text-center">
          <p className="text-base font-semibold text-slate-600">暂无安排</p>
          <p className="mt-2 text-sm text-slate-400">为这一天添加安排，保存后会立即显示。</p>
          {!showNewPlan ? (
            <button type="button" onClick={() => setShowNewPlan(true)} className="button-primary mt-4">
              <Plus className="h-4 w-4" />
              添加安排
            </button>
          ) : null}
        </section>
      ) : (
        <div className="space-y-5">
          {plans.map((plan) => (
            <section key={plan.id} className="rounded-2xl border border-[#E6DED3] bg-white p-5">
              <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-500">安排</p>
                  <h2 className="mt-2 wrap-break-word text-xl font-extrabold text-slate-800">{plan.title}</h2>
                  {plan.main_goal ? <p className="mt-2 wrap-break-word text-sm leading-6 text-slate-600">{plan.main_goal}</p> : null}
                  {plan.note ? <p className="mt-2 wrap-break-word text-xs leading-5 text-slate-400">{plan.note}</p> : null}
                </div>
                <button type="button" onClick={() => handleDeletePlan(plan)} className="button-danger">
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              </div>

              {/* Progress bar */}
              <div className="mt-5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>进度</span>
                  <span>{plan.completed_steps}/{plan.total_steps}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#F5F1EA]">
                  <div className="h-full bg-[#6B7A5A] rounded-full transition-all duration-300" style={{ width: `${Math.round(plan.progress * 100)}%` }} />
                </div>
              </div>

              {/* Steps list */}
              <div className="mt-5 border-l-2 border-[#E6DED3] pl-4">
                {plan.steps.length === 0 ? (
                  <p className="py-3 text-sm text-slate-400">暂无安排</p>
                ) : (
                  plan.steps.map((step) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      action={stepAction}
                      reason={stepReason}
                      onReasonChange={setStepReason}
                      onComplete={handleCompleteStep}
                      onDelete={handleDeleteStep}
                      onOpenAction={openStepAction}
                      onSubmitAction={handleStepAction}
                      onCancelAction={() => setStepAction(null)}
                    />
                  ))
                )}
              </div>

              {/* Add step form */}
              {stepPlanId === plan.id ? (
                <div className="mt-5 grid gap-3 rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
                  <input
                    className="input"
                    placeholder="安排标题"
                    value={newStepTitle}
                    onChange={(event) => setNewStepTitle(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void handleCreateStep(plan)}
                  />
                  <textarea
                    className="input min-h-20 resize-none py-3"
                    placeholder="安排说明"
                    value={newStepDescription}
                    onChange={(event) => setNewStepDescription(event.target.value)}
                  />
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input className="input" type="time" value={newStepStart} onChange={(event) => setNewStepStart(event.target.value)} />
                    <input className="input" type="time" value={newStepEnd} onChange={(event) => setNewStepEnd(event.target.value)} />
                    <input className="input" type="time" value={newStepReminder} onChange={(event) => setNewStepReminder(event.target.value)} />
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={newStepPriority}
                      onChange={(event) => setNewStepPriority(Number(event.target.value))}
                      placeholder="优先级"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => handleCreateStep(plan)} className="button-primary">
                      确定
                    </button>
                    <button type="button" onClick={resetStepForm} className="button-secondary">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setStepPlanId(plan.id)} className="button-secondary mt-5">
                  <Plus className="h-4 w-4" />
                  添加一项安排
                </button>
              )}
            </section>
          ))}
        </div>
      )}
      {dialog}
    </div>
  )
}

function StepRow({
  step,
  action,
  reason,
  onReasonChange,
  onComplete,
  onDelete,
  onOpenAction,
  onSubmitAction,
  onCancelAction,
}: {
  step: PlanStep
  action: StepAction | null
  reason: string
  onReasonChange: (value: string) => void
  onComplete: (stepId: number) => Promise<void>
  onDelete: (stepId: number) => Promise<void>
  onOpenAction: (stepId: number, kind: 'delay' | 'skip') => void
  onSubmitAction: () => Promise<void>
  onCancelAction: () => void
}) {
  const isActionOpen = action?.stepId === step.id
  const isDone = step.status === 'completed' || step.status === 'skipped'
  const isCurrent = step.status === 'in_progress'

  return (
    <div className="relative py-3 first:pt-0 last:pb-0">
      {/* Timeline dot */}
      <div
        className={[
          'absolute left-[-1.45rem] top-[1.15rem] h-3 w-3 rounded-full border-2',
          isCurrent ? 'border-[#6B7A5A] bg-[#6B7A5A]' : 'border-[#E6DED3] bg-white',
        ].join(' ')}
      />
      <div className={[
        'rounded-2xl border p-4',
        isCurrent ? 'border-[#6B7A5A]/30 bg-[#F5F1EA]' : 'border-[#E6DED3] bg-[#FFFDF8]',
      ].join(' ')}>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 wrap-break-word text-sm font-bold text-slate-700">{step.title}</p>
              <span className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${statusClass(step.status)}`}>
                {statusLabel(step.status)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              {step.start_time} - {step.end_time}
              {step.enable_reminder && step.remind_time ? ' / 提醒 ' + step.remind_time : ''}
            </p>
            {step.description ? <p className="mt-2 wrap-break-word text-xs leading-5 text-slate-500">{step.description}</p> : null}
            {step.delay_reason ? <p className="mt-2 wrap-break-word text-xs text-amber-600">延期：{step.delay_reason}</p> : null}
            {step.skip_reason ? <p className="mt-2 wrap-break-word text-xs text-slate-500">跳过：{step.skip_reason}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDone ? (
              <button type="button" onClick={() => onComplete(step.id)} className="button-primary text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                完成
              </button>
            ) : null}
            {!isDone ? (
              <button type="button" onClick={() => onOpenAction(step.id, 'delay')} className="button-secondary text-xs">
                <Clock3 className="h-3.5 w-3.5" />
                延期
              </button>
            ) : null}
            {!isDone ? (
              <button type="button" onClick={() => onOpenAction(step.id, 'skip')} className="button-secondary text-xs">
                <XCircle className="h-3.5 w-3.5" />
                跳过
              </button>
            ) : null}
            <button type="button" onClick={() => onDelete(step.id)} className="button-danger text-xs">
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
        </div>

        {isActionOpen ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input"
              placeholder={action.kind === 'delay' ? '延期原因' : '跳过原因'}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void onSubmitAction()}
            />
            <button type="button" onClick={onSubmitAction} className="button-primary">
              确定
            </button>
            <button type="button" onClick={onCancelAction} className="button-secondary">
              取消
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
