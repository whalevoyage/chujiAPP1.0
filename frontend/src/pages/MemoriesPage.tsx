import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Download, Image as ImageIcon,
  MapPin, Plus, Search, Upload, X, Calendar,
} from 'lucide-react'
import {
  createMemory, deleteMemory, getAttachmentUrl,
  listMemories, updateMemory, uploadMemoryAttachment,
  type Attachment, type Memory, type MemoryCreate,
} from '../api'
import { useConfirm } from '../hooks/useConfirm'
import DeletePasswordDialog from '../components/DeletePasswordDialog'

const emptyForm = { title: '', photoDate: '', location: '', story: '', tags: '' }

function isImage(a: Attachment) { return Boolean(a.mime_type?.startsWith('image/')) || /\.(jpe?g|png|webp)$/i.test(a.filename) }

export default function MemoriesPage() {
  const navigate = useNavigate()
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [keyword, setKeyword] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ images: Attachment[]; index: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { confirm, dialog } = useConfirm()

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try { setMemories(await listMemories(keyword.trim() || undefined)) }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }, [keyword])

  useEffect(() => { void loadData() }, [loadData])

  function resetForm() { setForm({ ...emptyForm }); setEditingId(null); setShowForm(false) }

  function startEdit(m: Memory) {
    setForm({ title: m.title, photoDate: m.photo_date ?? '', location: m.location ?? '', story: m.story ?? '', tags: m.tags.join(', ') })
    setEditingId(m.id); setShowForm(true); setError('')
  }

  function updateForm<K extends keyof typeof form>(k: K, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.title.trim()) { setError('请填写照片标题'); return }
    setError('')
    const payload: MemoryCreate = {
      title: form.title.trim(), photo_date: form.photoDate || null,
      location: form.location.trim() || null, story: form.story.trim() || null,
      tags: form.tags.split(/[,，、\s]+/).filter(Boolean),
    }
    try {
      if (editingId === null) { await createMemory(payload); setMessage('已添加回忆') }
      else { await updateMemory(editingId, payload); setMessage('已更新回忆') }
      resetForm(); await loadData()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
  }

  async function handleDelete(memory: Memory) {
    const ok = await confirm({ title: '确认删除？', message: `确定删除回忆「${memory.title}」吗？`, confirmText: '确认删除' })
    if (!ok) return
    setPendingDelete(memory)
  }

  async function confirmDelete(password: string) {
    if (!pendingDelete) return
    setDeleting(true); setError('')
    try {
      await deleteMemory(pendingDelete.id, password)
      setPendingDelete(null)
      setMessage('已删除')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  async function handleUpload(memoryId: number, file: File) {
    setUploadingId(memoryId); setError('')
    try { await uploadMemoryAttachment(memoryId, file); setMessage('照片已上传'); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setUploadingId(null) }
  }

  function openPreview(images: Attachment[], idx: number) { setPreview({ images, index: idx }) }

  // Handle keyboard nav in lightbox
  useEffect(() => {
    if (!preview) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreview(null)
      if (e.key === 'ArrowLeft') setPreview(p => p ? { ...p, index: Math.max(0, p.index - 1) } : null)
      if (e.key === 'ArrowRight') setPreview(p => p ? { ...p, index: Math.min(p.images.length - 1, p.index + 1) } : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">回忆图片墙</h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { resetForm(); setShowForm(true) }} className="button-primary text-xs">
            <Plus className="h-4 w-4" />添加回忆
          </button>
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="搜索回忆..." value={keyword}
              onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadData()} />
          </div>
          {memories.length > 0 ? (
            <span className="self-center text-xs text-slate-400">{memories.length} 张回忆</span>
          ) : null}
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {showForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold mb-4">{editingId ? '编辑回忆' : '添加回忆'}</h2>
          <div className="grid gap-3">
            <input className="input" placeholder="照片标题" value={form.title} onChange={e => updateForm('title', e.target.value)} autoFocus />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" type="date" value={form.photoDate} onChange={e => updateForm('photoDate', e.target.value)} />
              <input className="input" placeholder="地点" value={form.location} onChange={e => updateForm('location', e.target.value)} />
            </div>
            <input className="input" placeholder="标签（逗号分隔，如：旅行, 毕业, 朋友）" value={form.tags} onChange={e => updateForm('tags', e.target.value)} />
            <textarea className="input min-h-20 resize-none py-3" placeholder="写一段简短的故事..." value={form.story} onChange={e => updateForm('story', e.target.value)} />
            <div className="flex gap-2">
              <button onClick={handleSave} className="button-primary">保存</button>
              <button onClick={resetForm} className="button-secondary">取消</button>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-slate-400">加载中...</div>
      ) : memories.length === 0 ? (
        <div className="py-20 text-center rounded-2xl border border-dashed border-[#E6DED3] bg-[#FFFDF8]">
          <ImageIcon className="mx-auto h-14 w-14 text-slate-200" />
          <p className="mt-5 text-base font-semibold text-slate-600">还没有回忆照片</p>
          <p className="mt-2 text-sm text-slate-400">点击下方按钮，添加一张值得记住的照片</p>
          <button onClick={() => { resetForm(); setShowForm(true) }} className="button-primary mt-6">
            <Plus className="h-4 w-4" />添加第一张回忆
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {memories.map(mem => (
            <MemoryCard key={mem.id} memory={mem} uploading={uploadingId === mem.id}
              onEdit={startEdit} onDelete={handleDelete} onUpload={handleUpload} onPreview={openPreview} />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {preview ? (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={() => setPreview(null)}>
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <span className="text-sm text-white/60">{preview.index + 1} / {preview.images.length}</span>
            <button onClick={() => setPreview(null)} className="grid h-10 w-10 place-items-center rounded-xl text-white/60 hover:text-white">
              <X className="h-6 w-6" />
            </button>
          </div>
          {/* Image area */}
          <div className="flex-1 flex items-center justify-center min-h-0 px-4" onClick={e => e.stopPropagation()}>
            <img src={getAttachmentUrl(preview.images[preview.index].id)} alt=""
              className="max-h-full max-w-full rounded-2xl object-contain" />
          </div>
          {/* Bottom controls */}
          <div className="flex items-center justify-between px-4 py-4 shrink-0">
            <button onClick={e => { e.stopPropagation(); setPreview(p => p ? { ...p, index: Math.max(0, p.index - 1) } : null) }}
              disabled={preview.index === 0}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white disabled:opacity-20 hover:bg-white/20 transition">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <a href={getAttachmentUrl(preview.images[preview.index].id)} download
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm text-white hover:bg-white/20 transition">
              <Download className="h-4 w-4" />下载原图
            </a>
            <button onClick={e => { e.stopPropagation(); setPreview(p => p ? { ...p, index: Math.min(p.images.length - 1, p.index + 1) } : null) }}
              disabled={preview.index === preview.images.length - 1}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white disabled:opacity-20 hover:bg-white/20 transition">
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        </div>
      ) : null}

      <DeletePasswordDialog
        open={Boolean(pendingDelete)}
        title="删除回忆"
        description={`确认删除「${pendingDelete?.title ?? ''}」？请输入删除密码。`}
        loading={deleting}
        error={error}
        onCancel={() => { setPendingDelete(null); setError('') }}
        onConfirm={confirmDelete}
      />
      {dialog}
    </div>
  )
}

function MemoryCard({ memory, uploading, onEdit, onDelete, onUpload, onPreview }: {
  memory: Memory; uploading: boolean
  onEdit: (m: Memory) => void; onDelete: (m: Memory) => void
  onUpload: (id: number, f: File) => void; onPreview: (images: Attachment[], idx: number) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const images = memory.attachments.filter(isImage)
  const mainImg = images[0] ?? null

  return (
    <article className="group rounded-2xl border border-[#E6DED3] bg-white overflow-hidden hover:shadow-sm transition-shadow">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-[#F5F1EA]">
        {mainImg ? (
          <button type="button" onClick={() => onPreview(images, 0)} className="block w-full h-full">
            <img src={getAttachmentUrl(mainImg.id)} alt={memory.title}
              className="h-full w-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" />
            {images.length > 1 ? (
              <span className="absolute top-2 right-2 rounded-lg bg-black/50 px-2 py-0.5 text-[10px] text-white">{images.length} 张</span>
            ) : null}
          </button>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex w-full h-full items-center justify-center hover:bg-[#EFE9DD] transition">
            <div className="text-center">
              <Upload className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-xs text-slate-400">点击上传</p>
            </div>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h3 className="font-bold text-sm truncate text-slate-800">{memory.title}</h3>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          {memory.photo_date ? (
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{memory.photo_date}</span>
          ) : null}
          {memory.location ? (
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{memory.location}</span>
          ) : null}
        </div>

        {memory.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {memory.tags.slice(0, 3).map(t => (
              <span key={t} className="rounded-full bg-[#F5F1EA] px-2 py-0.5 text-[10px] text-[#6B7A5A]">{t}</span>
            ))}
            {memory.tags.length > 3 ? (
              <span className="text-[10px] text-slate-400 self-center">+{memory.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}

        {memory.story ? (
          <p className="mt-2.5 text-xs text-slate-500 line-clamp-3 leading-relaxed">{memory.story}</p>
        ) : null}

        {/* Actions */}
        <div className="mt-3 flex items-center gap-1.5 pt-2 border-t border-[#F5F1EA]">
          <button onClick={() => onEdit(memory)}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-600 transition">
            编辑
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-500 transition">
            {uploading ? '...' : '传图'}
          </button>
          <button onClick={() => onDelete(memory)}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 ml-auto transition">
            删除
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(memory.id, f); e.target.value = '' } }} />
        </div>
      </div>
    </article>
  )
}
