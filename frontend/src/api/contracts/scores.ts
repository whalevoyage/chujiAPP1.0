/** Shared scores DTOs for local and remote API providers. */

// ── 增强综测成绩 Enhanced Score Cards ──────────────────────

export type ScoreModule = {
  name: string
  score: number
  max_score: number
  note: string | null
}

export type EnhancedScoreCard = {
  id: number
  user_id: number
  title: string
  semester: string | null
  modules_json: string  // ScoreModule[]
  total_score: number | null
  note: string | null
  ai_analysis: string | null
  created_at: string
  updated_at: string
}

export type EnhancedScoreCreate = {
  title: string
  semester?: string | null
  modules: ScoreModule[]
  note?: string | null
}
