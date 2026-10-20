import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Frown,
  HelpCircle,
  ListTodo,
  MapPin,
  Meh,
  Plus,
  Smile,
  XCircle,
} from 'lucide-react'

import { useAuth } from '../auth'
import {
  checkinTask,
  completeStep,
  deleteCourse,
  deleteStep,
  deleteTask,
  delayStep,
  getCurrentReminder,
  getDailyScoreSummary,
  getDataCenterStats,
  getStreak,
  getTaskStats,
  getTodayCourses,
  getTodayPlans,
  getTodayScore,
  getTodayTasks,
  getUpcomingReminders,
  saveDailyScore,
  skipStep,
  undoCheckin,
  type Course,
  type DailyPlan,
  type DailyScore,
  type DailyScoreSummary,
  type DataCenterStats,
  type PlanStep,
  type Streak,
  type Task,
  type TaskStats,
} from '../api'
import { useConfirm } from '../hooks/useConfirm'
import DailyReminder from '../components/DailyReminder'
import FocusTimer from '../components/FocusTimer'
import HelpAssistant from '../components/HelpAssistant'
import QuickAdd from '../components/QuickAdd'
import WeatherCard from '../components/WeatherCard'

type StepAction = {
  stepId: number
  kind: 'delay' | 'skip'
}

type FocusItem =
  | { kind: 'step'; step: PlanStep; title: string; detail: string; description: string | null; status: string }
  | { kind: 'plan'; plan: DailyPlan; title: string; detail: string; description: string | null }

type ScheduleItem =
  | { kind: 'step'; step: PlanStep; title: string; time: string; subtitle: string; status: string }
  | { kind: 'course'; course: Course; title: string; time: string; subtitle: string }
  | { kind: 'task'; task: Task; title: string; time: string; subtitle: string; checkedIn: boolean }

const activeStepStatuses = new Set(['pending', 'in_progress', 'delayed'])

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

function stepTime(step: PlanStep) {
  return `${step.start_time} - ${step.end_time}`
}

function formatToday(date: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
}

