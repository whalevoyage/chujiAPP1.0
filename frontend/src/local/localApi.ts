import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ApiError } from '../api-errors'
import { MAX_IMPORT_ATTACHMENT_BYTES, MAX_IMPORT_ENTRIES, MAX_IMPORT_TOTAL_BYTES, validateZipEnvelope } from './zipSafety'
import {
  clearLocalAttachmentUrlCache,
  deleteLocalAttachment,
  exposeAttachment,
  getLocalAttachmentUrl,
  migrateLegacyAttachments,
  removeLocalAttachmentFile,
  readLocalAttachmentBytes,
  stageLocalAttachmentFile,
  uploadLocalAttachment,
} from './attachments'
import {
  deleteRow,
  exportAllRows,
  getMeta,
  getRow,
  listRows,
  replaceAllRows,
  saveRow,
  setMeta,
  type LocalRow,
} from './localDb'

type LocalOptions = { method?: string; body?: Record<string, unknown> }
type Obj = Record<string, unknown>

const USER_ID = 1
const DELETE_PASSWORD_ITERATIONS = 240_000
const MAX_IMPORT_ARCHIVE_BYTES = 100 * 1024 * 1024
let attachmentMigration: Promise<void> | null = null
const now = () => new Date().toISOString()
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const stamp = () => ({ created_at: now(), updated_at: now() })
const asNumber = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const asText = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const bodyOf = (value: unknown): Obj => value && typeof value === 'object' ? value as Obj : {}

function fail(status: number, message: string): never { throw new ApiError(status, message) }
function notFound(label: string): never { return fail(404, `${label}不存在`) }
function dateInRange(value: unknown, from?: string, to?: string) {
  const date = asText(value)
  return (!from || date >= from) && (!to || date <= to)
}
function searchMatch(row: Obj, q: string, fields: string[]) {
  const needle = q.trim().toLocaleLowerCase()
  return !needle || fields.some((field) => asText(row[field]).toLocaleLowerCase().includes(needle))
}
async function all(entity: string): Promise<Obj[]> { return await listRows(entity) as Obj[] }
async function byId(entity: string, id: number, label = '记录'): Promise<Obj> {
  const row = await getRow(entity, id)
  if (!row) notFound(label)
  return row as Obj
}
async function save(entity: string, row: Obj): Promise<Obj> { return await saveRow(entity, row as LocalRow) as Obj }
async function created(entity: string, values: Obj, defaults: Obj = {}): Promise<Obj> {
  return save(entity, { user_id: USER_ID, ...defaults, ...values, ...stamp() })
}
async function userProfile(): Promise<Obj> {
  const existing = await getRow('profiles', USER_ID)
  if (existing) return existing as Obj
  return save('profiles', {
    id: USER_ID,
    user_id: USER_ID,
    username: 'local',
    nickname: '我',
    role: 'user',
    is_active: true,
    must_change_password: false,
    created_at: now(),
    updated_at: now(),
    last_login_at: null,
  })
}
async function stepsForPlan(planId: number): Promise<Obj[]> {
  return (await all('plan_steps')).filter((item) => asNumber(item.plan_id) === planId)
    .sort((a, b) => asNumber(a.sort_order) - asNumber(b.sort_order) || asText(a.start_time).localeCompare(asText(b.start_time)))
}
async function planResponse(plan: Obj): Promise<Obj> {
  const steps = await stepsForPlan(asNumber(plan.id))
  const completed = steps.filter((step) => step.status === 'completed').length
  return { ...plan, steps, total_steps: steps.length, completed_steps: completed, progress: steps.length ? Math.round(completed / steps.length * 100) : 0 }
}
async function taskResponse(task: Obj): Promise<Obj> {
  const log = (await all('task_logs')).find((item) => asNumber(item.task_id) === asNumber(task.id) && item.log_date === today() && !item.is_makeup) ?? null
  return { ...task, checked_in: Boolean(log), today_log: log }
}
async function attachmentRows(ownerType?: string, ownerId?: number): Promise<Obj[]> {
  const rows = await all('attachments')
  return rows.filter((item) => (!ownerType || item.owner_type === ownerType) && (ownerId === undefined || asNumber(item.owner_id) === ownerId))
    .sort((a, b) => asText(b.created_at).localeCompare(asText(a.created_at)))
}
async function withAttachments(entity: 'memories' | 'projects' | 'honors', row: Obj): Promise<Obj> {
  const owner = entity === 'memories' ? 'memory' : entity === 'projects' ? 'project' : 'honor'
  const files = await Promise.all((await attachmentRows(owner, asNumber(row.id))).map(exposeAttachment))
  return { ...row, attachments: files, attachment_count: files.length }
}
async function allData(): Promise<Record<string, LocalRow[]>> { return exportAllRows() }

function parseIcs(text: string): Obj[] {
  const events = text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)
  const courses: Obj[] = []
  for (const event of events) {
    const get = (key: string) => event.match(new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'mi'))?.[1]?.trim() ?? ''
    const start = get('DTSTART').replace(/[^0-9]/g, '')
    const end = get('DTEND').replace(/[^0-9]/g, '')
    const day = start.length >= 8 ? new Date(Number(start.slice(0, 4)), Number(start.slice(4, 6)) - 1, Number(start.slice(6, 8))).getDay() : 1
    const mondayIndex = (day + 6) % 7
    const time = (value: string) => value.length >= 12 ? `${value.slice(8, 10)}:${value.slice(10, 12)}` : '00:00'
    courses.push({
      name: get('SUMMARY') || '未命名课程', teacher: null, location: get('LOCATION') || null,
      day_of_week: mondayIndex, start_time: time(start), end_time: time(end), start_week: 1, end_week: 16,
      color: '#6B7A5A', note: get('DESCRIPTION') || null,
    })
  }
  return courses
}

