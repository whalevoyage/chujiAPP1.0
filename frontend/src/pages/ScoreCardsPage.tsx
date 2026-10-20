import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Calculator, Plus, Save, Trash2 } from 'lucide-react'
import { apiRequest, type ApiError } from '../api'
import { useConfirm } from '../hooks/useConfirm'

// 综测字段：与需求一致（横向展示）
// 学号、姓名、10%基本素质、65%(智育+体育)、20%创新素质与实践能力(100分)、5%附件分、合计、综测排名、智育排名
const MODULE_TEMPLATES = [
  { key: 'student_no', name: '学号', maxScore: 0, isText: true },
  { key: 'name', name: '姓名', maxScore: 0, isText: true },
  { key: 'basic_10', name: '10%基本素质', maxScore: 100, isText: false },
  { key: 'intel_65', name: '65%(智育+体育)', maxScore: 100, isText: false },
  { key: 'innov_20', name: '20%创新素质与实践能力', maxScore: 100, isText: false },
  { key: 'attach_5', name: '5%附件分', maxScore: 100, isText: false },
  { key: 'total', name: '合计', maxScore: 0, isComputed: true },
  { key: 'rank_all', name: '综测排名', maxScore: 0, isText: true },
  { key: 'rank_intel', name: '智育排名', maxScore: 0, isText: true },
]

type Module = { name: string; score: number; max_score: number; note: string | null; text?: string }

type ScoreCard = {
  id: number; user_id: number; title: string; semester: string | null
  modules_json: string; total_score: number | null
  note: string | null; ai_analysis: string | null
  created_at: string; updated_at: string
}

// 表头顺序：学号、姓名、各分项、合计、综测排名、智育排名
const COLUMNS = MODULE_TEMPLATES

function emptyModules(): Module[] {
  return MODULE_TEMPLATES.map(m => ({ name: m.name, score: 0, max_score: m.maxScore, note: null, text: '' }))
}

// 计算合计（只对 4 个有分数的项求和）
function computeTotal(modules: Module[]): number {
  const keys = ['basic_10', 'intel_65', 'innov_20', 'attach_5']
  let total = 0
  MODULE_TEMPLATES.forEach((t, i) => {
    if (keys.includes(t.key)) {
      const m = modules[i]
      // 按权重折算：10%/65%/20%/5%
      const weightMap: Record<string, number> = { basic_10: 0.10, intel_65: 0.65, innov_20: 0.20, attach_5: 0.05 }
      const v = Number(m.score) || 0
      total += v * (weightMap[t.key] ?? 0)
    }
  })
  return Math.round(total * 100) / 100
}

