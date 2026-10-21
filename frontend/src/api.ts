import { SERVER_URL } from './config'
import { Capacitor } from '@capacitor/core'
import { ApiError } from './api-errors'
import { activeDataProvider } from './api/dataProvider'
import {
  downloadLocalFile,
  getLocalAttachmentUrl,
  importLocalData,
  readLocalFileDataUrl,
  requestLocalApi,
  uploadLocalAttachment,
} from './local/localApi'

export { ApiError } from './api-errors'

const API_BASE_URL = import.meta.env.PROD ? SERVER_URL : (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8788')

export type Role = 'admin' | 'user'

export type User = {
  id: number
  username: string
  nickname: string
  role: Role
  is_active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export type AuthResponse = {
  user: User
}

type JsonBody = Record<string, unknown>

export async function apiRequest<T>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: JsonBody } = {},
): Promise<T> {
  return activeDataProvider.request<T>(path, options)
}

export type BackupRecord = {
  id: number
  created_by_user_id: number
  filename: string
  size: number
  sha256: string
  status: 'success' | 'failed' | 'restored' | string
  created_at: string
  error_message: string | null
}

export type ApiKeyStatus = {
  configured: boolean
  masked: string | null
}

export type ApiKeySettings = {
  ai_configured: boolean
  ai_api_key: ApiKeyStatus
  ai_base_url: string
  ai_model: string
  weather_api_key: ApiKeyStatus
  weather_api_host: string
  ocr_configured: boolean
  ocr_api_key: ApiKeyStatus
  ocr_base_url: string
  ocr_model: string
}

export type ApiKeySettingsUpdate = {
  ai_base_url?: string
  ai_api_key?: string
  ai_model?: string
  weather_api_key?: string
  weather_api_host?: string
  ocr_api_key?: string
  ocr_base_url?: string
  ocr_model?: string
}

export type RestoreBackupResponse = {
  ok: boolean
  recovery_backup: string
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const plainMatch = header.match(/filename="?([^"]+)"?/i)
  return plainMatch?.[1] ?? fallback
}

async function readFileError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) return '下载失败'
  try {
    const data = JSON.parse(text) as { detail?: unknown }
    return typeof data.detail === 'string' ? data.detail : '下载失败'
  } catch {
    return text
  }
}

async function downloadApiFile(path: string, fallbackFilename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await downloadLocalFile(path, fallbackFilename)
    return
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readFileError(response))
  }
  const blob = await response.blob()
  const filename = filenameFromContentDisposition(response.headers.get('content-disposition'), fallbackFilename)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function createBackup(): Promise<BackupRecord> {
  return apiRequest<BackupRecord>('/api/backups/create', {
    method: 'POST',
  })
}

export async function listBackups(): Promise<BackupRecord[]> {
  return apiRequest<BackupRecord[]>('/api/backups')
}

export async function createDailyAutoBackup(): Promise<BackupRecord | null> {
  return apiRequest<BackupRecord | null>('/api/backups/auto-daily', { method: 'POST' })
}

export async function restoreBackup(backupId: number, password: string): Promise<RestoreBackupResponse> {
  return apiRequest<RestoreBackupResponse>(`/api/backups/${backupId}/restore`, {
    method: 'POST',
    body: { password },
  })
}

