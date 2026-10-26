/** Shared memories DTOs for local and remote API providers. */

import type { Attachment } from './honors'

// ── 回忆图片墙 Memories ─────────────────────────────────────

export type Memory = {
  id: number
  user_id: number
  title: string
  photo_date: string | null
  location: string | null
  story: string | null
  tags: string[]
  created_at: string
  updated_at: string
  attachment_count: number
  attachments: Attachment[]
}

export type MemoryCreate = {
  title: string
  photo_date?: string | null
  location?: string | null
  story?: string | null
  tags?: string[]
}

export type MemoryUpdate = Partial<MemoryCreate>