export async function requestLocalApi<T>(path: string, options: LocalOptions = {}): Promise<T> {
  attachmentMigration ??= migrateLegacyAttachments()
  await attachmentMigration
  const url = new URL(path, 'http://local.app')
  const p = url.pathname.replace(/\/$/, '') || '/'
  const method = (options.method ?? 'GET').toUpperCase()
  const body = bodyOf(options.body)
  const segments = p.split('/').filter(Boolean).map(decodeURIComponent)
  const q = url.searchParams
  const idAt = (index: number) => asNumber(segments[index])
  const user = await userProfile()

  // 本机档案默认登录，不显示网络账号/服务器登录步骤。
  if (p === '/api/auth/me' && method === 'GET') return { user } as T
  if (p === '/api/auth/login' && method === 'POST') {
    const profile = { ...user, last_login_at: now() }
    await save('profiles', profile)
    return { user: profile } as T
  }
  if (p === '/api/auth/logout' && method === 'POST') return { message: '已退出本机档案' } as T
  if (p === '/api/auth/change-password' && method === 'POST') return { user } as T
  if (p === '/api/admin/users' && method === 'GET') return [user] as T

  // 每日规划与步骤
  if (p === '/api/plans/today' || p === '/api/plans' || /^\/api\/plans\/\d+$/.test(p)) {
    const plans = await all('daily_plans')
    if (segments.length === 3 && /^\d+$/.test(segments[2])) {
      const plan = plans.find((item) => asNumber(item.id) === idAt(2))
      return (await planResponse(plan ?? notFound('计划'))) as T
    }
    if (method === 'GET') {
      const date = p.endsWith('/today') ? today() : q.get('date')
      const rows = plans.filter((item) => !date || item.plan_date === date)
        .sort((a, b) => asText(a.plan_date).localeCompare(asText(b.plan_date)))
      return await Promise.all(rows.map(planResponse)) as T
    }
    if (method === 'POST') return await planResponse(await created('daily_plans', body, {
      plan_date: today(), title: '今日计划', main_goal: null, note: null, status: 'active',
    })) as T
    if (method === 'PUT') {
      const id = idAt(2), row = await byId('daily_plans', id, '计划')
      return await planResponse(await save('daily_plans', { ...row, ...body, id, updated_at: now() })) as T
    }
    if (method === 'DELETE') {
      const id = idAt(2)
      await deleteRow('daily_plans', id)
      for (const step of await stepsForPlan(id)) await deleteRow('plan_steps', asNumber(step.id))
      return { ok: true } as T
    }
  }
  const planStepCreate = p.match(/^\/api\/plans\/(\d+)\/steps$/)
  if (planStepCreate && method === 'POST') {
    return await created('plan_steps', { ...body, plan_id: Number(planStepCreate[1]) }, {
      title: '新步骤', start_time: '09:00', end_time: '10:00', status: 'pending', priority: 0, sort_order: (await stepsForPlan(Number(planStepCreate[1]))).length,
    }) as T
  }
  if (p === '/api/plan-steps' || p.startsWith('/api/plan-steps/')) {
    const id = idAt(2), action = segments[3]
    if (method === 'GET') return await stepsForPlan(id) as T
    if (method === 'POST' && segments[3] === 'steps') return await created('plan_steps', { ...body, plan_id: id }, {
      title: '新步骤', start_time: '09:00', end_time: '10:00', status: 'pending', priority: 0, sort_order: 0,
    }) as T
    const row = await byId('plan_steps', id, '计划步骤')
    if (method === 'DELETE') { await deleteRow('plan_steps', id); return { ok: true } as T }
    if (method === 'PUT') return await save('plan_steps', { ...row, ...body, id, updated_at: now() }) as T
    if (method === 'POST') {
      const status = action === 'complete' ? 'completed' : action === 'start' ? 'in_progress' : action === 'skip' ? 'skipped' : action === 'delay' ? 'delayed' : asText(row.status)
      const updated = { ...row, status, completed_at: status === 'completed' ? now() : row.completed_at, delay_reason: action === 'delay' ? body.reason : row.delay_reason, skip_reason: action === 'skip' ? body.reason : row.skip_reason, updated_at: now() }
      return await save('plan_steps', updated) as T
    }
  }
  if (p === '/api/reminders/current' || p === '/api/reminders/upcoming') {
    const rows = (await all('plan_steps')).filter((item) => item.enable_reminder && item.status === 'pending')
      .sort((a, b) => asText(a.start_time).localeCompare(asText(b.start_time)))
    return (p.endsWith('/current') ? rows[0] ?? null : rows) as T
  }

  // 习惯任务与打卡
  if (p.startsWith('/api/tasks')) {
    const tasks = await all('tasks')
    if (p === '/api/tasks/today' || p === '/api/tasks') {
      const rows = tasks.filter((task) => task.is_active !== false)
      if (method === 'POST') return await taskResponse(await created('tasks', body, { title: '新任务', is_active: true, priority: 0, sort_order: tasks.length })) as T
      rows.sort((a, b) => asNumber(a.sort_order) - asNumber(b.sort_order) || asNumber(b.priority) - asNumber(a.priority))
      return await Promise.all(rows.map(taskResponse)) as T
    }
    if (p === '/api/tasks/stats' || p === '/api/tasks/stats/total') {
      const logs = await all('task_logs')
      const relevant = logs.filter((log) => p.endsWith('/total') || log.log_date === today())
      const completed = relevant.filter((log) => log.status === 'completed').length
      const rate = relevant.length ? completed / relevant.length : 0
      const encouragement = rate <= 0 ? '今天刚开始' : rate < .5 ? '慢慢来，先完成一件' : rate < .9 ? '进度不错' : '今天很稳'
      return (p.endsWith('/total')
        ? { total_tasks: tasks.length, total_completed: completed, completion_rate: rate, encouragement }
        : { total: tasks.filter((task) => task.is_active !== false).length, completed_today: completed, completion_rate: rate, encouragement }) as T
    }
    if (p === '/api/tasks/streak') {
      const days = [...new Set((await all('task_logs')).filter((log) => log.status === 'completed').map((log) => asText(log.log_date)))].sort().reverse()
      let streak = 0
      const cursor = new Date(`${today()}T12:00:00`)
      for (const day of days) {
        if (day !== `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`) break
        streak += 1; cursor.setDate(cursor.getDate() - 1)
      }
      return { streak, today_done: days.includes(today()) } as T
    }
    if (p === '/api/tasks/weekly-summary') {
      const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); start.setHours(0,0,0,0)
      const end = new Date(start); end.setDate(end.getDate() + 6)
      const startDate = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`
      const endDate = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`
      const logs = (await all('task_logs')).filter((log) => dateInRange(log.log_date, startDate, endDate) && log.status === 'completed')
      const steps = (await all('plan_steps')).filter((step) => step.status === 'completed' && (asText(step.completed_at) >= startDate))
      const sessions = (await all('focus_sessions')).filter((session) => asText(session.started_at) >= startDate && asText(session.started_at) <= `${endDate}T23:59:59` && session.status === 'completed')
      const daily: Record<string, number> = {}; for (const log of logs) daily[asText(log.log_date)] = (daily[asText(log.log_date)] ?? 0) + 1
      return { week_start: startDate, week_end: endDate, tasks_completed: logs.length, steps_completed: steps.length, focus_sessions: sessions.length, focus_minutes: Math.floor(sessions.reduce((n, s) => n + asNumber(s.duration_seconds), 0) / 60), daily_completion: daily } as T
    }
    const id = idAt(2), action = segments[3]
    if (method === 'GET') return await taskResponse(tasks.find((task) => asNumber(task.id) === id) ?? notFound('任务')) as T
    if (method === 'PUT') {
      const row = await byId('tasks', id, '任务')
      return await taskResponse(await save('tasks', { ...row, ...body, id, updated_at: now() })) as T
    }
    if (method === 'DELETE') { await deleteRow('tasks', id); return { ok: true } as T }
    if (method === 'POST' && action === 'checkin') {
      const old = (await all('task_logs')).find((log) => asNumber(log.task_id) === id && log.log_date === today() && !log.is_makeup)
      if (old) return old as T
      return await created('task_logs', { ...body, task_id: id, log_date: today(), status: 'completed', is_makeup: false, makeup_reason: null }) as T
    }
    if (method === 'POST' && action === 'undo-checkin') {
      const old = (await all('task_logs')).find((log) => asNumber(log.task_id) === id && log.log_date === today() && !log.is_makeup)
      if (old) await deleteRow('task_logs', asNumber(old.id))
      return { ok: true } as T
    }
    if (method === 'POST' && action === 'makeup') return await created('task_logs', { ...body, task_id: id, status: 'completed', is_makeup: true }) as T
  }

  // 日记与标签
  if (p === '/api/diary' || p === '/api/diary/search' || p.startsWith('/api/diary/')) {
    const entries = await all('diary_entries')
    if (method === 'GET' && (p === '/api/diary' || p === '/api/diary/search')) {
      const includeDeleted = q.get('include_deleted') === 'true'
      const keyword = q.get('q') ?? ''
      return entries.filter((entry) => (includeDeleted || !entry.is_deleted) && searchMatch(entry, keyword, ['title', 'content_md', 'mood']))
        .sort((a,b) => asText(b.entry_date).localeCompare(asText(a.entry_date))) as T
    }
    if (p === '/api/diary' && method === 'POST') {
      const entry = await created('diary_entries', { ...body, title: body.title || '未命名日记', content_md: body.content_md || '', entry_date: body.entry_date || today(), is_starred: Boolean(body.is_starred), is_private: Boolean(body.is_private), is_deleted: false, deleted_at: null })
      await setDiaryTags(asNumber(entry.id), Array.isArray(body.tags) ? body.tags.map(String) : [])
      return await diaryResponse(entry) as T
    }
    const id = idAt(2), action = segments[3]
    let row = entries.find((entry) => asNumber(entry.id) === id) ?? notFound('日记')
    if (method === 'GET') return await diaryResponse(row) as T
    if (method === 'PUT') {
      row = await save('diary_entries', { ...row, ...body, id, updated_at: now() })
      if (Array.isArray(body.tags)) await setDiaryTags(id, body.tags.map(String))
      return await diaryResponse(row) as T
    }
    if (method === 'DELETE') { await save('diary_entries', { ...row, is_deleted: true, deleted_at: now(), updated_at: now() }); return { ok: true } as T }
    if (method === 'POST' && action === 'restore') { row = await save('diary_entries', { ...row, is_deleted: false, deleted_at: null, updated_at: now() }); return await diaryResponse(row) as T }
  }
  if (p === '/api/tags' && method === 'GET') return await all('tags') as T
  if (p === '/api/tags' && method === 'POST') {
    const name = asText(body.name).trim()
    const existing = (await all('tags')).find((tag) => tag.name === name)
    return (existing ?? await created('tags', { ...body, name })) as T
  }

  // 复盘问题与改进动作
  if (p === '/api/weaknesses' && method === 'GET') {
    return (await all('weakness_records')).filter((row) => (q.get('include_deleted') === 'true' || !row.is_deleted)
      && (!q.get('category') || row.category === q.get('category'))
      && (!q.get('severity') || asNumber(row.severity) === asNumber(q.get('severity')))
      && dateInRange(row.occur_date, q.get('date_from') ?? undefined, q.get('date_to') ?? undefined)) as T
  }
  if (p === '/api/weaknesses' && method === 'POST') {
    return await created('weakness_records', { ...body, title: body.title || '待改进问题', category: body.category || '其他', severity: asNumber(body.severity, 5), occur_date: body.occur_date || today(), is_resolved: false, review_count: 0, is_deleted: false, deleted_at: null }) as T
  }
  if (p.startsWith('/api/weaknesses/')) {
    const id = idAt(2), action = segments[3], row = await byId('weakness_records', id, '问题记录')
    if (action === 'actions') {
      if (method === 'GET') return (await all('improvement_actions')).filter((item) => asNumber(item.weakness_id) === id) as T
      if (method === 'POST') return await created('improvement_actions', { ...body, weakness_id: id, status: '未执行', completed_at: null }, { difficulty: 5, add_to_plan: false, add_to_task: false }) as T
    }
    if (method === 'GET') return row as T
    if (method === 'PUT') return await save('weakness_records', { ...row, ...body, id, updated_at: now() }) as T
    if (method === 'DELETE') { await save('weakness_records', { ...row, is_deleted: true, deleted_at: now(), updated_at: now() }); return { ok: true } as T }
    if (method === 'POST' && action === 'resolve') return await save('weakness_records', { ...row, is_resolved: true, review_count: asNumber(row.review_count) + 1, updated_at: now() }) as T
    if (method === 'POST' && action === 'restore') return await save('weakness_records', { ...row, is_deleted: false, deleted_at: null, updated_at: now() }) as T
  }
  if (p.startsWith('/api/improvement-actions/')) {
    const id = idAt(2), action = segments[3], row = await byId('improvement_actions', id, '改进动作')
    if (method === 'PUT') return await save('improvement_actions', { ...row, ...body, id, updated_at: now() }) as T
    if (method === 'POST' && action === 'complete') return await save('improvement_actions', { ...row, status: '已完成', completed_at: now(), updated_at: now() }) as T
    if (method === 'POST' && action === 'add-to-plan') {
      const plan = await created('daily_plans', { title: '改进计划', main_goal: row.title, plan_date: today() }, { status: 'active' })
      const step = await created('plan_steps', { plan_id: plan.id, title: row.title, description: row.description, start_time: '09:00', end_time: '10:00' }, { status: 'pending', sort_order: 0 })
      return { ok: true, plan_id: plan.id, step_id: step.id } as T
    }
    if (method === 'POST' && action === 'add-to-task') {
      const task = await created('tasks', { title: row.title, category: '改进', task_type: '改进动作' }, { is_active: true, priority: 0, sort_order: (await all('tasks')).length })
      return { ok: true, task_id: task.id } as T
    }
  }

  if (p.startsWith('/api/reviews')) {
    if (p === '/api/reviews' && method === 'GET') return await all('review_reports') as T
    if (p === '/api/reviews/generate-local-summary' || p === '/api/reviews/generate-ai-prompt' || p === '/api/reviews/generate-smart-summary') {
      const reportType = asText(body.report_type, 'weekly')
      const endDate = asText(body.end_date, today())
      const defaultStart = reportType === 'daily' ? endDate : reportType === 'monthly' ? `${endDate.slice(0, 7)}-01` : (() => { const d = new Date(`${endDate}T12:00:00`); d.setDate(d.getDate() - 6); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
      const startDate = asText(body.start_date, defaultStart)
      const logs = (await all('task_logs')).filter((row) => dateInRange(row.log_date, startDate, endDate))
      const plans = (await all('daily_plans')).filter((row) => dateInRange(row.plan_date, startDate, endDate))
      const focus = (await all('focus_sessions')).filter((row) => asText(row.started_at).slice(0,10) >= startDate && asText(row.started_at).slice(0,10) <= endDate)
      const diaries = (await all('diary_entries')).filter((row) => !row.is_deleted && dateInRange(row.entry_date, startDate, endDate))
      const summary = { task_logs: logs.length, tasks_completed: logs.filter((row) => row.status === 'completed').length, plans: plans.length, focus_sessions: focus.length, focus_minutes: Math.floor(focus.reduce((n,row) => n + asNumber(row.duration_seconds),0) / 60), diary_entries: diaries.length }
      const inputSummary = `复盘区间：${startDate} 至 ${endDate}。完成任务打卡 ${summary.tasks_completed} 次，创建计划 ${summary.plans} 个，专注 ${summary.focus_minutes} 分钟，记录日记 ${summary.diary_entries} 篇。`
      if (p.endsWith('generate-local-summary')) return { report_type: reportType, start_date: startDate, end_date: endDate, summary, input_summary: inputSummary } as T
      const aiPrompt = `请根据以下个人数据做简短复盘，并给出可执行建议。\n\n${inputSummary}`
      if (p.endsWith('generate-ai-prompt')) {
        const report = await created('review_reports', { report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, ai_response: null, final_content: null, accepted: false, next_actions: null })
        return { report_id: report.id, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, summary } as T
      }
      const settings = JSON.parse(await getMeta('api_settings') ?? '{}') as Obj
      if (p.endsWith('generate-smart-summary') && settings.ai_api_key) {
        const aiSummary = await callModel(settings, 'ai', [
          { role: 'system', content: '你是个人成长复盘助手。根据数据给出简洁、具体、可执行的中文建议。' },
          { role: 'user', content: aiPrompt },
        ])
        const report = await created('review_reports', { report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, ai_response: aiSummary, final_content: aiSummary, accepted: true, next_actions: null })
        return { report_id: report.id, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_summary: aiSummary, summary_material: null, ai_enabled: true, message: '智能总结已生成并保存在本机' } as T
      }
      return { report_id: null, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_summary: null, summary_material: aiPrompt, ai_enabled: false, message: '本机模式下复盘统计可离线使用；AI 总结需要联网并配置模型服务。' } as T
    }
    if (p === '/api/reviews/save-ai-response' && method === 'POST') {
      const id = asNumber(body.report_id)
      const existing = id ? await getRow('review_reports', id) : null
      const row = existing
        ? await save('review_reports', { ...(existing as Obj), ...body, id, updated_at: now() })
        : await created('review_reports', { ...body, report_type: body.report_type || 'weekly', start_date: body.start_date || today(), end_date: body.end_date || today() }, { accepted: false })
      return row as T
    }
    if (p === '/api/reviews/document' && method === 'POST') return { ok: false, message: '文档生成需要联网服务' } as T
    const id = idAt(2), row = await byId('review_reports', id, '复盘报告')
    if (method === 'GET') return row as T
    if (method === 'PUT') return await save('review_reports', { ...row, ...body, id, updated_at: now() }) as T
    if (method === 'DELETE') { await deleteRow('review_reports', id); return { ok: true } as T }
  }

  // 专注、每日状态与提醒
  if (p === '/api/focus/start' && method === 'POST') return await created('focus_sessions', { ...body, status: 'running', duration_seconds: 0, started_at: now(), ended_at: null }) as T
  if (p.startsWith('/api/focus/') && segments[2] !== 'totals' && segments[2] !== 'today') {
    const id = idAt(2), row = await byId('focus_sessions', id, '专注记录')
    if (method === 'POST') return await save('focus_sessions', { ...row, status: 'completed', duration_seconds: asNumber(body.duration_seconds), ended_at: now() }) as T
  }
  if (p === '/api/focus/today' || p === '/api/focus/totals') {
    const sessions = (await all('focus_sessions')).filter((row) => row.status === 'completed')
    const todaySessions = sessions.filter((row) => asText(row.started_at).slice(0,10) === today())
    const result = { total_sessions: sessions.length, total_minutes: Math.floor(sessions.reduce((n,row) => n + asNumber(row.duration_seconds), 0)/60), sessions_today: todaySessions.length, total_minutes_today: Math.floor(todaySessions.reduce((n,row) => n + asNumber(row.duration_seconds),0)/60) }
    return p.endsWith('/today') ? { sessions_today: result.sessions_today, total_minutes_today: result.total_minutes_today } as T : result as T
  }
  if (p === '/api/daily-score' && method === 'POST') {
    const existing = (await all('daily_scores')).find((row) => row.score_date === today())
    const row = existing ? await save('daily_scores', { ...existing, ...body, updated_at: now() }) : await created('daily_scores', { ...body, score_date: today() })
    return row as T
  }
  if (p === '/api/daily-score/today') return ((await all('daily_scores')).find((row) => row.score_date === today()) ?? null) as T
  if (p === '/api/daily-score/summary') {
    const scores = await all('daily_scores'), avg = (days: number) => { const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-days); const rows = scores.filter((row) => asText(row.score_date) >= cutoff.toISOString().slice(0,10)); return rows.length ? Math.round(rows.reduce((n,row) => n + asNumber(row.score),0)/rows.length*10)/10 : null }
    const avg7 = avg(7), avg30 = avg(30), trend = avg7 === null || avg30 === null ? 'stable' : avg7 > avg30 + .3 ? 'up' : avg7 < avg30 - .3 ? 'down' : 'stable'
    return { avg_7d: avg7, avg_30d: avg30, trend, trend_text: trend === 'up' ? '最近一周状态有明显好转' : trend === 'down' ? '最近一周状态有所下降，注意调整' : '稳定，保持下去', total_records: scores.length } as T
  }
  if (p === '/api/daily-reminder/today' && method === 'GET') {
    const row = (await all('daily_reminders')).find((item) => item.reminder_date === today())
    return { id: row?.id ?? null, text: row?.text ?? '' } as T
  }
  if (p === '/api/daily-reminder/today' && method === 'POST') {
    const existing = (await all('daily_reminders')).find((item) => item.reminder_date === today())
    const row = existing ? await save('daily_reminders', { ...existing, text: asText(body.text), updated_at: now() }) : await created('daily_reminders', { text: asText(body.text), reminder_date: today() })
    return { id: row.id, text: row.text } as T
  }

  // 天气仅为联网附加项，离线时返回可识别的空状态，不阻断本地记录功能。
  if (p === '/api/weather/today') return { locationName: '', adm1: '', adm2: '', text: '离线', temp: null, feelsLike: null, windDir: null, windScale: null, humidity: null, obsTime: null, source: 'offline', rain_warning: '', ok: false } as T
  if (p === '/api/weather/search') return [] as T
  if (p === '/api/weather/location' && method === 'POST') { await setMeta('weather_location', JSON.stringify(body)); return { ok: true } as T }

  // API Key 只保存到本机设置；模型/天气调用仍需要联网。
  if (p === '/api/settings/api-keys' && method === 'GET') {
    const settings = JSON.parse(await getMeta('api_settings') ?? '{}') as Obj
    const masked = (key: unknown) => { const value = asText(key); return value ? `${value.slice(0, 3)}••••${value.slice(-4)}` : null }
    return {
      ai_configured: Boolean(settings.ai_api_key), ai_api_key: { configured: Boolean(settings.ai_api_key), masked: masked(settings.ai_api_key) },
      ai_base_url: asText(settings.ai_base_url, 'https://api.openai.com/v1'), ai_model: asText(settings.ai_model, 'gpt-4o-mini'),
      weather_api_key: { configured: Boolean(settings.weather_api_key), masked: masked(settings.weather_api_key) }, weather_api_host: asText(settings.weather_api_host),
      ocr_configured: Boolean(settings.ocr_api_key), ocr_api_key: { configured: Boolean(settings.ocr_api_key), masked: masked(settings.ocr_api_key) },
      ocr_base_url: asText(settings.ocr_base_url), ocr_model: asText(settings.ocr_model),
    } as T
  }
  if (p === '/api/settings/api-keys' && method === 'PUT') {
    const settings = { ...(JSON.parse(await getMeta('api_settings') ?? '{}') as Obj), ...body }
    await setMeta('api_settings', JSON.stringify(settings))
    return await requestLocalApi<T>('/api/settings/api-keys')
  }
  if (p === '/api/settings/delete-password' && method === 'GET') {
    const hasPassword = Boolean(await getMeta('delete_password'))
    return { configured: hasPassword, has_password: hasPassword } as T
  }
  if (p === '/api/settings/delete-password' && method === 'PUT') {
    const current = await getMeta('delete_password')
    if (current && !(await verifyLocalDeletePassword(asText(body.old_password)))) fail(400, '旧删除密码不正确')
    if (!current && body.old_password) fail(400, '本机尚未设置删除密码')
    const nextPassword = asText(body.new_password).trim()
    if (nextPassword.length < 8) fail(400, '新删除密码至少需要 8 位')
    await setMeta('delete_password', JSON.stringify(await hashLocalDeletePassword(nextPassword)))
    return { ok: true } as T
  }

  // 荣誉、回忆、项目及附件
  if (p === '/api/honors' && method === 'GET') {
    const rows = await all('honors')
    const filtered = rows.filter((row) => (!q.get('honor_type') || row.honor_type === q.get('honor_type'))
      && (!q.get('level') || row.level === q.get('level'))
      && (q.get('resume_ready') === null || Boolean(row.resume_ready) === (q.get('resume_ready') === 'true'))
      && searchMatch(row, q.get('q') ?? '', ['title', 'issuer', 'description']))
    const result = await Promise.all(filtered.map((row) => withAttachments('honors', row)))
    return result.sort((a,b) => asNumber(b.weight)-asNumber(a.weight) || asText(b.award_date).localeCompare(asText(a.award_date))) as T
  }
  if (p === '/api/honors' && method === 'POST') return await withAttachments('honors', await created('honors', body, { weight: 5, resume_ready: false, is_featured: false })) as T
  if (p.startsWith('/api/honors/')) {
    const id = idAt(2), row = await byId('honors', id, '荣誉记录')
    if (method === 'GET') return await withAttachments('honors', row) as T
    if (method === 'PUT') return await withAttachments('honors', await save('honors', { ...row, ...body, id, updated_at: now() })) as T
    if (method === 'DELETE') {
      await assertDeletePassword(body.password)
      for (const file of await attachmentRows('honor', id)) await deleteLocalAttachment(asNumber(file.id))
      await deleteRow('honors', id); return { ok: true } as T
    }
  }
  if (p === '/api/attachments/all' && method === 'GET') return await Promise.all((await attachmentRows()).map(exposeAttachment)) as T
  if (p.startsWith('/api/attachments/')) {
    const id = idAt(2), row = await byId('attachments', id, '附件')
    if (method === 'DELETE') { await assertDeletePassword(body.password); await deleteLocalAttachment(id); return { ok: true } as T }
    if (method === 'GET') return await exposeAttachment(row) as T
  }

  if (p === '/api/memories' && method === 'GET') {
    const rows = (await all('memories')).filter((row) => searchMatch(row, q.get('q') ?? '', ['title', 'location', 'story', 'tags']))
    return await Promise.all(rows.map((row) => withAttachments('memories', row))) as T
  }
  if (p === '/api/memories' && method === 'POST') return await withAttachments('memories', await created('memories', body)) as T
  if (p.startsWith('/api/memories/')) {
    const id = idAt(2), row = await byId('memories', id, '回忆')
    if (method === 'GET') return await withAttachments('memories', row) as T
    if (method === 'PUT') return await withAttachments('memories', await save('memories', { ...row, ...body, id, updated_at: now() })) as T
    if (method === 'DELETE') { await assertDeletePassword(body.password); for (const file of await attachmentRows('memory', id)) await deleteLocalAttachment(asNumber(file.id)); await deleteRow('memories', id); return { ok: true } as T }
  }
  if (p === '/api/projects' && method === 'GET') {
    const rows = (await all('projects')).filter((row) => searchMatch(row, q.get('q') ?? '', ['name', 'project_type', 'tech_stack', 'summary']))
    return await Promise.all(rows.map((row) => withAttachments('projects', row))) as T
  }
  if (p === '/api/projects' && method === 'POST') return await withAttachments('projects', await created('projects', body, { status: '进行中' })) as T
  if (p.startsWith('/api/projects/')) {
    const id = idAt(2), row = await byId('projects', id, '项目')
    if (method === 'GET') return await withAttachments('projects', row) as T
    if (method === 'PUT') return await withAttachments('projects', await save('projects', { ...row, ...body, id, updated_at: now() })) as T
    if (method === 'DELETE') { await assertDeletePassword(body.password); for (const file of await attachmentRows('project', id)) await deleteLocalAttachment(asNumber(file.id)); await deleteRow('projects', id); return { ok: true } as T }
  }

  // 课表与 iCalendar 文件导入。照片 OCR 是联网功能，离线时给出清楚提示。
  if (p === '/api/schedule/today' || p === '/api/schedule/week') {
    const day = (new Date().getDay() + 6) % 7
    return (await all('courses')).filter((row) => p.endsWith('/week') || asNumber(row.day_of_week) === day)
      .sort((a,b) => asNumber(a.day_of_week)-asNumber(b.day_of_week) || asText(a.start_time).localeCompare(asText(b.start_time))) as T
  }
  if (p === '/api/schedule' && method === 'POST') return await created('courses', body, { start_week: 1, end_week: 16, color: '#6B7A5A' }) as T
  if (p.startsWith('/api/schedule/') && /^\/api\/schedule\/\d+$/.test(p)) {
    const id = idAt(2), row = await byId('courses', id, '课程')
    if (method === 'GET') return row as T
    if (method === 'PUT') return await save('courses', { ...row, ...body, id, updated_at: now() }) as T
    if (method === 'DELETE') { await deleteRow('courses', id); return { ok: true } as T }
  }
  if (p === '/api/schedule/import-ics' && method === 'POST') {
    const items: Obj[] = []
    for (const course of parseIcs(asText(body.ics_text))) items.push(await created('courses', course, { start_week: 1, end_week: 16, color: '#6B7A5A' }))
    return { ok: true, imported: items.length, items, error: null } as T
  }
  if (p === '/api/schedule/import-photo' && method === 'POST') return await importSchedulePhotoLocal(body) as T

  // 综测成绩卡：本机计算总分；AI 分析保留为联网附加功能。
  if (p === '/api/scores' && method === 'GET') return (await all('score_cards')).filter((row) => !q.get('semester') || row.semester === q.get('semester')) as T
  if (p === '/api/scores' && method === 'POST') return await createScoreCard(body) as T
  if (p.startsWith('/api/scores/')) {
    const id = idAt(2), action = segments[3], row = await byId('score_cards', id, '成绩卡')
    if (action === 'analyze' && method === 'POST') {
      const settings = JSON.parse(await getMeta('api_settings') ?? '{}') as Obj
      const modules = JSON.parse(asText(row.modules_json, asText(row.subjects_json, '[]'))) as Obj[]
      const subjectList = modules.map((item) => `- ${asText(item.name)}：${asNumber(item.score)}分`).join('\n')
      const analysis = await callModel(settings, 'ai', [
        { role: 'system', content: '你是学习分析助手。请用简洁中文给出优势、薄弱点和改进建议。' },
        { role: 'user', content: `成绩卡：${asText(row.title)}\n学期：${asText(row.semester, '未知')}\n总分：${asNumber(row.total_score)}\n各项成绩：\n${subjectList}` },
      ])
      return await save('score_cards', { ...row, ai_analysis: analysis, updated_at: now() }) as T
    }
    if (method === 'PUT') return await updateScoreCard(row, body) as T
    if (method === 'DELETE') { await deleteRow('score_cards', id); return { ok: true } as T }
  }

  // 首页统计与时间线
  if (p === '/api/data-center/stats') {
    const logs = (await all('task_logs')).filter((row) => row.log_date === today())
    const completed = logs.filter((row) => row.status === 'completed').length
    const sessions = await all('focus_sessions')
    return { task_completion_rate: logs.length ? completed/logs.length : 0, total_focus_sessions: sessions.length, total_focus_minutes: Math.floor(sessions.reduce((n,row) => n + asNumber(row.duration_seconds),0)/60), total_courses: (await all('courses')).length, total_honors: (await all('honors')).length, total_projects: (await all('projects')).length, total_memories: (await all('memories')).length, total_diary_entries: (await all('diary_entries')).filter((row) => !row.is_deleted).length } as T
  }
  if (p === '/api/today-summary') {
    const taskCount = (await all('task_logs')).filter((row) => row.log_date === today() && row.status === 'completed').length
    const focus = (await all('focus_sessions')).filter((row) => asText(row.started_at).slice(0,10) === today())
    const score = (await all('daily_scores')).find((row) => row.score_date === today())
    const parts = []; if (taskCount) parts.push(`已完成 ${taskCount} 个任务`); if (focus.length) parts.push(`专注 ${Math.floor(focus.reduce((n,row) => n + asNumber(row.duration_seconds),0)/60)} 分钟`); if (score) parts.push(`状态评分 ${score.score} 分`)
    return { text: `${parts.join('，') || '今天还没有记录'}。`, task_count: taskCount, course_count: (await all('courses')).filter((row) => asNumber(row.day_of_week) === (new Date().getDay()+6)%7).length, has_focus_today: focus.length > 0, score_today: score?.score ?? null } as T
  }
  if (p === '/api/timeline') {
    const events: Obj[] = []
    for (const [entity, type, title, date, description] of [['honors','honor','title','award_date','description'], ['projects','project','name','start_date','summary'], ['memories','memory','title','photo_date','story']] as const) {
      for (const row of await all(entity)) if (row[date]) events.push({ id: row.id, date: row[date], type, title: row[title], description: row[description] })
    }
    return events.sort((a,b) => asText(b.date).localeCompare(asText(a.date))).slice(0, asNumber(q.get('limit'), 50)) as T
  }

  // 备份和服务器 JSON 导入
  if (p === '/api/backups' && method === 'GET') return await all('backups') as T
  if ((p === '/api/backups/create' || p === '/api/backups/auto-daily') && method === 'POST') return await createBackup() as T
  if (p.startsWith('/api/backups/')) {
    const id = idAt(2), action = segments[3], row = await byId('backups', id, '备份')
    if (action === 'restore' && method === 'POST') {
      const snapshot = bodyOf(row.snapshot)
      if (typeof row.sha256 === 'string' && row.sha256) {
        const snapshotHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(snapshot)))
        if (snapshotHash !== row.sha256.toLowerCase()) fail(400, '本机备份 SHA256 校验失败')
      }
      await ensureAttachmentMigrationComplete()
      const recoveryFilename = `恢复前备份-${now().replace(/[:.]/g, '-')}.json`
      const recoverySnapshot = await allData()
      const previousPaths = attachmentPaths(recoverySnapshot)
      const recoveryData = { ...recoverySnapshot }
      delete recoveryData.backups
      const recovery = await makeRecoveryBackup(recoveryFilename, recoveryData)
      try {
        await save('backups', recovery)
        await replaceAllRows(snapshot as Record<string, unknown[]>, { preserveBackups: true })
        clearLocalAttachmentUrlCache()
        attachmentMigration = null
        attachmentMigration = migrateLegacyAttachments()
        await attachmentMigration
        if ((await all('attachments')).some((item) => Boolean(item.data_url))) fail(400, '备份中的附件迁移失败，恢复已回滚')
        return { ok: true, recovery_backup: recovery.filename } as T
      } catch (error) {
        const newPaths = [...attachmentPaths(await allData())].filter((filePath) => !previousPaths.has(filePath))
        await replaceAllRows(recoverySnapshot)
        clearLocalAttachmentUrlCache()
        for (const filePath of newPaths) await removeLocalAttachmentFile(filePath)
        attachmentMigration = null
        throw error
      }
    }
    if (method === 'DELETE') { await assertDeletePassword(body.password); await deleteRow('backups', id); return { ok: true } as T }
  }
  if (p === '/api/exports/json' || p === '/api/exports/markdown' || p === '/api/exports/zip') return { local_export: true } as T

  if (p === '/api/admin/users' && method === 'POST') fail(400, '手机本机版仅使用当前本机档案')
  if (p.startsWith('/api/admin/users/')) return user as T
  fail(404, `本机模式暂不支持此操作：${method} ${p}`)
}