export async function deleteBackup(backupId: number, password: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/backups/${backupId}`, { method: 'DELETE', body: { password } })
}

export async function getApiKeySettings(): Promise<ApiKeySettings> {
  return apiRequest<ApiKeySettings>('/api/settings/api-keys')
}

export async function updateApiKeySettings(payload: ApiKeySettingsUpdate): Promise<ApiKeySettings> {
  return apiRequest<ApiKeySettings>('/api/settings/api-keys', {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export type DeletePasswordStatus = {
  configured: boolean
  has_password: boolean
}

export async function getDeletePasswordStatus(): Promise<DeletePasswordStatus> {
  return apiRequest<DeletePasswordStatus>('/api/settings/delete-password')
}

export async function changeDeletePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/settings/delete-password', {
    method: 'PUT',
    body: { old_password: oldPassword, new_password: newPassword },
  })
}

export async function exportJson(adminAll = false): Promise<void> {
  const params = adminAll ? '?admin_all=true' : ''
  await downloadApiFile(`/api/exports/json${params}`, '初记数据.json')
}

export async function exportMarkdown(): Promise<void> {
  await downloadApiFile('/api/exports/markdown', '初记阅读文档.md')
}

export async function exportZip(): Promise<void> {
  await downloadApiFile('/api/exports/zip', '初记完整导出.zip')
}

export async function importJsonFile(file: File): Promise<number> {
  if (Capacitor.isNativePlatform()) return importLocalData(file)
  throw new ApiError(501, '当前网页版暂不支持从文件导入，请使用手机本机版')
}

// ── DailyPlan ──────────────────────────────────────────────

export type DailyPlan = {
  id: number
  user_id: number
  plan_date: string
  title: string
  main_goal: string | null
  note: string | null
  status: string
  created_at: string
  updated_at: string
  steps: PlanStep[]
  total_steps: number
  completed_steps: number
  progress: number
}

export type PlanStep = {
  id: number
  user_id: number
  plan_id: number
  title: string
  description: string | null
  start_time: string
  end_time: string
  remind_time: string | null
  remind_before_minutes: number | null
  priority: number
  enable_reminder: boolean
  linked_task_id: number | null
  sort_order: number
  status: string
  completed_at: string | null
  delay_reason: string | null
  skip_reason: string | null
  created_at: string
  updated_at: string
}

export type DailyPlanCreate = {
  plan_date: string
  title: string
  main_goal?: string | null
  note?: string | null
}

export type PlanStepCreate = {
  title: string
  description?: string | null
  start_time: string
  end_time: string
  remind_time?: string | null
  remind_before_minutes?: number | null
  priority?: number
  enable_reminder?: boolean
  linked_task_id?: number | null
  sort_order?: number
}

export type StepActionRequest = {
  reason: string
}

// ── Task ──────────────────────────────────────────────────

export type Task = {
  id: number
  user_id: number
  title: string
  category: string | null
  task_type: string | null
  frequency: string | null
  priority: number
  weight: number | null
  estimated_minutes: number | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  checked_in: boolean
  today_log: TaskLog | null
}

export type TaskCreate = {
  title: string
  category?: string | null
  task_type?: string | null
  frequency?: string | null
  priority?: number
  weight?: number | null
  estimated_minutes?: number | null
  is_active?: boolean
  sort_order?: number
}

export type TaskUpdate = {
  title?: string
  category?: string | null
  task_type?: string | null
  frequency?: string | null
  priority?: number
  weight?: number | null
  estimated_minutes?: number | null
  is_active?: boolean
  sort_order?: number
}

export type TaskCheckinRequest = {
  note?: string | null
  minutes?: number | null
  difficulty?: number | null
}

export type TaskMakeupRequest = {
  log_date: string
  note?: string | null
  minutes?: number | null
  difficulty?: number | null
  reason: string
}

export type TaskLog = {
  id: number
  user_id: number
  task_id: number
  log_date: string
  status: string
  note: string | null
  minutes: number | null
  difficulty: number | null
  is_makeup: boolean
  makeup_reason: string | null
  created_at: string
  updated_at: string
}

export type TaskStats = {
  total: number
  completed_today: number
  completion_rate: number
  encouragement: string
}

export type TotalStats = {
  total_tasks: number
  total_completed: number
  completion_rate: number
  encouragement: string
}

// ── Plans API ──────────────────────────────────────────────

export async function getTodayPlans(): Promise<DailyPlan[]> {
  return apiRequest<DailyPlan[]>('/api/plans/today')
}

export async function getPlans(date?: string): Promise<DailyPlan[]> {
  const params = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiRequest<DailyPlan[]>(`/api/plans${params}`)
}

export async function getPlan(planId: number): Promise<DailyPlan> {
  return apiRequest<DailyPlan>(`/api/plans/${planId}`)
}

export async function createPlan(payload: DailyPlanCreate): Promise<DailyPlan> {
  return apiRequest<DailyPlan>('/api/plans', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updatePlan(planId: number, payload: Partial<DailyPlanCreate>): Promise<DailyPlan> {
  return apiRequest<DailyPlan>(`/api/plans/${planId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deletePlan(planId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/plans/${planId}`, {
    method: 'DELETE',
  })
}

export async function createStep(planId: number, payload: PlanStepCreate): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plans/${planId}/steps`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateStep(stepId: number, payload: Partial<PlanStepCreate>): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteStep(stepId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/plan-steps/${stepId}`, {
    method: 'DELETE',
  })
}

export async function startStep(stepId: number): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/start`, {
    method: 'POST',
  })
}

export async function completeStep(stepId: number): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/complete`, {
    method: 'POST',
  })
}

export async function delayStep(stepId: number, reason: string): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/delay`, {
    method: 'POST',
    body: { reason } as JsonBody,
  })
}

