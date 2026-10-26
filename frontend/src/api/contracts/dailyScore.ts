/** Shared dailyScore DTOs for local and remote API providers. */

// ── 每日状态汇总 Daily Score Summary ──────────────────────

export type DailyScoreSummary = {
  avg_7d: number | null
  avg_30d: number | null
  trend: 'up' | 'down' | 'stable'
  trend_text: string
  total_records: number
}
