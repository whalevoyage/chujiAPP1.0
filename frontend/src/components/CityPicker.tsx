import { Search, X, MapPin, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { searchCity, saveWeatherLocation, type CitySearchItem } from '../api'

type Props = {
  open: boolean
  currentLocationName: string
  onClose: () => void
  onSaved: () => void
}

export default function CityPicker({ open, currentLocationName, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<CitySearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  if (!open) return null

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = keyword.trim()
    if (!q || q.length < 1) return
    setError('')
    setSearching(true)
    setHasSearched(true)
    try {
      setResults(await searchCity(q))
    } catch (err) {
      setResults([])
      setError(err instanceof Error ? err.message : '搜索失败，请重试')
    } finally {
      setSearching(false)
    }
  }

  async function handleSelect(item: CitySearchItem) {
    setSaving(item.id)
    setError('')
    try {
      await saveWeatherLocation({
        location_id: item.id,
        location_name: item.name,
        adm1: item.adm1,
        adm2: item.adm2,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#E6DED3] bg-white shadow-xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DED3] shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">选择天气地区</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              当前：{currentLocationName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-[#F5F1EA] hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索栏 */}
        <form onSubmit={handleSearch} className="px-5 py-3 shrink-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9 h-10 text-xs"
              placeholder="输入城市或区县，例如：北京、杭州、广州"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={searching || !keyword.trim()}
            className="button-primary mt-2 h-9 w-full text-xs"
          >
            {searching ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                搜索中…
              </span>
            ) : (
              '搜索'
            )}
          </button>
        </form>

        {/* 错误提示 */}
        {error && (
          <p className="px-5 pb-2 text-xs text-red-500 shrink-0">{error}</p>
        )}

        {/* 搜索结果 */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {hasSearched && results.length === 0 && !searching && !error && (
            <p className="text-xs text-slate-400 text-center py-6">未找到地区，请换个关键词</p>
          )}
          {results.length > 0 && (
            <ul className="space-y-1">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={saving !== null}
                    onClick={() => handleSelect(item)}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#F5F1EA] transition disabled:opacity-50"
                  >
                    <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700 truncate">
                        {item.displayName}
                      </p>
                    </div>
                    {saving === item.id && (
                      <Loader2 className="h-4 w-4 animate-spin text-[#6B7A5A] shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
