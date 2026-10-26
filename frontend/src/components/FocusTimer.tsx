import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Square, Timer as TimerIcon, X } from 'lucide-react'
import { endFocus, getFocusTotals, startFocus, type FocusTotalsSummary } from '../api'

const DEFAULT_SECONDS = 45 * 60

function pad(n: number): string { return String(n).padStart(2, '0') }

// 背景主题：默认 / 护眼 / 黑夜 / 深绿（仅四款，简洁）
const BG_MODES = [
  { key: 'normal', bg: '#0d1117', label: '默认', text: 'rgba(255,255,255,0.92)', dim: 'rgba(255,255,255,0.18)' },
  { key: 'eyecare', bg: '#1c2a1f', label: '护眼', text: 'rgba(224,242,205,0.95)', dim: 'rgba(224,242,205,0.22)' },
  { key: 'night', bg: '#000000', label: '黑夜', text: 'rgba(255,255,255,0.92)', dim: 'rgba(255,255,255,0.16)' },
  { key: 'deepgreen', bg: '#0a1f12', label: '深绿', text: 'rgba(180,230,195,0.95)', dim: 'rgba(180,230,195,0.20)' },
]

type Props = { label?: string }

export default function FocusTimer({ label }: Props) {
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'done'>('idle')
  const [remaining, setRemaining] = useState(DEFAULT_SECONDS)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [showFullscreen, setShowFullscreen] = useState(false)
  const [bgKey, setBgKey] = useState('normal')
  const [summary, setSummary] = useState<FocusTotalsSummary>({
    total_sessions: 0, total_minutes: 0, sessions_today: 0, total_minutes_today: 0,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionRef = useRef<number | null>(null)

  const bg = BG_MODES.find(m => m.key === bgKey) ?? BG_MODES[0]

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const refreshSummary = useCallback(async () => {
    try { const s = await getFocusTotals(); setSummary(s) } catch { /* ignore */ }
  }, [])

  useEffect(() => { void refreshSummary() }, [refreshSummary])
  useEffect(() => { return clearTick }, [clearTick])
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  const finishSession = useCallback(async (elapsed: number) => {
    const sid = sessionRef.current
    sessionRef.current = null; setSessionId(null)
    if (sid !== null && elapsed > 0) { try { await endFocus(sid, elapsed) } catch { /* ignore */ } }
    await refreshSummary()
  }, [refreshSummary])

  // 用 ref 维护 remaining，避免 setInterval 闭包旧值
  const remainingRef = useRef(remaining)
  useEffect(() => { remainingRef.current = remaining }, [remaining])

  function tick() {
    const next = remainingRef.current - 1
    if (next <= 0) {
      clearTick()
      setRemaining(0)
      setStatus('done')
      void finishSession(DEFAULT_SECONDS)
      return
    }
    setRemaining(next)
  }

  async function startTimer() {
    try { const s = await startFocus(label ?? null, Math.round(DEFAULT_SECONDS / 60)); setSessionId(s.id); sessionRef.current = s.id } catch { /* ignore */ }
    setRemaining(DEFAULT_SECONDS); remainingRef.current = DEFAULT_SECONDS
    setStatus('running')
    clearTick()
    intervalRef.current = setInterval(tick, 1000)
  }
  function pauseTimer() { clearTick(); setStatus('paused') }
  function resumeTimer() { setStatus('running'); clearTick(); intervalRef.current = setInterval(tick, 1000) }
  async function finishTimer() {
    clearTick()
    const elapsed = DEFAULT_SECONDS - remaining
    setStatus('done')
    await finishSession(Math.max(0, elapsed))
  }
  async function resetTimer() {
    clearTick()
    if (sessionRef.current !== null) {
      const elapsed = DEFAULT_SECONDS - remaining
      if (elapsed > 0) { try { await endFocus(sessionRef.current, elapsed) } catch { /* ignore */ } }
      sessionRef.current = null; setSessionId(null); await refreshSummary()
    }
    setRemaining(DEFAULT_SECONDS); remainingRef.current = DEFAULT_SECONDS
    setStatus('idle')
  }
  async function exitFullscreen() {
    clearTick()
    if (status === 'running' || status === 'paused') {
      const elapsed = DEFAULT_SECONDS - remaining
      if (elapsed > 0) { try { await finishSession(elapsed) } catch { /* ignore */ } }
    }
    setShowFullscreen(false); setStatus('idle'); setRemaining(DEFAULT_SECONDS); remainingRef.current = DEFAULT_SECONDS
  }

  // 横屏监听：仅在 running 时建议横屏（仅提示，不强制旋转）
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  )
  useEffect(() => {
    function onResize() { setIsLandscape(window.innerWidth > window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const totalSec = DEFAULT_SECONDS
  const elapsedSec = Math.max(0, totalSec - remaining)
  const progressPct = totalSec > 0 ? Math.min(100, (elapsedSec / totalSec) * 100) : 0

  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const isIdle = status === 'idle'
  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const isDone = status === 'done'
  const timeFontSize = isLandscape ? 'clamp(5rem, 30vh, 9rem)' : 'clamp(7rem, 24vh, 14rem)'

  const overlay = (
    <div
      className="fixed inset-0 z-50 select-none"
      style={{ backgroundColor: bg.bg, color: bg.text, overflow: 'hidden' }}
    >
      {/* 顶部栏 */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}>
        <button
          type="button"
          onClick={exitFullscreen}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition active:scale-95"
          style={{ color: bg.dim }}
          aria-label="退出专注"
        >
          <X className="h-5 w-5" />
          <span className="hidden sm:inline">退出</span>
        </button>
        {/* 主题切换 */}
        <div className="flex gap-1.5">
          {BG_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setBgKey(m.key)}
              className="rounded-full transition active:scale-95"
              style={{
                width: 18, height: 18,
                backgroundColor: m.bg,
                border: bgKey === m.key ? `2px solid ${bg.text}` : `1px solid ${bg.dim}`,
                transform: bgKey === m.key ? 'scale(1.2)' : 'scale(1)',
              }}
              aria-label={m.label}
            />
          ))}
        </div>
      </div>

      {/* 中央倒计时：独立居中，不被底部按钮和统计挤偏 */}
      <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
        <div className="flex w-full max-w-5xl flex-col items-center gap-4 sm:gap-5">
          <p className="text-[11px] sm:text-xs tracking-[0.4em]" style={{ color: bg.dim }}>
            {isDone ? '已完成' : isRunning ? '专 注 中' : isPaused ? '已 暂 停' : '准 备 开 始'}
          </p>
          {label ? (
            <p className="mt-3 text-base sm:text-lg font-medium wrap-break-word" style={{ color: bg.text }}>
              {label}
            </p>
          ) : null}
          <p className="mt-1 text-xs" style={{ color: bg.dim }}>
            目标 {Math.round(totalSec / 60)} 分钟
          </p>

          {/* 大号倒计时：flex 居中，等宽 tabular-nums，视觉完美对称 */}
          <div
            className="flex items-baseline justify-center tabular-nums leading-none"
            style={{ fontSize: timeFontSize }}
          >
            {h > 0 ? (
              <>
                <span className="inline-block text-center font-thin" style={{ width: '1.15em', color: bg.text }}>{pad(h)}</span>
                <span className="inline-block text-center font-thin" style={{ width: '0.65em', color: bg.dim, fontSize: '0.62em' }}>:</span>
              </>
            ) : null}
            <span className="inline-block text-center font-thin" style={{ width: '1.15em', color: bg.text }}>{pad(m)}</span>
            <span className="inline-block text-center font-thin" style={{ width: '0.65em', color: bg.dim, fontSize: '0.62em' }}>:</span>
            <span className="inline-block text-center font-thin" style={{ width: '1.15em', color: isDone ? '#34d399' : bg.text }}>{pad(s)}</span>
          </div>

          {/* 细进度线（替代圆环，简洁专业） */}
          <div className="h-[3px] w-72 max-w-[78vw] overflow-hidden rounded-full" style={{ backgroundColor: bg.dim }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: isDone ? '#34d399' : bg.text }} />
          </div>
        </div>
      </div>

      {/* 底部区域：按钮 + 统计，竖屏上下排列，横屏左右排列 */}
      <div
        className="absolute left-0 right-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-3 landscape:flex-row landscape:justify-between landscape:gap-4 landscape:px-6"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {/* 控制按钮 */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {(isIdle || isDone) ? (
            <button type="button" onClick={startTimer}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition active:scale-95 landscape:px-5 landscape:py-2 landscape:text-xs"
              style={{ backgroundColor: bg.text, color: bg.bg }}>
              <Play className="h-4 w-4" />开始
            </button>
          ) : null}
          {isRunning ? (
            <button type="button" onClick={pauseTimer}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition active:scale-95 landscape:px-4 landscape:py-2 landscape:text-xs"
              style={{ border: `1px solid ${bg.dim}`, color: bg.text }}>
              <Pause className="h-4 w-4" />暂停
            </button>
          ) : null}
          {isPaused ? (
            <button type="button" onClick={resumeTimer}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition active:scale-95 landscape:px-5 landscape:py-2 landscape:text-xs"
              style={{ backgroundColor: bg.text, color: bg.bg }}>
              <Play className="h-4 w-4" />继续
            </button>
          ) : null}
          {(isRunning || isPaused) ? (
            <button type="button" onClick={finishTimer}
              className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition active:scale-95 landscape:px-3 landscape:py-2 landscape:text-xs"
              style={{ border: `1px solid ${bg.dim}`, color: bg.text }}>
              <Square className="h-3.5 w-3.5" />结束
            </button>
          ) : null}
          {!isIdle ? (
            <button type="button" onClick={resetTimer}
              className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition active:scale-95 landscape:px-3 landscape:py-2 landscape:text-xs"
              style={{ border: `1px solid ${bg.dim}`, color: bg.dim }}>
              <RotateCcw className="h-3.5 w-3.5" />重置
            </button>
          ) : null}
        </div>
        {/* 统计：横屏时隐藏以节省空间 */}
        <div className={`items-center gap-4 sm:gap-6 ${isLandscape ? 'hidden' : 'flex'}`}>
          <Stat value={summary.total_sessions} label="总次数" color={bg.text} dim={bg.dim} />
          <Stat value={summary.sessions_today} label="今日次数" color={bg.text} dim={bg.dim} />
          <Stat value={summary.total_minutes_today} label="今日分钟" color={bg.text} dim={bg.dim} />
          <Stat value={summary.total_minutes} label="总分钟" color={bg.text} dim={bg.dim} />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="rounded-2xl border border-[#E6DED3] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TimerIcon className="h-4 w-4 text-[#6B7A5A]" />
            <span>专注</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>总 {summary.total_sessions} 次</span>
            <span>今 {summary.sessions_today} 次</span>
            <span>{summary.total_minutes_today} 分钟</span>
          </div>
        </div>
        <button type="button" onClick={() => setShowFullscreen(true)} className="button-primary mt-3 w-full text-sm">
          开始专注（45 分钟）
        </button>
      </div>
      {showFullscreen ? overlay : null}
    </>
  )
}

function Stat({ value, label, color, dim }: { value: number; label: string; color: string; dim: string }) {
  return (
    <div className="text-center">
      <p className="text-lg sm:text-xl font-semibold tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-0.5 text-[10px]" style={{ color: dim }}>{label}</p>
    </div>
  )
}
