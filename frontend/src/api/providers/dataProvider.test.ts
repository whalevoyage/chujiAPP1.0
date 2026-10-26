import { describe, expect, it, vi } from 'vitest'
import { requestLocalApi } from '../../local/localApi'
import { LocalDataProvider } from './localDataProvider'
import { RemoteDataProvider } from './remoteDataProvider'

describe('data provider request boundary', () => {
  it('sends remote JSON requests with cookies and parses the response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"id":5}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const provider = new RemoteDataProvider('https://api.example', fetcher)

    await expect(provider.request<{ id: number }>('/api/plans', { method: 'POST', body: { title: 'plan' } }))
      .resolves.toEqual({ id: 5 })

    expect(fetcher).toHaveBeenCalledWith('https://api.example/api/plans', expect.objectContaining({
      credentials: 'include',
      body: '{"title":"plan"}',
    }))
    const requestOptions = fetcher.mock.calls[0][1]
    expect(new Headers(requestOptions?.headers).get('Content-Type')).toBe('application/json')
  })

  it('maps remote 401 responses to the shared session-expired event', async () => {
    const dispatch = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"detail":"expired"}', { status: 401 }),
    )
    const provider = new RemoteDataProvider('https://api.example', fetcher, dispatch)

    await expect(provider.request('/api/plans')).rejects.toMatchObject({ status: 401, message: 'expired' })
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('keeps local mode on the same request signature without network access', async () => {
    const localRequest = vi.fn().mockResolvedValue({ id: 7 })
    const provider = new LocalDataProvider(localRequest as unknown as typeof requestLocalApi)

    await expect(provider.request<{ id: number }>('/api/tasks', { method: 'POST', body: { title: 'task' } }))
      .resolves.toEqual({ id: 7 })

    expect(localRequest).toHaveBeenCalledWith('/api/tasks', { method: 'POST', body: { title: 'task' } })
  })
})