export async function skipStep(stepId: number, reason: string): Promise<PlanStep> {
  return apiRequest<PlanStep>(`/api/plan-steps/${stepId}/skip`, {
    method: 'POST',
    body: { reason } as JsonBody,
  })
}

export async function getCurrentReminder(): Promise<PlanStep | null> {
  return apiRequest<PlanStep | null>('/api/reminders/current')
}

export async function getUpcomingReminders(): Promise<PlanStep[]> {
  return apiRequest<PlanStep[]>('/api/reminders/upcoming')
}

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

export type Streak = { streak: number; today_done: boolean }

export async function getStreak(): Promise<Streak> {
  return apiRequest<Streak>('/api/tasks/streak')
}

export type WeeklySummary = {
  week_start: string; week_end: string
  tasks_completed: number; steps_completed: number
  focus_sessions: number; focus_minutes: number
  daily_completion: Record<string, number>
}

export async function getWeeklySummary(): Promise<WeeklySummary> {
  return apiRequest<WeeklySummary>('/api/tasks/weekly-summary')
}

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

export async function listDiary(includeDeleted = false): Promise<DiaryEntry[]> {
  const params = includeDeleted ? '?include_deleted=true' : ''
  return apiRequest<DiaryEntry[]>(`/api/diary${params}`)
}

export async function getDiary(entryId: number): Promise<DiaryEntry> {
  return apiRequest<DiaryEntry>(`/api/diary/${entryId}`)
}

