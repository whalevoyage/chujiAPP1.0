import { requestLocalApi } from '../../local/localApi'
import type { DataProvider, DataProviderRequestOptions } from '../contracts/dataProvider'

export class LocalDataProvider implements DataProvider {
  readonly mode = 'local' as const
  private readonly requestLocal: typeof requestLocalApi

  constructor(
    requestLocal: typeof requestLocalApi = requestLocalApi,
  ) {
    this.requestLocal = requestLocal
  }

  request<T>(path: string, options: DataProviderRequestOptions = {}): Promise<T> {
    return this.requestLocal<T>(path, { method: options.method, body: options.body })
  }
}
