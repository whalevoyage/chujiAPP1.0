/** system API operations. */
import type { BackupRecord, RestoreBackupResponse, ApiKeySettings, ApiKeySettingsUpdate, DeletePasswordStatus } from './contracts/types'
import type { JsonBody } from './client'
import { ApiError } from '../api-errors'
import { Capacitor } from '@capacitor/core'
import { apiRequest, downloadApiFile } from './client'
import { importLocalData } from '../local/localApi'

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
