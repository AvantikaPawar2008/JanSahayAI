import { Navigate, useLocation, Link } from 'react-router-dom'
import { Loader2, LogOut } from 'lucide-react'
import useAuth from '../hooks/useAuth'

/**
 * RoleGuard — wraps route groups and enforces role-based access.
 * If loading → shows brief spinner.
 * If unauthenticated → redirects to /login.
 * If role mismatched → redirects to assigned role's home page:
 *   citizen -> /citizen/report
 *   officer -> /officer/queue
 *   admin   -> /admin/dashboard
 */
export default function RoleGuard({ allow = [], children }) {
  const { user, role, loading, logout } = useAuth()
  const location = useLocation()

  // Brief loading state with safety timeout protection
  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
        <p className="text-sm text-white/50 font-medium">Verifying authorization...</p>
        <button
          onClick={logout}
          className="mt-4 text-xs text-white/30 hover:text-white/60 underline flex items-center gap-1"
        >
          <LogOut className="w-3 h-3" /> Reset Session
        </button>
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Admin superuser bypass: Administrators can inspect all views (citizen, officer, admin)
  if (role === 'admin') {
    return children
  }

  // Role check: only allow if user's role is in the allowed list
  if (allow.length > 0 && (!role || !allow.includes(role))) {
    const requiredRole = allow[0]
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-ivory-300 shadow-card p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4 font-bold text-xl">
            🛡️
          </div>
          <h2 className="text-lg font-bold text-charcoal-900 mb-1">Role Authorization Required</h2>
          <p className="text-xs text-charcoal-600 mb-4 leading-relaxed">
            This page requires <strong className="text-charcoal-900 uppercase font-semibold">{allow.join(' or ')}</strong> access.
            You are currently signed in as <span className="font-semibold text-civic-700">{user.email}</span> ({role || 'citizen'}).
          </p>

          <div className="space-y-2 pt-2 border-t border-ivory-200">
            {requiredRole === 'officer' && (
              <button
                onClick={async () => {
                  await logout()
                  window.location.href = '/login?demo=officer'
                }}
                className="w-full btn-primary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                Switch to Officer Demo (Ramesh Shinde)
              </button>
            )}
            {requiredRole === 'admin' && (
              <button
                onClick={async () => {
                  await logout()
                  window.location.href = '/login?demo=admin'
                }}
                className="w-full btn-primary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                Switch to Admin Demo (Commissioner Office)
              </button>
            )}
            <Link
              to={role === 'officer' ? '/officer/queue' : '/citizen/history'}
              className="w-full btn-secondary text-xs py-2 block text-center mt-2"
            >
              Return to Your Dashboard ({role || 'citizen'})
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return children
}
