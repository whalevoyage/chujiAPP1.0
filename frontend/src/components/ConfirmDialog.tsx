type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  cancelText?: string
  confirmText?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  cancelText = '取消',
  confirmText = '确认',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 active:scale-95"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
