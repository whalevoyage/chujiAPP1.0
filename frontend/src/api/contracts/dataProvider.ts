export type DataProviderMode = 'local' | 'remote'

export type DataProviderRequestOptions = Omit<RequestInit, 'body'> & {
  body?: Record<string, unknown>
}

/** Request boundary shared by server-backed Web/PWA and native local mode. */
export interface DataProvider {
  readonly mode: DataProviderMode
  request<T>(path: string, options?: DataProviderRequestOptions): Promise<T>
}
