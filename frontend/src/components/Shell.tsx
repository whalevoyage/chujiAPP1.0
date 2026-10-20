import { CalendarCheck2, CheckSquare, Home, NotebookPen, UserCircle } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../auth'

const baseTabs = [
  { path: '/today', label: '今日', icon: Home },
  { path: '/plans', label: '规划', icon: CalendarCheck2 },
  { path: '/checkin', label: '打卡', icon: CheckSquare },
  { path: '/review', label: '复盘', icon: NotebookPen },
  { path: '/profile', label: '我的', icon: UserCircle },
]

export default function Shell() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-[#E6DED3] bg-[#FFFDF8] px-5 py-6 md:block">
          <Brand />
          <nav className="mt-9 space-y-2">
            {baseTabs.map((tab) => (
              <NavItem key={tab.path} item={tab} />
            ))}
          </nav>
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-[#E6DED3] bg-white p-4">
            <p className="text-xs text-slate-500">当前用户</p>
            <p className="mt-2 truncate text-sm font-semibold text-slate-900">{user?.nickname || user?.username}</p>
            <p className="mt-1 text-[11px] text-slate-400">本地私有 · 王鑫焱</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-24 md:pb-0 md:pl-72">
          <Outlet />
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-[#E6DED3] bg-[#FFFDF8] px-2 py-2 md:hidden"
        style={{ gridTemplateColumns: `repeat(${baseTabs.length}, minmax(0, 1fr))` }}
      >
        {baseTabs.map((tab) => (
          <NavItem key={tab.path} item={tab} mobile />
        ))}
      </nav>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-1">
      <img src="/vault-icon.svg" alt="初记" className="h-12 w-12 rounded-2xl" />
      <div>
        <p className="text-lg font-extrabold tracking-wide text-slate-900">初记</p>
        <p className="text-xs text-slate-500">个人管理</p>
      </div>
    </div>
  )
}

function NavItem({
  item,
  mobile = false,
}: {
  item: { path: string; label: string; icon: typeof Home }
  mobile?: boolean
}) {
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        mobile
          ? [
              'flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold',
              isActive
                ? 'border border-[#6B7A5A]/35 bg-[#F5F1EA] text-[#6B7A5A]'
                : 'text-slate-500 active:bg-[#F5F1EA]',
            ].join(' ')
          : [
              'flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition',
              isActive
                ? 'border-[#6B7A5A]/40 bg-[#F5F1EA] text-[#6B7A5A]'
                : 'border-transparent text-slate-500 hover:border-[#E6DED3] hover:bg-[#F5F1EA] hover:text-slate-900',
            ].join(' ')
      }
    >
      <item.icon className={mobile ? 'h-5 w-5' : 'h-4 w-4'} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}
