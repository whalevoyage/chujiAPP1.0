/** Shared plans DTOs for local and remote API providers. */

// ── DailyPlan ──────────────────────────────────────────────

export type DailyPlan = {
  id: number
  user_id: number
  plan_date: string
  title: string
  main_goal: string | null
  note: string | null
  status: string
  created_at: string
  updated_at: string
  steps: PlanStep[]
  total_steps: number
  completed_steps: number
  progress: number
}

export type PlanStep = {
  id: number
  user_id: number
  plan_id: number
  title: string
  description: string | null
  start_time: string
  end_time: string
  remind_time: string | null
  remind_before_minutes: number | null
  priority: number
  enable_reminder: boolean
  linked_task_id: number | null
  sort_order: number
  status: string
  completed_at: string | null
  delay_reason: string | null
  skip_reason: string | null
  created_at: string
  updated_at: string
}

export type DailyPlanCreate = {
  plan_date: string
  title: string
  main_goal?: string | null
  note?: string | null
}

export type PlanStepCreate = {
  title: string
  description?: string | null
  start_time: string
  end_time: string
  remind_time?: string | null
  remind_before_minutes?: number | null
  priority?: number
  enable_reminder?: boolean
  linked_task_id?: number | null
  sort_order?: number
}

export type StepActionRequest = {
  reason: string
}