export default function TodayPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const today = formatToday(new Date())

  const [plans, setPlans] = useState<DailyPlan[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [stats, setStats] = useState<TaskStats | null>(null)
  const [dailyScore, setDailyScore] = useState<DailyScore | null>(null)
  const [streak, setStreak] = useState<Streak>({ streak: 0, today_done: false })
  const [currentReminder, setCurrentReminder] = useState<PlanStep | null>(null)
  const [upcomingReminders, setUpcomingReminders] = useState<PlanStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stepAction, setStepAction] = useState<StepAction | null>(null)
  const [stepReason, setStepReason] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [scoreSaving, setScoreSaving] = useState(false)
  const [scoreError, setScoreError] = useState('')
  const [scoreNote, setScoreNote] = useState('')
  const [scoreMood, setScoreMood] = useState('')
  const [scoreSummary, setScoreSummary] = useState<DailyScoreSummary | null>(null)
  const [dataCenter, setDataCenter] = useState<DataCenterStats | null>(null)
  const { confirm, dialog } = useConfirm()

  const allSteps = plans.flatMap((plan) => plan.steps)
  const activeSteps = allSteps.filter((step) => activeStepStatuses.has(step.status))
  const currentStep = currentReminder ?? activeSteps[0] ?? null
  const nextReminder = upcomingReminders[0] ?? activeSteps.find((step) => step.id !== currentStep?.id) ?? null
  const taskProgress = stats ? Math.round(stats.completion_rate * 100) : 0
  const orderedActiveSteps = currentStep
    ? [currentStep, ...activeSteps.filter((step) => step.id !== currentStep.id)]
    : activeSteps
  const focusItems: FocusItem[] =
    orderedActiveSteps.length > 0
      ? orderedActiveSteps.map((step) => ({
          kind: 'step',
          step,
          title: step.title,
          detail: stepTime(step),
          description: step.description,
          status: step.status,
        }))
      : plans.map((plan) => ({
          kind: 'plan',
          plan,
          title: plan.title,
          detail: `${plan.completed_steps}/${plan.total_steps} 项安排`,
          description: plan.main_goal || plan.note,
        }))
  const visibleFocusItems = focusItems.slice(0, 5)
  const hiddenFocusCount = focusItems.length - visibleFocusItems.length

  const scheduleItems: ScheduleItem[] = [
    ...allSteps
      .filter((s) => activeStepStatuses.has(s.status))
      .map(
        (s): ScheduleItem => ({
          kind: 'step',
          step: s,
          title: s.title,
          time: `${s.start_time} - ${s.end_time}`,
          subtitle: s.description ?? '',
          status: s.status,
        }),
      ),
    ...courses.map(
      (c): ScheduleItem => ({
        kind: 'course',
        course: c,
        title: c.name,
        time: `${c.start_time} - ${c.end_time}`,
        subtitle: [c.location, c.teacher].filter(Boolean).join(' / '),
      }),
    ),
    ...tasks.map(
      (t): ScheduleItem => ({
        kind: 'task',
        task: t,
        title: t.title,
        time: t.frequency ?? '',
        subtitle: t.category ?? '',
        checkedIn: t.checked_in,
      }),
    ),
  ].sort((a, b) => {
    const aHasTime = a.time.includes(':')
    const bHasTime = b.time.includes(':')
    if (aHasTime && !bHasTime) return -1
    if (!aHasTime && bHasTime) return 1
    if (aHasTime && bHasTime) return a.time.localeCompare(b.time)
    return 0
  })

  const visibleSchedule = scheduleItems.slice(0, 6)
  const hiddenScheduleCount = scheduleItems.length - visibleSchedule.length

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [plansData, tasksData, coursesData, statsData, streakData, currentData, upcomingData, scoreData, scoreSummaryData, dcData] = await Promise.all([
        getTodayPlans(),
        getTodayTasks(),
        getTodayCourses(),
        getTaskStats(),
        getStreak(),
        getCurrentReminder(),
        getUpcomingReminders(),
        getTodayScore(),
        getDailyScoreSummary().catch(() => null),
        getDataCenterStats().catch(() => null),
      ])
      setPlans(plansData)
      setTasks(tasksData)
      setCourses(coursesData)
      setStats(statsData)
      setStreak(streakData)
      setCurrentReminder(currentData)
      setUpcomingReminders(upcomingData)
      setDailyScore(scoreData)
      setScoreSummary(scoreSummaryData)
      setDataCenter(dcData)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  function openStepAction(stepId: number, kind: 'delay' | 'skip') {
    setStepAction({ stepId, kind })
    setStepReason('')
    setError('')
  }

  async function handleCompleteStep(stepId: number) {
    try {
      await completeStep(stepId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
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

  async function handleCheckin(taskId: number) {
    try {
      await checkinTask(taskId, {})
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '打卡失败')
    }
  }

  async function handleUndoCheckin(taskId: number) {
    try {
      await undoCheckin(taskId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败')
    }
  }

  async function handleDeleteStep(stepId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await deleteStep(stepId); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
  }

  async function handleDeleteTask(taskId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await deleteTask(taskId); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
  }

  async function handleDeleteCourse(courseId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await deleteCourse(courseId); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
  }

  async function handleScore(score: number) {
    setScoreSaving(true)
    setScoreError('')
    try {
      const noteText = [scoreMood ? {happy:'开心',calm:'平静',sad:'低落'}[scoreMood] : '', scoreNote].filter(Boolean).join(' | ')
      const result = await saveDailyScore(score, noteText || null)
      setDailyScore(result)
      setScoreNote('')
      setScoreMood('')
    } catch {
      setScoreError('保存失败，请重试')
    } finally {
      setScoreSaving(false)
    }
  }

  const remainingCount = scheduleItems.filter(
    (item) => {
      if (item.kind === 'task') return !item.checkedIn
      if (item.kind === 'step') return activeStepStatuses.has(item.status)
      return false
    }
  ).length

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">今日</h1>
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-[#E6DED3] bg-white text-slate-400 hover:text-[#6B7A5A] hover:border-[#6B7A5A]/30"
            aria-label="小助手"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">{today}</p>
        <div className="mt-3">
          <WeatherCard />
        </div>
        <div className="mt-3">
          <QuickAdd onCreated={loadData} />
        </div>
      </header>

      {user?.must_change_password ? (
        <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>当前账号正在使用初始或重置密码，请到"我的"页面修改密码。</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
        <div className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">当前要做</h2>
            {currentStep ? (
              <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${statusClass(currentStep.status)}`}>
                {statusLabel(currentStep.status)}
              </span>
            ) : null}
          </div>

          {visibleFocusItems.length > 0 ? (
            <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
              {visibleFocusItems.map((item) => (
                <article
                  key={item.kind === 'step' ? `step-${item.step.id}` : `plan-${item.plan.id}`}
                  className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4"
                >
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-lg font-extrabold leading-tight text-slate-800">{item.title}</p>
                        {item.kind === 'step' ? (
                          <span className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${statusClass(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
                      {item.description ? <p className="mt-2 break-words text-sm leading-6 text-slate-600">{item.description}</p> : null}
                    </div>
                    {item.kind === 'step' ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => handleCompleteStep(item.step.id)} className="button-primary">
                          <CheckCircle2 className="h-4 w-4" />
                          完成
                        </button>
                        <button type="button" onClick={() => openStepAction(item.step.id, 'delay')} className="button-secondary">
                          <Clock3 className="h-4 w-4" />
                          延期
                        </button>
                        <button type="button" onClick={() => openStepAction(item.step.id, 'skip')} className="button-secondary">
                          <XCircle className="h-4 w-4" />
                          跳过
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {item.kind === 'step' && stepAction?.stepId === item.step.id ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        className="input"
                        placeholder={stepAction.kind === 'delay' ? '延期原因' : '跳过原因'}
                        value={stepReason}
                        onChange={(event) => setStepReason(event.target.value)}
                        onKeyDown={(event) => event.key === 'Enter' && void handleStepAction()}
                      />
                      <button type="button" onClick={handleStepAction} className="button-primary">
                        确定
                      </button>
                      <button type="button" onClick={() => setStepAction(null)} className="button-secondary">
                        取消
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
              {hiddenFocusCount > 0 ? <p className="text-center text-xs text-slate-400">还有 {hiddenFocusCount} 项，在安排页查看</p> : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-5">
              <p className="text-base font-semibold">今天还没有安排</p>
              <p className="mt-2 text-sm text-slate-500">打开安排页，为今天加入第一项。</p>
              <button type="button" onClick={() => navigate('/plans')} className="button-secondary mt-4">
                <Plus className="h-4 w-4" />
                打开安排
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <MetricCard
            label="今日完成率"
            value={`${taskProgress}%`}
            detail={stats ? `${stats.completed_today}/${stats.total} 个任务` : '暂无任务'}
            hint={stats?.encouragement}
          />
          {streak.streak > 0 ? (
            <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">连续打卡</p>
              <p className="mt-2 text-2xl font-extrabold">{streak.streak} <span className="text-base font-normal text-slate-500">天</span></p>
              <p className="mt-1 text-xs text-slate-400">{streak.today_done ? '今天已完成' : '今天还没完成'}</p>
            </div>
          ) : null}
          <FocusTimer label={currentStep?.title} />
          <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-[#6B7A5A]" />
              下一个提醒
            </div>
            {nextReminder ? (
              <div className="mt-3 min-w-0">
                <p className="truncate text-base font-semibold">{nextReminder.title}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {nextReminder.enable_reminder && nextReminder.remind_time ? nextReminder.remind_time : nextReminder.start_time}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">暂无提醒</p>
            )}
          </div>
          {dataCenter ? (
            <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
              <p className="text-xs font-semibold text-slate-500">数据中心</p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">任务完成率</span><span className="text-right font-semibold">{Math.round(dataCenter.task_completion_rate * 100)}%</span>
                <span className="text-slate-500">专注次数</span><span className="text-right font-semibold">{dataCenter.total_focus_sessions}</span>
                <span className="text-slate-500">荣誉</span><span className="text-right font-semibold">{dataCenter.total_honors}</span>
                <span className="text-slate-500">项目</span><span className="text-right font-semibold">{dataCenter.total_projects}</span>
                <span className="text-slate-500">回忆</span><span className="text-right font-semibold">{dataCenter.total_memories}</span>
                <span className="text-slate-500">日记</span><span className="text-right font-semibold">{dataCenter.total_diary_entries}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[#E6DED3] bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <CalendarCheck2 className="h-4 w-4 text-[#6B7A5A]" />
            今日安排
          </h2>
          {hiddenScheduleCount > 0 ? (
            <span className="text-xs text-slate-400">共 {scheduleItems.length} 项</span>
          ) : null}
        </div>

        {scheduleItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-5 text-center">
            <p className="text-sm font-semibold">今天还没有安排</p>
            <p className="mt-2 text-xs text-slate-500">使用上方快速添加，或前往安排/课表/任务页面手动添加。</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => navigate('/plans')} className="button-secondary text-xs">
                <Plus className="h-4 w-4" />安排
              </button>
              <button type="button" onClick={() => navigate('/schedule')} className="button-secondary text-xs">
                <BookOpen className="h-4 w-4" />课表
              </button>
              <button type="button" onClick={() => navigate('/checkin')} className="button-secondary text-xs">
                <ListTodo className="h-4 w-4" />任务
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 md:hidden schedule-scroll">
              {visibleSchedule.map((item) => (
                <ScheduleCard
                  key={item.kind === 'step' ? `step-${item.step.id}` : item.kind === 'task' ? `task-${item.task.id}` : `course-${item.course.id}`}
                  item={item}
                  onCheckin={handleCheckin}
                  onUndo={handleUndoCheckin}
                  onComplete={handleCompleteStep}
                  onDeleteStep={handleDeleteStep}
                  onDeleteTask={handleDeleteTask}
                  onDeleteCourse={handleDeleteCourse}
                />
              ))}
              {hiddenScheduleCount > 0 ? (
                <button
                  type="button"
                  onClick={() => navigate('/plans')}
                  className="flex shrink-0 w-[120px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#E6DED3] bg-[#FFFDF8] p-3 text-xs text-slate-500 hover:border-[#6B7A5A]/40"
                >
                  <ChevronRight className="h-5 w-5" />
                  查看全部 +{hiddenScheduleCount}
                </button>
              ) : null}
            </div>

            <div className="mt-4 hidden gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
              {visibleSchedule.map((item) => (
                <ScheduleCard
                  key={item.kind === 'step' ? `step-${item.step.id}` : item.kind === 'task' ? `task-${item.task.id}` : `course-${item.course.id}`}
                  item={item}
                  onCheckin={handleCheckin}
                  onUndo={handleUndoCheckin}
                  onComplete={handleCompleteStep}
                  onDeleteStep={handleDeleteStep}
                  onDeleteTask={handleDeleteTask}
                  onDeleteCourse={handleDeleteCourse}
                />
              ))}
            </div>

            {hiddenScheduleCount > 0 ? (
              <div className="mt-3 flex gap-2 border-t border-[#E6DED3] pt-3">
                <button type="button" onClick={() => navigate('/plans')} className="button-secondary text-xs">
                  <CalendarCheck2 className="h-3 w-3" />查看规划
                </button>
                <button type="button" onClick={() => navigate('/schedule')} className="button-secondary text-xs">
                  <BookOpen className="h-3 w-3" />查看课程
                </button>
                <button type="button" onClick={() => navigate('/checkin')} className="button-secondary text-xs">
                  <ListTodo className="h-3 w-3" />查看任务
                </button>
                <span className="ml-auto self-center text-xs text-slate-400">+{hiddenScheduleCount} 项未显示</span>
              </div>
            ) : null}
          </>
        )}
      </section>

      <DailyReminder />

      {remainingCount > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-700">
            今天还有 {remainingCount} 项未完成
          </p>
          <p className="mt-1 text-xs text-amber-600">抽空完成一两件，别给自己太大压力。</p>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#E6DED3] bg-white p-4">
        <p className="text-sm font-semibold">今天状态怎么样？</p>
        {/* 5-star rating */}
        <div className="mt-3 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleScore(s)}
              disabled={scoreSaving}
              className={`text-2xl transition active:scale-90 ${scoreSaving ? 'opacity-50' : ''}`}
              aria-label={`${s} 星`}
            >
              {dailyScore && dailyScore.score >= s ? (
                <span className="text-amber-400">★</span>
              ) : (
                <span className="text-slate-200 hover:text-amber-300">☆</span>
              )}
            </button>
          ))}
        </div>
        {/* Mood tags */}
        <div className="mt-2 flex gap-2">
          {[
            { key: 'happy', label: '开心', icon: Smile, cls: 'hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600' },
            { key: 'calm', label: '平静', icon: Meh, cls: 'hover:bg-sky-50 hover:border-sky-300 hover:text-sky-600' },
            { key: 'sad', label: '低落', icon: Frown, cls: 'hover:bg-slate-100 hover:border-slate-400 hover:text-slate-600' },
          ].map(mood => (
            <button
              key={mood.key}
              type="button"
              onClick={() => setScoreMood(scoreMood === mood.key ? '' : mood.key)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition ${
                scoreMood === mood.key
                  ? 'border-[#6B7A5A] bg-[#F5F1EA] text-[#6B7A5A]'
                  : 'border-[#E6DED3] bg-white text-slate-500 ' + mood.cls
              }`}
            >
              <mood.icon className="h-3 w-3" />
              {mood.label}
            </button>
          ))}
        </div>
        {/* Note input */}
        <input
          className="input mt-2 !h-9 text-xs"
          placeholder="写一句今天的状态..."
          value={scoreNote}
          onChange={e => setScoreNote(e.target.value)}
          maxLength={100}
        />
        <div className="mt-2 flex items-center gap-2">
          {scoreSaving ? (
            <span className="text-xs text-slate-400">保存中...</span>
          ) : dailyScore ? (
            <span className="text-xs text-emerald-600">
              已记录 · {dailyScore.score}星{formatScoreNote(dailyScore.note)}
            </span>
          ) : null}
        </div>
        {scoreSummary ? (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3 text-xs sm:grid-cols-4">
            <StatusMetric label="7日均分" value={scoreSummary.avg_7d ?? '-'} />
            <StatusMetric label="30日均分" value={scoreSummary.avg_30d ?? '-'} />
            <StatusMetric label="记录数" value={scoreSummary.total_records} />
            <StatusMetric label="趋势" value={scoreSummary.trend_text} />
          </div>
        ) : null}
        {scoreError ? <p className="mt-1 text-xs text-red-500">{scoreError}</p> : null}
      </section>

      <HelpAssistant open={helpOpen} onClose={() => setHelpOpen(false)} />
      {dialog}
    </div>
  )
}

function formatScoreNote(note: string | null): string {
  if (!note) return ''
  const parts = note.split('|').map((item) => item.trim()).filter(Boolean)
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

function StatusMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 truncate font-semibold text-slate-700">{value}</p>
    </div>
  )
}

function MetricCard({ label, value, detail, hint }: { label: string; value: string; detail: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
      {hint ? <p className="mt-1 text-xs text-[#6B7A5A]">{hint}</p> : null}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#F5F1EA]">
        <div className="h-full bg-[#6B7A5A] rounded-full" style={{ width: value.endsWith('%') ? value : '0%' }} />
      </div>
    </div>
  )
}

function ScheduleCard({
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
            {item.subtitle ? ' / ' + item.subtitle : ''}
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
            else if (item.kind === 'course') onDeleteCourse(item.course.id)
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
      ) : item.kind === 'task' && item.checkedIn ? (
        <div className="mt-2">
          <button type="button" onClick={() => onUndo(item.task.id)} className="button-secondary text-[11px] h-8 w-full">
            撤销
          </button>
        </div>
      ) : null}
    </div>
  )
}
