import type { LocalRouteContext, LocalRouteResult } from './types'
import { handledRoute, unhandledRoute } from './types'

export async function handlePlanRoutes(context: LocalRouteContext): Promise<LocalRouteResult> {
  const { path: p, method, body, segments, query: q } = context
  const { all, asNumber, asText, today, idAt, planResponse, created, byId, save, now, notFound, deleteRow, stepsForPlan, refreshLocalPlanStatus } = context

  if (p === '/api/plans/today' || p === '/api/plans' || /^\/api\/plans\/\d+$/.test(p)) {
    const plans = await all('daily_plans')
    if (segments.length === 3 && /^\d+$/.test(segments[2])) {
      const plan = plans.find((item) => asNumber(item.id) === idAt(2))
      return handledRoute(await planResponse(plan ?? notFound('计划')))
    }
    if (method === 'GET') {
      const date = p.endsWith('/today') ? today() : q.get('date')
      const rows = plans.filter((item) => !date || item.plan_date === date)
        .sort((left, right) => asText(left.plan_date).localeCompare(asText(right.plan_date)))
      return handledRoute(await Promise.all(rows.map(planResponse)))
    }
    if (method === 'POST') return handledRoute(await planResponse(await created('daily_plans', body, {
      plan_date: today(), title: '今日计划', main_goal: null, note: null, status: 'active',
    })))
    if (method === 'PUT') {
      const id = idAt(2)
      const row = await byId('daily_plans', id, '计划')
      return handledRoute(await planResponse(await save('daily_plans', { ...row, ...body, id, updated_at: now() })))
    }
    if (method === 'DELETE') {
      const id = idAt(2)
      await deleteRow('daily_plans', id)
      for (const step of await stepsForPlan(id)) await deleteRow('plan_steps', asNumber(step.id))
      return handledRoute({ ok: true })
    }
    return unhandledRoute
  }

  const stepCreate = p.match(/^\/api\/plans\/(\d+)\/steps$/)
  if (stepCreate && method === 'POST') {
    const planId = Number(stepCreate[1])
    const step = await created('plan_steps', { ...body, plan_id: planId }, {
      title: '新步骤', start_time: '09:00', end_time: '10:00', status: 'pending', priority: 0,
      sort_order: (await stepsForPlan(planId)).length,
    })
    await refreshLocalPlanStatus(planId)
    return handledRoute(step)
  }

  if (p === '/api/plan-steps' || p.startsWith('/api/plan-steps/')) {
    const id = idAt(2)
    const action = segments[3]
    if (method === 'GET') return handledRoute(await stepsForPlan(id))
    if (method === 'POST' && action === 'steps') {
      const step = await created('plan_steps', { ...body, plan_id: id }, {
        title: '新步骤', start_time: '09:00', end_time: '10:00', status: 'pending', priority: 0, sort_order: 0,
      })
      await refreshLocalPlanStatus(id)
      return handledRoute(step)
    }
    const row = await byId('plan_steps', id, '计划步骤')
    if (method === 'DELETE') {
      await deleteRow('plan_steps', id)
      await refreshLocalPlanStatus(asNumber(row.plan_id))
      return handledRoute({ ok: true })
    }
    if (method === 'PUT') {
      const updated = await save('plan_steps', { ...row, ...body, id, updated_at: now() })
      await refreshLocalPlanStatus(asNumber(row.plan_id))
      return handledRoute(updated)
    }
    if (method === 'POST') {
      const status = action === 'complete' ? 'completed'
        : action === 'start' ? 'in_progress'
          : action === 'skip' ? 'skipped'
            : action === 'delay' ? 'delayed' : asText(row.status)
      const updated = {
        ...row,
        status,
        completed_at: status === 'completed' ? now() : row.completed_at,
        delay_reason: action === 'delay' ? body.reason : row.delay_reason,
        skip_reason: action === 'skip' ? body.reason : row.skip_reason,
        updated_at: now(),
      }
      const saved = await save('plan_steps', updated)
      await refreshLocalPlanStatus(asNumber(row.plan_id))
      return handledRoute(saved)
    }
    return unhandledRoute
  }

  if (p === '/api/reminders/current' || p === '/api/reminders/upcoming') {
    const rows = (await all('plan_steps')).filter((item) => item.enable_reminder && item.status === 'pending')
      .sort((left, right) => asText(left.start_time).localeCompare(asText(right.start_time)))
    return handledRoute(p.endsWith('/current') ? rows[0] ?? null : rows)
  }

  return unhandledRoute
}
