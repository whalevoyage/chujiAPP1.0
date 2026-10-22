/** Shared honors DTOs for local and remote API providers. */

// ── Honors / Attachments ───────────────────────────────────

export type Attachment = {
  id: number
  user_id: number
  owner_type: string
  owner_id: number
  filename: string
  mime_type: string | null
  size: number
  sha256: string
  created_at: string
}

export type Honor = {
  id: number
  user_id: number
  title: string
  honor_type: string
  level: string | null
  issuer: string | null
  award_date: string | null
  role: string | null
  weight: number
  resume_ready: boolean
  is_featured: boolean
  description: string | null
  created_at: string
  updated_at: string
  attachment_count: number
  attachments: Attachment[]
}

export type HonorCreate = {
  title: string
  honor_type: string
  level?: string | null
  issuer?: string | null
  award_date?: string | null
  role?: string | null
  weight?: number
  resume_ready?: boolean
  is_featured?: boolean
  description?: string | null
}

export type HonorUpdate = Partial<HonorCreate>

export type HonorFilters = {
  honorType?: string
  level?: string
  resumeReady?: boolean | null
  q?: string
}
