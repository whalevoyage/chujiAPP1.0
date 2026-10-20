import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'

import Shell from './components/Shell'
import FullScreenLoading from './components/FullScreenLoading'
import NetworkErrorBanner from './components/NetworkErrorBanner'
import AdminUsersPage from './pages/AdminUsersPage'
import CheckinPage from './pages/CheckinPage'
import DiaryPage from './pages/DiaryPage'
import HonorsPage from './pages/HonorsPage'
import LoginPage from './pages/LoginPage'
import MemoriesPage from './pages/MemoriesPage'
import PlansPage from './pages/PlansPage'
import ProfilePage from './pages/ProfilePage'
import ProjectsPage from './pages/ProjectsPage'
import ReviewPage from './pages/ReviewPage'
import SchedulePage from './pages/SchedulePage'
import ScoreCardsPage from './pages/ScoreCardsPage'
import TodayPage from './pages/TodayPage'
import { useAuth } from './auth'

function App() {
  return (
    <>
      <NetworkErrorBanner />
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/checkin" element={<CheckinPage />} />
          <Route path="/diary" element={<DiaryPage />} />
          <Route path="/honors" element={<HonorsPage />} />
          <Route path="/memories" element={<MemoriesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/scores" element={<ScoreCardsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Route>
    </Routes>
    </>
  )
}

function RequireAuth() {
  const { user, loading } = useAuth()

  if (loading) {
    return <FullScreenLoading />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (user?.role !== 'admin') {
    return <Navigate to="/today" replace />
  }

  return children
}

export default App
