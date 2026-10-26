import type { LocalRouteContext, LocalRouteResult } from './types'
import { handledRoute, unhandledRoute } from './types'

export async function handleTaskRoutes(context: LocalRouteContext): Promise<LocalRouteResult> {
  const { path: p, method, body, segments } = context
  const { all, asNumber, asText, today, idAt, taskResponse, created, dateInRange, byId, save, now, deleteRow } = context
  if (!p.startsWith('/api/tasks')) return unhandledRoute

  const tasks = await all('tasks')
  if (p === '/api/tasks/today' || p === '/api/tasks') {
    const rows = tasks.filter((task) => task.is_active !== false)
    if (method === 'POST') return handledRoute(await taskResponse(await created('tasks', body, {
      title: '新任务', is_active: true, priority: 0, sort_order: tasks.length,
    })))
    rows.sort((left, right) => asNumber(left.sort_order) - asNumber(right.sort_order) || asNumber(right.priority) - asNumber(left.priority))
    return handledRoute(await Promise.all(rows.map(taskResponse)))
  }
  if (p === '/api/tasks/stats' || p === '/api/tasks/stats/total') {
    const logs = await all('task_logs')
    const relevant = logs.filter((log) => p.endsWith('/total') || log.log_date === today())
    const completed = relevant.filter((log) => log.status === 'completed').length
    const rate = relevant.length ? completed / relevant.length : 0
    const encouragement = rate <= 0 ? '今天刚开始' : rate < .5 ? '慢慢来，先完成一件' : rate < .9 ? '进度不错' : '今天很稳'
    return handledRoute(p.endsWith('/total')
      ? { total_tasks: tasks.length, total_completed: completed, completion_rate: rate, encouragement }
      : { total: tasks.filter((task) => task.is_active !== false).length, completed_today: completed, completion_rate: rate, encouragement })
  }
  if (p === '/api/tasks/streak') {
    const days = [...new Set((await all('task_logs')).filter((log) => log.status === 'completed').map((log) => asText(log.log_date)))].sort().reverse()
    let streak = 0
    const cursor = new Date(`${today()}T12:00:00`)
    for (const day of days) {
      if (day !== `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`) break
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return handledRoute({ streak, today_done: days.includes(today()) })
  }
  if (p === '/api/tasks/weekly-summary') {
    const start = new Date()
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const startDate = format(start)
    const endDate = format(end)
    const logs = (await all('task_logs')).filter((log) => dateInRange(log.log_date, startDate, endDate) && log.status === 'completed')
    const steps = (await all('plan_steps')).filter((step) => step.status === 'completed' && asText(step.completed_at) >= startDate)
    const sessions = (await all('focus_sessions')).filter((session) => asText(session.started_at) >= startDate && asText(session.started_at) <= `${endDate}T23:59:59` && session.status === 'completed')
    const daily: Record<string, number> = {}
    for (const log of logs) daily[asText(log.log_date)] = (daily[asText(log.log_date)] ?? 0) + 1
    return handledRoute({
      week_start: startDate,
      week_end: endDate,
      tasks_completed: logs.length,
      steps_completed: steps.length,
      focus_sessions: sessions.length,
      focus_minutes: Math.floor(sessions.reduce((total, session) => total + asNumber(session.duration_seconds), 0) / 60),
      daily_completion: daily,
    })
  }

  const id = idAt(2)
  const action = segments[3]
  if (method === 'GET') return handledRoute(await taskResponse(tasks.find((task) => asNumber(task.id) === id) ?? context.notFound('任务')))
  if (method === 'PUT') {
    const row = await byId('tasks', id, '任务')
    return handledRoute(await taskResponse(await save('tasks', { ...row, ...body, id, updated_at: now() })))
  }
  if (method === 'DELETE') {
    await deleteRow('tasks', id)
    return handledRoute({ ok: true })
  }
  if (method === 'POST' && action === 'checkin') {
    const old = (await all('task_logs')).find((log) => asNumber(log.task_id) === id && log.log_date === today() && !log.is_makeup)
    if (old) return handledRoute(old)
    return handledRoute(await created('task_logs', { ...body, task_id: id, log_date: today(), status: 'completed', is_makeup: false, makeup_reason: null }))
  }
  if (method === 'POST' && action === 'undo-checkin') {
    const old = (await all('task_logs')).find((log) => asNumber(log.task_id) === id && log.log_date === today() && !log.is_makeup)
    if (old) await deleteRow('task_logs', asNumber(old.id))
    return handledRoute({ ok: true })
  }
  if (method === 'POST' && action === 'makeup') {
    return handledRoute(await created('task_logs', { ...body, task_id: id, status: 'completed', is_makeup: true }))
  }
  return unhandledRoute
}
