import { useEffect, useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { CalendarPlus, CheckCircle2, Edit3, Plus, RotateCcw, Save, Trash2, XCircle } from 'lucide-react'

import {
  checkinTask, createTask, deleteTask, getTaskStats, getTasks,
  makeupTask, undoCheckin, updateTask, type Task, type TaskStats,
} from '../api'

type TaskForm = { title: string; category: string; frequency: string; priority: string; estimatedMinutes: string }

const emptyTaskForm: TaskForm = { title: '', category: '', frequency: '', priority: '0', estimatedMinutes: '' }

function localDateValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function payloadFromForm(form: TaskForm) {
  return {
    title: form.title.trim(),
    category: form.category.trim() || null,
    frequency: form.frequency.trim() || null,
    priority: Number(form.priority) || 0,
    estimated_minutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
  }
}

export default function CheckinPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [stats, setStats] = useState<TaskStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTask, setNewTask] = useState<TaskForm>(emptyTaskForm)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editTask, setEditTask] = useState<TaskForm>(emptyTaskForm)
  const [makeupTaskId, setMakeupTaskId] = useState<number | null>(null)
  const [makeupDate, setMakeupDate] = useState(localDateValue())
  const [makeupReason, setMakeupReason] = useState('')
  const { confirm, dialog } = useConfirm()

  async function loadData() {
    setLoading(true); setError('')
    try {
      const [tasksData, statsData] = await Promise.all([getTasks(), getTaskStats()])
      setTasks(tasksData); setStats(statsData)
    } catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadData() }, [])

  function updateNewTask(field: keyof TaskForm, value: string) { setNewTask(c => ({ ...c, [field]: value })) }
  function updateEditTask(field: keyof TaskForm, value: string) { setEditTask(c => ({ ...c, [field]: value })) }

  async function handleCreateTask() {
    if (!newTask.title.trim()) return
    try { await createTask(payloadFromForm(newTask)); setNewTask(emptyTaskForm); setShowNewTask(false); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '创建失败') }
  }

  function startEdit(task: Task) {
    setEditingTaskId(task.id)
    setEditTask({ title: task.title, category: task.category ?? '', frequency: task.frequency ?? '', priority: String(task.priority), estimatedMinutes: task.estimated_minutes == null ? '' : String(task.estimated_minutes) })
  }

  async function handleUpdateTask(taskId: number) {
    if (!editTask.title.trim()) return
    try { await updateTask(taskId, payloadFromForm(editTask)); setEditingTaskId(null); setEditTask(emptyTaskForm); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '更新失败') }
  }

  async function handleDeleteTask(taskId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await deleteTask(taskId); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
  }

  async function handleCheckin(taskId: number) {
    try { await checkinTask(taskId, {}); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '打卡失败') }
  }

  async function handleUndoCheckin(taskId: number) {
    try { await undoCheckin(taskId); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '撤销失败') }
  }

  function openMakeup(taskId: number) { setMakeupTaskId(taskId); setMakeupDate(localDateValue()); setMakeupReason(''); setError('') }

  async function handleMakeup(taskId: number) {
    if (!makeupDate || !makeupReason.trim()) { setError('请填写补卡日期和原因'); return }
    try { await makeupTask(taskId, { log_date: makeupDate, reason: makeupReason.trim() }); setMakeupTaskId(null); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '补卡失败') }
  }

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>

  const completionRate = stats ? Math.round(stats.completion_rate * 100) : 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-wide text-slate-800">打卡</h1>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : null}

      {/* Stats + new task */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">今日完成</p>
            <p className="mt-3 text-4xl font-extrabold text-slate-800">{completionRate}%</p>
            {stats ? <p className="mt-1 text-sm text-slate-500">{stats.completed_today}/{stats.total} 项</p> : null}
          </div>
          {!showNewTask ? (
            <button type="button" onClick={() => setShowNewTask(true)} className="button-primary">
              <Plus className="h-4 w-4" />新建任务
            </button>
          ) : null}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#F5F1EA]">
          <div className="h-full bg-[#6B7A5A] rounded-full transition-all" style={{ width: `${completionRate}%` }} />
        </div>

        {showNewTask ? (
          <div className="mt-4 flex gap-2">
            <input className="input flex-1" placeholder="任务名称，回车添加" value={newTask.title}
              onChange={e => updateNewTask('title', e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateTask(); if (e.key === 'Escape') { setShowNewTask(false); setNewTask(emptyTaskForm) } }}
              autoFocus />
            <button type="button" onClick={handleCreateTask} className="button-primary shrink-0">添加</button>
            <button type="button" onClick={() => { setShowNewTask(false); setNewTask(emptyTaskForm) }} className="button-secondary shrink-0">取消</button>
          </div>
        ) : null}
      </section>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-[#E6DED3] bg-white p-8 text-center">
          <p className="text-sm text-slate-500">暂无任务，点击上方按钮创建第一个</p>
        </div>
      ) : (
        <section className="grid gap-3">
          {tasks.map(task => (
            <article key={task.id} className="rounded-2xl border border-[#E6DED3] bg-white p-4">
              {editingTaskId === task.id ? (
                <TaskFormFields form={editTask} onChange={updateEditTask} primaryLabel="保存"
                  onPrimary={() => handleUpdateTask(task.id)}
                  onCancel={() => { setEditingTaskId(null); setEditTask(emptyTaskForm) }} />
              ) : (
                <TaskRow task={task} onCheckin={handleCheckin} onUndo={handleUndoCheckin}
                  onEdit={startEdit} onDelete={handleDeleteTask} onMakeup={openMakeup} />
              )}

              {makeupTaskId === task.id ? (
                <div className="mt-4 grid gap-2 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto_auto]">
                  <input className="input" type="date" value={makeupDate} onChange={e => setMakeupDate(e.target.value)} />
                  <input className="input" placeholder="补卡原因" value={makeupReason}
                    onChange={e => setMakeupReason(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void handleMakeup(task.id)} />
                  <button type="button" onClick={() => handleMakeup(task.id)} className="button-primary">确定</button>
                  <button type="button" onClick={() => setMakeupTaskId(null)} className="button-secondary">取消</button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
      {dialog}
    </div>
  )
}

function TaskFormFields({ form, onChange, primaryLabel, onPrimary, onCancel }: {
  form: TaskForm; onChange: (field: keyof TaskForm, value: string) => void
  primaryLabel: string; onPrimary: () => Promise<void>; onCancel: () => void
}) {
  return (
    <div className="grid gap-3">
      <input className="input" placeholder="任务标题" value={form.title}
        onChange={e => onChange('title', e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void onPrimary()} />
      <div className="grid gap-2 sm:grid-cols-4">
        <input className="input" placeholder="分类" value={form.category} onChange={e => onChange('category', e.target.value)} />
        <input className="input" placeholder="频率" value={form.frequency} onChange={e => onChange('frequency', e.target.value)} />
        <input className="input" type="number" min={0} placeholder="优先级" value={form.priority} onChange={e => onChange('priority', e.target.value)} />
        <input className="input" type="number" min={0} placeholder="分钟" value={form.estimatedMinutes} onChange={e => onChange('estimatedMinutes', e.target.value)} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onPrimary} className="button-primary"><Save className="h-4 w-4" />{primaryLabel}</button>
        <button type="button" onClick={onCancel} className="button-secondary"><XCircle className="h-4 w-4" />取消</button>
      </div>
    </div>
  )
}

function TaskRow({ task, onCheckin, onUndo, onEdit, onDelete, onMakeup }: {
  task: Task; onCheckin: (id: number) => Promise<void>; onUndo: (id: number) => Promise<void>
  onEdit: (t: Task) => void; onDelete: (id: number) => Promise<void>; onMakeup: (id: number) => void
}) {
  const metadata = [task.category, task.frequency, task.estimated_minutes === null ? null : `${task.estimated_minutes} 分钟`, task.priority > 0 ? `优先级 ${task.priority}` : null].filter(Boolean)

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
            task.checked_in ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-[#E6DED3] bg-[#FFFDF8] text-slate-400'
          }`}>
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="min-w-0 wrap-break-word text-base font-bold text-slate-700">{task.title}</p>
            {metadata.length > 0 ? <p className="mt-1 wrap-break-word text-xs text-slate-400">{metadata.join(' / ')}</p> : null}
          </div>
          <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
            task.checked_in ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#E6DED3] bg-[#FFFDF8] text-slate-500'
          }`}>
            {task.checked_in ? '已打卡' : '待打卡'}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {task.checked_in ? (
          <button type="button" onClick={() => onUndo(task.id)} className="button-secondary"><RotateCcw className="h-4 w-4" />撤销</button>
        ) : (
          <button type="button" onClick={() => onCheckin(task.id)} className="button-primary"><CheckCircle2 className="h-4 w-4" />打卡</button>
        )}
        <button type="button" onClick={() => onMakeup(task.id)} className="button-secondary"><CalendarPlus className="h-4 w-4" />补卡</button>
        <button type="button" onClick={() => onEdit(task)} className="button-secondary"><Edit3 className="h-4 w-4" />编辑</button>
        <button type="button" onClick={() => onDelete(task.id)} className="button-danger"><Trash2 className="h-4 w-4" />删除</button>
      </div>
    </div>
  )
}
