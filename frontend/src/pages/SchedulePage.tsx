import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowLeft, Camera, Plus, Save, Trash2, Upload, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  createCourse, deleteCourse, getWeekCourses, importIcs, importSchedulePhoto,
  updateCourse, type Course, type CourseCreate,
} from '../api'
import { useConfirm } from '../hooks/useConfirm'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 标准节次时间
const PERIODS = [
  { num: 1, start: '08:00', end: '08:45' },
  { num: 2, start: '08:55', end: '09:40' },
  { num: 3, start: '10:00', end: '10:45' },
  { num: 4, start: '10:55', end: '11:40' },
  { num: 5, start: '13:30', end: '14:15' },
  { num: 6, start: '14:25', end: '15:10' },
  { num: 7, start: '15:30', end: '16:15' },
  { num: 8, start: '16:25', end: '17:10' },
  { num: 9, start: '17:30', end: '18:15' },
  { num: 10, start: '18:15', end: '19:00' },
  { num: 11, start: '19:30', end: '20:15' },
  { num: 12, start: '20:15', end: '21:00' },
]

const COURSE_COLORS = ['#6B7A5A', '#5A7A6B', '#8B6B5A', '#5A6B8B', '#8B5A7A', '#7A8B5A', '#5A8B8B', '#846B5A']

type FormState = {
  name: string; teacher: string; location: string
  day_of_week: number; period_start: number; period_end: number
  start_week: string; end_week: string; note: string; color: string
}

const emptyForm: FormState = {
  name: '', teacher: '', location: '',
  day_of_week: 0, period_start: 1, period_end: 2,
  start_week: '1', end_week: '16', note: '', color: COURSE_COLORS[0],
}

