import type { LocalObject, LocalRouteContext, LocalRouteResult } from './types'
import { handledRoute, unhandledRoute } from './types'

export async function handleReviewRoutes(context: LocalRouteContext): Promise<LocalRouteResult> {
  const { path: p, method, body, segments, query: q, idAt } = context
  const { all, asNumber, asText, today, now, dateInRange, byId, created, save, deleteRow, getRow, getMeta, callModel } = context

  if (p === '/api/weaknesses' && method === 'GET') {
    return handledRoute((await all('weakness_records')).filter((row) => (q.get('include_deleted') === 'true' || !row.is_deleted)
      && (!q.get('category') || row.category === q.get('category'))
      && (!q.get('severity') || asNumber(row.severity) === asNumber(q.get('severity')))
      && dateInRange(row.occur_date, q.get('date_from') ?? undefined, q.get('date_to') ?? undefined)))
  }
  if (p === '/api/weaknesses' && method === 'POST') {
    return handledRoute(await created('weakness_records', {
      ...body,
      title: body.title || '待改进问题',
      category: body.category || '其他',
      severity: asNumber(body.severity, 5),
      occur_date: body.occur_date || today(),
      is_resolved: false,
      review_count: 0,
      is_deleted: false,
      deleted_at: null,
    }))
  }
  if (p.startsWith('/api/weaknesses/')) {
    const id = idAt(2)
    const action = segments[3]
    const row = await byId('weakness_records', id, '问题记录')
    if (action === 'actions') {
      if (method === 'GET') return handledRoute((await all('improvement_actions')).filter((item) => asNumber(item.weakness_id) === id))
      if (method === 'POST') return handledRoute(await created('improvement_actions', {
        ...body,
        weakness_id: id,
        status: '未执行',
        completed_at: null,
      }, { difficulty: 5, add_to_plan: false, add_to_task: false }))
    }
    if (method === 'GET') return handledRoute(row)
    if (method === 'PUT') return handledRoute(await save('weakness_records', { ...row, ...body, id, updated_at: now() }))
    if (method === 'DELETE') {
      await save('weakness_records', { ...row, is_deleted: true, deleted_at: now(), updated_at: now() })
      return handledRoute({ ok: true })
    }
    if (method === 'POST' && action === 'resolve') {
      return handledRoute(await save('weakness_records', { ...row, is_resolved: true, review_count: asNumber(row.review_count) + 1, updated_at: now() }))
    }
    if (method === 'POST' && action === 'restore') {
      return handledRoute(await save('weakness_records', { ...row, is_deleted: false, deleted_at: null, updated_at: now() }))
    }
    return unhandledRoute
  }
  if (p.startsWith('/api/improvement-actions/')) {
    const id = idAt(2)
    const action = segments[3]
    const row = await byId('improvement_actions', id, '改进动作')
    if (method === 'PUT') return handledRoute(await save('improvement_actions', { ...row, ...body, id, updated_at: now() }))
    if (method === 'POST' && action === 'complete') {
      return handledRoute(await save('improvement_actions', { ...row, status: '已完成', completed_at: now(), updated_at: now() }))
    }
    if (method === 'POST' && action === 'add-to-plan') {
      const plan = await created('daily_plans', { title: '改进计划', main_goal: row.title, plan_date: today() }, { status: 'active' })
      const step = await created('plan_steps', { plan_id: plan.id, title: row.title, description: row.description, start_time: '09:00', end_time: '09:30' }, { status: 'pending', sort_order: 0 })
      return handledRoute({ ok: true, plan_id: plan.id, step_id: step.id })
    }
    if (method === 'POST' && action === 'add-to-task') {
      const task = await created('tasks', { title: row.title, category: '改进', task_type: '改进动作' }, { is_active: true, priority: 0, sort_order: (await all('tasks')).length })
      return handledRoute({ ok: true, task_id: task.id })
    }
    return unhandledRoute
  }

  if (!p.startsWith('/api/reviews')) return unhandledRoute
  if (p === '/api/reviews' && method === 'GET') return handledRoute(await all('review_reports'))
  if (p === '/api/reviews/generate-local-summary' || p === '/api/reviews/generate-ai-prompt' || p === '/api/reviews/generate-smart-summary') {
    const reportType = asText(body.report_type, 'weekly')
    const endDate = asText(body.end_date, today())
    const defaultStart = reportType === 'daily'
      ? endDate
      : reportType === 'monthly'
        ? `${endDate.slice(0, 7)}-01`
        : (() => {
            const date = new Date(`${endDate}T12:00:00`)
            date.setDate(date.getDate() - 6)
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          })()
    const startDate = asText(body.start_date, defaultStart)
    const logs = (await all('task_logs')).filter((row) => dateInRange(row.log_date, startDate, endDate))
    const plans = (await all('daily_plans')).filter((row) => dateInRange(row.plan_date, startDate, endDate))
    const focus = (await all('focus_sessions')).filter((row) => asText(row.started_at).slice(0, 10) >= startDate && asText(row.started_at).slice(0, 10) <= endDate)
    const diaries = (await all('diary_entries')).filter((row) => !row.is_deleted && dateInRange(row.entry_date, startDate, endDate))
    const weaknesses = (await all('weakness_records')).filter((row) => !row.is_deleted && dateInRange(row.occur_date, startDate, endDate))
    const weaknessIds = new Set(weaknesses.map((row) => asNumber(row.id)))
    const actions = (await all('improvement_actions')).filter((row) => weaknessIds.has(asNumber(row.weakness_id)))
    const summary = {
      task_logs: logs.length,
      tasks_completed: logs.filter((row) => row.status === 'completed').length,
      plans: plans.length,
      focus_sessions: focus.length,
      focus_minutes: Math.floor(focus.reduce((total, row) => total + asNumber(row.duration_seconds), 0) / 60),
      diary_entries: diaries.length,
      weakness_count: weaknesses.length,
      completed_actions: actions.filter((row) => row.status === '已完成').map((row) => ({ id: row.id, title: row.title })),
      unfinished_actions: actions.filter((row) => row.status !== '已完成').map((row) => ({ id: row.id, title: row.title, status: row.status })),
    }
    const inputSummary = `复盘区间：${startDate} 至 ${endDate}。完成任务打卡 ${summary.tasks_completed} 次，创建计划 ${summary.plans} 个，专注 ${summary.focus_minutes} 分钟，记录日记 ${summary.diary_entries} 篇。`
    if (p.endsWith('generate-local-summary')) return handledRoute({ report_type: reportType, start_date: startDate, end_date: endDate, summary, input_summary: inputSummary })
    const aiPrompt = `请根据以下数据生成${reportType === 'daily' ? '每日' : reportType === 'monthly' ? '月度' : '周度'}复盘建议：\n\n${inputSummary}`
    if (p.endsWith('generate-ai-prompt')) {
      const report = await created('review_reports', { report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, ai_response: null, final_content: null, accepted: false, next_actions: null })
      return handledRoute({ report_id: report.id, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, summary })
    }
    const settings = JSON.parse(await getMeta('api_settings') ?? '{}') as LocalObject
    if (settings.ai_api_key) {
      const aiSummary = await callModel(settings, 'ai', [
        { role: 'system', content: '你是个人成长复盘助手。根据数据给出简洁、具体、可执行的中文建议。' },
        { role: 'user', content: aiPrompt },
      ])
      const report = await created('review_reports', { report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_prompt: aiPrompt, ai_response: aiSummary, final_content: aiSummary, accepted: true, next_actions: null })
      return handledRoute({ report_id: report.id, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_summary: aiSummary, summary_material: null, ai_enabled: true, message: '智能总结已生成并保存在本机' })
    }
    return handledRoute({ report_id: null, report_type: reportType, start_date: startDate, end_date: endDate, input_summary: inputSummary, ai_summary: null, summary_material: aiPrompt, ai_enabled: false, message: '本机模式下复盘统计可离线使用；AI 总结需要联网并配置模型服务。' })
  }
  if (p === '/api/reviews/save-ai-response' && method === 'POST') {
    const id = asNumber(body.report_id)
    const existing = id ? await getRow('review_reports', id) : null
    const row = existing
      ? await save('review_reports', { ...existing, ...body, id, updated_at: now() })
      : await created('review_reports', { ...body, report_type: body.report_type || 'weekly', start_date: body.start_date || today(), end_date: body.end_date || today() }, { accepted: false })
    return handledRoute(row)
  }
  if (p === '/api/reviews/document' && method === 'POST') return handledRoute({ ok: false, message: '文档生成需要联网服务' })
  const id = idAt(2)
  const row = await byId('review_reports', id, '复盘报告')
  if (method === 'GET') return handledRoute(row)
  if (method === 'PUT') return handledRoute(await save('review_reports', { ...row, ...body, id, updated_at: now() }))
  if (method === 'DELETE') {
    await deleteRow('review_reports', id)
    return handledRoute({ ok: true })
  }
  return unhandledRoute
}