async function setDiaryTags(entryId: number, names: string[]) {
  const existing = (await all('tag_links')).filter((item) => item.target_type === 'diary' && asNumber(item.target_id) === entryId)
  for (const link of existing) await deleteRow('tag_links', asNumber(link.id))
  for (const name of names) {
    const tag = (await all('tags')).find((item) => item.name === name) ?? await created('tags', { name, color: null })
    await created('tag_links', { tag_id: tag.id, target_type: 'diary', target_id: entryId })
  }
}
async function diaryResponse(row: Obj): Promise<Obj> {
  const links = (await all('tag_links')).filter((item) => item.target_type === 'diary' && asNumber(item.target_id) === asNumber(row.id))
  const tags = await all('tags')
  return { ...row, tags: links.map((link) => tags.find((tag) => asNumber(tag.id) === asNumber(link.tag_id))?.name).filter(Boolean) }
}
async function assertDeletePassword(password: unknown) {
  const configured = await getMeta('delete_password')
  if (configured && !(await verifyLocalDeletePassword(asText(password)))) fail(403, '删除密码不正确')
}

type LocalDeletePasswordRecord = {
  algorithm: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  hash: string
}

async function hashLocalDeletePassword(password: string): Promise<LocalDeletePasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: DELETE_PASSWORD_ITERATIONS },
    key,
    256,
  )
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: DELETE_PASSWORD_ITERATIONS,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(new Uint8Array(bits)),
  }
}

