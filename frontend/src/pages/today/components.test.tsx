// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScheduleCard } from './components'
import type { ScheduleItem } from './types'

describe('Today schedule components', () => {
  it('sends the selected task id when tapping check-in', () => {
    const onCheckin = vi.fn(async () => undefined)
    const item = {
      kind: 'task',
      task: { id: 41 },
      title: '阅读专业书',
      time: '09:00',
      subtitle: '',
      checkedIn: false,
    } as unknown as ScheduleItem

    render(
      <ScheduleCard
        item={item}
        onCheckin={onCheckin}
        onUndo={vi.fn(async () => undefined)}
        onComplete={vi.fn(async () => undefined)}
        onDeleteStep={vi.fn(async () => undefined)}
        onDeleteTask={vi.fn(async () => undefined)}
        onDeleteCourse={vi.fn(async () => undefined)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '打卡' }))
    expect(onCheckin).toHaveBeenCalledWith(41)
  })
})
