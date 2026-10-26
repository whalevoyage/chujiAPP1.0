import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { ApiError } from '../api-errors'
import { validateZipEnvelope } from './zipSafety'

function archive(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, contents]) => [name, strToU8(contents)])))
}

describe('local ZIP safety checks', () => {
  it('accepts an application export ZIP with a manifest', () => {
    const bytes = archive({ 'export.json': '{}', 'manifest.json': '{"format_version":1,"attachment_files":[]}' })
    expect(() => validateZipEnvelope(bytes)).not.toThrow()
  })

  it('rejects path traversal before decompression', () => {
    const bytes = archive({ '../escape.txt': 'nope', 'export.json': '{}', 'manifest.json': '{}' })
    expect(() => validateZipEnvelope(bytes)).toThrow(ApiError)
  })

  it('rejects unsupported entries and duplicate names', () => {
    const unsafe = archive({ 'database.sqlite': 'private', 'export.json': '{}', 'manifest.json': '{}' })
    expect(() => validateZipEnvelope(unsafe)).toThrow(/不允许的文件路径/)
  })

  it('rejects inflated-size claims before handing the archive to unzip', () => {
    const bytes = archive({ 'export.json': '{}', 'manifest.json': '{}' })
    const end = bytes.length - 22
    const directoryOffset = bytes[end + 16] | (bytes[end + 17] << 8) | (bytes[end + 18] << 16) | (bytes[end + 19] << 24)
    const central = directoryOffset >>> 0
    const inflatedSize = 300 * 1024 * 1024
    bytes[central + 24] = inflatedSize & 0xff
    bytes[central + 25] = (inflatedSize >>> 8) & 0xff
    bytes[central + 26] = (inflatedSize >>> 16) & 0xff
    bytes[central + 27] = (inflatedSize >>> 24) & 0xff
    expect(() => validateZipEnvelope(bytes)).toThrow(/解压总大小/)
  })
})