async function verifyLocalDeletePassword(password: string): Promise<boolean> {
  const stored = await getMeta('delete_password')
  if (!stored || !password) return false
  let parsed: unknown
  try { parsed = JSON.parse(stored) } catch { parsed = null }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Partial<LocalDeletePasswordRecord>
    if (
      record.algorithm !== 'PBKDF2-SHA256'
      || !Number.isInteger(record.iterations)
      || Number(record.iterations) < 10_000
      || Number(record.iterations) > 1_000_000
      || !record.salt
      || !record.hash
    ) return false
    try {
      const salt = base64ToBytes(record.salt)
      const expected = base64ToBytes(record.hash)
      const iterations = Number(record.iterations)
      const key = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveBits'])
      const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
        key,
        expected.length * 8,
      ))
      if (bits.length !== expected.length) return false
      let difference = 0
      for (let index = 0; index < bits.length; index += 1) difference |= bits[index] ^ expected[index]
      return difference === 0
    } catch {
      return false
    }
  }

  // Old local releases stored this value in plaintext. Rehash only after a
  // successful match so a failed migration never invalidates the old password.
  if (stored !== password) return false
  await setMeta('delete_password', JSON.stringify(await hashLocalDeletePassword(password)))
  return true
}

async function createScoreCard(payload: Obj): Promise<Obj> {
  const items = Array.isArray(payload.modules) ? payload.modules as Obj[] : Array.isArray(payload.subjects) ? payload.subjects as Obj[] : []
  if (!items.length) fail(400, '请至少填写一项成绩')
  const sum = items.reduce((total, item) => total + asNumber(item.score), 0)
  const row = await created('score_cards', {
    title: asText(payload.title), semester: payload.semester ?? null, subjects_json: JSON.stringify(items),
    modules_json: JSON.stringify(items), total_score: Math.round(sum * 100) / 100, gpa: null,
    note: payload.note ?? null, ai_analysis: null,
  })
  return row
}
async function updateScoreCard(row: Obj, payload: Obj): Promise<Obj> {
  const items = Array.isArray(payload.modules) ? payload.modules as Obj[] : Array.isArray(payload.subjects) ? payload.subjects as Obj[] : null
  const next: Obj = { ...row, ...payload, updated_at: now() }
  if (items) {
    next.subjects_json = JSON.stringify(items)
    next.modules_json = JSON.stringify(items)
    next.total_score = Math.round(items.reduce((total, item) => total + asNumber(item.score), 0) * 100) / 100
  }
  if (!next.modules_json) next.modules_json = asText(next.subjects_json, '[]')
  return save('score_cards', next)
}
async function createBackup(): Promise<Obj> {
  await ensureAttachmentMigrationComplete()
  const snapshot = await allData()
  delete snapshot.backups
  snapshot.attachments = (snapshot.attachments ?? []).map((row) => {
    const safe = { ...row }
    delete safe.data_url
    return safe
  })
  const text = JSON.stringify(snapshot)
  const createdAt = now()
  return save('backups', {
    user_id: USER_ID, filename: `chuji-local-${createdAt.replace(/[:.]/g, '-')}.json`, size: new TextEncoder().encode(text).length,
    sha256: await sha256Hex(new TextEncoder().encode(text)), status: 'success', error_message: null, created_at: createdAt, snapshot,
  })
}

