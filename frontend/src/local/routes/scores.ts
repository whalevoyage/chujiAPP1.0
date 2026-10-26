import type { LocalObject, LocalRouteContext, LocalRouteResult } from './types'
import { handledRoute, unhandledRoute } from './types'
import { ApiError } from '../../api-errors'

function calculateScore(
  items: LocalObject[],
  asNumber: LocalRouteContext['asNumber'],
  asText: LocalRouteContext['asText'],
): { totalScore: number; gpa: number } {
  const moduleNames = new Set(items.map((item) => item.name))
  if (moduleNames.has('合计')) {
    const totalScore = Math.round(asNumber(items.find((item) => item.name === '合计')?.score) * 100) / 100
    return { totalScore, gpa: 0 }
  }
  const weightedModules = ['10%', '65%', '20%', '5%'].some((prefix) =>
    items.some((item) => asText(item.name).startsWith(prefix)),
  )
  if (weightedModules) {
    const weights: Record<string, number> = {
      '10%基本素质': 0.1,
      '65%智育+体育': 0.65,
      '20%创新素质与实践能力': 0.2,
      '5%附件分': 0.05,
    }
    const totalScore = items.reduce((total, item) => total + asNumber(item.score) * (weights[asText(item.name)] ?? 0), 0)
    return { totalScore: Math.round(totalScore * 100) / 100, gpa: 0 }
  }
  const credits = items.reduce((total, item) => total + asNumber(item.credit, 1), 0)
  const weightedTotal = items.reduce((total, item) => total + asNumber(item.score) * asNumber(item.credit, 1), 0)
  const average = credits > 0 ? weightedTotal / credits : 0
  return { totalScore: Math.round(average * 10) / 10, gpa: average > 0 ? Math.round(average / 100 * 400) / 100 : 0 }
}

async function createScoreCard(context: LocalRouteContext, payload: LocalObject): Promise<LocalObject> {
  const items = Array.isArray(payload.modules) ? payload.modules as LocalObject[] : Array.isArray(payload.subjects) ? payload.subjects as LocalObject[] : []
  if (!items.length) throw new ApiError(400, '请至少填写一项成绩')
  const { totalScore, gpa } = calculateScore(items, context.asNumber, context.asText)
  return context.created('score_cards', {
    title: context.asText(payload.title),
    semester: payload.semester ?? null,
    subjects_json: JSON.stringify(items),
    modules_json: JSON.stringify(items),
    total_score: totalScore,
    gpa,
    note: payload.note ?? null,
    ai_analysis: null,
  })
}

async function updateScoreCard(context: LocalRouteContext, row: LocalObject, payload: LocalObject): Promise<LocalObject> {
  const items = Array.isArray(payload.modules) ? payload.modules as LocalObject[] : Array.isArray(payload.subjects) ? payload.subjects as LocalObject[] : null
  const next: LocalObject = { ...row, ...payload, updated_at: context.now() }
  if (items) {
    next.subjects_json = JSON.stringify(items)
    next.modules_json = JSON.stringify(items)
    const result = calculateScore(items, context.asNumber, context.asText)
    next.total_score = result.totalScore
    next.gpa = result.gpa
  }
  if (!next.modules_json) next.modules_json = context.asText(next.subjects_json, '[]')
  return context.save('score_cards', next)
}

export async function handleScoreRoutes(context: LocalRouteContext): Promise<LocalRouteResult> {
  const { path: p, method, body, query, idAt, segments } = context
  const { all, byId, deleteRow, analyzeScore } = context
  if (p === '/api/scores' && method === 'GET') {
    return handledRoute((await all('score_cards')).filter((row) => !query.get('semester') || row.semester === query.get('semester')))
  }
  if (p === '/api/scores' && method === 'POST') {
    return handledRoute(await createScoreCard(context, body))
  }
  if (!p.startsWith('/api/scores/')) return unhandledRoute

  const id = idAt(2)
  const action = segments[3]
  const row = await byId('score_cards', id, '成绩卡')
  if (action === 'analyze' && method === 'POST') return handledRoute(await analyzeScore(row))
  if (method === 'PUT') return handledRoute(await updateScoreCard(context, row, body))
  if (method === 'DELETE') {
    await deleteRow('score_cards', id)
    return handledRoute({ ok: true })
  }
  return unhandledRoute
}
