import {
  Clipboard,
  FileText,
  Plus,
  Save,
  Send,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useConfirm } from '../hooks/useConfirm'
import { ActionCard, StatCard, WeaknessCard } from './review/components'

import {
  addImprovementActionToPlan,
  addImprovementActionToTask,
  completeImprovementAction,
  createImprovementAction,
  createWeakness,
  deleteReviewReport,
  deleteWeakness,
  getWeeklySummary,
  generateSmartReviewSummary,
  listImprovementActions,
  listReviewReports,
  listWeaknesses,
  resolveWeakness,
  restoreWeakness,
  saveAiReviewResponse,
  updateWeakness,
  type ImprovementAction,
  type ReviewReport,
  type WeaknessRecord,
  type WeeklySummary,
} from '../api'

const categories = ['拖延', '情绪', '作息', '学习', '执行力', '专注力', '消费', '其他']
const periods = ['', '早上', '上午', '中午', '下午', '晚上', '凌晨']

type WeaknessForm = {
  title: string
  category: string
  severity: number
  occurDate: string
  occurPeriod: string
  behavior: string
  reason: string
  impact: string
  emotion: string
  correction: string
  prevention: string
  addToPlan: boolean
}

type ActionForm = {
  title: string
  description: string
  difficulty: number
  estimatedMinutes: string
}

type ReportType = 'daily' | 'weekly' | 'monthly'

function localDateValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function weekStartValue() {
  const now = new Date()
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1
  now.setDate(now.getDate() - day)
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function blankWeaknessForm(): WeaknessForm {
  return {
    title: '',
    category: '其他',
    severity: 5,
    occurDate: localDateValue(),
    occurPeriod: '',
    behavior: '',
    reason: '',
    impact: '',
    emotion: '',
    correction: '',
    prevention: '',
    addToPlan: false,
  }
}

const blankActionForm: ActionForm = {
  title: '',
  description: '',
  difficulty: 5,
  estimatedMinutes: '',
}



function reportTypeLabel(value: string) {
  if (value === 'daily') return '日复盘'
  if (value === 'weekly') return '周复盘'
  if (value === 'monthly') return '月复盘'
  return value
}

export default function ReviewPage() {
  const { confirm, dialog } = useConfirm()

  const [weaknesses, setWeaknesses] = useState<WeaknessRecord[]>([])
  const [actionsByWeakness, setActionsByWeakness] = useState<Record<number, ImprovementAction[]>>({})
  const [reports, setReports] = useState<ReviewReport[]>([])
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showWeaknessForm, setShowWeaknessForm] = useState(false)
  const [editingWeaknessId, setEditingWeaknessId] = useState<number | null>(null)
  const [weaknessForm, setWeaknessForm] = useState<WeaknessForm>(() => blankWeaknessForm())
  const [actionWeaknessId, setActionWeaknessId] = useState<number | null>(null)
  const [actionForm, setActionForm] = useState<ActionForm>({ ...blankActionForm })
  const [currentReportId, setCurrentReportId] = useState<number | null>(null)
  const [promptType, setPromptType] = useState<ReportType>('daily')
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null)
  const [showReports, setShowReports] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ReviewReport | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [records, reviewReports] = await Promise.all([listWeaknesses({ includeDeleted }), listReviewReports()])
      getWeeklySummary().then(setWeeklySummary).catch(() => {})
      const actionPairs = await Promise.all(records.map(async (record) => [record.id, await listImprovementActions(record.id)] as const))
      const nextActions: Record<number, ImprovementAction[]> = {}
      actionPairs.forEach(([id, actions]) => {
        nextActions[id] = actions
      })
      setWeaknesses(records)
      setReports(reviewReports)
      setActionsByWeakness(nextActions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [includeDeleted])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const allActions = useMemo(() => Object.values(actionsByWeakness).flat(), [actionsByWeakness])
  const stats = useMemo(() => {
    const today = localDateValue()
    const weekStart = weekStartValue()
    const weekRecords = weaknesses.filter((item) => !item.is_deleted && item.occur_date >= weekStart && item.occur_date <= today)
    const counts = new Map<string, number>()
    weekRecords.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1))
    const topCategory = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '暂无'
    const unfinishedActions = allActions.filter((action) => action.status !== '已完成').length
    const reviewedToday = reports.some((report) => report.report_type === 'daily' && report.start_date <= today && report.end_date >= today)
    return { weekCount: weekRecords.length, topCategory, unfinishedActions, reviewedToday }
  }, [allActions, reports, weaknesses])

  function updateWeaknessForm<K extends keyof WeaknessForm>(field: K, value: WeaknessForm[K]) {
    setWeaknessForm((current) => ({ ...current, [field]: value }))
  }

  function resetWeaknessForm() {
    setWeaknessForm(blankWeaknessForm())
    setEditingWeaknessId(null)
    setShowWeaknessForm(false)
  }

  function startEditWeakness(record: WeaknessRecord) {
    setWeaknessForm({
      title: record.title,
      category: record.category,
      severity: record.severity,
      occurDate: record.occur_date,
      occurPeriod: record.occur_period ?? '',
      behavior: record.behavior,
      reason: record.reason ?? '',
      impact: record.impact ?? '',
      emotion: record.emotion ?? '',
      correction: record.correction ?? '',
      prevention: record.prevention ?? '',
      addToPlan: false,
    })
    setEditingWeaknessId(record.id)
    setShowWeaknessForm(true)
    setError('')
    setMessage('')
  }

  async function handleSaveWeakness() {
    if (!weaknessForm.behavior.trim()) {
      setError('请填写具体表现')
      return
    }
    setError('')
    setMessage('')
    try {
      const payload = {
        title: weaknessForm.title.trim() || null,
        category: weaknessForm.category,
        severity: weaknessForm.severity,
        occur_date: weaknessForm.occurDate,
        occur_period: weaknessForm.occurPeriod || null,
        behavior: weaknessForm.behavior.trim(),
        reason: weaknessForm.reason.trim() || null,
        impact: weaknessForm.impact.trim() || null,
        emotion: weaknessForm.emotion.trim() || null,
        correction: weaknessForm.correction.trim() || null,
        prevention: weaknessForm.prevention.trim() || null,
      }
      if (editingWeaknessId === null) {
        await createWeakness({ ...payload, add_to_plan: weaknessForm.addToPlan })
        setMessage('问题记录已保存')
      } else {
        await updateWeakness(editingWeaknessId, payload)
        setMessage('问题记录已更新')
      }
      resetWeaknessForm()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function handleDeleteWeakness(record: WeaknessRecord) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' })
    if (!ok) return
    setError('')
    setMessage('')
    try {
      await deleteWeakness(record.id)
      setMessage('问题记录已删除')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleResolveWeakness(record: WeaknessRecord) {
    setError('')
    setMessage('')
    try {
      await resolveWeakness(record.id)
      setMessage('已标记解决')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function handleRestoreWeakness(record: WeaknessRecord) {
    setError('')
    setMessage('')
    try {
      await restoreWeakness(record.id)
      setMessage('问题记录已恢复')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败')
    }
  }

  function openActionForm(record: WeaknessRecord) {
    setActionWeaknessId(record.id)
    setActionForm({
      title: record.correction?.slice(0, 200) || `改进：${record.title}`,
      description: record.correction ?? '',
      difficulty: Math.min(10, Math.max(1, record.severity)),
      estimatedMinutes: '30',
    })
    setError('')
    setMessage('')
  }

  async function handleSaveAction() {
    if (actionWeaknessId === null || !actionForm.title.trim()) {
      setError('请填写措施标题')
      return
    }
    setError('')
    setMessage('')
    try {
      await createImprovementAction(actionWeaknessId, {
        title: actionForm.title.trim(),
        description: actionForm.description.trim() || null,
        difficulty: actionForm.difficulty,
        estimated_minutes: actionForm.estimatedMinutes ? Number(actionForm.estimatedMinutes) : null,
      })
      setActionWeaknessId(null)
      setActionForm({ ...blankActionForm })
      setMessage('改进措施已添加')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    }
  }

  async function handleCompleteAction(action: ImprovementAction) {
    setError('')
    setMessage('')
    try {
      await completeImprovementAction(action.id)
      setMessage('措施已完成')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function handleAddActionToPlan(action: ImprovementAction) {
    setError('')
    setMessage('')
    try {
      await addImprovementActionToPlan(action.id)
      setMessage('已加入明日安排')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入安排失败')
    }
  }

  async function handleAddActionToTask(action: ImprovementAction) {
    setError('')
    setMessage('')
    try {
      await addImprovementActionToTask(action.id)
      setMessage('已加入任务')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入任务失败')
    }
  }

  async function handleSmartSummary() {
    setError('')
    setMessage('')
    setAiLoading(true)
    try {
      const data = await generateSmartReviewSummary({ report_type: promptType })
      setCurrentReportId(data.report_id)
      setGeneratedPrompt(data.summary_material ?? '')
      setAiResponse(data.ai_summary ?? '')
      setMessage(data.message)
      await loadData()
    } catch (err) {
      // 修复 Failed to fetch：网络/AI 服务异常时给出友好提示而非报错
      const msg = err instanceof Error ? err.message : ''
      if (/failed to fetch|networkerr|load failed/i.test(msg)) {
        setError('网络连接失败，无法生成复盘。请检查网络或 AI 服务是否可用。')
      } else if (/未配置|key|密钥/i.test(msg)) {
        setError('')
        setMessage('未配置 AI 服务，已生成本地复盘素材，可复制后手动使用。')
      } else {
        setError(msg || '生成失败')
      }
    } finally {
      setAiLoading(false)
    }
  }

  async function handleDeleteReport(reportId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可直接恢复，请谨慎操作。', confirmText: '确认删除' })
    if (!ok) return
    try {
      await deleteReviewReport(reportId)
      setReports((prev) => prev.filter((r) => r.id !== reportId))
      setMessage('报告已删除')
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  async function handleCopyPrompt() {
    if (!generatedPrompt) {
      setError('请先生成提示词')
      return
    }
    try {
      await navigator.clipboard.writeText(generatedPrompt)
      setMessage('提示词已复制')
      setError('')
    } catch {
      setError('复制失败')
    }
  }

  async function handleSaveAiResponse() {
    if (!aiResponse.trim()) {
      setError('请粘贴总结结果')
      return
    }
    setError('')
    setMessage('')
    try {
      await saveAiReviewResponse({
        report_id: currentReportId,
        report_type: promptType,
        ai_prompt: generatedPrompt || null,
        ai_response: aiResponse.trim(),
        final_content: aiResponse.trim(),
        accepted: true,
      })
      setMessage('总结已保存')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div>
          <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-wide">复盘</h1>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>
      ) : null}

      {/* 复盘操作区 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <FileText className="h-4 w-4 text-[#6B7A5A]" />
          生成复盘
        </h2>
        <p className="mt-1 text-sm text-slate-500">选择时间范围后点击生成。如已配置 AI 服务则自动生成 AI 总结；未配置时生成本地素材，可复制后手动使用。</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,12rem)_auto_auto]">
          <select className="input" value={promptType} onChange={(event) => setPromptType(event.target.value as ReportType)}>
            <option value="daily">今日</option>
            <option value="weekly">本周</option>
            <option value="monthly">本月</option>
          </select>
          <button type="button" onClick={handleSmartSummary} disabled={aiLoading} className="button-primary">
            {aiLoading ? '生成中...' : '生成提示词'}
          </button>
          <button type="button" onClick={() => setShowWeaknessForm(true)} className="button-secondary">
            <Plus className="h-4 w-4" />
            记录问题
          </button>
        </div>

        {/* 提示词/总结编辑区 */}
        {(generatedPrompt || aiResponse) ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-3">
              <textarea
                className="input min-h-48 resize-none py-3"
                value={generatedPrompt}
                onChange={(event) => setGeneratedPrompt(event.target.value)}
                placeholder="复盘提示词"
              />
              <button type="button" onClick={handleCopyPrompt} className="button-secondary sm:max-w-48">
                <Clipboard className="h-4 w-4" />
                复制提示词
              </button>
            </div>
            <div className="grid gap-3">
              <textarea
                className="input min-h-48 resize-none py-3"
                value={aiResponse}
                onChange={(event) => setAiResponse(event.target.value)}
                placeholder="粘贴 AI 总结结果"
              />
              <button type="button" onClick={handleSaveAiResponse} className="button-primary sm:max-w-48">
                <Send className="h-4 w-4" />
                保存结果
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* 统计卡片 */}
      <section className="grid gap-3 sm:grid-cols-4">
        <StatCard label="本周问题" value={`${stats.weekCount}`} />
        <StatCard label="高频类型" value={stats.topCategory} />
        <StatCard label="未完成措施" value={`${stats.unfinishedActions}`} />
        <StatCard label="今日复盘" value={stats.reviewedToday ? '已完成' : '未完成'} />
      </section>

      {/* 问题记录表单 */}
      {showWeaknessForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Target className="h-4 w-4 text-[#6B7A5A]" />
            {editingWeaknessId === null ? '记录问题' : '编辑问题'}
          </h2>
          <div className="mt-4 grid gap-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <select className="input" value={weaknessForm.category} onChange={(event) => updateWeaknessForm('category', event.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <input className="input" type="number" min={1} max={10} value={weaknessForm.severity} onChange={(event) => updateWeaknessForm('severity', Number(event.target.value))} aria-label="严重程度" />
              <input className="input" type="date" value={weaknessForm.occurDate} onChange={(event) => updateWeaknessForm('occurDate', event.target.value)} />
              <select className="input" value={weaknessForm.occurPeriod} onChange={(event) => updateWeaknessForm('occurPeriod', event.target.value)}>
                {periods.map((period) => (
                  <option key={period} value={period}>{period || '发生时段'}</option>
                ))}
              </select>
            </div>
            <input className="input" placeholder="一句话标题" value={weaknessForm.title} onChange={(event) => updateWeaknessForm('title', event.target.value)} />
            <textarea className="input min-h-24 resize-none py-3" placeholder="具体表现" value={weaknessForm.behavior} onChange={(event) => updateWeaknessForm('behavior', event.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <textarea className="input min-h-24 resize-none py-3" placeholder="产生原因" value={weaknessForm.reason} onChange={(event) => updateWeaknessForm('reason', event.target.value)} />
              <textarea className="input min-h-24 resize-none py-3" placeholder="造成影响" value={weaknessForm.impact} onChange={(event) => updateWeaknessForm('impact', event.target.value)} />
            </div>
            <input className="input" placeholder="当时情绪" value={weaknessForm.emotion} onChange={(event) => updateWeaknessForm('emotion', event.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <textarea className="input min-h-24 resize-none py-3" placeholder="改进措施" value={weaknessForm.correction} onChange={(event) => updateWeaknessForm('correction', event.target.value)} />
              <textarea className="input min-h-24 resize-none py-3" placeholder="下次预防方法" value={weaknessForm.prevention} onChange={(event) => updateWeaknessForm('prevention', event.target.value)} />
            </div>
            {editingWeaknessId === null ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={weaknessForm.addToPlan} onChange={(event) => updateWeaknessForm('addToPlan', event.target.checked)} />
                加入明日安排
              </label>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={handleSaveWeakness} className="button-primary">
                <Save className="h-4 w-4" />保存
              </button>
              <button type="button" onClick={resetWeaknessForm} className="button-secondary">
                <XCircle className="h-4 w-4" />取消
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 问题档案 - 可折叠 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <button type="button" onClick={() => setShowProblems((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">问题档案</span>
          <span className="text-sm text-slate-500">{showProblems ? '收起' : '展开'} ({weaknesses.length})</span>
        </button>
        {showProblems ? (
          <div className="mt-4 grid gap-3">
            <div className="flex justify-end">
              <button type="button" onClick={() => setIncludeDeleted((value) => !value)} className="button-secondary text-xs">
                {includeDeleted ? '隐藏已删除' : '查看已删除'}
              </button>
            </div>
            {weaknesses.length === 0 ? (
              <p className="text-sm text-slate-500">暂无问题记录</p>
            ) : (
              weaknesses.map((record) => (
                <WeaknessCard
                  key={record.id}
                  record={record}
                  onEdit={startEditWeakness}
                  onResolve={handleResolveWeakness}
                  onAction={openActionForm}
                  onRestore={handleRestoreWeakness}
                  onDelete={handleDeleteWeakness}
                />
              ))
            )}
          </div>
        ) : null}
      </section>

      {/* 改进措施 - 可折叠 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <button type="button" onClick={() => setShowActions((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">改进措施</span>
          <span className="text-sm text-slate-500">{showActions ? '收起' : '展开'} ({allActions.length})</span>
        </button>
        {showActions ? (
          <div className="mt-4 grid gap-3">
            {actionWeaknessId !== null ? (
              <div className="grid gap-2 rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
                <input className="input" placeholder="措施标题" value={actionForm.title} onChange={(event) => setActionForm((current) => ({ ...current, title: event.target.value }))} />
                <textarea className="input min-h-24 resize-none py-3" placeholder="措施说明" value={actionForm.description} onChange={(event) => setActionForm((current) => ({ ...current, description: event.target.value }))} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="input" type="number" min={1} max={10} value={actionForm.difficulty} onChange={(event) => setActionForm((current) => ({ ...current, difficulty: Number(event.target.value) }))} aria-label="执行难度" />
                  <input className="input" type="number" min={0} placeholder="预计分钟" value={actionForm.estimatedMinutes} onChange={(event) => setActionForm((current) => ({ ...current, estimatedMinutes: event.target.value }))} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={handleSaveAction} className="button-primary">保存措施</button>
                  <button type="button" onClick={() => setActionWeaknessId(null)} className="button-secondary">取消</button>
                </div>
              </div>
            ) : null}
            {allActions.length === 0 ? (
              <p className="text-sm text-slate-500">暂无改进措施</p>
            ) : (
              allActions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onComplete={handleCompleteAction}
                  onAddToPlan={handleAddActionToPlan}
                  onAddToTask={handleAddActionToTask}
                />
              ))
            )}
          </div>
        ) : null}
      </section>

      {/* 本周摘要 */}
      {weeklySummary ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold">本周摘要</h2>
          <p className="text-xs text-slate-400 mt-1">{weeklySummary.week_start} 至 {weeklySummary.week_end}</p>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            <div className="rounded-xl bg-[#F5F1EA] p-3">
              <p className="text-2xl font-extrabold text-[#6B7A5A]">{weeklySummary.tasks_completed}</p>
              <p className="text-[10px] text-slate-500 mt-1">完成任务</p>
            </div>
            <div className="rounded-xl bg-[#F5F1EA] p-3">
              <p className="text-2xl font-extrabold text-[#6B7A5A]">{weeklySummary.steps_completed}</p>
              <p className="text-[10px] text-slate-500 mt-1">完成步骤</p>
            </div>
            <div className="rounded-xl bg-[#F5F1EA] p-3">
              <p className="text-2xl font-extrabold text-[#6B7A5A]">{weeklySummary.focus_sessions}</p>
              <p className="text-[10px] text-slate-500 mt-1">专注次数</p>
            </div>
            <div className="rounded-xl bg-[#F5F1EA] p-3">
              <p className="text-2xl font-extrabold text-[#6B7A5A]">{weeklySummary.focus_minutes}</p>
              <p className="text-[10px] text-slate-500 mt-1">专注分钟</p>
            </div>
          </div>
          {/* 热力图 */}
          <div className="mt-4 flex gap-1 justify-center">
            {Object.entries(weeklySummary.daily_completion).map(([dateStr, count]) => {
              const d = new Date(dateStr + 'T00:00:00')
              const dayLabels = ['一','二','三','四','五','六','日']
              const dow = d.getDay()
              const dayIdx = dow === 0 ? 6 : dow - 1
              const level = count === 0 ? 'bg-[#F0ECE5]' : count <= 2 ? 'bg-[#C8D5B9]' : count <= 5 ? 'bg-[#8FAA7B]' : 'bg-[#6B7A5A]'
              return (
                <div key={dateStr} className="flex flex-col items-center gap-1">
                  <div className={`w-7 h-7 rounded-md ${level} transition`} title={`${dateStr}: ${count} 项`} />
                  <span className="text-[9px] text-slate-400">{dayLabels[dayIdx]}</span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* 历史报告 - 可折叠 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <button type="button" onClick={() => setShowReports((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">历史报告</span>
          <span className="text-sm text-slate-500">{showReports ? '收起' : '展开'} ({reports.length})</span>
        </button>
        {showReports && reports.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {reports.slice(0, 10).map((report) => (
              <div key={report.id} className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {reportTypeLabel(report.report_type)} / {report.start_date} 至 {report.end_date}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{report.ai_response ? '已保存总结' : '已有提示词'}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedReport(report)}
                      className="button-secondary text-xs"
                    >
                      打开
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteReport(report.id)}
                      className="button-danger text-xs"
                    >
                      <Trash2 className="h-3 w-3" />删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {showReports && reports.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">暂无历史报告</p>
        ) : null}
      </section>

      {/* 报告详情弹窗 */}
      {selectedReport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedReport(null)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* 标题区 */}
            <div className="border-b border-[#E6DED3] pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                {reportTypeLabel(selectedReport.report_type)} 报告
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedReport.start_date} 至 {selectedReport.end_date}
                {selectedReport.accepted ? <span className="ml-2 text-emerald-600 font-medium">已采纳</span> : null}
              </p>
            </div>

            {!selectedReport.ai_response && !selectedReport.ai_prompt && !selectedReport.input_summary ? (
              <p className="py-10 text-center text-sm text-slate-400">暂无内容</p>
            ) : (
              <div className="mt-4 space-y-4">
                {/* ① AI 总结 — 最优先、最大字号 */}
                {selectedReport.ai_response ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-emerald-100 text-[10px]">①</span>
                      AI 总结
                    </h4>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {selectedReport.ai_response}
                    </div>
                  </div>
                ) : null}

                {/* ② 数据汇总 */}
                {selectedReport.input_summary ? (
                  <div className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-[#F5F1EA] text-[10px] text-slate-500">②</span>
                      数据汇总
                    </h4>
                    <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600 leading-relaxed">{selectedReport.input_summary}</pre>
                  </div>
                ) : null}

                {/* ③ 提示词 / 原始记录 */}
                {selectedReport.ai_prompt ? (
                  <div className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-[#F5F1EA] text-[10px] text-slate-500">③</span>
                      原始记录 / 提示词
                    </h4>
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-500">{selectedReport.ai_prompt}</pre>
                  </div>
                ) : null}

                {/* ④ 后续行动 */}
                {selectedReport.next_actions ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold text-blue-800">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-blue-100 text-[10px]">④</span>
                      后续计划
                    </h4>
                    <p className="mt-2 text-sm text-slate-700 leading-relaxed">{selectedReport.next_actions}</p>
                  </div>
                ) : null}
              </div>
            )}

            <div className="mt-5 flex justify-end border-t border-[#E6DED3] pt-4">
              <button type="button" onClick={() => setSelectedReport(null)} className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 active:scale-95">
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog}
    </div>
  )
}