async function ensureAttachmentMigrationComplete(): Promise<void> {
  await migrateLegacyAttachments()
  if ((await all('attachments')).some((item) => Boolean(item.data_url))) {
    fail(409, '仍有旧版附件未迁移，备份或导入已暂停；原附件数据已保留，请先重新打开附件页面完成迁移。')
  }
}

function attachmentPaths(data: Record<string, unknown[]>): Set<string> {
  const rows = Array.isArray(data.attachments) ? data.attachments : []
  return new Set(rows.map((raw) => asText(bodyOf(raw).local_path)).filter(Boolean))
}

async function makeRecoveryBackup(filename: string, snapshot: Record<string, unknown[]>): Promise<Obj> {
  const serialized = JSON.stringify(snapshot)
  return {
    user_id: USER_ID,
    filename,
    snapshot,
    size: new TextEncoder().encode(serialized).length,
    sha256: await sha256Hex(new TextEncoder().encode(serialized)),
    status: 'success',
    error_message: null,
    created_at: now(),
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeArchiveFilename(filename: string): string {
  const cleaned = Array.from(filename)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .map((character) => '\\/:*?"<>|'.includes(character) ? '_' : character)
    .join('')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return cleaned || 'attachment.bin'
}

const exportNames: Record<string, string> = {
  daily_plans: 'daily_plans', plan_steps: 'plan_steps', tasks: 'tasks', task_logs: 'task_logs',
  diary_entries: 'diary_entries', tags: 'tags', tag_links: 'tag_links', weakness_records: 'weakness_records',
  improvement_actions: 'improvement_actions', review_reports: 'review_reports', honors: 'honors', attachments: 'attachments',
  courses: 'courses', focus_sessions: 'focus_sessions', daily_scores: 'daily_scores',
  daily_reminders: 'daily_reminders', score_cards: 'score_cards', memories: 'memories', projects: 'projects',
}
const importNames: Record<string, string> = {
  daily_plans: 'daily_plans', plan_steps: 'plan_steps', tasks: 'tasks', task_logs: 'task_logs',
  diary_entries: 'diary_entries', tags: 'tags', tag_links: 'tag_links', weakness_records: 'weakness_records',
  improvement_actions: 'improvement_actions', review_reports: 'review_reports', honors: 'honors', attachments: 'attachments',
  courses: 'courses', focus_sessions: 'focus_sessions', daily_scores: 'daily_scores',
  daily_reminders: 'daily_reminders', score_cards: 'score_cards', memories: 'memories', projects: 'projects',
}
function publicExport(data: Record<string, LocalRow[]>) {
  const result: Obj = { format: 'chuji-local-v1', exported_at: now(), scope: 'current_user', current_user: { id: USER_ID, username: 'local', nickname: '我', role: 'admin' } }
  for (const [entity, key] of Object.entries(exportNames)) {
    const rows = data[entity] ?? []
    result[key] = entity === 'attachments' ? rows.map((raw) => {
      const row = { ...raw }
      delete row.data_url
      delete row.local_path
      return row
    }) : rows
  }
  return result
}
function importedCollections(value: Obj): Record<string, unknown[]> {
  const source = bodyOf(value.data ?? value)
  const result: Record<string, unknown[]> = {}
  for (const [key, entity] of Object.entries(importNames)) {
    const rows = source[key]
    if (Array.isArray(rows)) {
      result[entity] = rows.map((raw) => {
        const row = bodyOf(raw)
        const next: Obj = { ...row, user_id: USER_ID }
        if (entity === 'attachments') delete next.local_path
        if (entity === 'score_cards' && !next.modules_json) next.modules_json = asText(next.subjects_json, '[]')
        return next
      })
    }
  }
  return result
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取附件'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('附件读取失败'))
    reader.readAsDataURL(file)
  })
}
export { fileToDataUrl as readLocalFileDataUrl }
export { getLocalAttachmentUrl, uploadLocalAttachment }

