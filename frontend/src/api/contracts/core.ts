/** Shared core DTOs for local and remote API providers. */

/** Shared public request/response DTOs used by local and remote providers. */

export type Role = 'admin' | 'user'

export type User = {
  id: number
  username: string
  nickname: string
  role: Role
  is_active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export type AuthResponse = {
  user: User
}

export type BackupRecord = {
  id: number
  created_by_user_id: number
  filename: string
  size: number
  sha256: string
  status: 'success' | 'failed' | 'restored' | string
  created_at: string
  error_message: string | null
}

export type ApiKeyStatus = {
  configured: boolean
  masked: string | null
}

export type ApiKeySettings = {
  ai_configured: boolean
  ai_api_key: ApiKeyStatus
  ai_base_url: string
  ai_model: string
  weather_api_key: ApiKeyStatus
  weather_api_host: string
  ocr_configured: boolean
  ocr_api_key: ApiKeyStatus
  ocr_base_url: string
  ocr_model: string
}

export type ApiKeySettingsUpdate = {
  ai_base_url?: string
  ai_api_key?: string
  ai_model?: string
  weather_api_key?: string
  weather_api_host?: string
  ocr_api_key?: string
  ocr_base_url?: string
  ocr_model?: string
}

export type RestoreBackupResponse = {
  ok: boolean
  recovery_backup: string
}

export type DeletePasswordStatus = {
  configured: boolean
  has_password: boolean
}
