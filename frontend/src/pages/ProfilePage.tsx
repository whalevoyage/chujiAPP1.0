import {
  AlertTriangle,
  Archive,
  Award,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Code2,
  Database,
  Download,
  FileJson,
  FileText,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  Package,
  RotateCcw,
  Save,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'

import {
  apiRequest,
  ApiError,
  changeDeletePassword,
  createBackup,
  deleteBackup,
  exportJson,
  exportMarkdown,
  exportZip,
  getApiKeySettings,
  getDeletePasswordStatus,
  importJsonFile,
  listBackups,
  restoreBackup,
  updateApiKeySettings,
  type ApiKeySettings,
  type ApiKeySettingsUpdate,
  type AuthResponse,
  type BackupRecord,
  type DeletePasswordStatus,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog'
import DeletePasswordDialog from '../components/DeletePasswordDialog'
import MediaWall from '../components/MediaWall'
import { useAuth } from '../auth'
import { useConfirm } from '../hooks/useConfirm'
import { InfoCard, LoadingIcon, MoreEntry, PasswordField } from './profile/components'
import { backupStatusLabel as statusLabel, formatBytes, formatDateTime } from './profile/formatters'

type ExportKind = 'json' | 'markdown' | 'zip'

export default function ProfilePage() {
  const { user, logout, setUser } = useAuth()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const canManageServerSettings = isAdmin || Capacitor.isNativePlatform()
  const canManageSystemBackups = isAdmin || Capacitor.isNativePlatform()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dataMessage, setDataMessage] = useState('')
  const [dataError, setDataError] = useState('')
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [backupRecords, setBackupRecords] = useState<BackupRecord[]>([])
  const [backupAction, setBackupAction] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [showDataSafe, setShowDataSafe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKeySettings | null>(null)
  const [aiKey, setAiKey] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [weatherKey, setWeatherKey] = useState('')
  const [weatherApiHost, setWeatherApiHost] = useState('')
  const [ocrKey, setOcrKey] = useState('')
  const [ocrBaseUrl, setOcrBaseUrl] = useState('')
  const [ocrModel, setOcrModel] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyMsg, setKeyMsg] = useState('')
  const [showDeletePassword, setShowDeletePassword] = useState(false)
  const [oldDeletePassword, setOldDeletePassword] = useState('')
  const [newDeletePassword, setNewDeletePassword] = useState('')
  const [confirmDeletePassword, setConfirmDeletePassword] = useState('')
  const [deletePasswordMsg, setDeletePasswordMsg] = useState('')
  const [deletePasswordError, setDeletePasswordError] = useState('')
  const [deletePasswordSaving, setDeletePasswordSaving] = useState(false)
  const [deletePasswordStatus, setDeletePasswordStatus] = useState<DeletePasswordStatus | null>(null)
  const [showMediaWall, setShowMediaWall] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [pendingDeleteBackup, setPendingDeleteBackup] = useState<BackupRecord | null>(null)
  const [pendingRestoreBackup, setPendingRestoreBackup] = useState<BackupRecord | null>(null)
  const [deleteBackupError, setDeleteBackupError] = useState('')
  const [restoreBackupError, setRestoreBackupError] = useState('')

  const refreshBackups = useCallback(async () => {
    setDataError('')
    if (!canManageSystemBackups) {
      setBackupRecords([])
      return
    }
    try {
      setBackupRecords(await listBackups())
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : '备份列表加载失败')
    }
  }, [canManageSystemBackups])

  useEffect(() => { void refreshBackups() }, [refreshBackups])

  const refreshApiKeys = useCallback(async () => {
    try {
      const data = await getApiKeySettings()
      setApiKeys(data)
      setAiBaseUrl(data.ai_base_url)
      setAiModel(data.ai_model)
      setWeatherApiHost(data.weather_api_host)
      setOcrBaseUrl(data.ocr_base_url)
      setOcrModel(data.ocr_model)
    } catch (err) {
      setKeyMsg(err instanceof ApiError ? err.message : 'API Key 配置加载失败')
    }
  }, [])

  useEffect(() => {
    if (showApiKeys) void refreshApiKeys()
  }, [showApiKeys, refreshApiKeys])

  useEffect(() => {
    if (!showDeletePassword) return
    getDeletePasswordStatus().then(setDeletePasswordStatus).catch(() => setDeletePasswordStatus(null))
  }, [showDeletePassword])

  async function handlePasswordChange(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setError('')
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    const okPw = await confirm({ title: '确认修改？', message: '确认修改当前账号密码？', confirmText: '确认修改' })
    if (!okPw) return
    try {
      const data = await apiRequest<AuthResponse>('/api/auth/change-password', {
        method: 'POST',
        body: { old_password: oldPassword, new_password: newPassword },
      })
      setUser(data.user)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已修改')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败')
    }
  }

  async function handleChangeDeletePassword(event: FormEvent) {
    event.preventDefault()
    setDeletePasswordMsg('')
    setDeletePasswordError('')
    if (deletePasswordStatus?.has_password && !oldDeletePassword) { setDeletePasswordError('请输入旧删除密码'); return }
    if (!newDeletePassword) { setDeletePasswordError('请输入新删除密码'); return }
    if (newDeletePassword !== confirmDeletePassword) { setDeletePasswordError('两次输入的新密码不一致'); return }
    const okDel = await confirm({ title: '确认修改？', message: '确认修改删除密码？', confirmText: '确认修改' })
    if (!okDel) return
    setDeletePasswordSaving(true)
    try {
      await changeDeletePassword(oldDeletePassword, newDeletePassword)
      setDeletePasswordStatus({ configured: true, has_password: true })
      setOldDeletePassword('')
      setNewDeletePassword('')
      setConfirmDeletePassword('')
      setDeletePasswordMsg('删除密码已修改')
      setTimeout(() => setDeletePasswordMsg(''), 3000)
    } catch (err) {
      setDeletePasswordError(err instanceof ApiError ? err.message : '修改失败')
    } finally {
      setDeletePasswordSaving(false)
    }
  }

  function handleLogout() {
    setShowLogoutConfirm(true)
  }

  async function confirmLogout() {
    setShowLogoutConfirm(false)
    await logout()
    navigate('/login', { replace: true })
  }

  async function saveApiKeys() {
    setKeySaving(true)
    setKeyMsg('')
    try {
      const payload: ApiKeySettingsUpdate = {
        ai_base_url: aiBaseUrl.trim(),
        ai_model: aiModel.trim(),
        weather_api_host: weatherApiHost.trim(),
        ocr_base_url: ocrBaseUrl.trim(),
        ocr_model: ocrModel.trim(),
      }
      if (aiKey.trim()) payload.ai_api_key = aiKey.trim()
      if (weatherKey.trim()) payload.weather_api_key = weatherKey.trim()
      if (ocrKey.trim()) payload.ocr_api_key = ocrKey.trim()
      const next = await updateApiKeySettings(payload)
      setApiKeys(next)
      setAiKey('')
      setWeatherKey('')
      setOcrKey('')
      setKeyMsg(Capacitor.isNativePlatform() ? 'API Key 已保存到本机；模型和天气调用仍需要联网。' : 'API Key 已保存到服务端 .env，页面不会显示完整 Key')
      setTimeout(() => setKeyMsg(''), 3000)
    } catch (err) {
      setKeyMsg(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setKeySaving(false)
    }
  }

  async function handleExport(kind: ExportKind) {
    setDataMessage('')
    setDataError('')
    setExporting(kind)
    try {
      if (kind === 'json') await exportJson()
      if (kind === 'markdown') await exportMarkdown()
      if (kind === 'zip') await exportZip()
      setDataMessage('导出文件已开始下载')
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : '导出失败')
    } finally {
      setExporting(null)
    }
  }

  async function handleImportJson(file: File | undefined) {
    if (!file) return
    const ok = await confirm({
      title: '导入并替换本机数据？',
      message: '导入会替换这台手机当前保存的记录。请先导出现有数据作为备份。',
      confirmText: '导入并替换',
    })
    if (!ok) return
    setDataMessage('')
    setDataError('')
    try {
      const count = await importJsonFile(file)
      setDataMessage(`导入完成，共导入 ${count} 条记录。`)
      await refreshBackups()
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : '导入失败')
    }
  }

  async function handleCreateBackup() {
    setDataMessage('')
    setDataError('')
    setBackupAction('create')
    try {
      const record = await createBackup()
      setDataMessage(`系统备份已创建：${record.filename}`)
      await refreshBackups()
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : '创建备份失败')
    } finally {
      setBackupAction(null)
    }
  }

  function handleDeleteBackup(record: BackupRecord) {
    setPendingDeleteBackup(record)
    setDeleteBackupError('')
  }

  async function confirmDeleteBackup(password: string) {
    if (!pendingDeleteBackup) return
    setDeleteBackupError('')
    setBackupAction(`delete-${pendingDeleteBackup.id}`)
    try {
      await deleteBackup(pendingDeleteBackup.id, password)
      setDataMessage('备份已删除')
      setPendingDeleteBackup(null)
      await refreshBackups()
    } catch (err) {
      setDeleteBackupError(err instanceof ApiError ? err.message : '删除备份失败')
    } finally {
      setBackupAction(null)
    }
  }

  async function handleRestoreBackup(record: BackupRecord) {
    const ok1 = await confirm({ title: '确认恢复？', message: `确认恢复备份 ${record.filename}？系统会先自动备份当前数据。`, confirmText: '继续' })
    if (!ok1) return
    const ok2 = await confirm({ title: '二次确认', message: '恢复会替换当前数据库、附件和导出数据，确认继续？', confirmText: '确认恢复' })
    if (!ok2) return
    setPendingRestoreBackup(record)
    setRestoreBackupError('')
  }

  async function confirmRestoreBackup(password: string) {
    if (!pendingRestoreBackup) return
    setDataMessage('')
    setDataError('')
    setBackupAction(`restore-${pendingRestoreBackup.id}`)
    setRestoreBackupError('')
    try {
      const result = await restoreBackup(pendingRestoreBackup.id, password)
      setDataMessage(`恢复完成，当前数据已自动保存为：${result.recovery_backup}`)
      setPendingRestoreBackup(null)
      await refreshBackups()
    } catch (err) {
      setRestoreBackupError(err instanceof ApiError ? err.message : '恢复失败')
    } finally {
      setBackupAction(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-b border-[#E6DED3] pb-4">
        <p className="text-sm font-semibold text-[#6B7A5A]">初记</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-wide">我的</h1>
      </header>

      {Capacitor.isNativePlatform() ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">手机本机版：日记、计划、课表、附件等数据保存在此设备，无需登录服务器。</p>
      ) : null}

      {/* 用户信息 */}
      <section className="grid gap-3 sm:grid-cols-3">
        <InfoCard label="昵称" value={user?.nickname ?? '-'} />
        <InfoCard label="用户名" value={user?.username ?? '-'} />
        <InfoCard label="角色" value={isAdmin ? '管理员' : '普通用户'} />
      </section>

      {/* 更多入口 - 可折叠 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <button type="button" onClick={() => setShowMore((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">更多</span>
          <ChevronRight className={`h-5 w-5 text-slate-400 transition ${showMore ? 'rotate-90' : ''}`} />
        </button>
        {showMore ? (
          <div className="mt-4 grid gap-2">
            <MoreEntry icon={<BookOpen className="h-5 w-5" />} title="我的日记" onClick={() => navigate('/diary')} />
            <MoreEntry icon={<CalendarDays className="h-5 w-5" />} title="课表" onClick={() => navigate('/schedule')} />
            <MoreEntry icon={<Trophy className="h-5 w-5" />} title="荣誉墙" onClick={() => navigate('/honors')} />
            <MoreEntry icon={<ImageIcon className="h-5 w-5" />} title="回忆图片墙" onClick={() => navigate('/memories')} />
            <MoreEntry icon={<Award className="h-5 w-5" />} title="综测成绩" onClick={() => navigate('/scores')} />
            <MoreEntry icon={<Code2 className="h-5 w-5" />} title="项目库" onClick={() => navigate('/projects')} />
            {isAdmin ? (
              <MoreEntry icon={<Users className="h-5 w-5" />} title="用户管理" onClick={() => navigate('/admin/users')} />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* API Key 配置 */}
      <section className={`rounded-2xl border border-[#E6DED3] bg-white p-5 ${canManageServerSettings ? '' : 'hidden'}`}>
        <button type="button" onClick={() => setShowApiKeys((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">
            <KeyRound className="mr-2 inline h-4 w-4 text-[#6B7A5A]" />
            API Key 配置
          </span>
          <ChevronRight className={`h-5 w-5 text-slate-400 transition ${showApiKeys ? 'rotate-90' : ''}`} />
        </button>
        {showApiKeys ? (
          <div className="mt-4 space-y-3">
            {keyMsg ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{keyMsg}</p> : null}
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              配置并使用 AI/OCR 后，相关复盘文字、成绩、课表图片和你提交的内容会发送到你填写的第三方服务。不开启 AI/OCR 时，普通记录仍保存在本机或自托管服务器；手机本机版无需连接本项目服务器。
            </p>

            {/* AI */}
            <label className="block rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                AI 配置
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${apiKeys?.ai_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {apiKeys?.ai_configured ? '已配置' : '未配置'}
                </span>
                {apiKeys?.ai_api_key.masked ? <span className="font-normal text-slate-400">{apiKeys.ai_api_key.masked}</span> : null}
              </span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className="input h-9 text-xs" placeholder="Base URL" value={aiBaseUrl} onChange={e => setAiBaseUrl(e.target.value)} />
                <input className="input h-9 text-xs" placeholder="模型" value={aiModel} onChange={e => setAiModel(e.target.value)} />
              </div>
              <input className="input mt-2 h-9 text-xs" type="password" placeholder="修改配置：输入新 Key，留空不修改" value={aiKey} onChange={e => setAiKey(e.target.value)} />
              <p className="mt-1 text-[10px] text-slate-400">复盘、综测分析</p>
            </label>

            {/* 天气 */}
            {!Capacitor.isNativePlatform() ? <label className="block rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                和风天气 Key
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${apiKeys?.weather_api_key.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {apiKeys?.weather_api_key.configured ? '已配置' : '未配置'}
                </span>
                {apiKeys?.weather_api_key.masked ? <span className="font-normal text-slate-400">{apiKeys.weather_api_key.masked}</span> : null}
              </span>
              <input className="input mt-1.5 h-9 text-xs" placeholder="API Host，例如：xxxxx.qweatherapi.com" value={weatherApiHost} onChange={e => setWeatherApiHost(e.target.value)} />
              <input className="input mt-2 h-9 text-xs" type="password" placeholder="修改配置：输入新 Key，留空不修改" value={weatherKey} onChange={e => setWeatherKey(e.target.value)} />
              <p className="mt-1 text-[10px] text-slate-400">天气地区通过地区选择器设置</p>
            </label> : <p className="rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3 text-xs text-slate-500">手机本机版不请求实时天气服务，天气卡片会显示离线状态。</p>}

            {/* OCR */}
            <label className="block rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                OCR Key
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${apiKeys?.ocr_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {apiKeys?.ocr_configured ? '已配置' : '未配置'}
                </span>
                {apiKeys?.ocr_api_key.masked ? <span className="font-normal text-slate-400">{apiKeys.ocr_api_key.masked}</span> : null}
                <span className="font-normal text-slate-400">（可选，未填时复用 AI 配置）</span>
              </span>
              <input className="input mt-1.5 h-9 text-xs" type="password" placeholder="修改配置：输入新 Key，留空不修改" value={ocrKey} onChange={e => setOcrKey(e.target.value)} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="input h-8 text-[11px]" placeholder="Base URL" value={ocrBaseUrl} onChange={e => setOcrBaseUrl(e.target.value)} />
                <input className="input h-8 text-[11px]" placeholder="模型" value={ocrModel} onChange={e => setOcrModel(e.target.value)} />
              </div>
              <p className="mt-1 text-[10px] text-slate-400">拍照识别课表</p>
            </label>

            <button type="button" onClick={saveApiKeys} disabled={keySaving} className="button-primary text-xs w-full">
              {keySaving ? <LoadingIcon /> : <Save className="h-4 w-4" />}保存
            </button>
          </div>
        ) : null}
      </section>

      {/* 数据备份 - 可折叠 */}
      <section className="rounded-2xl border border-[#E6DED3] bg-white p-5">
        <button type="button" onClick={() => setShowDataSafe((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">
            <Archive className="mr-2 inline h-4 w-4 text-[#6B7A5A]" />
            数据备份
          </span>
          <ChevronRight className={`h-5 w-5 text-slate-400 transition ${showDataSafe ? 'rotate-90' : ''}`} />
        </button>
        {showDataSafe ? (
          <div className="mt-4">
            {dataMessage ? (
              <p className="mb-3 rounded-xl border border-emerald-400/30 bg-emerald-50 p-2 text-sm text-emerald-700">{dataMessage}</p>
            ) : null}
            {dataError ? (
              <p className="mb-3 rounded-xl border border-red-400/30 bg-red-50 p-2 text-sm text-red-600">{dataError}</p>
            ) : null}

            {/* 导出 */}
            <div className="mb-4 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Download className="h-4 w-4 text-[#6B7A5A]" />我的导出
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => handleExport('json')} disabled={exporting !== null} className="button-secondary text-xs">
                  {exporting === 'json' ? <LoadingIcon /> : <FileJson className="h-4 w-4" />}
                  数据文件
                </button>
                <button type="button" onClick={() => handleExport('markdown')} disabled={exporting !== null} className="button-secondary text-xs">
                  {exporting === 'markdown' ? <LoadingIcon /> : <FileText className="h-4 w-4" />}
                  阅读文档
                </button>
                <button type="button" onClick={() => handleExport('zip')} disabled={exporting !== null} className="button-secondary text-xs">
                  {exporting === 'zip' ? <LoadingIcon /> : <Package className="h-4 w-4" />}
                  完整压缩包
                </button>
              </div>
              {Capacitor.isNativePlatform() ? (
                <div className="mt-4 border-t border-[#E6DED3] pt-3">
                  <label className="button-secondary inline-flex cursor-pointer text-xs">
                    <FileJson className="h-4 w-4" />
                    导入 JSON / ZIP
                    <input type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={(event) => { void handleImportJson(event.target.files?.[0]); event.currentTarget.value = '' }} />
                  </label>
                  <p className="mt-2 text-[11px] text-slate-500">支持初记 JSON 和完整 ZIP。旧版服务器 JSON 不含附件原文件；完整 ZIP 会一并迁移其中的附件。</p>
                </div>
              ) : null}
            </div>

            {canManageSystemBackups ? <>
            <div className="mb-4 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Database className="h-4 w-4 text-[#6B7A5A]" />数据备份
              </h3>
              <p className="mt-1 text-xs text-slate-500">{Capacitor.isNativePlatform() ? '备份保存在手机应用私有数据中；更换手机或重装前，请通过“数据文件”导出到其他位置。' : '备份会打包 data 目录和数据库到 backups 目录；系统每天首次打开会自动备份一次。'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleCreateBackup} disabled={backupAction !== null} className="button-primary text-xs">
                  {backupAction === 'create' ? <LoadingIcon /> : <Database className="h-4 w-4" />}
                  立即备份
                </button>
                <button type="button" onClick={refreshBackups} disabled={backupAction !== null} className="button-secondary text-xs">
                  查看备份
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-red-400/20 bg-[#FFFDF8] p-4">
              <div className="mb-3 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm text-red-600">恢复备份需要二次确认，恢复前会自动备份当前数据。</p>
              </div>
              {backupRecords.length > 0 ? (
                <div className="grid gap-2">
                  {backupRecords.map((record) => (
                    <div key={record.id} className="flex flex-col gap-2 rounded-xl border border-[#E6DED3] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{record.filename}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDateTime(record.created_at)} / {formatBytes(record.size)} / {statusLabel(record.status)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreBackup(record)}
                          disabled={backupAction !== null || record.status === 'failed'}
                          className="button-danger text-xs"
                        >
                          {backupAction === `restore-${record.id}` ? <LoadingIcon /> : <RotateCcw className="h-4 w-4" />}
                          恢复
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBackup(record)}
                          disabled={backupAction !== null}
                          className="button-secondary text-xs"
                        >
                          {backupAction === `delete-${record.id}` ? <LoadingIcon /> : <Trash2 className="h-4 w-4" />}
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">暂无备份文件。</p>
              )}
            </div>
            </> : <p className="mt-4 text-xs text-slate-500">这里只显示你自己的导出文件；服务器系统备份由管理员管理。</p>}
          </div>
        ) : null}
      </section>

      {/* 安全中心 - 可折叠 */}
      <section className={`rounded-2xl border border-[#E6DED3] bg-white p-5 ${Capacitor.isNativePlatform() ? 'hidden' : ''}`}>
        <button type="button" onClick={() => setShowPassword((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">
            <KeyRound className="mr-2 inline h-4 w-4 text-[#6B7A5A]" />
            修改密码
          </span>
          <ChevronRight className={`h-5 w-5 text-slate-400 transition ${showPassword ? 'rotate-90' : ''}`} />
        </button>
        {showPassword ? (
          <form className="mt-4 grid gap-3" onSubmit={handlePasswordChange}>
            <PasswordField label="旧密码" value={oldPassword} onChange={setOldPassword} />
            <PasswordField label="新密码" value={newPassword} onChange={setNewPassword} />
            <PasswordField label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} />
            {message ? <p className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="rounded-xl border border-red-400/30 bg-red-50 p-2 text-sm text-red-600">{error}</p> : null}
            <button type="submit" className="button-primary max-w-xs">
              <Save className="h-4 w-4" />保存新密码
            </button>
          </form>
        ) : null}
      </section>

      {/* 修改删除密码 */}
      <section className={`rounded-2xl border border-[#E6DED3] bg-white p-5 ${canManageServerSettings ? '' : 'hidden'}`}>
        <button type="button" onClick={() => setShowDeletePassword((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-base font-bold">
            <KeyRound className="mr-2 inline h-4 w-4 text-[#6B7A5A]" />
            修改删除密码
          </span>
          <ChevronRight className={`h-5 w-5 text-slate-400 transition ${showDeletePassword ? 'rotate-90' : ''}`} />
        </button>
        {showDeletePassword ? (
          <form className="mt-4 grid gap-3" onSubmit={handleChangeDeletePassword}>
            <p className="text-xs text-slate-500">删除密码用于删除荣誉、回忆、项目等数据时的二次验证。</p>
            {deletePasswordStatus?.has_password ? <PasswordField label="旧删除密码" value={oldDeletePassword} onChange={setOldDeletePassword} /> : null}
            <PasswordField label="新删除密码" value={newDeletePassword} onChange={setNewDeletePassword} />
            <PasswordField label="确认新删除密码" value={confirmDeletePassword} onChange={setConfirmDeletePassword} />
            {deletePasswordMsg ? <p className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-2 text-sm text-emerald-700">{deletePasswordMsg}</p> : null}
            {deletePasswordError ? <p className="rounded-xl border border-red-400/30 bg-red-50 p-2 text-sm text-red-600">{deletePasswordError}</p> : null}
            <button type="submit" disabled={deletePasswordSaving} className="button-primary max-w-xs">
              {deletePasswordSaving ? <LoadingIcon /> : <Save className="h-4 w-4" />}修改删除密码
            </button>
          </form>
        ) : null}
      </section>

      {!Capacitor.isNativePlatform() ? (
        <button type="button" onClick={handleLogout} className="button-danger max-w-xs">
          <LogOut className="h-4 w-4" />退出登录
        </button>
      ) : null}

      <p className="text-center text-[11px] text-slate-300 pt-2">本项目由王鑫焱所作</p>

      <MediaWall open={showMediaWall} onClose={() => setShowMediaWall(false)} />

      {confirmDialog}

      <ConfirmDialog
        open={showLogoutConfirm}
        title="确认退出登录？"
        message="退出后需要重新登录。"
        cancelText="取消"
        confirmText="确认"
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={confirmLogout}
      />

      <DeletePasswordDialog
        open={Boolean(pendingDeleteBackup)}
        title="删除备份"
        description={`确认删除备份「${pendingDeleteBackup?.filename ?? ''}」？请输入删除密码。`}
        loading={backupAction?.startsWith('delete-') ?? false}
        error={deleteBackupError}
        onCancel={() => { setPendingDeleteBackup(null); setDeleteBackupError('') }}
        onConfirm={confirmDeleteBackup}
      />
      <DeletePasswordDialog
        open={Boolean(pendingRestoreBackup)}
        title="验证系统恢复"
        description={restoreBackupError || `恢复「${pendingRestoreBackup?.filename ?? ''}」会替换整个服务器数据。请输入独立删除/恢复密码继续。`}
        confirmLabel="确认恢复"
        loading={backupAction?.startsWith('restore-') ?? false}
        error={restoreBackupError}
        onCancel={() => { setPendingRestoreBackup(null); setRestoreBackupError('') }}
        onConfirm={confirmRestoreBackup}
      />
    </div>
  )
}