export default function ScoreCardsPage() {
  const navigate = useNavigate()
  const [cards, setCards] = useState<ScoreCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [semester, setSemester] = useState('')
  const [semesterFilter, setSemesterFilter] = useState('')
  const [modules, setModules] = useState<Module[]>(() => emptyModules())
  const [note, setNote] = useState('')
  const { confirm, dialog } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = semesterFilter ? `?semester=${encodeURIComponent(semesterFilter)}` : ''
      setCards(await apiRequest<ScoreCard[]>(`/api/scores${params}`))
    } catch (err) { setError((err as ApiError).message || '加载失败') }
    finally { setLoading(false) }
  }, [semesterFilter])

  useEffect(() => { void load() }, [load])

  function resetForm() {
    setShowForm(false); setEditingId(null); setTitle(''); setSemester('')
    setModules(emptyModules())
    setNote(''); setError('')
  }

  function startEdit(card: ScoreCard) {
    setEditingId(card.id); setTitle(card.title); setSemester(card.semester ?? '')
    const savedModules = JSON.parse(card.modules_json) as Module[]
    const merged = MODULE_TEMPLATES.map(t => {
      const existing = savedModules.find(m => m.name === t.name)
      return existing || { name: t.name, score: 0, max_score: t.maxScore, note: null, text: '' }
    })
    setModules(merged)
    setNote(card.note ?? ''); setShowForm(true)
  }

  function updateModule(idx: number, field: keyof Module, value: string | number) {
    setModules(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  async function handleSave() {
    if (!title.trim()) { setError('请输入成绩卡标题'); return }
    setError('')
    // 保存所有模块（包含学号/姓名/排名等文本字段，以及合计）
    const finalModules = modules.map((m, i) => {
      const t = MODULE_TEMPLATES[i]
      if (t.isComputed) return { ...m, score: computeTotal(modules) }
      return m
    })
    // 保存时保留文本和数值
    const payload = {
      title: title.trim(),
      semester: semester.trim() || null,
      modules: finalModules.filter((m, i) => {
        const t = MODULE_TEMPLATES[i]
        if (t.isText) return Boolean(m.text?.trim())
        if (t.isComputed) return true
        return m.score > 0
      }).map(m => ({ name: m.name, score: Number(m.score) || 0, max_score: m.max_score, note: m.text || null })),
      note: note.trim() || null,
    }
    try {
      const body = payload as unknown as Record<string, unknown>
      if (editingId) { await apiRequest(`/api/scores/${editingId}`, { method: 'PUT', body }) }
      else { await apiRequest('/api/scores', { method: 'POST', body }) }
      setMessage(editingId ? '已更新' : '已创建')
      resetForm(); await load()
    } catch (err) { setError((err as ApiError).message || '保存失败') }
  }

  async function handleDelete(id: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await apiRequest(`/api/scores/${id}`, { method: 'DELETE' }); await load(); setMessage('已删除') }
    catch (err) { setError((err as ApiError).message || '删除失败') }
  }

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>

  const semesters = [...new Set(cards.map(c => c.semester).filter(Boolean))] as string[]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">综测成绩</h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => { resetForm(); setShowForm(true) }} className="button-primary text-xs">
            <Plus className="h-4 w-4" />新建记录
          </button>
          {semesters.length > 0 ? (
            <select className="input w-auto" value={semesterFilter} onChange={e => setSemesterFilter(e.target.value)}>
              <option value="">所有学期</option>
              {semesters.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : null}
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-400/30 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {/* 表单：横向字段 */}
      {showForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold mb-4">{editingId ? '编辑记录' : '新建记录'}</h2>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="标题（如：2024-2025-1 综测）" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
              <input className="input" placeholder="学期（如：2024-2025-1）" value={semester} onChange={e => setSemester(e.target.value)} />
            </div>
            <p className="text-xs text-slate-500">各字段（合计自动计算）：</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {MODULE_TEMPLATES.map((t, i) => {
                const m = modules[i]
                if (t.isComputed) {
                  return (
                    <div key={t.key} className="rounded-xl border border-[#6B7A5A]/30 bg-[#F5F1EA] p-2">
                      <label className="text-[11px] text-slate-600">{t.name}</label>
                      <div className="mt-1 text-center text-lg font-bold text-[#6B7A5A]">{computeTotal(modules)}</div>
                    </div>
                  )
                }
                return (
                  <div key={t.key} className="rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-2">
                    <label className="text-[11px] text-slate-600">{t.name}</label>
                    {t.isText ? (
                      <input className="input mt-1 h-8 text-xs" placeholder={t.name}
                        value={m.text || ''} onChange={e => updateModule(i, 'text', e.target.value)} />
                    ) : (
                      <input className="input mt-1 h-8 text-center text-xs" type="number" min={0} max={100} placeholder="0"
                        value={m.score || ''} onChange={e => updateModule(i, 'score', Number(e.target.value))} />
                    )}
                  </div>
                )
              })}
            </div>
            <textarea className="input min-h-16 resize-none py-3" placeholder="备注（可选）" value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={handleSave} className="button-primary"><Save className="h-4 w-4" />保存</button>
              <button onClick={resetForm} className="button-secondary">取消</button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 列表：PC 端横向表格，手机端横向可滚动表格 */}
      {cards.length === 0 && !showForm ? (
        <div className="rounded-2xl border border-[#E6DED3] bg-white p-10 text-center">
          <Calculator className="mx-auto h-12 w-12 text-slate-200" />
          <p className="mt-4 text-base font-semibold">还没有综测记录</p>
          <p className="mt-2 text-sm text-slate-500">新建一条综测成绩记录</p>
          <button type="button" onClick={() => { resetForm(); setShowForm(true) }} className="button-primary mt-5">
            <Plus className="h-4 w-4" />新建记录
          </button>
        </div>
      ) : (
        <section className="rounded-2xl border border-[#E6DED3] bg-white overflow-hidden">
          {/* 提示：手机端可横向滑动 */}
          <div className="overflow-x-auto schedule-table">
            <table className="w-full text-sm border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-[#F5F1EA] text-slate-700">
                  {COLUMNS.map(c => (
                    <th key={c.key} className="border border-[#E6DED3] px-3 py-2.5 text-xs font-semibold text-center whitespace-nowrap">
                      {c.name}
                    </th>
                  ))}
                  <th className="border border-[#E6DED3] px-3 py-2.5 text-xs font-semibold text-center whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {cards.map(card => {
                  const mods: Module[] = JSON.parse(card.modules_json || '[]')
                  const getByKey = (idx: number) => {
                    const t = MODULE_TEMPLATES[idx]
                    const m = mods.find(x => x.name === t.name)
                    return m
                  }
                  return (
                    <tr key={card.id} className="hover:bg-[#FFFDF8]">
                      {/* 标题作为第一行 tooltip（放学号列下方） */}
                      {COLUMNS.map((c, i) => {
                        const m = getByKey(i)
                        const display = c.isComputed
                          ? String(card.total_score ?? computeTotal(mods.length ? mods : emptyModules()))
                          : c.isText
                            ? m?.note || m?.text || '-'
                            : m ? String(m.score) : '-'
                        return (
                          <td key={c.key} className={`border border-[#E6DED3] px-3 py-2 text-center whitespace-nowrap ${c.isComputed ? 'font-bold text-[#6B7A5A]' : 'text-slate-700'}`}>
                            {display}
                          </td>
                        )
                      })}
                      <td className="border border-[#E6DED3] px-3 py-2 text-center whitespace-nowrap">
                        <button onClick={() => startEdit(card)} className="text-xs px-2 py-1 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] mr-1">编辑</button>
                        <button onClick={() => handleDelete(card.id)} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50" aria-label="删除"><Trash2 className="h-3 w-3 inline" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="md:hidden px-3 py-2 text-center text-[11px] text-slate-400">← 左右滑动查看完整表格 →</p>
        </section>
      )}
      {dialog}
    </div>
  )
}
