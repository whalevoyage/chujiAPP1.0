/** reviews API operations. */
import type { JsonBody } from './client'
import type { WeaknessFilters, WeaknessRecord, WeaknessCreate, WeaknessUpdate, ImprovementAction, ImprovementActionCreate, ImprovementActionUpdate, ReviewGenerateRequest, LocalReviewSummary, AiReviewPrompt, SmartReviewSummary, ReviewSaveResponse, ReviewReport } from './contracts/types'
import { apiRequest } from './client'

export async function listWeaknesses(filters: WeaknessFilters = {}): Promise<WeaknessRecord[]> {
  const params = new URLSearchParams()
  if (filters.includeDeleted) params.set('include_deleted', 'true')
  if (filters.category) params.set('category', filters.category)
  if (filters.severity !== undefined) params.set('severity', String(filters.severity))
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiRequest<WeaknessRecord[]>(`/api/weaknesses${suffix}`)
}

export async function createWeakness(payload: WeaknessCreate): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>('/api/weaknesses', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function getWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}`)
}

export async function updateWeakness(
  weaknessId: number,
  payload: WeaknessUpdate,
): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteWeakness(weaknessId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/weaknesses/${weaknessId}`, {
    method: 'DELETE',
  })
}

export async function resolveWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}/resolve`, {
    method: 'POST',
  })
}

export async function restoreWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}/restore`, {
    method: 'POST',
  })
}

export async function listImprovementActions(weaknessId: number): Promise<ImprovementAction[]> {
  return apiRequest<ImprovementAction[]>(`/api/weaknesses/${weaknessId}/actions`)
}

export async function createImprovementAction(
  weaknessId: number,
  payload: ImprovementActionCreate,
): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/weaknesses/${weaknessId}/actions`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateImprovementAction(
  actionId: number,
  payload: ImprovementActionUpdate,
): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/improvement-actions/${actionId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function completeImprovementAction(actionId: number): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/improvement-actions/${actionId}/complete`, {
    method: 'POST',
  })
}

export async function addImprovementActionToPlan(actionId: number): Promise<{ ok: boolean; plan_id: number; step_id: number }> {
  return apiRequest<{ ok: boolean; plan_id: number; step_id: number }>(
    `/api/improvement-actions/${actionId}/add-to-plan`,
    { method: 'POST' },
  )
}

export async function addImprovementActionToTask(actionId: number): Promise<{ ok: boolean; task_id: number }> {
  return apiRequest<{ ok: boolean; task_id: number }>(
    `/api/improvement-actions/${actionId}/add-to-task`,
    { method: 'POST' },
  )
}

export async function generateLocalReviewSummary(
  payload: ReviewGenerateRequest,
): Promise<LocalReviewSummary> {
  return apiRequest<LocalReviewSummary>('/api/reviews/generate-local-summary', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function generateAiReviewPrompt(payload: ReviewGenerateRequest): Promise<AiReviewPrompt> {
  return apiRequest<AiReviewPrompt>('/api/reviews/generate-ai-prompt', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function generateSmartReviewSummary(payload: ReviewGenerateRequest): Promise<SmartReviewSummary> {
  return apiRequest<SmartReviewSummary>('/api/reviews/generate-smart-summary', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function saveAiReviewResponse(payload: ReviewSaveResponse): Promise<ReviewReport> {
  return apiRequest<ReviewReport>('/api/reviews/save-ai-response', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function listReviewReports(): Promise<ReviewReport[]> {
  return apiRequest<ReviewReport[]>('/api/reviews')
}

export async function getReviewReport(reportId: number): Promise<ReviewReport> {
  return apiRequest<ReviewReport>(`/api/reviews/${reportId}`)
}

export async function updateReviewReport(
  reportId: number,
  payload: Partial<Pick<ReviewReport, 'ai_response' | 'final_content' | 'accepted' | 'next_actions'>>,
): Promise<ReviewReport> {
  return apiRequest<ReviewReport>(`/api/reviews/${reportId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteReviewReport(reportId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/reviews/${reportId}`, { method: 'DELETE' })
}
