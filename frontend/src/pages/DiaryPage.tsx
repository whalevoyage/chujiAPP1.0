import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Check, Edit3, RotateCcw, Search, Star, Trash2, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createDiary, deleteDiary, listDiary, restoreDiary, searchDiary, updateDiary, type DiaryEntry } from '../api'
import { useConfirm } from '../hooks/useConfirm'

const moods = ['', '平静', '开心', '焦虑', '疲惫', '低落', '充实']

type DiaryForm = { title: string; content: string; entryDate: string; mood: string; tags: string; isStarred: boolean; isPrivate: boolean }

const emptyForm: DiaryForm = { title: '', content: '', entryDate: localDateValue(), mood: '', tags: '', isStarred: false, isPrivate: false }

function localDateValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function parseTags(value: string) { return value.split(/[,，、\s]+/).map(t => t.trim()).filter(Boolean) }
function tagsToInput(tags: string[]) { return tags.join(', ') }
function summary(content: string) { const p = content.replace(/\s+/g, ' ').trim(); return p.length > 120 ? p.slice(0, 120) + '...' : p }

export default function DiaryPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [form, setForm] = useState<DiaryForm>(emptyForm)
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const { confirm, dialog } = useConfirm()

  const loadEntries = useCallback(async () => {
    setLoading(true); setError('')
    try { setEntries(await listDiary(includeDeleted)) }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }, [includeDeleted])

  useEffect(() => { void loadEntries() }, [loadEntries])

  function updateForm<K extends keyof DiaryForm>(f: K, v: DiaryForm[K]) { setForm(c => ({ ...c, [f]: v })) }
  function resetForm() { setForm({ ...emptyForm, entryDate: localDateValue() }); setEditingEntryId(null) }

  async function handleSubmit() {
    if (!form.content.trim()) { setError('请填写日记正文'); return }
    setError(''); setMessage('')
    try {
      const payload = { title: form.title.trim() || null, content_md: form.content.trim(), entry_date: form.entryDate, mood: form.mood || null, tags: parseTags(form.tags), is_starred: form.isStarred, is_private: form.isPrivate }
      if (editingEntryId === null) { await createDiary(payload); setMessage('日记已保存') }
      else { await updateDiary(editingEntryId, payload); setMessage('日记已更新') }
      resetForm(); await loadEntries()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
  }

  function startEdit(entry: DiaryEntry) {
    setEditingEntryId(entry.id)
    setForm({ title: entry.title, content: entry.content_md, entryDate: entry.entry_date, mood: entry.mood ?? '', tags: tagsToInput(entry.tags), isStarred: entry.is_starred, isPrivate: entry.is_private })
    setMessage(''); setError('')
  }

  async function handleDelete(entryId: number) {
    const ok = await confirm({ title: '确认删除？', message: '删除后不可恢复，请谨慎操作。', confirmText: '确认删除' }); if (!ok) return
    try { await deleteDiary(entryId); setMessage('日记已删除'); await loadEntries() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
  }

  async function handleRestore(entryId: number) {
    try { await restoreDiary(entryId); setMessage('日记已恢复'); await loadEntries() }
    catch (err) { setError(err instanceof Error ? err.message : '恢复失败') }
  }

  async function handleSearch() {
    setLoading(true); setError(''); setMessage('')
    try {
      const q = searchQuery.trim()
      setEntries(q ? await searchDiary(q, includeDeleted) : await listDiary(includeDeleted))
    } catch (err) { setError(err instanceof Error ? err.message : '搜索失败') }
    finally { setLoading(false) }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide text-slate-800">我的日记</h1>
          </div>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {/* 写日记表单 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <div className="flex items-center gap-2 text-base font-bold text-slate-800">
          <BookOpen className="h-4 w-4 text-[#6B7A5A]" />
          {editingEntryId === null ? '写日记' : '编辑日记'}
        </div>
        <div className="mt-4 grid gap-3">
          <input className="input" placeholder="标题" value={form.title} onChange={e => updateForm('title', e.target.value)} />
          <textarea className="input min-h-40 resize-none py-3" placeholder="正文" value={form.content} onChange={e => updateForm('content', e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="input" type="date" value={form.entryDate} onChange={e => updateForm('entryDate', e.target.value)} />
            <select className="input" value={form.mood} onChange={e => updateForm('mood', e.target.value)}>
              {moods.map(m => <option key={m} value={m}>{m || '心情'}</option>)}
            </select>
            <input className="input" placeholder="标签，逗号分隔" value={form.tags} onChange={e => updateForm('tags', e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.isStarred} onChange={e => updateForm('isStarred', e.target.checked)} />加星</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.isPrivate} onChange={e => updateForm('isPrivate', e.target.checked)} />私密</label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={handleSubmit} className="button-primary text-xs"><Check className="h-3 w-3" />保存</button>
              <button type="button" onClick={resetForm} className="button-secondary text-xs"><XCircle className="h-3 w-3" />取消</button>
            </div>
          </div>
        </div>
      </section>

      {/* 搜索 + 列表 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input className="input" placeholder="搜索标题或正文" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleSearch()} />
          <button type="button" onClick={handleSearch} className="button-secondary text-xs"><Search className="h-3 w-3" />搜索</button>
          <button type="button" onClick={() => setIncludeDeleted(v => !v)} className="button-secondary text-xs">
            {includeDeleted ? '隐藏已删除' : '查看已删除'}
          </button>
        </div>

        {loading ? (
          <p className="mt-6 py-4 text-center text-sm text-slate-400">加载中...</p>
        ) : entries.length === 0 ? (
          <div className="mt-6 py-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-semibold text-slate-500">还没有日记</p>
            <p className="mt-1 text-xs text-slate-400">在上方写一篇日记开始记录</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {entries.map(entry => (
              <article key={entry.id} className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 truncate text-base font-bold text-slate-700">{entry.title}</h2>
                      {entry.is_starred ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
                      {entry.is_private ? <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">私密</span> : null}
                      {entry.is_deleted ? <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-500">已删除</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{entry.entry_date}{entry.mood ? ' / ' + entry.mood : ''}</p>
                    <p className="mt-3 break-words text-sm leading-6 text-slate-600">{summary(entry.content_md)}</p>
                    {entry.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {entry.tags.map(tag => <span key={tag} className="rounded-full bg-[#F5F1EA] px-2 py-0.5 text-[10px] text-[#6B7A5A]">{tag}</span>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => startEdit(entry)} className="button-secondary text-xs"><Edit3 className="h-3 w-3" />编辑</button>
                    {entry.is_deleted ? (
                      <button type="button" onClick={() => handleRestore(entry.id)} className="button-secondary text-xs"><RotateCcw className="h-3 w-3" />恢复</button>
                    ) : (
                      <button type="button" onClick={() => handleDelete(entry.id)} className="button-danger text-xs"><Trash2 className="h-3 w-3" />删除</button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {dialog}
    </div>
  )
}
