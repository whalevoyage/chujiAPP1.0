/** tasks API operations. */
import type { JsonBody } from './client'
import type { Task, TaskCreate, TaskUpdate, TaskCheckinRequest, TaskLog, TaskMakeupRequest, TaskStats, TotalStats, Streak, WeeklySummary } from './contracts/types'
import { apiRequest } from './client'

// ── Tasks API ──────────────────────────────────────────────

export async function getTasks(): Promise<Task[]> {
  return apiRequest<Task[]>('/api/tasks')
}

export async function getTask(taskId: number): Promise<Task> {
  return apiRequest<Task>(`/api/tasks/${taskId}`)
}

export async function createTask(payload: TaskCreate): Promise<Task> {
  return apiRequest<Task>('/api/tasks', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateTask(taskId: number, payload: TaskUpdate): Promise<Task> {
  return apiRequest<Task>(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteTask(taskId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export async function checkinTask(taskId: number, payload: TaskCheckinRequest): Promise<TaskLog> {
  return apiRequest<TaskLog>(`/api/tasks/${taskId}/checkin`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function undoCheckin(taskId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/tasks/${taskId}/undo-checkin`, {
    method: 'POST',
  })
}

export async function makeupTask(taskId: number, payload: TaskMakeupRequest): Promise<TaskLog> {
  return apiRequest<TaskLog>(`/api/tasks/${taskId}/makeup`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function getTodayTasks(): Promise<Task[]> {
  return apiRequest<Task[]>('/api/tasks/today')
}

export async function getTaskStats(): Promise<TaskStats> {
  return apiRequest<TaskStats>('/api/tasks/stats')
}

export async function getTotalStats(): Promise<TotalStats> {
  return apiRequest<TotalStats>('/api/tasks/stats/total')
}

export async function getStreak(): Promise<Streak> {
  return apiRequest<Streak>('/api/tasks/streak')
}

export async function getWeeklySummary(): Promise<WeeklySummary> {
  return apiRequest<WeeklySummary>('/api/tasks/weekly-summary')
}
