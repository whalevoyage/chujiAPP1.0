import { ApiError } from '../api-errors'

export const MAX_IMPORT_TOTAL_BYTES = 250 * 1024 * 1024
export const MAX_IMPORT_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_ENTRIES = 502

function fail(status: number, message: string): never {
  throw new ApiError(status, message)
}

function zipU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) fail(400, 'ZIP 目录结构不完整')
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function zipU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) fail(400, 'ZIP 目录结构不完整')
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

/** Validate the ZIP central directory and file ranges before any decompression. */
export function validateZipEnvelope(bytes: Uint8Array): void {
  const minEocd = Math.max(0, bytes.length - 22 - 65_535)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= minEocd; offset -= 1) {
    if (zipU32(bytes, offset) === 0x06054b50 && offset + 22 + zipU16(bytes, offset + 20) === bytes.length) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) fail(400, 'ZIP 目录无效或不受支持')
  const disk = zipU16(bytes, eocd + 4)
  const directoryDisk = zipU16(bytes, eocd + 6)
  const diskEntries = zipU16(bytes, eocd + 8)
  const entryCount = zipU16(bytes, eocd + 10)
  const directorySize = zipU32(bytes, eocd + 12)
  const directoryOffset = zipU32(bytes, eocd + 16)
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) fail(400, '不支持分卷 ZIP 或 ZIP64 格式')
  if (entryCount < 2 || entryCount > MAX_IMPORT_ENTRIES || directoryOffset + directorySize !== eocd) fail(400, 'ZIP 文件数量或目录边界无效')

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const seenNames = new Set<string>()
  const occupiedRanges: Array<[number, number]> = []
  let cursor = directoryOffset
  let totalUncompressed = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (zipU32(bytes, cursor) !== 0x02014b50) fail(400, 'ZIP 中央目录记录无效')
    const flags = zipU16(bytes, cursor + 8)
    const method = zipU16(bytes, cursor + 10)
    const compressed = zipU32(bytes, cursor + 20)
    const uncompressed = zipU32(bytes, cursor + 24)
    const nameLength = zipU16(bytes, cursor + 28)
    const extraLength = zipU16(bytes, cursor + 30)
    const commentLength = zipU16(bytes, cursor + 32)
    const startDisk = zipU16(bytes, cursor + 34)
    const localOffset = zipU32(bytes, cursor + 42)
    const nameStart = cursor + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > directoryOffset + directorySize || !nameLength || startDisk !== 0 || (flags & 0x41) !== 0 || (method !== 0 && method !== 8)) fail(400, 'ZIP 使用了不受支持或加密的条目')
    let name: string
    try { name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)) } catch { fail(400, 'ZIP 文件名不是有效 UTF-8') }
    if (seenNames.has(name) || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail(400, 'ZIP 文件名重复或包含绝对路径')
    seenNames.add(name)
    const parts = name.split('/')
    const isAttachment = parts.length === 2 && parts[0] === 'attachments' && !containsControlCharacter(parts[1]) && parts[1] !== '.' && parts[1] !== '..'
    if (!isAttachment && !['export.json', 'export.md', 'manifest.json'].includes(name)) fail(400, 'ZIP 包含不允许的文件路径')
    if (parts.some((part) => !part || part === '.' || part === '..')) fail(400, 'ZIP 路径包含无效目录段')
    if (isAttachment && uncompressed > MAX_IMPORT_ATTACHMENT_BYTES) fail(413, 'ZIP 中的单个附件不能超过 20 MB')
    if (name === 'manifest.json' && uncompressed > 2 * 1024 * 1024) fail(413, 'ZIP 清单过大')
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_IMPORT_TOTAL_BYTES) fail(413, 'ZIP 解压总大小不能超过 250 MB')
    if (compressed === 0 ? uncompressed > 0 : uncompressed / compressed > 1000) fail(413, 'ZIP 压缩比异常，已拒绝导入')
    if (localOffset + 30 > directoryOffset || zipU32(bytes, localOffset) !== 0x04034b50) fail(400, 'ZIP 本地文件头无效')
    const localNameLength = zipU16(bytes, localOffset + 26)
    const localExtraLength = zipU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressed
    if (dataEnd > directoryOffset || dataStart < localOffset || dataEnd < dataStart) fail(400, 'ZIP 文件数据越过目录边界')
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
    if (localName !== name || zipU16(bytes, localOffset + 6) !== flags || zipU16(bytes, localOffset + 8) !== method) fail(400, 'ZIP 本地文件头与中央目录不一致')
    occupiedRanges.push([localOffset, dataEnd])
    cursor = next
  }
  if (cursor !== directoryOffset + directorySize) fail(400, 'ZIP 中央目录长度不匹配')
  occupiedRanges.sort((left, right) => left[0] - right[0])
  for (let index = 1; index < occupiedRanges.length; index += 1) {
    if (occupiedRanges[index][0] < occupiedRanges[index - 1][1]) fail(400, 'ZIP 文件数据区域重叠')
  }
}
