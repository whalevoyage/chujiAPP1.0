import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Download, FileText, Plus, Save, Search,
  Trophy, Upload, X,
} from 'lucide-react'
import {
  createHonor, deleteAttachment, deleteHonor, getAttachmentUrl, listHonors,
  updateHonor, uploadAttachment, type Attachment, type Honor,
} from '../api'
import DeletePasswordDialog from '../components/DeletePasswordDialog'

type HonorForm = {
  title: string; honorType: string; level: string; issuer: string
  awardDate: string; role: string; weight: number; description: string
}

const emptyForm: HonorForm = { title: '', honorType: '', level: '', issuer: '', awardDate: '', role: '', weight: 5, description: '' }

function formFromHonor(h: Honor): HonorForm {
  return { title: h.title, honorType: h.honor_type, level: h.level ?? '', issuer: h.issuer ?? '', awardDate: h.award_date ?? '', role: h.role ?? '', weight: h.weight, description: h.description ?? '' }
}

function isImage(a: Attachment) { return Boolean(a.mime_type?.startsWith('image/')) || /\.(jpe?g|png|webp)$/i.test(a.filename) }

export default function HonorsPage() {
  const navigate = useNavigate()
  const [honors, setHonors] = useState<Honor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<HonorForm>(emptyForm)
  const [keyword, setKeyword] = useState('')
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ images: Attachment[]; index: number } | null>(null)
  const [pendingDeleteHonor, setPendingDeleteHonor] = useState<Honor | null>(null)
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState<Attachment | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try { setHonors(await listHonors({ q: keyword.trim() || undefined })) }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }, [keyword])

  useEffect(() => { void loadData() }, [loadData])

  const groups = useMemo(() => ({
    core: honors.filter(h => h.weight >= 8),
    normal: honors.filter(h => h.weight >= 3 && h.weight <= 7),
    small: honors.filter(h => h.weight <= 2),
  }), [honors])

  function updateForm<K extends keyof HonorForm>(f: K, v: HonorForm[K]) { setForm(c => ({ ...c, [f]: v })) }
  function resetForm() { setForm({ ...emptyForm }); setEditingId(null); setShowForm(false) }

  function startEdit(h: Honor) { setForm(formFromHonor(h)); setEditingId(h.id); setShowForm(true); setError('') }

  async function handleSave() {
    if (!form.title.trim() || !form.honorType.trim()) { setError('请填写荣誉名称和类型'); return }
    setError('')
    const payload = { title: form.title.trim(), honor_type: form.honorType.trim(), level: form.level.trim() || null, issuer: form.issuer.trim() || null, award_date: form.awardDate || null, role: form.role.trim() || null, weight: form.weight, description: form.description.trim() || null }
    try {
      if (editingId === null) { await createHonor(payload); setMessage('荣誉已创建') }
      else { await updateHonor(editingId, payload); setMessage('荣誉已更新') }
      resetForm(); await loadData()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
  }

  function handleDelete(h: Honor) {
    setPendingDeleteHonor(h)
  }

  async function handleUpload(honorId: number, file: File) {
    setUploadingId(honorId); setError('')
    try { await uploadAttachment('honor', honorId, file); setMessage('附件已上传'); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setUploadingId(null) }
  }

  function handleDeleteAttachment(a: Attachment) {
    setPendingDeleteAttachment(a)
  }

  async function confirmDelete(password: string) {
    setDeleting(true); setError('')
    try {
      if (pendingDeleteHonor) {
        await deleteHonor(pendingDeleteHonor.id, password)
        setMessage('已删除')
      }
      if (pendingDeleteAttachment) {
        await deleteAttachment(pendingDeleteAttachment.id, password)
        setMessage('附件已删除')
      }
      setPendingDeleteHonor(null)
      setPendingDeleteAttachment(null)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">荣誉墙</h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { resetForm(); setShowForm(true) }} className="button-primary text-xs">
            <Plus className="h-4 w-4" />新增荣誉
          </button>
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="搜索荣誉..." value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadData()} />
          </div>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-400/30 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {showForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold mb-4">{editingId ? '编辑荣誉' : '新增荣誉'}</h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" placeholder="荣誉名称" value={form.title} onChange={e => updateForm('title', e.target.value)} autoFocus />
              <input className="input" placeholder="荣誉类型（如：奖学金、竞赛、证书）" value={form.honorType} onChange={e => updateForm('honorType', e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <input className="input" placeholder="级别" value={form.level} onChange={e => updateForm('level', e.target.value)} />
              <input className="input" placeholder="主办方" value={form.issuer} onChange={e => updateForm('issuer', e.target.value)} />
              <input className="input" type="date" value={form.awardDate} onChange={e => updateForm('awardDate', e.target.value)} />
              <input className="input" placeholder="我的角色" value={form.role} onChange={e => updateForm('role', e.target.value)} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-600">权重：{form.weight}</span>
              <input className="w-full accent-[#6B7A5A]" type="range" min={1} max={10} value={form.weight} onChange={e => updateForm('weight', Number(e.target.value))} />
            </label>
            <textarea className="input min-h-20 resize-none py-3" placeholder="描述" value={form.description} onChange={e => updateForm('description', e.target.value)} />
            <div className="flex gap-2">
              <button onClick={handleSave} className="button-primary"><Save className="h-4 w-4" />保存</button>
              <button onClick={resetForm} className="button-secondary">取消</button>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : honors.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-[#E6DED3] bg-white">
          <Trophy className="mx-auto h-12 w-12 text-slate-200" />
          <p className="mt-4 text-base font-semibold">还没有荣誉记录</p>
          <p className="mt-2 text-sm text-slate-500">添加你的第一个荣誉</p>
          <button onClick={() => { resetForm(); setShowForm(true) }} className="button-primary mt-5">
            <Plus className="h-4 w-4" />新增荣誉
          </button>
        </div>
      ) : (
        <>
          <HonorSection title="核心荣誉（权重 8-10）" honors={groups.core} uploadingId={uploadingId}
            onEdit={startEdit} onDelete={handleDelete} onUpload={handleUpload}
            onDeleteAttachment={handleDeleteAttachment}
            onPreview={(imgs, idx) => setPreview({ images: imgs, index: idx })} />
          <HonorSection title="普通荣誉（权重 3-7）" honors={groups.normal} uploadingId={uploadingId}
            onEdit={startEdit} onDelete={handleDelete} onUpload={handleUpload}
            onDeleteAttachment={handleDeleteAttachment}
            onPreview={(imgs, idx) => setPreview({ images: imgs, index: idx })} />
          <HonorSection title="小成就（权重 1-2）" honors={groups.small} uploadingId={uploadingId}
            onEdit={startEdit} onDelete={handleDelete} onUpload={handleUpload}
            onDeleteAttachment={handleDeleteAttachment}
            onPreview={(imgs, idx) => setPreview({ images: imgs, index: idx })} />
        </>
      )}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute right-4 top-4 text-white/70 hover:text-white"><X className="h-6 w-6" /></button>
          {preview.images.length > 1 ? <p className="absolute left-4 top-4 rounded-xl bg-black/50 px-3 py-1.5 text-sm text-white">{preview.index + 1}/{preview.images.length}</p> : null}
          <img src={getAttachmentUrl(preview.images[preview.index].id)} alt="" className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
          <a href={getAttachmentUrl(preview.images[preview.index].id)} download className="absolute bottom-6 right-6 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20" onClick={e => e.stopPropagation()}><Download className="mr-2 inline h-4 w-4" />下载</a>
        </div>
      ) : null}

      <DeletePasswordDialog
        open={Boolean(pendingDeleteHonor || pendingDeleteAttachment)}
        title={pendingDeleteHonor ? '删除荣誉' : '删除附件'}
        description={
          pendingDeleteHonor
            ? `确认删除荣誉「${pendingDeleteHonor.title}」？请输入删除密码。`
            : `确认删除附件「${pendingDeleteAttachment?.filename ?? ''}」？请输入删除密码。`
        }
        loading={deleting}
        error={error}
        onCancel={() => { setPendingDeleteHonor(null); setPendingDeleteAttachment(null); setError('') }}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function HonorSection({ title, honors, uploadingId, onEdit, onDelete, onUpload, onDeleteAttachment, onPreview }: {
  title: string; honors: Honor[]; uploadingId: number | null
  onEdit: (h: Honor) => void; onDelete: (h: Honor) => void
  onUpload: (id: number, f: File) => void; onDeleteAttachment: (a: Attachment) => void
  onPreview: (images: Attachment[], idx: number) => void
}) {
  const [open, setOpen] = useState(true)
  if (honors.length === 0) return null
  return (
    <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <h2 className="text-lg font-extrabold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{honors.length} 项</p>
        </div>
        <span className="text-sm text-slate-500">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {honors.map(h => (
            <HonorCard key={h.id} honor={h} uploading={uploadingId === h.id}
              onEdit={onEdit} onDelete={onDelete} onUpload={onUpload}
              onDeleteAttachment={onDeleteAttachment} onPreview={onPreview} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function HonorCard({ honor, uploading, onEdit, onDelete, onUpload, onDeleteAttachment, onPreview }: {
  honor: Honor; uploading: boolean
  onEdit: (h: Honor) => void; onDelete: (h: Honor) => void
  onUpload: (id: number, f: File) => void; onDeleteAttachment: (a: Attachment) => void
  onPreview: (images: Attachment[], idx: number) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const images = honor.attachments.filter(isImage)
  const mainImg = images[0] ?? null

  return (
    <article className="rounded-2xl border border-[#E6DED3] bg-[#FFFDF8] overflow-hidden">
      {/* 主图片区域 — 自适应 */}
      {mainImg ? (
        <button type="button" onClick={() => onPreview([mainImg], 0)}
          className="block w-full aspect-4/3 overflow-hidden bg-[#F5F1EA]">
          <img src={getAttachmentUrl(mainImg.id)} alt={honor.title}
            className="h-full w-full object-cover hover:scale-105 transition" loading="lazy" />
        </button>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex w-full aspect-4/3 items-center justify-center bg-[#F5F1EA] hover:bg-[#EFE9DD] transition">
          <div className="text-center">
            <Upload className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-xs text-slate-400">上传证书或图片</p>
          </div>
        </button>
      )}

      <div className="p-4">
        <div className="flex items-start gap-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#6B7A5A]/20 bg-[#F5F1EA] text-[#6B7A5A]">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm">{honor.title}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge>{honor.honor_type}</Badge>
              {honor.level ? <Badge>{honor.level}</Badge> : null}
              <Badge>权重 {honor.weight}</Badge>
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-1 text-[11px] text-slate-500">
          <p>主办方：{honor.issuer || '-'}</p>
          <p>获得日期：{honor.award_date || '-'}</p>
          {honor.role ? <p>角色：{honor.role}</p> : null}
        </div>

        {honor.description ? (
          <p className="mt-2 text-xs text-slate-500 line-clamp-2 leading-relaxed">{honor.description.replace(/\s+/g, ' ').trim()}</p>
        ) : null}

        {/* 附件列表 */}
        {honor.attachments.filter(a => !isImage(a)).length > 0 ? (
          <div className="mt-2 space-y-1">
            {honor.attachments.filter(a => !isImage(a)).map(a => (
              <div key={a.id} className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="flex items-center gap-1 truncate"><FileText className="h-3 w-3 shrink-0" />{a.filename}</span>
                <div className="flex gap-1 shrink-0">
                  <a href={getAttachmentUrl(a.id)} target="_blank" rel="noreferrer" className="text-[#6B7A5A] hover:underline">查看</a>
                  <button onClick={() => onDeleteAttachment(a)} className="text-red-400 hover:text-red-600">删除</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex gap-1.5">
          <button onClick={() => onEdit(honor)} className="text-[11px] px-2 py-1 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA]">编辑</button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-[11px] px-2 py-1 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-500">
            {uploading ? '上传中...' : '传图'}
          </button>
          <button onClick={() => onDelete(honor)} className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 ml-auto">删除</button>
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(honor.id, f); e.target.value = '' } }} />
        </div>
      </div>
    </article>
  )
}

function Badge({ children }: { children: import('react').ReactNode }) {
  return <span className="rounded-md border border-[#E6DED3] bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{children}</span>
}
