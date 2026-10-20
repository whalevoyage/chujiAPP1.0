import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ExternalLink, Image as ImageIcon, Plus, Save,
  Search, X, XCircle, Calendar, Code, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  createProject, deleteProject, getAttachmentUrl,
  listProjects, updateProject, uploadProjectAttachment,
  type Attachment, type Project, type ProjectCreate,
} from '../api'
import DeletePasswordDialog from '../components/DeletePasswordDialog'

const STATUS_OPTIONS = ['进行中', '已完成', '暂停', '规划中', '已归档']
const emptyForm = { name: '', startDate: '', status: '进行中', techStack: '', summary: '', link: '', nextPlan: '' }

const statusStyle: Record<string, string> = {
  '进行中': 'text-emerald-700 bg-emerald-50',
  '已完成': 'text-slate-600 bg-slate-100',
  '暂停': 'text-amber-700 bg-amber-50',
  '规划中': 'text-sky-700 bg-sky-50',
  '已归档': 'text-stone-500 bg-stone-100',
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [keyword, setKeyword] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [previewImg, setPreviewImg] = useState<Attachment | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try { setProjects(await listProjects(keyword.trim() || undefined)) }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败') }
    finally { setLoading(false) }
  }, [keyword])

  useEffect(() => { void loadData() }, [loadData])

  function resetForm() { setForm({ ...emptyForm }); setEditingId(null); setShowForm(false) }

  function startEdit(p: Project) {
    setForm({
      name: p.name, startDate: p.start_date ?? '',
      status: p.status, techStack: p.tech_stack ?? '', summary: p.summary ?? '',
      link: p.link ?? '', nextPlan: p.next_plan ?? p.achievements ?? '',
    })
    setEditingId(p.id); setShowForm(true); setError('')
  }

  function updateForm<K extends keyof typeof form>(k: K, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim()) { setError('请填写项目名称'); return }
    setError('')
    const payload: ProjectCreate = {
      name: form.name.trim(), project_type: null,
      start_date: form.startDate || null, status: form.status,
      tech_stack: form.techStack.trim() || null, summary: form.summary.trim() || null,
      link: form.link.trim() || null, achievements: null,
      next_plan: form.nextPlan.trim() || null,
    }
    try {
      if (editingId === null) { await createProject(payload); setMessage('项目已添加') }
      else { await updateProject(editingId, payload); setMessage('项目已更新') }
      resetForm(); await loadData()
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
  }

  function handleDelete(project: Project) {
    setPendingDelete(project)
  }

  async function confirmDelete(password: string) {
    if (!pendingDelete) return
    setDeleting(true); setError('')
    try {
      await deleteProject(pendingDelete.id, password)
      setPendingDelete(null)
      setMessage('已删除')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  async function handleUpload(projectId: number, file: File) {
    setUploadingId(projectId); setError('')
    try { await uploadProjectAttachment(projectId, file); setMessage('截图已上传'); await loadData() }
    catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setUploadingId(null) }
  }

  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10 text-center text-slate-400">加载中...</div>

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#E6DED3] bg-white hover:bg-[#F5F1EA]" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-wide">项目库</h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => { resetForm(); setShowForm(true) }} className="button-primary text-xs">
            <Plus className="h-4 w-4" />添加项目
          </button>
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="搜索项目..." value={keyword}
              onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadData()} />
          </div>
          {projects.length > 0 ? (
            <span className="text-xs text-slate-400">{projects.length} 个项目</span>
          ) : null}
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      {showForm ? (
        <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
          <h2 className="text-base font-bold mb-4">{editingId ? '编辑项目' : '添加项目'}</h2>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="项目名称" value={form.name} onChange={e => updateForm('name', e.target.value)} autoFocus />
              <input className="input" type="date" value={form.startDate} onChange={e => updateForm('startDate', e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" value={form.status} onChange={e => updateForm('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="input" placeholder="技术栈" value={form.techStack} onChange={e => updateForm('techStack', e.target.value)} />
            </div>
            <input className="input" placeholder="项目链接 / 部署地址" value={form.link} onChange={e => updateForm('link', e.target.value)} />
            <textarea className="input min-h-16 resize-none py-3" placeholder="项目简介" value={form.summary} onChange={e => updateForm('summary', e.target.value)} />
            <textarea className="input min-h-16 resize-none py-3" placeholder="备注" value={form.nextPlan} onChange={e => updateForm('nextPlan', e.target.value)} />
            <div className="flex gap-2">
              <button onClick={handleSave} className="button-primary"><Save className="h-4 w-4" />保存</button>
              <button onClick={resetForm} className="button-secondary"><XCircle className="h-4 w-4" />取消</button>
            </div>
          </div>
        </section>
      ) : null}

      {projects.length === 0 ? (
        <div className="py-20 text-center rounded-2xl border border-dashed border-[#E6DED3] bg-[#FFFDF8]">
          <Code className="mx-auto h-14 w-14 text-slate-200" />
          <p className="mt-5 text-base font-semibold text-slate-600">还没有项目记录</p>
          <p className="mt-2 text-sm text-slate-400">记录你的每一个项目，积累成长足迹</p>
          <button onClick={() => { resetForm(); setShowForm(true) }} className="button-primary mt-6">
            <Plus className="h-4 w-4" />添加第一个项目
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} uploading={uploadingId === p.id}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onEdit={startEdit} onDelete={handleDelete} onUpload={handleUpload}
              onPreviewImage={setPreviewImg} />
          ))}
        </div>
      )}

      {previewImg ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={() => setPreviewImg(null)}>
          <button onClick={() => setPreviewImg(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl text-white/60 hover:text-white">
            <X className="h-6 w-6" />
          </button>
          <img src={getAttachmentUrl(previewImg.id)} alt="" className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      ) : null}

      <DeletePasswordDialog
        open={Boolean(pendingDelete)}
        title="删除项目"
        description={`确认删除项目「${pendingDelete?.name ?? ''}」？请输入删除密码。`}
        loading={deleting}
        error={error}
        onCancel={() => { setPendingDelete(null); setError('') }}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function ProjectCard({ project, uploading, expanded, onToggle, onEdit, onDelete, onUpload, onPreviewImage }: {
  project: Project; uploading: boolean; expanded: boolean
  onToggle: () => void; onEdit: (p: Project) => void; onDelete: (project: Project) => void
  onUpload: (id: number, f: File) => void; onPreviewImage: (a: Attachment) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const images = project.attachments.filter(a => a.mime_type?.startsWith('image/'))
  const note = project.next_plan || project.achievements
  const hasDetails = Boolean(note)

  return (
    <article className="rounded-2xl border border-[#E6DED3] bg-white overflow-hidden">
      {/* Main row: always visible */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F5F1EA] text-[#6B7A5A]">
            <Code className="h-5 w-5" />
          </div>

          {/* Core info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-slate-800">{project.name}</h3>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusStyle[project.status] || statusStyle['进行中']}`}>
                {project.status}
              </span>
            </div>

            {/* Summary */}
            {project.summary ? (
              <p className="mt-1.5 text-xs text-slate-500 line-clamp-2 leading-relaxed">{project.summary}</p>
            ) : null}

            {/* Meta row */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              {project.start_date ? (
                <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{project.start_date}</span>
              ) : null}
              {project.tech_stack ? (
                <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
                  {project.tech_stack.split(/[,，、\s]+/).filter(Boolean).slice(0, 3).join(' / ')}
                </span>
              ) : null}
              {project.link ? (
                <a href={project.link} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#6B7A5A] hover:underline">
                  <ExternalLink className="h-3 w-3" />链接
                </a>
              ) : null}
              {project.attachment_count > 0 ? (
                <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />{project.attachment_count} 图</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Screenshots row */}
        {images.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {images.map(img => (
              <button key={img.id} onClick={() => onPreviewImage(img)}
                className="h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-[#E6DED3] bg-[#F5F1EA]">
                <img src={getAttachmentUrl(img.id)} alt="" className="h-full w-full object-cover hover:scale-105 transition" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-3 flex items-center gap-1.5">
          <button onClick={() => onEdit(project)}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-600 transition">
            编辑
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-500 transition">
            {uploading ? '...' : '传截图'}
          </button>
          {hasDetails ? (
            <button onClick={onToggle}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[#E6DED3] hover:bg-[#F5F1EA] text-slate-500 transition flex items-center gap-1">
              {expanded ? <><ChevronUp className="h-3 w-3" />收起</> : <><ChevronDown className="h-3 w-3" />详情</>}
            </button>
          ) : null}
          <button onClick={() => onDelete(project)}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 ml-auto transition">
            删除
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(project.id, f); e.target.value = '' } }} />
        </div>
      </div>

      {/* Expandable details */}
      {expanded && hasDetails ? (
        <div className="border-t border-[#F5F1EA] bg-[#FFFDF8] px-4 py-3 space-y-3">
          {note ? (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">备注</p>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{note}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
