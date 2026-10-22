/** Shared HTTP/local request client and file transfer helpers. */
import { SERVER_URL } from '../config'
import { Capacitor } from '@capacitor/core'
import { ApiError } from '../api-errors'
import { activeDataProvider } from './dataProvider'
import { downloadLocalFile } from '../local/localApi'

export const API_BASE_URL = import.meta.env.PROD ? SERVER_URL : (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8788')

export type JsonBody = Record<string, unknown>

export async function apiRequest<T>(
  path: string,
  options: Omit<RequestInit, 'body'> & { body?: JsonBody } = {},
): Promise<T> {
  return activeDataProvider.request<T>(path, options)
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const plainMatch = header.match(/filename="?([^"]+)"?/i)
  return plainMatch?.[1] ?? fallback
}

async function readFileError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) return '下载失败'
  try {
    const data = JSON.parse(text) as { detail?: unknown }
    return typeof data.detail === 'string' ? data.detail : '下载失败'
  } catch {
    return text
  }
}

export async function downloadApiFile(path: string, fallbackFilename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await downloadLocalFile(path, fallbackFilename)
    return
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readFileError(response))
  }
  const blob = await response.blob()
  const filename = filenameFromContentDisposition(response.headers.get('content-disposition'), fallbackFilename)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
