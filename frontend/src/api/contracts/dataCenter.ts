/** Shared dataCenter DTOs for local and remote API providers. */

// ── 数据中心 ────────────────────────────────────────────────

export type DataCenterStats = {
  task_completion_rate: number
  total_focus_sessions: number
  total_focus_minutes: number
  total_courses: number
  total_honors: number
  total_projects: number
  total_memories: number
  total_diary_entries: number
}