export default function SchedulePage() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const icsInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const { confirm, dialog } = useConfirm()

  async function loadData() {
    setLoading(true); setError('')
    try { setCourses(await getWeekCourses()) }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadData() }, [])

  function updateForm<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(c => ({ ...c, [k]: v })) }
  function resetForm() { setForm(emptyForm); setEditingId(null); setShowForm(false) }

  function startEdit(c: Course) {
    // 根据课程时间匹配节次
    let ps = 1, pe = 2
    const matchStart = PERIODS.findIndex(p => p.start === c.start_time)
    const matchEnd = PERIODS.findIndex(p => p.end === c.end_time)
    if (matchStart >= 0) ps = matchStart + 1
    if (matchEnd >= 0) pe = matchEnd + 1
    else if (matchStart >= 0) pe = matchStart + 2

    setForm({
      name: c.name, teacher: c.teacher ?? '', location: c.location ?? '',
      day_of_week: c.day_of_week, period_start: ps, period_end: pe,
      start_week: String(c.start_week ?? 1), end_week: String(c.end_week ?? 16),
      note: c.note ?? '', color: c.color || COURSE_COLORS[c.day_of_week % COURSE_COLORS.length],
    })
    setEditingId(c.id); setShowForm(true); setError(''); setMessage('')
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('请填写课程名称'); return }
    const ps = Math.min(form.period_start, form.period_end)
    const pe = Math.max(form.period_start, form.period_end)
    const pStart = PERIODS[ps - 1]
    const pEnd = PERIODS[pe - 1]
    if (!pStart || !pEnd) { setError('节次选择无效'); return }

    setError(''); setMessage('')
    const payload: CourseCreate = {
      name: form.name.trim(),
      teacher: form.teacher.trim() || null,
      location: form.location.trim() || null,
      day_of_week: form.day_of_week,
      start_time: pStart.start,
      end_time: pEnd.end,
      start_week: Number(form.start_week) || 1,
      end_week: Number(form.end_week) || 16,
      note: form.note.trim() || null,
      color: form.color || null,
    }
    try {
      if (editingId === null) { await createCourse(payload); setMessage('课程已添加') }
      else { await updateCourse(editingId, payload); setMessage('课程已更新') }
      resetForm(); await loadData()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
  }

  async function handleDelete(courseId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    setDeletingId(courseId)
    try { await deleteCourse(courseId); setMessage('课程已删除'); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
    finally { setDeletingId(null) }
  }

  async function handleIcsUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; if (!file) return
    setError(''); setMessage('')
    try { const result = await importIcs(file); setMessage(`成功导入 ${result.imported} 个课程`); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '导入失败') }
    event.currentTarget.value = ''
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; if (!file) return
    setError(''); setMessage(''); setOcrLoading(true)
    try {
      const result = await importSchedulePhoto(file)
      setMessage(result.message)
      if (result.imported > 0) await loadData()
      else setShowForm(true)
    } catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setOcrLoading(false) }
    event.currentTarget.value = ''
  }

  // Build schedule grid data
  const scheduleGrid = WEEKDAYS.map((_, dow) =>
    PERIODS.map(period => {
      const course = courses.find(c =>
        c.day_of_week === dow &&
        c.start_time <= period.start &&
        c.end_time > period.start
      )
      if (!course) return null
      // Only show label on the first period of the course
      if (course.start_time !== period.start) return { ...course, _span: true }
      const endPeriodIdx = PERIODS.findIndex(p => p.end === course.end_time || p.start > course.end_time)
      const span = endPeriodIdx === -1 ? PERIODS.length - period.num + 1 : endPeriodIdx - period.num + 1
      return { ...course, _span: Math.max(1, span) }
    })
  )

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>

  return (
    <div className="mx-auto flex max-w-full flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">课表</h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowForm(true)} className="button-primary text-xs">
            <Plus className="h-4 w-4" />添加课程
          </button>
          <label className="button-secondary cursor-pointer text-xs">
            <Upload className="h-4 w-4" />导入课表(.ics)
            <input ref={icsInputRef} type="file" accept=".ics,.ical,text/calendar" className="hidden" onChange={handleIcsUpload} />
          </label>
          <label className="button-secondary cursor-pointer text-xs">
            <Camera className="h-4 w-4" />{ocrLoading ? '识别中...' : '拍照识别'}
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={ocrLoading} />
          </label>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-400/30 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {showForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold mb-4">{editingId !== null ? '编辑课程' : '添加课程'}</h2>
          <div className="grid gap-3">
            <input className="input" placeholder="课程名称" value={form.name} onChange={e => updateForm('name', e.target.value)} autoFocus />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="老师" value={form.teacher} onChange={e => updateForm('teacher', e.target.value)} />
              <input className="input" placeholder="地点" value={form.location} onChange={e => updateForm('location', e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <select className="input" value={form.day_of_week} onChange={e => updateForm('day_of_week', Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <select className="input" value={form.period_start} onChange={e => updateForm('period_start', Number(e.target.value))}>
                {PERIODS.map(p => <option key={p.num} value={p.num}>第{p.num}节 {p.start}</option>)}
              </select>
              <select className="input" value={form.period_end} onChange={e => updateForm('period_end', Number(e.target.value))}>
                {PERIODS.map(p => <option key={p.num} value={p.num}>到第{p.num}节 {p.end}</option>)}
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" type="number" min={1} max={30} placeholder="开始周" value={form.start_week} onChange={e => updateForm('start_week', e.target.value)} />
              <input className="input" type="number" min={1} max={30} placeholder="结束周" value={form.end_week} onChange={e => updateForm('end_week', e.target.value)} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">颜色</span>
                <input type="color" value={form.color} onChange={e => updateForm('color', e.target.value)} className="h-8 w-8 rounded-sm border cursor-pointer" />
              </div>
            </div>
            <textarea className="input min-h-16 resize-none py-3" placeholder="备注" value={form.note} onChange={e => updateForm('note', e.target.value)} />
            <div className="flex gap-2">
              <button onClick={handleSave} className="button-primary"><Save className="h-4 w-4" />保存</button>
              <button onClick={resetForm} className="button-secondary"><XCircle className="h-4 w-4" />取消</button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 周课表网格 */}
      <section className="overflow-x-auto rounded-2xl border border-[#E6DED3] bg-white schedule-table">
        <div className="min-w-[700px]">
          {/* 表头：节次 + 周几 */}
          <div className="grid border-b border-[#E6DED3] sticky top-0 bg-white z-10" style={{ gridTemplateColumns: '70px repeat(7, 1fr)' }}>
            <div className="p-2 text-center text-[11px] font-semibold text-slate-400 border-r border-[#E6DED3]">节次</div>
            {WEEKDAYS.map(d => (
              <div key={d} className="p-2 text-center text-xs font-semibold text-slate-600 border-r border-[#E6DED3] last:border-r-0">{d}</div>
            ))}
          </div>
          {/* 每一行 = 一个节次 */}
          {PERIODS.map(period => (
            <div key={period.num} className="grid border-b border-[#E6DED3]/50" style={{ gridTemplateColumns: '70px repeat(7, 1fr)', minHeight: '52px' }}>
              {/* 左侧节次信息 */}
              <div className="flex flex-col items-center justify-center border-r border-[#E6DED3]/50 p-1 bg-[#FFFDF8]">
                <span className="text-[11px] font-semibold text-slate-600">{period.num}</span>
                <span className="text-[9px] text-slate-400">{period.start}</span>
                <span className="text-[9px] text-slate-400">{period.end}</span>
              </div>
              {/* 每天单元格 */}
              {WEEKDAYS.map((_, dow) => {
                const cell = scheduleGrid[dow][period.num - 1]
                if (!cell) return <div key={dow} className="border-r border-[#E6DED3]/30 last:border-r-0" />
                if (cell._span) return <div key={dow} className="border-r border-[#E6DED3]/30 last:border-r-0" />

                return (
                  <div key={dow} className="border-r border-[#E6DED3]/30 last:border-r-0 p-0.5 relative" style={{ gridRow: `span ${cell._span || 1}` }}>
                    <button
                      type="button"
                      className="w-full h-full rounded-lg px-2 py-1.5 text-left text-[11px] leading-tight transition hover:opacity-85 flex flex-col justify-start min-h-[44px]"
                      style={{ backgroundColor: cell.color || COURSE_COLORS[dow % COURSE_COLORS.length], color: '#fff' }}
                      onClick={() => startEdit(cell)}
                    >
                      <p className="truncate font-semibold">{cell.name}</p>
                      {cell.location ? <p className="truncate opacity-85 text-[10px]">{cell.location}</p> : null}
                      {cell.teacher ? <p className="truncate opacity-75 text-[10px]">{cell.teacher}</p> : null}
                      <p className="opacity-75 text-[10px] mt-auto">{cell.start_time}-{cell.end_time}</p>
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>

      {/* 课程列表（备选视图）*/}
      <section className="grid gap-2">
        <h2 className="text-base font-bold">课程列表</h2>
        {courses.length === 0 ? (
          <div className="rounded-2xl border border-[#E6DED3] bg-white p-8 text-center">
            <p className="text-sm text-slate-500">暂无课程，点击上方按钮添加</p>
          </div>
        ) : (
          courses.map(c => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-[#E6DED3] bg-white p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color || '#6B7A5A' }} />
                  <span className="truncate text-sm font-bold">{c.name}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {WEEKDAYS[c.day_of_week]} {c.start_time}-{c.end_time}
                  {c.teacher ? ` / ${c.teacher}` : ''}
                  {c.location ? ` / ${c.location}` : ''}
                  {c.start_week && c.end_week ? ` / 第${c.start_week}-${c.end_week}周` : ''}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => startEdit(c)} className="button-secondary text-xs py-1 px-2">编辑</button>
                <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="button-danger text-xs py-1 px-2" aria-label="删除课程">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </section>
      {dialog}
    </div>
  )
}
