// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImprovementAction, WeaknessRecord } from '../../api'
import { ActionCard, WeaknessCard } from './components'

const weakness = {
  id: 12,
  title: '复盘拖延',
  category: '拖延',
  severity: 7,
  occur_date: '2026-10-22',
  occur_period: null,
  behavior: '临近截止才开始写作业',
  reason: null,
  impact: null,
  emotion: null,
  correction: null,
  prevention: null,
  is_resolved: false,
  review_count: 0,
  is_deleted: false,
  deleted_at: null,
  user_id: 2,
  created_at: '2026-10-22T09:00:00',
  updated_at: '2026-10-22T09:00:00',
} satisfies WeaknessRecord

const action = {
  id: 15,
  user_id: 2,
  weakness_id: weakness.id,
  title: '先写作业提纲',
  description: '用二十分钟列出主要观点',
  difficulty: 4,
  estimated_minutes: 20,
  add_to_plan: false,
  add_to_task: false,
  status: '未执行',
  feedback: null,
  completed_at: null,
  created_at: '2026-10-22T09:00:00',
  updated_at: '2026-10-22T09:00:00',
} satisfies ImprovementAction

describe('Review cards', () => {
  it('opens the improvement-action flow for a weakness', () => {
    const onAction = vi.fn()
    render(
      <WeaknessCard
        record={weakness}
        onEdit={vi.fn()}
        onResolve={vi.fn(async () => undefined)}
        onAction={onAction}
        onRestore={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '添加措施' }))
    expect(onAction).toHaveBeenCalledWith(weakness)
  })

  it('completes an improvement action', () => {
    const onComplete = vi.fn(async () => undefined)
    render(
      <ActionCard
        action={action}
        onComplete={onComplete}
        onAddToPlan={vi.fn(async () => undefined)}
        onAddToTask={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onComplete).toHaveBeenCalledWith(action)
  })
})
