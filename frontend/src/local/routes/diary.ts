import type { LocalRouteContext, LocalRouteResult } from './types'
import { handledRoute, unhandledRoute } from './types'

export async function handleDiaryRoutes(context: LocalRouteContext): Promise<LocalRouteResult> {
  const { path: p, method, body, segments, query: q } = context
  const { all, asNumber, asText, today, idAt, searchMatch, created, setDiaryTags, diaryResponse, save, now, notFound } = context
  if (p === '/api/diary' || p === '/api/diary/search' || p.startsWith('/api/diary/')) {
    const entries = await all('diary_entries')
    if (method === 'GET' && (p === '/api/diary' || p === '/api/diary/search')) {
      const includeDeleted = q.get('include_deleted') === 'true'
      const keyword = q.get('q') ?? ''
      return handledRoute(entries.filter((entry) => (includeDeleted || !entry.is_deleted) && searchMatch(entry, keyword, ['title', 'content_md', 'mood']))
        .sort((left, right) => asText(right.entry_date).localeCompare(asText(left.entry_date))))
    }
    if (p === '/api/diary' && method === 'POST') {
      const entry = await created('diary_entries', {
        ...body,
        title: body.title || '未命名日记',
        content_md: body.content_md || '',
        entry_date: body.entry_date || today(),
        is_starred: Boolean(body.is_starred),
        is_private: Boolean(body.is_private),
        is_deleted: false,
        deleted_at: null,
      })
      await setDiaryTags(asNumber(entry.id), Array.isArray(body.tags) ? body.tags.map(String) : [])
      return handledRoute(await diaryResponse(entry))
    }
    const id = idAt(2)
    const action = segments[3]
    let row = entries.find((entry) => asNumber(entry.id) === id) ?? notFound('日记')
    if (method === 'GET') return handledRoute(await diaryResponse(row))
    if (method === 'PUT') {
      row = await save('diary_entries', { ...row, ...body, id, updated_at: now() })
      if (Array.isArray(body.tags)) await setDiaryTags(id, body.tags.map(String))
      return handledRoute(await diaryResponse(row))
    }
    if (method === 'DELETE') {
      await save('diary_entries', { ...row, is_deleted: true, deleted_at: now(), updated_at: now() })
      return handledRoute({ ok: true })
    }
    if (method === 'POST' && action === 'restore') {
      row = await save('diary_entries', { ...row, is_deleted: false, deleted_at: null, updated_at: now() })
      return handledRoute(await diaryResponse(row))
    }
    return unhandledRoute
  }
  if (p === '/api/tags' && method === 'GET') return handledRoute(await all('tags'))
  if (p === '/api/tags' && method === 'POST') {
    const name = asText(body.name).trim()
    const existing = (await all('tags')).find((tag) => tag.name === name)
    return handledRoute(existing ?? await created('tags', { ...body, name }))
  }
  return unhandledRoute
}
