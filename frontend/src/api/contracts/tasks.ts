/** Shared tasks DTOs for local and remote API providers. */

// ── Task ──────────────────────────────────────────────────

export type Task = {
  id: number
  user_id: number
  title: string
  category: string | null
  task_type: string | null
  frequency: string | null
  priority: number
  weight: number | null
  estimated_minutes: number | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  checked_in: boolean
  today_log: TaskLog | null
}

export type TaskCreate = {
  title: string
  category?: string | null
  task_type?: string | null
  frequency?: string | null
  priority?: number
  weight?: number | null
  estimated_minutes?: number | null
  is_active?: boolean
  sort_order?: number
}

export type TaskUpdate = {
  title?: string
  category?: string | null
  task_type?: string | null
  frequency?: string | null
  priority?: number
  weight?: number | null
  estimated_minutes?: number | null
  is_active?: boolean
  sort_order?: number
}

export type TaskCheckinRequest = {
  note?: string | null
  minutes?: number | null
  difficulty?: number | null
}

export type TaskMakeupRequest = {
  log_date: string
  note?: string | null
  minutes?: number | null
  difficulty?: number | null
  reason: string
}

export type TaskLog = {
  id: number
  user_id: number
  task_id: number
  log_date: string
  status: string
  note: string | null
  minutes: number | null
  difficulty: number | null
  is_makeup: boolean
  makeup_reason: string | null
  created_at: string
  updated_at: string
}

export type TaskStats = {
  total: number
  completed_today: number
  completion_rate: number
  encouragement: string
}

export type TotalStats = {
  total_tasks: number
  total_completed: number
  completion_rate: number
  encouragement: string
}

export type Streak = { streak: number; today_done: boolean }

export type WeeklySummary = {
  week_start: string; week_end: string
  tasks_completed: number; steps_completed: number
  focus_sessions: number; focus_minutes: number
  daily_completion: Record<string, number>
}
