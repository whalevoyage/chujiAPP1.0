/** dataCenter API operations. */
import type { DailyScoreSummary, DataCenterStats, TimelineEvent } from './contracts/types'
import { apiRequest } from './client'

export async function getDailyScoreSummary(): Promise<DailyScoreSummary> {
  return apiRequest<DailyScoreSummary>('/api/daily-score/summary')
}

export async function getDataCenterStats(): Promise<DataCenterStats> {
  return apiRequest<DataCenterStats>('/api/data-center/stats')
}

export async function getTimeline(limit?: number): Promise<TimelineEvent[]> {
  const params = limit ? `?limit=${limit}` : ''
  return apiRequest<TimelineEvent[]>(`/api/timeline${params}`)
}
