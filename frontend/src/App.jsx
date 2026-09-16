import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import {
  Activity,
  FileText,
  Shield,
  MapPin,
  Flame,
  BarChart3,
  Bell,
  Menu,
  X,
  LogIn,
  LogOut,
  User,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'

import useAuth from './hooks/useAuth'
import RoleGuard from './components/RoleGuard'

// Auth Pages
import LoginPage from './pages/auth/LoginPage'
import SignupPage from './pages/auth/SignupPage'

// Citizen Pages
import ReportIssuePage from './pages/citizen/ReportIssuePage'
import TrackTicketPage from './pages/citizen/TrackTicketPage'

// Officer Pages
import OfficerQueuePage from './pages/officer/OfficerQueuePage'
import TicketDetailPage from './pages/officer/TicketDetailPage'

// Admin Pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import HotspotMapPage from './pages/admin/HotspotMapPage'
import HotspotAlertsPage from './pages/admin/HotspotAlertsPage'

export default function App() {
  const { user, profile, role, loading, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Home redirect helper based on role
  const getHomePath = () => {
    if (!user) return '/login'
    if (role === 'officer') return '/officer/queue'
    if (role === 'admin') return '/admin/dashboard'
    return '/citizen/report'
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-surface-900/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <NavLink to={getHomePath()} className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-civic-500 to-purple-500 flex items-center justify-center shadow-lg shadow-civic-500/20 group-hover:shadow-civic-500/40 transition-shadow">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold gradient-text hidden sm:block">CivicPulse</span>
            </NavLink>

            {/* Desktop Nav Items according to current role */}
            <div className="hidden md:flex items-center gap-1">
              {/* Citizen Links */}
              {(!user || role === 'citizen' || role === 'admin') && (
                <>
                  <NavLink to="/citizen/report" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <FileText className="w-4 h-4" /> Report Issue
                  </NavLink>
                  <NavLink to="/citizen/track" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <MapPin className="w-4 h-4" /> Track
                  </NavLink>
                </>
              )}

              {/* Officer Links */}
              {(role === 'officer' || role === 'admin') && (
                <>
                  <div className="w-px h-6 bg-white/10 mx-2" />
                  <NavLink to="/officer/queue" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Shield className="w-4 h-4" /> Queue
                  </NavLink>
                </>
              )}

              {/* Admin Links */}
              {role === 'admin' && (
                <>
                  <div className="w-px h-6 bg-white/10 mx-2" />
                  <NavLink to="/admin/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <BarChart3 className="w-4 h-4" /> Dashboard
                  </NavLink>
                  <NavLink to="/admin/hotspots" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Flame className="w-4 h-4 text-red-400" /> Hotspot Map
                  </NavLink>
                  <NavLink to="/admin/alerts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Bell className="w-4 h-4" /> Alerts
                  </NavLink>
                </>
              )}
            </div>

            {/* Auth / Profile Actions */}
            <div className="hidden md:flex items-center gap-3">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="flex flex-col text-right">
                    <span className="text-xs font-semibold text-white/90">
                      {profile?.full_name || user.email?.split('@')[0]}
                    </span>
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                        role === 'admin'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : role === 'officer'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-civic-500/20 text-civic-300 border border-civic-500/30'
                      }`}>
                        {role || 'citizen'}
                      </span>
                      {profile?.department && (
                        <span className="text-[10px] text-white/40 max-w-[100px] truncate" title={profile.department}>
                          · {profile.department}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <NavLink to="/login" className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
                    <LogIn className="w-3.5 h-3.5" /> Sign In
                  </NavLink>
                  <NavLink to="/signup" className="btn-primary text-xs px-3 py-1.5">
                    Sign Up
                  </NavLink>
                </div>
              )}
            </div>

            {/* Mobile Menu Toggle */}
            <button
              className="md:hidden p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-surface-900/95 backdrop-blur-xl animate-slide-up">
            <div className="px-4 py-3 space-y-1">
              <NavLink to="/citizen/report" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <FileText className="w-4 h-4" /> Report Issue
              </NavLink>
              <NavLink to="/citizen/track" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <MapPin className="w-4 h-4" /> Track Tickets
              </NavLink>

              {(role === 'officer' || role === 'admin') && (
                <NavLink to="/officer/queue" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                  <Shield className="w-4 h-4" /> Officer Queue
                </NavLink>
              )}

              {role === 'admin' && (
                <>
                  <NavLink to="/admin/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                    <BarChart3 className="w-4 h-4" /> Dashboard
                  </NavLink>
                  <NavLink to="/admin/hotspots" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                    <Flame className="w-4 h-4" /> Hotspot Map
                  </NavLink>
                  <NavLink to="/admin/alerts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                    <Bell className="w-4 h-4" /> Alerts
                  </NavLink>
                </>
              )}

              <div className="pt-2 border-t border-white/10">
                {user ? (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false)
                      handleLogout()
                    }}
                    className="w-full text-left nav-link text-red-400 hover:text-red-300"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out ({profile?.full_name || user.email})
                  </button>
                ) : (
                  <div className="flex gap-2 pt-1">
                    <NavLink to="/login" className="btn-secondary flex-1 text-center text-xs py-2" onClick={() => setMobileMenuOpen(false)}>
                      Sign In
                    </NavLink>
                    <NavLink to="/signup" className="btn-primary flex-1 text-center text-xs py-2" onClick={() => setMobileMenuOpen(false)}>
                      Sign Up
                    </NavLink>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content with Route Groups Protected by RoleGuard */}
      <main className="flex-1">
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Root Redirect */}
          <Route
            path="/"
            element={
              loading ? (
                <div className="min-h-[60vh] flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
                </div>
              ) : user ? (
                role === 'officer' ? (
                  <Navigate to="/officer/queue" replace />
                ) : role === 'admin' ? (
                  <Navigate to="/admin/dashboard" replace />
                ) : (
                  <Navigate to="/citizen/report" replace />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Citizen Routes: citizen, admin */}
          <Route
            path="/citizen/report"
            element={
              <RoleGuard allow={['citizen', 'admin']}>
                <ReportIssuePage />
              </RoleGuard>
            }
          />
          <Route
            path="/citizen/track"
            element={
              <RoleGuard allow={['citizen', 'officer', 'admin']}>
                <TrackTicketPage />
              </RoleGuard>
            }
          />
          <Route
            path="/citizen/track/:ticketId"
            element={
              <RoleGuard allow={['citizen', 'officer', 'admin']}>
                <TrackTicketPage />
              </RoleGuard>
            }
          />

          {/* Officer Routes: officer, admin */}
          <Route
            path="/officer/queue"
            element={
              <RoleGuard allow={['officer', 'admin']}>
                <OfficerQueuePage />
              </RoleGuard>
            }
          />
          <Route
            path="/officer/ticket/:ticketId"
            element={
              <RoleGuard allow={['officer', 'admin']}>
                <TicketDetailPage />
              </RoleGuard>
            }
          />

          {/* Admin Routes: admin only */}
          <Route
            path="/admin/dashboard"
            element={
              <RoleGuard allow={['admin']}>
                <AdminDashboardPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/hotspots"
            element={
              <RoleGuard allow={['admin']}>
                <HotspotMapPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/alerts"
            element={
              <RoleGuard allow={['admin']}>
                <HotspotAlertsPage />
              </RoleGuard>
            }
          />

          {/* Legacy / Shortcut Redirects */}
          <Route path="/report" element={<Navigate to="/citizen/report" replace />} />
          <Route path="/track" element={<Navigate to="/citizen/track" replace />} />
          <Route path="/track/:ticketId" element={<Navigate to="/citizen/track" replace />} />
          <Route path="/officer" element={<Navigate to="/officer/queue" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 px-6 text-center text-xs text-white/30">
        CivicPulse © 2026 — AI-powered municipal complaint resolution platform
      </footer>
    </div>
  )
}
