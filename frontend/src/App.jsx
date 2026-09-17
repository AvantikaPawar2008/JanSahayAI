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
  Clock,
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
import TicketHistoryPage from './pages/citizen/TicketHistoryPage'

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
    return '/citizen/history'
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 border-b border-ivory-300 bg-white/90 backdrop-blur-md shadow-subtle">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <NavLink to={getHomePath()} className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-civic-500 text-white flex items-center justify-center shadow-sm group-hover:bg-civic-600 transition-colors">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-base font-bold text-charcoal-900 tracking-tight leading-none">JanSahayAI</span>
                <span className="text-[10px] text-charcoal-500 font-medium tracking-wide">Smart Civic Resolution</span>
              </div>
            </NavLink>

            {/* Desktop Nav Items according to current role */}
            <div className="hidden md:flex items-center gap-1">
              {/* Citizen Links */}
              {(!user || role === 'citizen' || role === 'admin') && (
                <>
                  <NavLink to="/citizen/history" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Clock className="w-4 h-4 text-civic-600" /> My Tickets
                  </NavLink>
                  <NavLink to="/citizen/report" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <FileText className="w-4 h-4 text-civic-600" /> Report Issue
                  </NavLink>
                  <NavLink to="/citizen/track" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <MapPin className="w-4 h-4 text-civic-600" /> Track
                  </NavLink>
                </>
              )}

              {/* Officer Links */}
              {(role === 'officer' || role === 'admin') && (
                <>
                  <div className="w-px h-5 bg-ivory-300 mx-1.5" />
                  <NavLink to="/officer/queue" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Shield className="w-4 h-4 text-sage-600" /> Queue
                  </NavLink>
                </>
              )}

              {/* Admin Links */}
              {role === 'admin' && (
                <>
                  <div className="w-px h-5 bg-ivory-300 mx-1.5" />
                  <NavLink to="/admin/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <BarChart3 className="w-4 h-4 text-muted-blue-600" /> Dashboard
                  </NavLink>
                  <NavLink to="/admin/hotspots" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Flame className="w-4 h-4 text-coral-500" /> Hotspot Map
                  </NavLink>
                  <NavLink to="/admin/alerts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Bell className="w-4 h-4 text-amber-600" /> Alerts
                  </NavLink>
                </>
              )}
            </div>

            {/* Auth / Profile Actions */}
            <div className="hidden md:flex items-center gap-3">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="flex flex-col text-right">
                    <span className="text-xs font-semibold text-charcoal-900">
                      {profile?.full_name || user.email?.split('@')[0]}
                    </span>
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                        role === 'admin'
                          ? 'bg-muted-blue-50 text-muted-blue-700 border border-muted-blue-200'
                          : role === 'officer'
                          ? 'bg-sage-100 text-civic-800 border border-sage-200'
                          : 'bg-ivory-200 text-charcoal-700 border border-ivory-300'
                      }`}>
                        {role || 'citizen'}
                      </span>
                      {profile?.department && (
                        <span className="text-[10px] text-charcoal-500 max-w-[120px] truncate" title={profile.department}>
                          · {profile.department}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg bg-ivory-100 border border-ivory-300 text-charcoal-500 hover:text-coral-600 hover:bg-coral-50 transition-colors"
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
              className="md:hidden p-2 rounded-lg text-charcoal-600 hover:text-charcoal-900 hover:bg-ivory-200"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-ivory-300 bg-white/98 shadow-card animate-slide-up px-4 py-3 space-y-1">
            <div className="px-4 py-3 space-y-1">
              <NavLink to="/citizen/history" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
                <Clock className="w-4 h-4" /> My Tickets
              </NavLink>
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

              <div className="pt-2 border-t border-ivory-200">
                {user ? (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false)
                      handleLogout()
                    }}
                    className="w-full text-left nav-link text-coral-600 hover:text-coral-700"
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
                  <Navigate to="/citizen/history" replace />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Citizen Routes: citizen, admin */}
          <Route
            path="/citizen/history"
            element={
              <RoleGuard allow={['citizen', 'admin']}>
                <TicketHistoryPage />
              </RoleGuard>
            }
          />
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
      <footer className="border-t border-ivory-300 bg-white/70 py-4 px-6 text-center text-xs text-charcoal-400">
        JanSahayAI © 2026 — AI-driven smart civic resolution platform
      </footer>
    </div>
  )
}
