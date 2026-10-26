/** scores API operations. */
import type { EnhancedScoreCard, EnhancedScoreCreate } from './contracts/types'
import type { JsonBody } from './client'
import { apiRequest } from './client'

export async function listEnhancedScores(semester?: string): Promise<EnhancedScoreCard[]> {
  const params = semester ? `?semester=${encodeURIComponent(semester)}` : ''
  return apiRequest<EnhancedScoreCard[]>(`/api/scores${params}`)
}

export async function createEnhancedScore(payload: EnhancedScoreCreate): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>('/api/scores', { method: 'POST', body: payload as unknown as JsonBody })
}

export async function updateEnhancedScore(id: number, payload: Partial<EnhancedScoreCreate>): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>(`/api/scores/${id}`, { method: 'PUT', body: payload as unknown as JsonBody })
}

export async function deleteEnhancedScore(id: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/scores/${id}`, { method: 'DELETE' })
}

export async function analyzeScore(id: number): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>(`/api/scores/${id}/analyze`, { method: 'POST' })
}
