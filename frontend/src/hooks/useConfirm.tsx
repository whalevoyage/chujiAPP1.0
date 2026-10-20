import { useCallback, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

export type ConfirmOptions = {
  title: string
  message: string
  cancelText?: string
  confirmText?: string
}

export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        setState({ ...options, resolve })
      }),
    [],
  )

  const dialog = state ? (
    <ConfirmDialog
      open={true}
      title={state.title}
      message={state.message}
      cancelText={state.cancelText ?? '取消'}
      confirmText={state.confirmText ?? '确认'}
      onCancel={() => {
        state.resolve(false)
        setState(null)
      }}
      onConfirm={() => {
        state.resolve(true)
        setState(null)
      }}
    />
  ) : null

  return { confirm, dialog }
}
