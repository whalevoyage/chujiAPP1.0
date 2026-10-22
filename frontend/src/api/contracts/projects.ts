/** Shared projects DTOs for local and remote API providers. */

import type { Attachment } from './honors'

// ── 项目库 Projects ─────────────────────────────────────────

export type Project = {
  id: number
  user_id: number
  name: string
  project_type: string | null
  start_date: string | null
  status: string
  tech_stack: string | null
  summary: string | null
  link: string | null
  achievements: string | null
  next_plan: string | null
  created_at: string
  updated_at: string
  attachment_count: number
  attachments: Attachment[]
}

export type ProjectCreate = {
  name: string
  project_type?: string | null
  start_date?: string | null
  status?: string
  tech_stack?: string | null
  summary?: string | null
  link?: string | null
  achievements?: string | null
  next_plan?: string | null
}

export type ProjectUpdate = Partial<ProjectCreate>
