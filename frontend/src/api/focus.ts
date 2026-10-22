/** focus API operations. */
import type { FocusSession, FocusTotalsSummary, WeatherToday, CitySearchItem, WeatherLocationSave, DailyScore } from './contracts/types'
import type { JsonBody } from './client'
import { apiRequest } from './client'

export async function startFocus(label?: string | null, plannedMinutes?: number): Promise<FocusSession> {
  return apiRequest<FocusSession>('/api/focus/start', {
    method: 'POST',
    body: { label, planned_minutes: plannedMinutes ?? 25 } as JsonBody,
  })
}

export async function endFocus(sessionId: number, durationSeconds: number): Promise<FocusSession> {
  return apiRequest<FocusSession>(`/api/focus/${sessionId}/end`, {
    method: 'POST',
    body: { duration_seconds: durationSeconds } as JsonBody,
  })
}

export async function getFocusTotals(): Promise<FocusTotalsSummary> {
  return apiRequest<FocusTotalsSummary>('/api/focus/totals')
}

export async function getTodayWeather(): Promise<WeatherToday> {
  return apiRequest<WeatherToday>('/api/weather/today')
}

export async function searchCity(keyword: string): Promise<CitySearchItem[]> {
  return apiRequest<CitySearchItem[]>(`/api/weather/search?keyword=${encodeURIComponent(keyword)}`)
}

export async function saveWeatherLocation(payload: WeatherLocationSave): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/weather/location', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function saveDailyScore(score: number, note?: string | null): Promise<DailyScore> {
  return apiRequest<DailyScore>('/api/daily-score', {
    method: 'POST',
    body: { score, note } as JsonBody,
  })
}

export async function getTodayScore(): Promise<DailyScore | null> {
  return apiRequest<DailyScore | null>('/api/daily-score/today')
}
