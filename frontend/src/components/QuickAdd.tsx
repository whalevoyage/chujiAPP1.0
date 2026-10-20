import { useRef, useState } from 'react'
import { CheckCircle2, Plus, X } from 'lucide-react'

import { createCourse, createPlan, createStep, createTask } from '../api'
import type { CourseCreate } from '../api'

const WEEKDAY_MAP: Record<string, number> = {
  '周一': 0, '星期一': 0,
  '周二': 1, '星期二': 1,
  '周三': 2, '星期三': 2,
  '周四': 3, '星期四': 3,
  '周五': 4, '星期五': 4,
  '周六': 5, '星期六': 5,
  '周日': 6, '星期日': 6, '星期天': 6,
}

type Props = {
  onCreated: () => void
}

type PreviewItem = {
  type: 'task' | 'course' | 'step'
  title: string
  startTime?: string
  endTime?: string
  dayOfWeek?: number
  location?: string
}

function localDateValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function parseInput(text: string): PreviewItem {
  const trimmed = text.trim()

  const isCourse = /课程|上课|课表|\b课\b/.test(trimmed)
  const hasStep = /步骤|安排|计划|规划/.test(trimmed)
  const timeMatch = trimmed.match(/(\d{1,2})[:：](\d{2})/)
  const cnTimeMatch = trimmed.match(/(\d{1,2})点/)

  const title = trimmed
    .replace(/\d{1,2}[:：]\d{2}/g, '')
    .replace(/\d{1,2}点/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (isCourse) {
    let dayOfWeek = 0
    for (const [key, val] of Object.entries(WEEKDAY_MAP)) {
      if (trimmed.includes(key)) { dayOfWeek = val; break }
    }
    const locMatch = trimmed.match(/(?:在|地点[：:]|教室[：:])(\S+)/)
    let startTime = '08:00'
    let endTime = '09:30'
    if (timeMatch) {
      const h = timeMatch[1].padStart(2, '0')
      startTime = `${h}:${timeMatch[2]}`
      endTime = `${String(Number(h) + 1).padStart(2, '0')}:${timeMatch[2]}`
    } else if (cnTimeMatch) {
      const h = cnTimeMatch[1].padStart(2, '0')
      startTime = `${h}:00`
      endTime = `${String(Number(h) + 1).padStart(2, '0')}:00`
    }
    return { type: 'course', title: title || trimmed, startTime, endTime, dayOfWeek, location: locMatch?.[1] }
  }

  if (hasStep || timeMatch || cnTimeMatch) {
    let startTime = '09:00'
    let endTime = '10:00'
    if (timeMatch) {
      const h = timeMatch[1].padStart(2, '0')
      startTime = `${h}:${timeMatch[2]}`
      endTime = `${String(Number(h) + 1).padStart(2, '0')}:${timeMatch[2]}`
    } else if (cnTimeMatch) {
      const h = cnTimeMatch[1].padStart(2, '0')
      startTime = `${h}:00`
      endTime = `${String(Number(h) + 1).padStart(2, '0')}:00`
    }
    return { type: 'step', title: title || trimmed, startTime, endTime }
  }

  // 默认创建为任务
  return { type: 'task', title: title || trimmed }
}

export default function QuickAdd({ onCreated }: Props) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleAdd() {
    setError('')
    setSuccess('')
    const text = input.trim()
    if (!text) {
      setError('请输入内容')
      return
    }
    const result = parseInput(text)
    setPreview(result)
  }

  function handleCancel() {
    setPreview(null)
    setInput('')
    setError('')
    // 保持焦点
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  async function handleConfirm() {
    if (!preview) return
    setSaving(true)
    setError('')
    try {
      if (preview.type === 'task') {
        await createTask({ title: preview.title })
      } else if (preview.type === 'course') {
        const payload: CourseCreate = {
          name: preview.title,
          day_of_week: preview.dayOfWeek ?? 0,
          start_time: preview.startTime ?? '08:00',
          end_time: preview.endTime ?? '09:30',
          location: preview.location ?? null,
        }
        await createCourse(payload)
      } else if (preview.type === 'step') {
        const today = localDateValue()
        const plan = await createPlan({ plan_date: today, title: '今日安排' })
        await createStep(plan.id, {
          title: preview.title,
          start_time: preview.startTime ?? '09:00',
          end_time: preview.endTime ?? '10:00',
          sort_order: 0,
        })
      }
      const typeNames = { task: '任务', course: '课程', step: '安排' }
      setSuccess(`已添加${typeNames[preview.type]}：${preview.title}`)
      setInput('')
      setPreview(null)
      onCreated()
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const typeLabel = preview
    ? preview.type === 'task' ? '任务' : preview.type === 'course' ? '课程' : '规划步骤'
    : ''

  return (
    <div className="rounded-2xl border border-[#E6DED3] bg-white p-3">
      {!preview ? (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input flex-1"
            placeholder="输入一句话，例如：每天背单词、9:30开会、周一高数课"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(''); setSuccess('') }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { setInput(''); setError('') }
            }}
          />
          <button type="button" onClick={handleAdd} className="button-primary shrink-0" disabled={!input.trim() || saving}>
            <Plus className="h-4 w-4" />
            添加
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-md border border-[#E6DED3] bg-[#F5F1EA] px-2 py-0.5 text-[11px] font-semibold text-[#6B7A5A]">
              {typeLabel}
            </span>
            <button type="button" onClick={handleCancel} className="text-slate-400 hover:text-slate-600" aria-label="取消">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm font-semibold">{preview.title}</p>
          {preview.startTime ? (
            <p className="text-xs text-slate-500">
              {preview.startTime}{preview.endTime ? ` - ${preview.endTime}` : ''}
              {preview.type === 'course' ? ` / ${['周一','周二','周三','周四','周五','周六','周日'][preview.dayOfWeek ?? 0]}` : ''}
              {preview.location ? ` / ${preview.location}` : ''}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={handleConfirm} className="button-primary text-xs" disabled={saving}>
              <Plus className="h-4 w-4" />
              {saving ? '添加中...' : '确认添加'}
            </button>
            <button type="button" onClick={handleCancel} className="button-secondary text-xs">
              取消
            </button>
          </div>
        </div>
      )}
      {success ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />{success}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
