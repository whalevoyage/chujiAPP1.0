import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { ApiError } from '../api-errors'
import { deleteRow, getRow, listRows, saveRow, type LocalRow } from './localDb'

type Row = Record<string, unknown> & { id?: number }

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_LEGACY_MIGRATION_BYTES = 50 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}
const urlCache = new Map<number, string>()
const legacyUrlCache = new Map<number, string>()

export function safeAttachmentFilename(value: string): string {
  const leaf = value.replaceAll('\\', '/').split('/').pop() ?? ''
  const cleaned = leaf.replace(/[^A-Za-z0-9._\-\u4e00-\u9fff]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return cleaned || 'attachment.bin'
}

function validateRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || parts[0] !== 'attachments'
    || parts.length !== 2
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new ApiError(400, '附件路径无效')
  }
  return parts.join('/')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer as ArrayBuffer
}

async function readFileBytes(localPath: string): Promise<Uint8Array> {
  const { data } = await Filesystem.readFile({ path: localPath, directory: Directory.Data })
  return typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer())
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function relativeFileUrl(localPath: string): Promise<string> {
  const safePath = validateRelativePath(localPath)
  const { uri } = await Filesystem.getUri({ path: safePath, directory: Directory.Data })
  return Capacitor.convertFileSrc(uri)
}

function stripPrivateFields(row: Row): Row {
  const exposed = { ...row }
  delete exposed.data_url
  delete exposed.local_path
  return exposed
}

async function migrateLegacyAttachment(row: Row, dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new ApiError(400, '旧版附件数据格式无效')
  const bytes = base64ToBytes(match[2])
  if (bytes.length > MAX_LEGACY_MIGRATION_BYTES) throw new ApiError(413, '旧版附件超过迁移大小限制，已保留原数据')

  const id = Number(row.id)
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '附件记录 ID 无效')
  const filename = safeAttachmentFilename(String(row.filename ?? 'attachment.bin'))
  const localPath = `attachments/${id}_${crypto.randomUUID()}_${filename}`
  const fileHash = await sha256(bytes)
  try {
    await Filesystem.writeFile({
      path: localPath,
      data: bytesToBase64(bytes),
      directory: Directory.Data,
      recursive: true,
    })
    // Verify the private file before replacing the legacy SQLite payload.
    const savedBytes = await readFileBytes(localPath)
    if (savedBytes.length !== bytes.length || await sha256(savedBytes) !== fileHash) throw new ApiError(500, '旧版附件迁移校验失败，原附件仍保留')
  } catch (error) {
    await Filesystem.deleteFile({ path: localPath, directory: Directory.Data }).catch(() => undefined)
    throw error
  }

  const updated: Row = {
    ...row,
    local_path: localPath,
    mime_type: row.mime_type ?? match[1],
    size: bytes.length,
    sha256: fileHash,
    data_url: undefined,
  }
  try {
    await saveRow('attachments', updated as LocalRow)
  } catch (error) {
    await Filesystem.deleteFile({ path: localPath, directory: Directory.Data }).catch(() => undefined)
    throw error
  }
  return await relativeFileUrl(localPath)
}

export async function exposeAttachment(row: Row): Promise<Row> {
  const id = Number(row.id)
  if (!Number.isInteger(id) || id <= 0) return stripPrivateFields(row)
  const existingPath = typeof row.local_path === 'string' ? row.local_path : ''
  if (existingPath) {
    try {
      const localPath = validateRelativePath(existingPath)
      // getUri() does not confirm that the file exists. Read it first so a
      // stale URL cache cannot hide a missing attachment from the user.
      await readFileBytes(localPath)
      urlCache.set(id, await relativeFileUrl(localPath))
      legacyUrlCache.delete(id)
      return stripPrivateFields(row)
    } catch {
      // Leave legacy data intact if a previous migration left a stale path.
    }
  }

  const dataUrl = typeof row.data_url === 'string' ? row.data_url : ''
  if (dataUrl) {
    legacyUrlCache.set(id, dataUrl)
    try {
      const localUrl = await migrateLegacyAttachment(row, dataUrl)
      urlCache.set(id, localUrl)
      legacyUrlCache.delete(id)
      const latest = await getRow('attachments', id)
      return stripPrivateFields((latest ?? row) as Row)
    } catch {
      // The Base64 payload remains in SQLite until file write, verification,
      // and metadata replacement all succeed.
      return stripPrivateFields(row)
    }
  }

  return stripPrivateFields(row)
}

export async function migrateLegacyAttachments(): Promise<void> {
  const rows = await listRows('attachments')
  for (const row of rows) {
    if (typeof row.data_url === 'string' && row.data_url && row.id) await exposeAttachment(row as Row)
  }
}

