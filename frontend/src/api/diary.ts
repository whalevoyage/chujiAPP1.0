/** diary API operations. */
import type { DiaryEntry, DiaryCreate, DiaryUpdate, Tag, TagCreate } from './contracts/types'
import type { JsonBody } from './client'
import { apiRequest } from './client'

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
