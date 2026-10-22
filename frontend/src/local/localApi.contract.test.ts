import { beforeEach, describe, expect, it, vi } from 'vitest'
import scenarios from '../../../contracts/core-growth-scenarios.json'

const localState = vi.hoisted(() => ({
  tables: new Map<string, Map<number, Record<string, unknown>>>(),
  sequences: new Map<string, number>(),
  metadata: new Map<string, string>(),
}))

vi.mock('./localDb', () => ({
  deleteRow: vi.fn(async (entity: string, id: number) => { localState.tables.get(entity)?.delete(id) }),
  exportAllRows: vi.fn(async () => Object.fromEntries([...localState.tables.entries()].map(([entity, rows]) => [entity, [...rows.values()]]))),
  getMeta: vi.fn(async (key: string) => localState.metadata.get(key) ?? null),
  getRow: vi.fn(async (entity: string, id: number) => localState.tables.get(entity)?.get(id) ?? null),
  listRows: vi.fn(async (entity: string) => [...(localState.tables.get(entity)?.values() ?? [])].sort((left, right) => Number(right.id) - Number(left.id))),
  replaceAllRows: vi.fn(async (data: Record<string, unknown[]>) => {
    localState.tables.clear()
    localState.sequences.clear()
    for (const [entity, rows] of Object.entries(data)) {
      const table = new Map<number, Record<string, unknown>>()
      for (const value of rows) {
        const row = value as Record<string, unknown>
        table.set(Number(row.id), row)
        localState.sequences.set(entity, Math.max(localState.sequences.get(entity) ?? 0, Number(row.id)))
      }
      localState.tables.set(entity, table)
    }
  }),
  saveRow: vi.fn(async (entity: string, value: Record<string, unknown>) => {
    const table = localState.tables.get(entity) ?? new Map<number, Record<string, unknown>>()
    localState.tables.set(entity, table)
    let id = Number(value.id ?? 0)
    if (!id) {
      id = (localState.sequences.get(entity) ?? 0) + 1
      localState.sequences.set(entity, id)
    }
    const row = { ...value, id }
    table.set(id, row)
    return row
  }),
  setMeta: vi.fn(async (key: string, value: string) => { localState.metadata.set(key, value) }),
}))

import { requestLocalApi } from './localApi'

describe('Local API core growth flows', () => {
  beforeEach(() => {
    localState.tables.clear()
    localState.sequences.clear()
    localState.metadata.clear()
  })

  it('creates a plan, completes a step, and reports full progress', async () => {
    const scenario = scenarios.planProgress
    const expected = scenario.expected
    const plan = await requestLocalApi<{ id: number; progress: number }>('/api/plans', {
      method: 'POST',
      body: scenario.plan,
    })
    expect(plan.progress).toBe(expected.initial_progress)

    const step = await requestLocalApi<{ id: number; status: string }>(`/api/plans/${plan.id}/steps`, {
      method: 'POST',
      body: scenario.step,
    })
    expect(step.status).toBe(expected.step_status)

    await requestLocalApi(`/api/plan-steps/${step.id}/complete`, { method: 'POST' })
    const updated = await requestLocalApi<{ progress: number; completed_steps: number; status: string }>(`/api/plans/${plan.id}`)
    expect(updated).toMatchObject({
      progress: expected.completed_progress,
      completed_steps: expected.completed_steps,
      status: expected.plan_status,
    })
  })

  it('creates a task, records one check-in, and returns the daily count', async () => {
    const scenario = scenarios.taskCheckin
    const expected = scenario.expected
    const task = await requestLocalApi<{ id: number }>('/api/tasks', {
      method: 'POST',
      body: scenario.task,
    })
    const checkin = await requestLocalApi<{ task_id: number; status: string }>(`/api/tasks/${task.id}/checkin`, {
      method: 'POST',
      body: scenario.checkin,
    })
    const stats = await requestLocalApi<{ total: number; completed_today: number }>('/api/tasks/stats')

    expect(checkin).toMatchObject({ task_id: task.id, status: expected.checkin_status })
    expect(stats).toMatchObject({ total: expected.total_tasks, completed_today: expected.completed_today })
  })
})