export async function readLocalAttachmentBytes(row: Row): Promise<Uint8Array | null> {
  const existingPath = typeof row.local_path === 'string' ? row.local_path : ''
  if (existingPath) {
    const localPath = validateRelativePath(existingPath)
    return await readFileBytes(localPath)
  }
  const dataUrl = typeof row.data_url === 'string' ? row.data_url : ''
  const match = dataUrl.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/)
  return match ? base64ToBytes(match[1]) : null
}

export async function stageLocalAttachmentFile(filename: string, bytes: Uint8Array): Promise<{ local_path: string; size: number; sha256: string }> {
  const safeFilename = safeAttachmentFilename(filename)
  const extension = safeFilename.includes('.') ? safeFilename.slice(safeFilename.lastIndexOf('.')).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new ApiError(400, '备份包含不支持的附件类型')
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new ApiError(413, '备份附件必须为 1 字节至 20 MB')
  const localPath = `attachments/${crypto.randomUUID()}_${safeFilename}`
  const fileHash = await sha256(bytes)
  try {
    await Filesystem.writeFile({ path: localPath, data: bytesToBase64(bytes), directory: Directory.Data, recursive: true })
    const savedBytes = await readFileBytes(localPath)
    if (savedBytes.length !== bytes.length || await sha256(savedBytes) !== fileHash) throw new ApiError(500, '导入附件写入校验失败')
  } catch (error) {
    await Filesystem.deleteFile({ path: localPath, directory: Directory.Data }).catch(() => undefined)
    throw error
  }
  return { local_path: localPath, size: bytes.length, sha256: fileHash }
}

export async function removeLocalAttachmentFile(localPath: string): Promise<void> {
  const safePath = validateRelativePath(localPath)
  await Filesystem.deleteFile({ path: safePath, directory: Directory.Data }).catch(() => undefined)
}

export async function uploadLocalAttachment(
  ownerType: 'honor' | 'memory' | 'project',
  ownerId: number,
  file: File,
): Promise<Row> {
  const filename = safeAttachmentFilename(file.name)
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new ApiError(400, '仅支持 JPG / PNG / WebP 图片和 PDF 文件')
  if (!file.size) throw new ApiError(400, '附件不能为空')
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, '附件不能超过 20 MB')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileHash = await sha256(bytes)
  const localPath = `attachments/${crypto.randomUUID()}_${filename}`
  try {
    await Filesystem.writeFile({
      path: localPath,
      data: bytesToBase64(bytes),
      directory: Directory.Data,
      recursive: true,
    })
    const savedBytes = await readFileBytes(localPath)
    if (savedBytes.length !== bytes.length || await sha256(savedBytes) !== fileHash) {
      throw new ApiError(500, '附件写入校验失败')
    }
    const row = await saveRow('attachments', {
      user_id: 1,
      owner_type: ownerType,
      owner_id: ownerId,
      filename,
      mime_type: MIME_BY_EXTENSION[extension],
      size: bytes.length,
      sha256: fileHash,
      local_path: localPath,
      created_at: new Date().toISOString(),
    }) as Row
    const url = await relativeFileUrl(localPath)
    urlCache.set(Number(row.id), url)
    return stripPrivateFields(row as Row)
  } catch (error) {
    await Filesystem.deleteFile({ path: localPath, directory: Directory.Data }).catch(() => undefined)
    throw error
  }
}

export function getLocalAttachmentUrl(id: number): string {
  return urlCache.get(id) ?? legacyUrlCache.get(id) ?? ''
}

export function clearLocalAttachmentUrlCache(): void {
  urlCache.clear()
  legacyUrlCache.clear()
}

export async function deleteLocalAttachment(id: number): Promise<void> {
  const row = await getRow('attachments', id)
  if (!row) return
  const attachment = row as Row
  const localPath = typeof attachment.local_path === 'string' ? validateRelativePath(attachment.local_path) : ''
  let bytes: Uint8Array | null = null
  if (localPath) {
    try {
      bytes = await readFileBytes(localPath)
      await Filesystem.deleteFile({ path: localPath, directory: Directory.Data })
    } catch (error) {
      if (bytes) {
        await Filesystem.writeFile({ path: localPath, data: bytesToBase64(bytes), directory: Directory.Data, recursive: true })
      }
      throw error
    }
  }
  try {
    await deleteRow('attachments', id)
    urlCache.delete(id)
    legacyUrlCache.delete(id)
  } catch (error) {
    if (localPath && bytes) {
      await Filesystem.writeFile({ path: localPath, data: bytesToBase64(bytes), directory: Directory.Data, recursive: true })
    }
    throw error
  }
}
