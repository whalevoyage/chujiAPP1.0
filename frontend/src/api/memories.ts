/** memories API operations. */
import type { JsonBody } from './client'
import type { Memory, MemoryCreate, MemoryUpdate, Attachment } from './contracts/types'
import { ApiError } from '../api-errors'
import { Capacitor } from '@capacitor/core'
import { apiRequest, API_BASE_URL } from './client'
import { uploadLocalAttachment } from '../local/localApi'

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