async function shareTextFile(filename: string, content: string, mimeType: string) {
  const path = `chuji/${filename}`
  const result = await Filesystem.writeFile({ path, data: content, directory: Directory.Cache, recursive: true, encoding: Encoding.UTF8 })
  const uri = result.uri || (await Filesystem.getUri({ path, directory: Directory.Cache })).uri
  await Share.share({ title: filename, text: '初记本机数据文件', url: uri, dialogTitle: '导出初记数据' })
  void mimeType
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer as ArrayBuffer
}
async function shareZipFile(filename: string, contents: Record<string, Uint8Array>) {
  const archive = zipSync(contents, { level: 6 })
  if (archive.length > MAX_IMPORT_ARCHIVE_BYTES) fail(413, '完整 ZIP 不能超过 100 MB；请分批导出或减少附件后重试')
  const path = `chuji/${filename}`
  const result = await Filesystem.writeFile({ path, data: bytesToBase64(archive), directory: Directory.Cache, recursive: true })
  const uri = result.uri || (await Filesystem.getUri({ path, directory: Directory.Cache })).uri
  await Share.share({ title: filename, text: '初记完整本机备份', url: uri, dialogTitle: '导出初记备份' })
}
function escapeMarkdown(value: unknown) { return asText(value).replaceAll('|', '\\|').replaceAll('\n', ' ') }
export async function downloadLocalFile(path: string, fallbackFilename: string): Promise<void> {
  const data = publicExport(await allData())
  if (path.endsWith('/markdown')) {
    const lines = ['# 初记数据导出', '', `导出时间：${data.exported_at}`, '']
    for (const [entity, rows] of Object.entries(data)) if (Array.isArray(rows) && rows.length) {
      lines.push(`## ${entity}`, '')
      for (const row of rows as Obj[]) lines.push(`- ${escapeMarkdown(row.title ?? row.name ?? row.text ?? JSON.stringify(row))}`)
      lines.push('')
    }
    return shareTextFile('初记阅读文档.md', lines.join('\n'), 'text/markdown')
  }
  if (path.endsWith('/zip')) {
    await ensureAttachmentMigrationComplete()
    const json = strToU8(JSON.stringify(data, null, 2))
    const manifest: Obj = { source: 'chuji-android-local', format_version: 1, created_at: now(), exported_at: data.exported_at, scope: 'current_user', attachment_files: [] }
    const files: Record<string, Uint8Array> = { 'export.json': json, 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) }
    const attachmentRows = await all('attachments')
    if (attachmentRows.length + 2 > MAX_IMPORT_ENTRIES) fail(413, '附件超过 500 个，无法生成单个本机 ZIP')
    let totalBytes = json.length + (files['manifest.json']?.length ?? 0)
    for (const row of attachmentRows) {
      const bytes = await readLocalAttachmentBytes(row)
      if (!bytes) fail(400, `附件“${asText(row.filename, '未命名')}”缺少本地文件，无法生成完整 ZIP`)
      if (bytes.length > MAX_IMPORT_ATTACHMENT_BYTES) fail(413, '附件超过 20 MB，无法包含在本机 ZIP 导出中')
      totalBytes += bytes.length
      if (totalBytes > MAX_IMPORT_TOTAL_BYTES) fail(413, '附件与数据展开后超过 250 MB，无法生成本机 ZIP')
      const archivePath = `attachments/${asNumber(row.id)}_${safeArchiveFilename(asText(row.filename, 'attachment.bin'))}`
      files[archivePath] = bytes
      manifest.attachment_files = [...manifest.attachment_files as unknown[], {
        attachment_id: row.id, filename: asText(row.filename), archive_path: archivePath,
        size: bytes.length, sha256: await sha256Hex(bytes),
      }]
    }
    files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    return shareZipFile('初记完整导出.zip', files)
  }
  const filename = fallbackFilename
  return shareTextFile(filename, JSON.stringify(data, null, 2), 'application/json')
}
export async function importLocalData(file: File): Promise<number> {
  attachmentMigration ??= migrateLegacyAttachments()
  await attachmentMigration
  await ensureAttachmentMigrationComplete()
  if (file.size > MAX_IMPORT_ARCHIVE_BYTES) fail(413, '导入文件不能超过 100 MB')
  let parsed: unknown
  let zipEntries: Record<string, Uint8Array> | null = null
  let manifest: Obj | null = null
  if (file.name.toLowerCase().endsWith('.zip')) {
    const archiveBytes = new Uint8Array(await file.arrayBuffer())
    validateZipEnvelope(archiveBytes)
    try { zipEntries = unzipSync(archiveBytes) } catch { fail(400, 'ZIP 文件损坏或格式不受支持') }
    const exportFile = zipEntries['export.json']
    if (!exportFile) fail(400, 'ZIP 中未找到 export.json 数据文件')
    try { parsed = JSON.parse(strFromU8(exportFile)) } catch { fail(400, 'ZIP 中的 JSON 数据无法解析') }
    const manifestBytes = zipEntries['manifest.json']
    if (!manifestBytes) fail(400, 'ZIP 中未找到 manifest.json 清单文件')
    try { manifest = bodyOf(JSON.parse(strFromU8(manifestBytes))) } catch { fail(400, 'ZIP 清单无法解析') }
    if (asNumber(manifest.format_version) !== 1 || !Array.isArray(manifest.attachment_files)) fail(400, 'ZIP 清单版本或附件列表无效')
  } else {
    try { parsed = JSON.parse(new TextDecoder().decode(await file.arrayBuffer())) } catch { fail(400, '无法识别该文件，请选择初记 JSON 或 ZIP 数据导出文件') }
  }
  const collections = importedCollections(bodyOf(parsed))
  if (!Object.keys(collections).length) fail(400, '文件中没有可导入的初记数据')
  const recoverySnapshot = await allData()
  const previousPaths = attachmentPaths(recoverySnapshot)
  const recoveryData = { ...recoverySnapshot }
  delete recoveryData.backups
  const recovery = await makeRecoveryBackup(`导入前备份-${now().replace(/[:.]/g, '-')}.json`, recoveryData)
  const stagedPaths: string[] = []
  if (zipEntries) {
    try {
      const attachments = collections.attachments ?? []
      const attachmentFiles = manifest?.attachment_files as Obj[]
      if (attachmentFiles.length > 500) fail(400, 'ZIP 附件数量超过 500 个')
      const ids = new Set<number>()
      const paths = new Set<string>()
      const archiveAttachmentPaths = Object.keys(zipEntries).filter((name) => name.startsWith('attachments/'))
      const stagedById = new Map<number, Obj>()
      for (const item of attachmentFiles) {
        const id = asNumber(item.attachment_id, -1)
        const archivePath = asText(item.archive_path)
        if (!Number.isInteger(id) || id <= 0 || ids.has(id) || paths.has(archivePath)) fail(400, 'ZIP 清单包含重复或无效的附件记录')
        ids.add(id); paths.add(archivePath)
        const bytes = zipEntries[archivePath]
        if (!bytes || !archiveAttachmentPaths.includes(archivePath)) fail(400, 'ZIP 清单引用了不存在的附件文件')
        if (bytes.length > MAX_IMPORT_ATTACHMENT_BYTES || (item.size !== undefined && asNumber(item.size, -1) !== bytes.length)) fail(400, 'ZIP 附件大小与清单不一致')
        const hash = await sha256Hex(bytes)
        if (item.sha256 && asText(item.sha256).toLowerCase() !== hash) fail(400, 'ZIP 附件 SHA256 校验失败')
        const metadata = attachments.map(bodyOf).find((row) => asNumber(row.id) === id)
        if (!metadata) fail(400, 'ZIP 清单中的附件在导出数据中不存在')
        if (item.filename && asText(item.filename) !== asText(metadata.filename)) fail(400, 'ZIP 清单与附件文件名不一致')
        const staged = await stageLocalAttachmentFile(asText(item.filename, asText(metadata.filename, 'attachment.bin')), bytes)
        stagedPaths.push(staged.local_path)
        stagedById.set(id, { ...metadata, ...staged, data_url: undefined })
      }
      if (archiveAttachmentPaths.some((name) => !paths.has(name))) fail(400, 'ZIP 包含未在清单中声明的附件文件')
      collections.attachments = attachments.map((raw) => {
        const row = bodyOf(raw)
        const staged = stagedById.get(asNumber(row.id))
        return staged ? { ...row, ...staged } : row
      })
    } catch (error) {
      for (const localPath of stagedPaths) await removeLocalAttachmentFile(localPath)
      throw error
    }
  }
  try {
    await save('backups', recovery)
    await replaceAllRows(collections, { preserveBackups: true })
    clearLocalAttachmentUrlCache()
    attachmentMigration = migrateLegacyAttachments()
    await attachmentMigration
    if ((await all('attachments')).some((item) => Boolean(item.data_url))) fail(400, '附件迁移失败，导入已回滚')
    await userProfile()
  } catch (error) {
    const newPaths = [...attachmentPaths(await allData())].filter((localPath) => !previousPaths.has(localPath))
    await replaceAllRows(recoverySnapshot)
    clearLocalAttachmentUrlCache()
    for (const localPath of new Set([...stagedPaths, ...newPaths])) await removeLocalAttachmentFile(localPath)
    attachmentMigration = null
    throw error
  }
  return Object.values(collections).reduce((count, rows) => count + rows.length, 0)
}

