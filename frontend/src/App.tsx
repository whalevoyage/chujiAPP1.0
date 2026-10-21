import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import Shell from './components/Shell'
import FullScreenLoading from './components/FullScreenLoading'
import NetworkErrorBanner from './components/NetworkErrorBanner'
import { useAuth } from './auth'

const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
const CheckinPage = lazy(() => import('./pages/CheckinPage'))
const DiaryPage = lazy(() => import('./pages/DiaryPage'))
const HonorsPage = lazy(() => import('./pages/HonorsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const MemoriesPage = lazy(() => import('./pages/MemoriesPage'))
const PlansPage = lazy(() => import('./pages/PlansPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const ScoreCardsPage = lazy(() => import('./pages/ScoreCardsPage'))
const TodayPage = lazy(() => import('./pages/TodayPage'))

function App() {
  return (
    <>
      <NetworkErrorBanner />
      <Suspense fallback={<FullScreenLoading />}>
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
      </Suspense>
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
