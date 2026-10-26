import { beforeEach, describe, expect, it, vi } from 'vitest'
import scenarios from '../../../contracts/core-growth-scenarios.json'

const localState = vi.hoisted(() => ({
  tables: new Map<string, Map<number, Record<string, unknown>>>(),
  sequences: new Map<string, number>(),
  metadata: new Map<string, string>(),
  files: new Map<string, string>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => uri.replace('file://', 'capacitor://') },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'data', Cache: 'cache' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data, directory }: { path: string; data: string; directory: string }) => {
      localState.files.set(`${directory}:${path}`, data)
      return { uri: `file://${directory}/${path}` }
    }),
    readFile: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      const data = localState.files.get(`${directory}:${path}`)
      if (data === undefined) throw new Error('File not found')
      return { data }
    }),
    getUri: vi.fn(async ({ path, directory }: { path: string; directory: string }) => ({ uri: `file://${directory}/${path}` })),
    deleteFile: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      if (!localState.files.delete(`${directory}:${path}`)) throw new Error('File not found')
    }),
  },
}))

vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => undefined) } }))

vi.mock('./localDb', () => ({
  deleteRow: vi.fn(async (entity: string, id: number) => { localState.tables.get(entity)?.delete(id) }),
  exportAllRows: vi.fn(async () => Object.fromEntries([...localState.tables.entries()].map(([entity, rows]) => [entity, [...rows.values()]]))),
  getMeta: vi.fn(async (key: string) => localState.metadata.get(key) ?? null),
  getRow: vi.fn(async (entity: string, id: number) => localState.tables.get(entity)?.get(id) ?? null),
  listRows: vi.fn(async (entity: string) => [...(localState.tables.get(entity)?.values() ?? [])].sort((left, right) => Number(right.id) - Number(left.id))),
  replaceAllRows: vi.fn(async (data: Record<string, unknown[]>, options: { preserveBackups?: boolean } = {}) => {
    const backups = options.preserveBackups ? localState.tables.get('backups') : undefined
    const backupSequence = options.preserveBackups ? localState.sequences.get('backups') : undefined
    localState.tables.clear()
    localState.sequences.clear()
    if (backups) localState.tables.set('backups', backups)
    if (backupSequence !== undefined) localState.sequences.set('backups', backupSequence)
    for (const [entity, rows] of Object.entries(data)) {
      if (entity === 'backups' && options.preserveBackups) continue
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

import { downloadLocalFile, importLocalData, requestLocalApi, uploadLocalAttachment } from './localApi'
import { clearLocalAttachmentUrlCache, getLocalAttachmentUrl, readLocalAttachmentBytes } from './attachments'

describe('Local API core growth flows', () => {
  beforeEach(() => {
    localState.tables.clear()
    localState.sequences.clear()
    localState.metadata.clear()
    localState.files.clear()
    clearLocalAttachmentUrlCache()
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

  it('links a weakness to a completed action and includes it in review', async () => {
    const scenario = scenarios.weaknessActionReview
    const weakness = await requestLocalApi<{ id: number }>('/api/weaknesses', {
      method: 'POST',
      body: scenario.weakness,
    })
    const action = await requestLocalApi<{ id: number }>(`/api/weaknesses/${weakness.id}/actions`, {
      method: 'POST',
      body: scenario.action,
    })
    await requestLocalApi(`/api/improvement-actions/${action.id}/complete`, { method: 'POST' })
    const review = await requestLocalApi<{ summary: { weakness_count: number; completed_actions: unknown[]; unfinished_actions: unknown[] } }>(
      '/api/reviews/generate-local-summary',
      { method: 'POST', body: scenario.review },
    )

    expect(review.summary.weakness_count).toBe(scenario.expected.weakness_count)
    expect(review.summary.completed_actions).toHaveLength(scenario.expected.completed_actions)
    expect(review.summary.unfinished_actions).toHaveLength(scenario.expected.unfinished_actions)
  })

  it('calculates weighted score cards consistently', async () => {
    const scenario = scenarios.scoreCard
    const score = await requestLocalApi<{ id: number; total_score: number }>('/api/scores', {
      method: 'POST',
      body: scenario.score,
    })

    expect(score.total_score).toBe(scenario.expected.total_score)
  })

  it('exports and restores an honor with its private attachment', async () => {
    const scenario = scenarios.honorAttachment
    const honor = await requestLocalApi<{ id: number }>('/api/honors', {
      method: 'POST',
      body: scenario.honor,
    })
    const attachmentFile = new File([scenario.attachment.content], scenario.attachment.filename, { type: scenario.attachment.mime_type })
    const attachment = await uploadLocalAttachment('honor', honor.id, attachmentFile)
    const attachmentId = Number(attachment.id)

    await downloadLocalFile('/api/exports/zip', '初记完整导出.zip')
    const archiveBase64 = localState.files.get('cache:chuji/初记完整导出.zip')
    expect(archiveBase64).toBeDefined()
    const archiveBytes = Uint8Array.from(atob(archiveBase64 ?? ''), (character) => character.charCodeAt(0))

    await requestLocalApi(`/api/honors/${honor.id}`, { method: 'DELETE', body: { password: 'local-test-password' } })
    const imported = await importLocalData(new File([archiveBytes], 'backup.zip', { type: 'application/zip' }))
    const restoredHonor = await requestLocalApi<{ attachments: Array<{ id: number; owner_type: string; filename: string; mime_type: string }> }>(`/api/honors/${honor.id}`)
    const restoredAttachment = localState.tables.get('attachments')?.get(attachmentId)
    const restoredBytes = await readLocalAttachmentBytes(restoredAttachment ?? {})
    const expected = scenario.expected

    expect(imported).toBeGreaterThan(0)
    expect(restoredHonor.attachments).toEqual([expect.objectContaining({
      id: attachmentId,
      owner_type: expected.owner_type,
      filename: expected.filename,
      mime_type: expected.mime_type,
    })])
    expect(restoredBytes && new TextDecoder().decode(restoredBytes)).toBe(expected.content)
    expect(getLocalAttachmentUrl(attachmentId)).toContain('capacitor://')
  })
})