export async function createDiary(payload: DiaryCreate): Promise<DiaryEntry> {
  return apiRequest<DiaryEntry>('/api/diary', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateDiary(entryId: number, payload: DiaryUpdate): Promise<DiaryEntry> {
  return apiRequest<DiaryEntry>(`/api/diary/${entryId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteDiary(entryId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/diary/${entryId}`, {
    method: 'DELETE',
  })
}

export async function restoreDiary(entryId: number): Promise<DiaryEntry> {
  return apiRequest<DiaryEntry>(`/api/diary/${entryId}/restore`, {
    method: 'POST',
  })
}

export async function searchDiary(q: string, includeDeleted = false): Promise<DiaryEntry[]> {
  const params = new URLSearchParams()
  params.set('q', q)
  if (includeDeleted) {
    params.set('include_deleted', 'true')
  }
  return apiRequest<DiaryEntry[]>(`/api/diary/search?${params.toString()}`)
}

export async function listTags(): Promise<Tag[]> {
  return apiRequest<Tag[]>('/api/tags')
}

export async function createTag(payload: TagCreate): Promise<Tag> {
  return apiRequest<Tag>('/api/tags', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export const getDiaryEntries = listDiary
export const getDiaryEntry = getDiary
export const createDiaryEntry = createDiary
export const updateDiaryEntry = updateDiary
export const deleteDiaryEntry = deleteDiary
export const restoreDiaryEntry = restoreDiary
export const searchDiaryEntries = searchDiary
export const getTags = listTags

// ── Review / Weakness API ─────────────────────────────────

export type WeaknessRecord = {
  id: number
  user_id: number
  title: string
  category: string
  severity: number
  occur_date: string
  occur_period: string | null
  behavior: string
  reason: string | null
  impact: string | null
  emotion: string | null
  correction: string | null
  prevention: string | null
  is_resolved: boolean
  review_count: number
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type WeaknessCreate = {
  title?: string | null
  category?: string
  severity?: number
  occur_date?: string | null
  occur_period?: string | null
  behavior: string
  reason?: string | null
  impact?: string | null
  emotion?: string | null
  correction?: string | null
  prevention?: string | null
  add_to_plan?: boolean
}

export type WeaknessUpdate = Partial<Omit<WeaknessCreate, 'add_to_plan'>> & {
  is_resolved?: boolean
}

export type ImprovementAction = {
  id: number
  user_id: number
  weakness_id: number
  title: string
  description: string | null
  difficulty: number
  estimated_minutes: number | null
  add_to_plan: boolean
  add_to_task: boolean
  status: string
  feedback: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type ImprovementActionCreate = {
  title: string
  description?: string | null
  difficulty?: number
  estimated_minutes?: number | null
  add_to_plan?: boolean
  add_to_task?: boolean
}

export type ImprovementActionUpdate = Partial<ImprovementActionCreate> & {
  status?: string
  feedback?: string | null
}

export type ReviewReport = {
  id: number
  user_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string | null
  ai_prompt: string | null
  ai_response: string | null
  final_content: string | null
  accepted: boolean
  next_actions: string | null
  created_at: string
  updated_at: string
}

export type ReviewGenerateRequest = {
  report_type: 'daily' | 'weekly' | 'monthly' | 'custom'
  start_date?: string | null
  end_date?: string | null
}

export type LocalReviewSummary = {
  report_type: string
  start_date: string
  end_date: string
  summary: Record<string, unknown>
  input_summary: string
}

export type AiReviewPrompt = {
  report_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string
  ai_prompt: string
  summary: Record<string, unknown>
}

export type SmartReviewSummary = {
  report_id: number
  report_type: string
  start_date: string
  end_date: string
  input_summary: string
  ai_summary: string | null
  summary_material: string | null
  ai_enabled: boolean
  message: string
}

export type ReviewSaveResponse = {
  report_id?: number | null
  report_type?: 'daily' | 'weekly' | 'monthly' | 'custom'
  start_date?: string | null
  end_date?: string | null
  ai_prompt?: string | null
  ai_response: string
  final_content?: string | null
  accepted?: boolean
  next_actions?: string | null
}

export type WeaknessFilters = {
  includeDeleted?: boolean
  category?: string
  severity?: number
  dateFrom?: string
  dateTo?: string
}

export async function listWeaknesses(filters: WeaknessFilters = {}): Promise<WeaknessRecord[]> {
  const params = new URLSearchParams()
  if (filters.includeDeleted) params.set('include_deleted', 'true')
  if (filters.category) params.set('category', filters.category)
  if (filters.severity !== undefined) params.set('severity', String(filters.severity))
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiRequest<WeaknessRecord[]>(`/api/weaknesses${suffix}`)
}

export async function createWeakness(payload: WeaknessCreate): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>('/api/weaknesses', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function getWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}`)
}

export async function updateWeakness(
  weaknessId: number,
  payload: WeaknessUpdate,
): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteWeakness(weaknessId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/weaknesses/${weaknessId}`, {
    method: 'DELETE',
  })
}

export async function resolveWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}/resolve`, {
    method: 'POST',
  })
}

export async function restoreWeakness(weaknessId: number): Promise<WeaknessRecord> {
  return apiRequest<WeaknessRecord>(`/api/weaknesses/${weaknessId}/restore`, {
    method: 'POST',
  })
}

export async function listImprovementActions(weaknessId: number): Promise<ImprovementAction[]> {
  return apiRequest<ImprovementAction[]>(`/api/weaknesses/${weaknessId}/actions`)
}

export async function createImprovementAction(
  weaknessId: number,
  payload: ImprovementActionCreate,
): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/weaknesses/${weaknessId}/actions`, {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function updateImprovementAction(
  actionId: number,
  payload: ImprovementActionUpdate,
): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/improvement-actions/${actionId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function completeImprovementAction(actionId: number): Promise<ImprovementAction> {
  return apiRequest<ImprovementAction>(`/api/improvement-actions/${actionId}/complete`, {
    method: 'POST',
  })
}

export async function addImprovementActionToPlan(actionId: number): Promise<{ ok: boolean; plan_id: number; step_id: number }> {
  return apiRequest<{ ok: boolean; plan_id: number; step_id: number }>(
    `/api/improvement-actions/${actionId}/add-to-plan`,
    { method: 'POST' },
  )
}

export async function addImprovementActionToTask(actionId: number): Promise<{ ok: boolean; task_id: number }> {
  return apiRequest<{ ok: boolean; task_id: number }>(
    `/api/improvement-actions/${actionId}/add-to-task`,
    { method: 'POST' },
  )
}

export async function generateLocalReviewSummary(
  payload: ReviewGenerateRequest,
): Promise<LocalReviewSummary> {
  return apiRequest<LocalReviewSummary>('/api/reviews/generate-local-summary', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function generateAiReviewPrompt(payload: ReviewGenerateRequest): Promise<AiReviewPrompt> {
  return apiRequest<AiReviewPrompt>('/api/reviews/generate-ai-prompt', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function generateSmartReviewSummary(payload: ReviewGenerateRequest): Promise<SmartReviewSummary> {
  return apiRequest<SmartReviewSummary>('/api/reviews/generate-smart-summary', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function saveAiReviewResponse(payload: ReviewSaveResponse): Promise<ReviewReport> {
  return apiRequest<ReviewReport>('/api/reviews/save-ai-response', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function listReviewReports(): Promise<ReviewReport[]> {
  return apiRequest<ReviewReport[]>('/api/reviews')
}

export async function getReviewReport(reportId: number): Promise<ReviewReport> {
  return apiRequest<ReviewReport>(`/api/reviews/${reportId}`)
}

export async function updateReviewReport(
  reportId: number,
  payload: Partial<Pick<ReviewReport, 'ai_response' | 'final_content' | 'accepted' | 'next_actions'>>,
): Promise<ReviewReport> {
  return apiRequest<ReviewReport>(`/api/reviews/${reportId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteReviewReport(reportId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/reviews/${reportId}`, { method: 'DELETE' })
}

// ── Focus / DailyScore ──────────────────────────────────────

export type FocusSession = {
  id: number
  user_id: number
  label: string | null
  status: string
  duration_seconds: number
  started_at: string
  ended_at: string | null
  created_at: string
}

export type FocusTotalsSummary = {
  total_sessions: number
  total_minutes: number
  sessions_today: number
  total_minutes_today: number
}

export type WeatherToday = {
  locationName: string
  adm1: string
  adm2: string
  text: string
  temp: number | null
  feelsLike: number | null
  windDir: string | null
  windScale: string | null
  humidity: number | null
  obsTime: string | null
  source: string
  rain_warning: string
  ok: boolean
}

export type CitySearchItem = {
  id: string
  name: string
  adm1: string
  adm2: string
  country: string
  displayName: string
}

export type WeatherLocationSave = {
  location_id: string
  location_name: string
  adm1: string
  adm2: string
}

export type DailyScore = {
  id: number
  user_id: number
  score_date: string
  score: number
  note: string | null
  created_at: string
  updated_at: string
}

export async function startFocus(label?: string | null, plannedMinutes?: number): Promise<FocusSession> {
  return apiRequest<FocusSession>('/api/focus/start', {
    method: 'POST',
    body: { label, planned_minutes: plannedMinutes ?? 25 } as JsonBody,
  })
}

export async function endFocus(sessionId: number, durationSeconds: number): Promise<FocusSession> {
  return apiRequest<FocusSession>(`/api/focus/${sessionId}/end`, {
    method: 'POST',
    body: { duration_seconds: durationSeconds } as JsonBody,
  })
}

export async function getFocusTotals(): Promise<FocusTotalsSummary> {
  return apiRequest<FocusTotalsSummary>('/api/focus/totals')
}

export async function getTodayWeather(): Promise<WeatherToday> {
  return apiRequest<WeatherToday>('/api/weather/today')
}

export async function searchCity(keyword: string): Promise<CitySearchItem[]> {
  return apiRequest<CitySearchItem[]>(`/api/weather/search?keyword=${encodeURIComponent(keyword)}`)
}

export async function saveWeatherLocation(payload: WeatherLocationSave): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/weather/location', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function saveDailyScore(score: number, note?: string | null): Promise<DailyScore> {
  return apiRequest<DailyScore>('/api/daily-score', {
    method: 'POST',
    body: { score, note } as JsonBody,
  })
}

export async function getTodayScore(): Promise<DailyScore | null> {
  return apiRequest<DailyScore | null>('/api/daily-score/today')
}

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

export async function listHonors(filters: HonorFilters = {}): Promise<Honor[]> {
  const params = new URLSearchParams()
  if (filters.honorType) params.set('honor_type', filters.honorType)
  if (filters.level) params.set('level', filters.level)
  if (filters.resumeReady !== undefined && filters.resumeReady !== null) {
    params.set('resume_ready', String(filters.resumeReady))
  }
  if (filters.q) params.set('q', filters.q)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return apiRequest<Honor[]>(`/api/honors${suffix}`)
}

export async function createHonor(payload: HonorCreate): Promise<Honor> {
  return apiRequest<Honor>('/api/honors', {
    method: 'POST',
    body: payload as unknown as JsonBody,
  })
}

export async function getHonor(honorId: number): Promise<Honor> {
  return apiRequest<Honor>(`/api/honors/${honorId}`)
}

export async function updateHonor(honorId: number, payload: HonorUpdate): Promise<Honor> {
  return apiRequest<Honor>(`/api/honors/${honorId}`, {
    method: 'PUT',
    body: payload as unknown as JsonBody,
  })
}

export async function deleteHonor(honorId: number, password: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/honors/${honorId}`, {
    method: 'DELETE',
    body: { password },
  })
}

export async function uploadAttachment(ownerType: 'honor' | 'memory' | 'project', ownerId: number, file: File): Promise<Attachment> {
  if (Capacitor.isNativePlatform()) return await uploadLocalAttachment(ownerType, ownerId, file) as Attachment
  const formData = new FormData()
  formData.set('owner_type', ownerType)
  formData.set('owner_id', String(ownerId))
  formData.set('file', file)

  const response = await fetch(`${API_BASE_URL}/api/attachments/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : '上传失败'
    throw new ApiError(response.status, message)
  }
  return data as Attachment
}

export function getAttachmentUrl(attachmentId: number): string {
  if (Capacitor.isNativePlatform()) return getLocalAttachmentUrl(attachmentId)
  return `${API_BASE_URL}/api/attachments/${attachmentId}`
}

export async function deleteAttachment(attachmentId: number, password: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/attachments/${attachmentId}`, {
    method: 'DELETE',
    body: { password },
  })
}

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

export async function getTodayCourses(): Promise<Course[]> {
  return apiRequest<Course[]>('/api/schedule/today')
}

export async function getWeekCourses(): Promise<Course[]> {
  return apiRequest<Course[]>('/api/schedule/week')
}

export async function createCourse(payload: CourseCreate): Promise<Course> {
  return apiRequest<Course>('/api/schedule', { method: 'POST', body: payload as unknown as JsonBody })
}

export async function updateCourse(courseId: number, payload: CourseUpdate): Promise<Course> {
  return apiRequest<Course>(`/api/schedule/${courseId}`, { method: 'PUT', body: payload as unknown as JsonBody })
}

export async function deleteCourse(courseId: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/schedule/${courseId}`, { method: 'DELETE' })
}

export type IcsImportResponse = {
  ok: boolean
  imported: number
  items: Course[]
  error: string | null
}

export async function importIcs(file: File): Promise<IcsImportResponse> {
  if (Capacitor.isNativePlatform()) {
    return requestLocalApi<IcsImportResponse>('/api/schedule/import-ics', { method: 'POST', body: { ics_text: await file.text() } })
  }
  const formData = new FormData()
  formData.set('file', file)
  const response = await fetch(`${API_BASE_URL}/api/schedule/import-ics`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : '导入失败'
    throw new ApiError(response.status, message)
  }
  return data as IcsImportResponse
}

export async function importSchedulePhoto(file: File): Promise<{
  ok: boolean
  message: string
  imported: number
  items: Course[]
}> {
  if (Capacitor.isNativePlatform()) {
    return requestLocalApi('/api/schedule/import-photo', { method: 'POST', body: { filename: file.name, image_data_url: await readLocalFileDataUrl(file) } })
  }
  const formData = new FormData()
  formData.set('file', file)
  const response = await fetch(`${API_BASE_URL}/api/schedule/import-photo`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : '上传失败'
    throw new ApiError(response.status, message)
  }
  return data as { ok: boolean; message: string; imported: number; items: Course[] }
}

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

export async function listMemories(q?: string): Promise<Memory[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : ''
  return apiRequest<Memory[]>(`/api/memories${params}`)
}

export async function createMemory(payload: MemoryCreate): Promise<Memory> {
  return apiRequest<Memory>('/api/memories', { method: 'POST', body: payload as unknown as JsonBody })
}

export async function updateMemory(id: number, payload: MemoryUpdate): Promise<Memory> {
  return apiRequest<Memory>(`/api/memories/${id}`, { method: 'PUT', body: payload as unknown as JsonBody })
}

export async function deleteMemory(id: number, password: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/memories/${id}`, { method: 'DELETE', body: { password } })
}

export async function uploadMemoryAttachment(memoryId: number, file: File): Promise<Attachment> {
  if (Capacitor.isNativePlatform()) return await uploadLocalAttachment('memory', memoryId, file) as Attachment
  const formData = new FormData()
  formData.set('owner_type', 'memory')
  formData.set('owner_id', String(memoryId))
  formData.set('file', file)
  const response = await fetch(`${API_BASE_URL}/api/attachments/upload`, {
    method: 'POST', credentials: 'include', body: formData,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : '上传失败'
    throw new ApiError(response.status, message)
  }
  return data as Attachment
}

// ── 项目库 Projects ─────────────────────────────────────────

export type Project = {
  id: number
  user_id: number
  name: string
  project_type: string | null
  start_date: string | null
  status: string
  tech_stack: string | null
  summary: string | null
  link: string | null
  achievements: string | null
  next_plan: string | null
  created_at: string
  updated_at: string
  attachment_count: number
  attachments: Attachment[]
}

export type ProjectCreate = {
  name: string
  project_type?: string | null
  start_date?: string | null
  status?: string
  tech_stack?: string | null
  summary?: string | null
  link?: string | null
  achievements?: string | null
  next_plan?: string | null
}

export type ProjectUpdate = Partial<ProjectCreate>

export async function listProjects(q?: string): Promise<Project[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : ''
  return apiRequest<Project[]>(`/api/projects${params}`)
}

export async function createProject(payload: ProjectCreate): Promise<Project> {
  return apiRequest<Project>('/api/projects', { method: 'POST', body: payload as unknown as JsonBody })
}

export async function updateProject(id: number, payload: ProjectUpdate): Promise<Project> {
  return apiRequest<Project>(`/api/projects/${id}`, { method: 'PUT', body: payload as unknown as JsonBody })
}

export async function deleteProject(id: number, password: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE', body: { password } })
}

export async function uploadProjectAttachment(projectId: number, file: File): Promise<Attachment> {
  if (Capacitor.isNativePlatform()) return await uploadLocalAttachment('project', projectId, file) as Attachment
  const formData = new FormData()
  formData.set('owner_type', 'project')
  formData.set('owner_id', String(projectId))
  formData.set('file', file)
  const response = await fetch(`${API_BASE_URL}/api/attachments/upload`, {
    method: 'POST', credentials: 'include', body: formData,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : '上传失败'
    throw new ApiError(response.status, message)
  }
  return data as Attachment
}

// ── 增强综测成绩 Enhanced Score Cards ──────────────────────

export type ScoreModule = {
  name: string
  score: number
  max_score: number
  note: string | null
}

export type EnhancedScoreCard = {
  id: number
  user_id: number
  title: string
  semester: string | null
  modules_json: string  // ScoreModule[]
  total_score: number | null
  note: string | null
  ai_analysis: string | null
  created_at: string
  updated_at: string
}

export type EnhancedScoreCreate = {
  title: string
  semester?: string | null
  modules: ScoreModule[]
  note?: string | null
}

export async function listEnhancedScores(semester?: string): Promise<EnhancedScoreCard[]> {
  const params = semester ? `?semester=${encodeURIComponent(semester)}` : ''
  return apiRequest<EnhancedScoreCard[]>(`/api/scores${params}`)
}

export async function createEnhancedScore(payload: EnhancedScoreCreate): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>('/api/scores', { method: 'POST', body: payload as unknown as JsonBody })
}

export async function updateEnhancedScore(id: number, payload: Partial<EnhancedScoreCreate>): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>(`/api/scores/${id}`, { method: 'PUT', body: payload as unknown as JsonBody })
}

export async function deleteEnhancedScore(id: number): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/api/scores/${id}`, { method: 'DELETE' })
}

export async function analyzeScore(id: number): Promise<EnhancedScoreCard> {
  return apiRequest<EnhancedScoreCard>(`/api/scores/${id}/analyze`, { method: 'POST' })
}

// ── 每日状态汇总 Daily Score Summary ──────────────────────

export type DailyScoreSummary = {
  avg_7d: number | null
  avg_30d: number | null
  trend: 'up' | 'down' | 'stable'
  trend_text: string
  total_records: number
}

export async function getDailyScoreSummary(): Promise<DailyScoreSummary> {
  return apiRequest<DailyScoreSummary>('/api/daily-score/summary')
}

// ── 数据中心 ────────────────────────────────────────────────

export type DataCenterStats = {
  task_completion_rate: number
  total_focus_sessions: number
  total_focus_minutes: number
  total_courses: number
  total_honors: number
  total_projects: number
  total_memories: number
  total_diary_entries: number
}

export async function getDataCenterStats(): Promise<DataCenterStats> {
  return apiRequest<DataCenterStats>('/api/data-center/stats')
}

// ── 成长时间线 ──────────────────────────────────────────────

export type TimelineEvent = {
  id: number
  date: string
  type: 'honor' | 'project' | 'memory' | 'milestone'
  title: string
  description: string | null
}

export async function getTimeline(limit?: number): Promise<TimelineEvent[]> {
  const params = limit ? `?limit=${limit}` : ''
  return apiRequest<TimelineEvent[]>(`/api/timeline${params}`)
}
