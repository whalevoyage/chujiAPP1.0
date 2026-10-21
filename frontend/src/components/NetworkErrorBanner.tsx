import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

/**
 * 检测网络状态。
 * 在 Capacitor 原生环境使用 @capacitor/network 插件，
 * 在浏览器环境回退到 navigator.onLine + online/offline 事件。
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    // Capacitor 原生环境
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/network').then(({ Network }) => {
        Network.getStatus().then((s) => setOnline(s.connected))
        Network.addListener('networkStatusChange', (s) => {
          setOnline(s.connected)
        })
      })
      return
    }

    // 浏览器环境
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}

/**
 * 网络不可用时在页面顶部显示提示条。
 * 不影响页面正常渲染——API 调用失败时各页面已有各自的错误处理。
 */
export default function NetworkErrorBanner() {
  const online = useNetworkStatus()

  if (online) return null

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800"
      role="alert"
    >
      <WifiOff className="h-4 w-4 flex-shrink-0" />
      <span>网络不可用，请检查网络连接后重试</span>
    </div>
  )
}