type ChatMessage = { role: string; content: unknown }
async function callModel(settings: Obj, kind: 'ai' | 'ocr', messages: ChatMessage[]): Promise<string> {
  const apiKey = asText(kind === 'ocr' ? settings.ocr_api_key || settings.ai_api_key : settings.ai_api_key).trim()
  const baseUrl = asText(kind === 'ocr' ? settings.ocr_base_url || settings.ai_base_url : settings.ai_base_url, 'https://api.openai.com/v1').trim().replace(/\/$/, '')
  const model = asText(kind === 'ocr' ? settings.ocr_model || settings.ai_model : settings.ai_model, 'gpt-4o-mini').trim()
  if (!apiKey) fail(400, '请先在“我的 → API Key 配置”中填写模型 Key；不填写时本地记录功能仍可离线使用。')
  if (!baseUrl || !model) fail(400, '请完善模型 Base URL 和模型名称')
  let parsedBaseUrl: URL
  try { parsedBaseUrl = new URL(baseUrl) } catch { fail(400, '模型 Base URL 格式无效') }
  const localDevHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsedBaseUrl.hostname)
  if (parsedBaseUrl.protocol !== 'https:' && !(import.meta.env.DEV && parsedBaseUrl.protocol === 'http:' && localDevHost)) {
    fail(400, '不允许通过非加密 HTTP 发送模型 Key 和个人数据。')
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password) fail(400, 'Base URL 不要包含用户名或密码')
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: kind === 'ocr' ? 0.1 : 0.5, max_tokens: kind === 'ocr' ? 1800 : 900 }),
    })
  } catch {
    fail(0, '模型连接失败，请检查网络、Base URL 和服务商跨域设置')
  }
  const text = await response.text()
  let data: Obj = {}
  try { data = bodyOf(text ? JSON.parse(text) : {}) } catch { /* use status below */ }
  if (!response.ok) fail(response.status, asText(data.error && bodyOf(data.error).message, `模型请求失败（${response.status}）`))
  const choices = Array.isArray(data.choices) ? data.choices as Obj[] : []
  const message = bodyOf(choices[0]?.message)
  const content = message.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const combined = content.map((part) => asText(bodyOf(part).text)).join('\n').trim()
    if (combined) return combined
  }
  fail(502, '模型没有返回可用文本')
}

