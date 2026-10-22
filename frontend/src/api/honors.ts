/** honors API operations. */
import type { HonorFilters, Honor, HonorCreate, HonorUpdate, Attachment } from './contracts/types'
import type { JsonBody } from './client'
import { ApiError } from '../api-errors'
import { Capacitor } from '@capacitor/core'
import { apiRequest, API_BASE_URL } from './client'
import { getLocalAttachmentUrl } from '../local/localApi'
import { uploadLocalAttachment } from '../local/localApi'

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
