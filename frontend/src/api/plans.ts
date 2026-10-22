/** plans API operations. */
import type { DailyPlan, DailyPlanCreate, PlanStepCreate, PlanStep } from './contracts/types'
import type { JsonBody } from './client'
import { apiRequest } from './client'

// ── Plans API ──────────────────────────────────────────────

export async function getTodayPlans(): Promise<DailyPlan[]> {
  return apiRequest<DailyPlan[]>('/api/plans/today')
}

export async function getPlans(date?: string): Promise<DailyPlan[]> {
  const params = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiRequest<DailyPlan[]>(`/api/plans${params}`)
}

export async function getPlan(planId: number): Promise<DailyPlan> {
  return apiRequest<DailyPlan>(`/api/plans/${planId}`)
}

export async function createPlan(payload: DailyPlanCreate): Promise<DailyPlan> {
  return apiRequest<DailyPlan>('/api/plans', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updatePlan(planId: number, payload: Partial<DailyPlanCreate>): Promise<DailyPlan> {
  return apiRequest<DailyPlan>(`/api/plans/${planId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deletePlan(planId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/plans/${planId}`, {
    method: 'DELETE',
  })
}

export async function createStep(planId: number, payload: PlanStepCreate): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plans/${planId}/steps`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateStep(stepId: number, payload: Partial<PlanStepCreate>): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteStep(stepId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/plan-steps/${stepId}`, {
    method: 'DELETE',
  })
}

export async function startStep(stepId: number): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/start`, {
    method: 'POST',
  })
}

export async function completeStep(stepId: number): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/complete`, {
    method: 'POST',
  })
}

export async function delayStep(stepId: number, reason: string): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/delay`, {
    method: 'POST',
    body: { reason } as JsonBody,
  })
}

export async function skipStep(stepId: number, reason: string): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/skip`, {
    method: 'POST',
    body: { reason } as JsonBody,
  })
}

export async function getCurrentReminder(): Promise<PlanStep | null> {
  return apiRequest<PlanStep | null>('/api/reminders/current')
}

export async function getUpcomingReminders(): Promise<PlanStep[]> {
  return apiRequest<PlanStep[]>('/api/reminders/upcoming')
}