async function importSchedulePhotoLocal(body: Obj): Promise<Obj> {
  const filename = asText(body.filename)
  const imageDataUrl = asText(body.image_data_url)
  if (!/\.(jpe?g|png|webp)$/i.test(filename)) fail(400, '仅支持 JPG / PNG / WebP 图片')
  if (!imageDataUrl.startsWith('data:image/')) fail(400, '图片内容无效')
  const settings = JSON.parse(await getMeta('api_settings') ?? '{}') as Obj
  const key = asText(settings.ocr_api_key || settings.ai_api_key)
  if (!key) return { ok: true, message: '图片识别需要联网模型。请先在“我的 → API Key 配置”中配置 AI/OCR Key。', imported: 0, items: [] }
  const model = asText(settings.ocr_model || settings.ai_model, 'gpt-4o-mini').toLowerCase()
  if (!/(gpt-4o|gpt-4-turbo|gpt-4\.1|claude|gemini|qwen.*vl|glm-4v|vision|multimodal)/.test(model)) {
    return { ok: true, message: '当前模型可能不支持图片识别，请改用支持视觉输入的模型。', imported: 0, items: [] }
  }
  const prompt = '请识别这张大学课表图片，输出严格 JSON 数组，不要 markdown。每项格式：{"name":"课程名","day":"周一/周二/...","periods":[1,2],"teacher":"老师","location":"教室"}。节次为 1-12，无法识别字段写空字符串。'
  const answer = await callModel(settings, 'ocr', [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] }])
  let parsed: unknown
  try { parsed = JSON.parse(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return { ok: true, message: 'OCR 识别结果无法解析，请手动添加课程。', imported: 0, items: [] } }
  if (!Array.isArray(parsed)) return { ok: true, message: 'OCR 未识别到课程，请手动添加。', imported: 0, items: [] }
  const days: Record<string, number> = { 周一: 0, 周二: 1, 周三: 2, 周四: 3, 周五: 4, 周六: 5, 周日: 6, 星期一: 0, 星期二: 1, 星期三: 2, 星期四: 3, 星期五: 4, 星期六: 5, 星期日: 6 }
  const periods: [string, string][] = [['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],['13:30','14:15'],['14:25','15:10'],['15:30','16:15'],['16:25','17:10'],['17:30','18:15'],['18:15','19:00'],['19:30','20:15'],['20:15','21:00']]
  const colors = ['#6B7A5A','#5A7A6B','#8B6B5A','#5A6B8B','#8B5A7A','#7A8B5A','#5A8B8B']
  const items: Obj[] = []
  for (const raw of parsed) {
    const item = bodyOf(raw), dayText = asText(item.day)
    const dow = days[dayText]
    const nums = Array.isArray(item.periods) ? item.periods.map((value) => asNumber(value)).filter((value) => value >= 1 && value <= 12) : []
    if (dow === undefined || !nums.length || !asText(item.name)) continue
    const first = Math.min(...nums), last = Math.max(...nums)
    items.push(await created('courses', { name: asText(item.name), teacher: asText(item.teacher) || null, location: asText(item.location) || null, day_of_week: dow, start_time: periods[first - 1][0], end_time: periods[last - 1][1], start_week: 1, end_week: 16, color: colors[dow], note: null }))
  }
  return { ok: true, message: items.length ? `已识别并导入 ${items.length} 门课程。` : 'OCR 未识别到有效课程，请手动添加。', imported: items.length, items }
}
