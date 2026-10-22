/** schedule API operations. */
import type { Course, CourseCreate, CourseUpdate, IcsImportResponse } from './contracts/types'
import type { JsonBody } from './client'
import { ApiError } from '../api-errors'
import { Capacitor } from '@capacitor/core'
import { apiRequest, API_BASE_URL } from './client'
import { readLocalFileDataUrl } from '../local/localApi'
import { requestLocalApi } from '../local/localApi'

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
