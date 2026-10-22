/** Shared schedule DTOs for local and remote API providers. */

// ── Course / 课表 ──────────────────────────────────────────

export type Course = {
  id: number
  user_id: number
  name: string
  teacher: string | null
  location: string | null
  day_of_week: number
  start_time: string
  end_time: string
  start_week: number | null
  end_week: number | null
  color: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type CourseCreate = {
  name: string
  teacher?: string | null
  location?: string | null
  day_of_week: number
  start_time: string
  end_time: string
  start_week?: number | null
  end_week?: number | null
  color?: string | null
  note?: string | null
}

export type CourseUpdate = Partial<CourseCreate>

export type IcsImportResponse = {
  ok: boolean
  imported: number
  items: Course[]
  error: string | null
}
