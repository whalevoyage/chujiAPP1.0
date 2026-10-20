import { useState } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, Search, X } from 'lucide-react'

type FaqItem = {
  q: string
  a: string
}

const FAQS: FaqItem[] = [
  {
    q: '今天该看哪里？',
    a: '打开"今日"页面，这里汇总了今天的安排、任务、专注统计和状态评分。从上到下依次是：天气提醒、智能摘要、当前安排、任务完成率、专注入口、今日课表、今日状态评分。',
  },
  {
    q: '如何添加今天的安排？',
    a: '在"今日"页面顶部有快速添加输入框。输入内容后点击添加，系统会自动识别类型：带时间的内容会创建为规划步骤，日常习惯类会创建为打卡任务，课程类会关联到课表。',
  },
  {
    q: '规划、任务、课程有什么区别？',
    a: '规划是把一天分成具体时间段，每个步骤有开始和结束时间，适合安排日程。任务是每日打卡项，适合背单词、跑步等习惯。课程是每周固定的课表，在课表页面统一管理。',
  },
  {
    q: '如何开始专注？',
    a: '在"今日"页面找到"专注"卡片，点击"开始专注"进入全屏专注模式。默认 25 分钟倒计时，可以在设置中调整时长。支持暂停、继续和提前结束。专注记录会自动保存，完成后会统计今日专注时长。',
  },
  {
    q: '今日状态怎么记录？',
    a: '在今日页底部有 1-5 分评分按钮，点一下即可保存当天状态。还可以选择心情标签（开心/平静/低落）和写一句备注。可以多次修改，系统会计算 7 天和 30 天平均分。',
  },
  {
    q: '如何生成复盘文档？',
    a: '在"回顾"页面，选择复盘类型（日/周/月），系统会自动汇总本地的任务、专注、状态等数据。如果配置了 AI Key，还会自动生成 AI 分析总结。未配置 AI 时可以手动查看数据汇总。',
  },
  {
    q: '如何添加课表？',
    a: '在课表页面，点击添加课程，选择星期几、节次（自动匹配时间）、填写课程名称即可。也可以上传 .ics 日历文件批量导入，或者拍照上传课表图片自动识别（需先配置 OCR Key）。',
  },
  {
    q: '如何配置 API Key？',
    a: '在"我的 → API Key 配置"中填写。支持三个配置：AI（DeepSeek 等，用于复盘分析和综测建议）、和风天气 Key（实时天气）、OCR Key（课表拍照识别，未填时复用 AI 配置）。Key 保存在服务端，页面只显示已配置/未配置状态，不显示完整 Key。',
  },
  {
    q: '如何备份数据？',
    a: '在"我的 → 数据备份"中，可以创建系统备份（打包 data 目录和数据库到 backups 目录）。系统每天首次打开会自动备份一次。也支持导出 JSON、Markdown 或 ZIP 格式。恢复备份需要二次确认，恢复前会自动备份当前数据。',
  },
  {
    q: '如何上传回忆照片？',
    a: '在回忆图片墙页面，先点击"添加回忆"填写标题等基本信息，保存后会在卡片中看到"传图"按钮，点击即可上传照片。支持 jpg/png/webp 格式，单张不超过 20MB。点击照片可全屏预览，支持左右切换和下载原图。',
  },
  {
    q: '如何修改删除密码？',
    a: '在"我的 → 修改删除密码"中操作。删除确认密码用于删除荣誉、回忆、项目等数据。请在首次启动前通过 INITIAL_DELETE_PASSWORD 配置，之后可在此修改。',
  },
  {
    q: '综测成绩怎么录入？',
    a: '在综测成绩页面，创建一个新的成绩卡，可以按模块录入：学业成绩、德育表现、体育健康、创新竞赛、志愿服务、荣誉证书、加分项、扣分项。系统自动计算总分和得分率。配置 AI 后可获取分析建议。',
  },
  {
    q: '回忆图片墙是什么？',
    a: '用来存放值得记住的照片。每张照片可以添加标题、拍摄日期、地点、标签和一段故事。照片以卡片网格展示，支持搜索、预览大图和下载。',
  },
  {
    q: '项目库怎么用？',
    a: '用来记录做过的项目。每个项目包含名称、状态（进行中/已完成/暂停/规划中/已归档）、日期、技术栈、简介、链接和备注。支持传截图、搜索、编辑和删除。',
  },
  {
    q: '为什么看不到用户管理？',
    a: '初记是个人管理系统，用户管理功能仅限管理员使用。普通用户只能管理自己的数据。',
  },
]

type Props = {
  open: boolean
  onClose: () => void
}

export default function HelpAssistant({ open, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  if (!open) return null

  const filtered = search.trim()
    ? FAQS.filter((f) => f.q.includes(search.trim()) || f.a.includes(search.trim()))
    : FAQS

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#F7F4EE]" style={{ overflow: 'hidden' }}>
      {/* 顶部 */}
      <div className="flex items-center gap-3 border-b border-[#E6DED3] bg-white px-4 py-3">
        <HelpCircle className="h-5 w-5 text-[#6B7A5A]" />
        <span className="flex-1 text-base font-bold">小助手</span>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-[#F5F1EA]" aria-label="关闭">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 搜索 */}
      <div className="border-b border-[#E6DED3] bg-white px-4 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-[#E6DED3] bg-[#FFFDF8] px-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="flex-1 bg-transparent py-2.5 text-sm outline-none"
            placeholder="搜索问题..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpanded(null) }}
          />
        </div>
      </div>

      {/* 问题列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">没有找到相关问题</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((item, idx) => (
              <div key={idx} className="rounded-xl border border-[#E6DED3] bg-white overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
                  onClick={() => setExpanded(expanded === idx ? null : idx)}
                >
                  {expanded === idx
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7A5A]" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  }
                  <span className="flex-1">{item.q}</span>
                </button>
                {expanded === idx ? (
                  <div className="border-t border-[#E6DED3] bg-[#FFFDF8] px-4 py-3">
                    <p className="text-sm leading-relaxed text-slate-600">{item.a}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="border-t border-[#E6DED3] bg-white px-4 py-3">
        <p className="text-xs text-slate-400">
          小助手内置常见问题，离线可用。如需更多帮助，请联系管理员。
        </p>
      </div>
    </div>
  )
}
