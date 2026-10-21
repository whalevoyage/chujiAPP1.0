import { ApiError } from '../../api-errors'
import type { DataProvider, DataProviderRequestOptions } from '../contracts/dataProvider'

export class RemoteDataProvider implements DataProvider {
  readonly mode = 'remote' as const
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly dispatchSessionExpired: () => void

  constructor(
    baseUrl: string,
    fetcher: typeof fetch = fetch,
    dispatchSessionExpired = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('auth:session-expired'))
    },
  ) {
    this.baseUrl = baseUrl
    this.fetcher = fetcher
    this.dispatchSessionExpired = dispatchSessionExpired
  }

  async request<T>(path: string, options: DataProviderRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')

    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        credentials: 'include',
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      })
    } catch {
      throw new ApiError(0, '网络连接失败，请检查网络设置')
    }

    const text = await response.text()
    const data = text ? JSON.parse(text) : null
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login') this.dispatchSessionExpired()
      const message = typeof data?.detail === 'string' ? data.detail : '请求失败'
      throw new ApiError(response.status, message)
    }
    return data as T
  }
}
