/** Shared timeline DTOs for local and remote API providers. */

// ── 成长时间线 ──────────────────────────────────────────────

export type TimelineEvent = {
  id: number
  date: string
  type: 'honor' | 'project' | 'memory' | 'milestone'
  title: string
  description: string | null
}
