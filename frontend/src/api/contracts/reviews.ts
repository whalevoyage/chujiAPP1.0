/** Shared reviews DTOs for local and remote API providers. */

// ── Review / Weakness API ─────────────────────────────────

export type WeaknessRecord = {
  id: number
  user_id: number
  title: string
  category: string
  severity: number
  occur_date: string
  occur_period: string | null
  behavior: string
  reason: string | null
  impact: string | null
  emotion: string | null
  correction: string | null
  prevention: string | null
  is_resolved: boolean
  review_count: number
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type WeaknessCreate = {
  title?: string | null
  category?: string
  severity?: number
  occur_date?: string | null
  occur_period?: string | null
  behavior: string
  reason?: string | null
  impact?: string | null
  emotion?: string | null
  correction?: string | null
  prevention?: string | null
  add_to_plan?: boolean
}

export type WeaknessUpdate = Partial<Omit<WeaknessCreate, 'add_to_plan'>> & {
  is_resolved?: boolean
}

export type ImprovementAction = {
  id: number
  user_id: number
  weakness_id: number
  title: string
  description: string | null
  difficulty: number
  estimated_minutes: number | null
  add_to_plan: boolean
  add_to_task: boolean
  status: string
  feedback: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type ImprovementActionCreate = {
  title: string
  description?: string | null
  difficulty?: number
  estimated_minutes?: number | null
  add_to_plan?: boolean
  add_to_task?: boolean
}

export type ImprovementActionUpdate = Partial<ImprovementActionCreate> & {
  status?: string
  feedback?: string | null
}

export type ReviewReport = {
  id: number
  user_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string | null
  ai_prompt: string | null
  ai_response: string | null
  final_content: string | null
  accepted: boolean
  next_actions: string | null
  created_at: string
  updated_at: string
}

export type ReviewGenerateRequest = {
  report_type: 'daily' | 'weekly' | 'monthly' | 'custom'
  start_date?: string | null
  end_date?: string | null
}

export type LocalReviewSummary = {
  report_type: string
  start_date: string
  end_date: string
  summary: Record<string, unknown>
  input_summary: string
}

export type AiReviewPrompt = {
  report_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string
  ai_prompt: string
  summary: Record<string, unknown>
}

export type SmartReviewSummary = {
  report_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string
  ai_summary: string | null
  summary_material: string | null
  ai_enabled: boolean
  message: string
}

export type ReviewSaveResponse = {
  report_id?: number | null
  report_type?: 'daily' | 'weekly' | 'monthly' | 'custom'
  start_date?: string | null
  end_date?: string | null
  ai_prompt?: string | null
  ai_response: string
  final_content?: string | null
  accepted?: boolean
  next_actions?: string | null
}

export type WeaknessFilters = {
  includeDeleted?: boolean
  category?: string
  severity?: number
  dateFrom?: string
  dateTo?: string
}
