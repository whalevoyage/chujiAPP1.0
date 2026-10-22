/** projects API operations. */
import type { JsonBody } from './client'
import type { Project, ProjectCreate, ProjectUpdate, Attachment } from './contracts/types'
import { ApiError } from '../api-errors'
import { Capacitor } from '@capacitor/core'
import { apiRequest, API_BASE_URL } from './client'
import { uploadLocalAttachment } from '../local/localApi'

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
