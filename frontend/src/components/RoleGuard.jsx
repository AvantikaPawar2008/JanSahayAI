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

  // Role check: only allow if user's role is in the allowed list
  if (allow.length > 0 && (!role || !allow.includes(role))) {
    const roleHomeMap = {
      citizen: '/citizen/report',
      officer: '/officer/queue',
      admin: '/admin/dashboard',
    }
    const targetHome = roleHomeMap[role] || '/citizen/report'
    return <Navigate to={targetHome} replace />
  }

  return children
}
