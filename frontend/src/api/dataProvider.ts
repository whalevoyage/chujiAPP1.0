import { Capacitor } from '@capacitor/core'
import { SERVER_URL } from '../config'
import { LocalDataProvider } from './providers/localDataProvider'
import { RemoteDataProvider } from './providers/remoteDataProvider'
import type { DataProvider } from './contracts/dataProvider'

const apiBaseUrl = import.meta.env.PROD ? SERVER_URL : (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8788')

export const activeDataProvider: DataProvider = Capacitor.isNativePlatform()
  ? new LocalDataProvider()
  : new RemoteDataProvider(apiBaseUrl)
