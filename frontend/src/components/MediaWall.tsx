import { useEffect, useState } from 'react'
import { Download, Image as ImageIcon, Trash2, X } from 'lucide-react'
import { apiRequest, deleteAttachment, getAttachmentUrl, type Attachment } from '../api'
import { useConfirm } from '../hooks/useConfirm'
import DeletePasswordDialog from './DeletePasswordDialog'

type Props = {
  open: boolean
  onClose: () => void
}

export default function MediaWall({ open, onClose }: Props) {
  const [items, setItems] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const { confirm, dialog } = useConfirm()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiRequest<Attachment[]>('/api/attachments/all')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const images = items.filter((a) => Boolean(a.mime_type?.startsWith('image/')) || /\.(jpe?g|png|webp)$/i.test(a.filename))

  async function confirmDelete(password: string) {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteAttachment(pendingDelete.id, password)
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id))
      if (preview?.id === pendingDelete.id) setPreview(null)
      setPendingDelete(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#F7F4EE]">
      {/* 顶部 */}
      <div className="flex items-center gap-3 border-b border-[#E6DED3] bg-white px-4 py-3">
        <ImageIcon className="h-5 w-5 text-[#6B7A5A]" />
        <span className="flex-1 text-base font-bold">回忆图片墙</span>
        <span className="text-xs text-slate-400">{images.length} 张</span>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-[#F5F1EA]">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
        ) : images.length === 0 ? (
          <div className="py-16 text-center">
            <ImageIcon className="mx-auto h-12 w-12 text-slate-200" />
            <p className="mt-4 text-sm text-slate-400">还没有上传图片</p>
            <p className="mt-1 text-xs text-slate-400">在荣誉墙或回忆图片墙上传后，会在这里显示</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setPreview(img)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-[#E6DED3] bg-white"
              >
                <img
                  src={getAttachmentUrl(img.id)}
                  alt={img.filename}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition">
                  <p className="truncate text-[10px] text-white">{img.filename}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 预览弹层 */}
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setPreview(null)}>
          <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl text-white/70 hover:text-white">
            <X className="h-6 w-6" />
          </button>
          <img
            src={getAttachmentUrl(preview.id)}
            alt={preview.filename}
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-6 flex gap-2">
            <a
              href={getAttachmentUrl(preview.id)}
              download={preview.filename}
              className="flex items-center gap-1 rounded-full bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/20"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3 w-3" />下载原图
            </a>
            <button
              type="button"
              className="flex items-center gap-1 rounded-full bg-red-500/20 px-4 py-2 text-xs text-white hover:bg-red-500/30"
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await confirm({ title: '确认删除', message: '确定删除这张图片吗？删除后不可恢复。', confirmText: '确认删除' })
                if (ok) setPendingDelete(preview)
              }}
            >
              <Trash2 className="h-3 w-3" />删除
            </button>
          </div>
        </div>
      ) : null}

      <DeletePasswordDialog
        open={Boolean(pendingDelete)}
        title="删除图片"
        description={deleteError || `确认删除「${pendingDelete?.filename ?? ''}」？请输入删除密码。`}
        loading={deleting}
        onCancel={() => { setPendingDelete(null); setDeleteError('') }}
        onConfirm={confirmDelete}
      />
      {dialog}
    </div>
  )
}
