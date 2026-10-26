import { useEffect, useState } from 'react'
import { Edit3, Quote, Save } from 'lucide-react'
import { apiRequest } from '../api'

export default function DailyReminder() {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    apiRequest<{ id: number | null; text: string }>('/api/daily-reminder/today')
      .then((data) => { if (data.text) { setText(data.text); setEditing(false) } })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const result = await apiRequest<{ id: number; text: string }>('/api/daily-reminder/today', {
        method: 'POST',
        body: { text },
      })
      setText(result.text)
      setEditing(false)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (!loaded) return null

  if (!editing && !text) {
    return (
      <div className="rounded-xl border border-dashed border-[#E6DED3] bg-[#FFFDF8] p-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-2 text-xs text-slate-400 hover:text-[#6B7A5A]"
        >
          <Quote className="h-3 w-3" />
          写一句今天想对自己说的话
        </button>
      </div>
    )
  }

  if (!editing && text) {
    return (
      <div className="rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3">
        <div className="flex items-start gap-2">
          <Quote className="mt-0.5 h-3 w-3 shrink-0 text-[#6B7A5A]" />
          <p className="flex-1 text-xs text-slate-600 leading-relaxed italic">{text}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 text-slate-300 hover:text-[#6B7A5A]"
            aria-label="编辑"
          >
            <Edit3 className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#6B7A5A]/30 bg-[#FFFDF8] p-3">
      <input
        className="w-full bg-transparent text-xs text-slate-700 outline-hidden"
        placeholder="今天想对自己说..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
        autoFocus
        maxLength={200}
      />
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" onClick={handleSave} disabled={saving || !text.trim()} className="rounded-lg bg-[#6B7A5A] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
          <Save className="inline h-3 w-3 mr-1" />保存
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-[#E6DED3] bg-white px-3 py-1 text-[11px] text-slate-500">
          取消
        </button>
      </div>
    </div>
  )
}
