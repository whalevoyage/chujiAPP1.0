/** Shared focus DTOs for local and remote API providers. */

// ── Focus / DailyScore ──────────────────────────────────────

export type FocusSession = {
  id: number
  user_id: number
  label: string | null
  status: string
  duration_seconds: number
  started_at: string
  ended_at: string | null
  created_at: string
}

export type FocusTotalsSummary = {
  total_sessions: number
  total_minutes: number
  sessions_today: number
  total_minutes_today: number
}

export type WeatherToday = {
  locationName: string
  adm1: string
  adm2: string
  text: string
  temp: number | null
  feelsLike: number | null
  windDir: string | null
  windScale: string | null
  humidity: number | null
  obsTime: string | null
  source: string
  rain_warning: string
  ok: boolean
}

export type CitySearchItem = {
  id: string
  name: string
  adm1: string
  adm2: string
  country: string
  displayName: string
}

export type WeatherLocationSave = {
  location_id: string
  location_name: string
  adm1: string
  adm2: string
}

export type DailyScore = {
  id: number
  user_id: number
  score_date: string
  score: number
  note: string | null
  created_at: string
  updated_at: string
}
