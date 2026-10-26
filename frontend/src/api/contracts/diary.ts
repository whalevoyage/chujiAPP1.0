/** Shared diary DTOs for local and remote API providers. */

// ── Diary API ──────────────────────────────────────────────

export type DiaryEntry = {
  id: number
  user_id: number
  title: string
  content_md: string
  mood: string | null
  entry_date: string
  is_starred: boolean
  is_private: boolean
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
}

export type DiaryCreate = {
  title?: string | null
  content_md: string
  mood?: string | null
  entry_date?: string | null
  is_starred?: boolean
  is_private?: boolean
  tags?: string[]
}

export type DiaryUpdate = {
  title?: string | null
  content_md?: string
  mood?: string | null
  entry_date?: string | null
  is_starred?: boolean
  is_private?: boolean
  tags?: string[]
}

export type Tag = {
  id: number
  user_id: number
  name: string
  color: string | null
  created_at: string
}

export type TagCreate = {
  name: string
  color?: string | null
}
