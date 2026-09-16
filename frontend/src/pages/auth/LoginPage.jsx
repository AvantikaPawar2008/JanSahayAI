import { useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { LogIn, Mail, Lock, Loader2, AlertCircle, Shield, Activity } from 'lucide-react'
import useAuth from '../../hooks/useAuth'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const res = await login(email.trim(), password)
      const userRole = res?.profile?.role || 'citizen'

      // Strict role-specific home destinations
      const roleHomeMap = {
        citizen: '/citizen/report',
        officer: '/officer/queue',
        admin: '/admin/dashboard',
      }

      const defaultHome = roleHomeMap[userRole] || '/citizen/report'
      const fromPath = location.state?.from?.pathname

      // Only respect fromPath if it belongs to this user's role prefix
      let destination = defaultHome
      if (fromPath && fromPath !== '/login' && fromPath !== '/signup') {
        if (userRole === 'officer' && fromPath.startsWith('/officer')) {
          destination = fromPath
        } else if (userRole === 'admin' && fromPath.startsWith('/admin')) {
          destination = fromPath
        } else if (userRole === 'citizen' && fromPath.startsWith('/citizen')) {
          destination = fromPath
        }
      }

      navigate(destination, { replace: true })
    } catch (err) {
      setError(err.message || 'Invalid email or password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-enter min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="glass-card max-w-md w-full p-8 border-white/10 shadow-2xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-civic-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-civic-500 to-purple-600 mx-auto flex items-center justify-center shadow-lg shadow-civic-500/25 mb-4">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">Welcome to CivicPulse</h1>
          <p className="text-sm text-white/50 mt-1">Sign in to access your civic workspace</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@pune.gov.in"
                className="input-field pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field pl-10"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 mt-6 text-sm font-semibold tracking-wide"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Quick Credentials Info Box for testing */}
        <div className="mt-6 p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white/60 space-y-1.5">
          <p className="font-semibold text-white/80 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-civic-400" />
            Configured Test Credentials:
          </p>
          <p>• Officer: <code className="text-amber-300">officer@pune.gov.in</code> / <code className="text-white/80">Password@123</code></p>
          <p>• Admin: <code className="text-purple-300">admin@pune.gov.in</code> / <code className="text-white/80">Password@123</code></p>
          <p>• Citizen: <code className="text-emerald-300">citizen@pune.gov.in</code> / <code className="text-white/80">Password@123</code></p>
        </div>

        {/* Footer Link */}
        <div className="mt-6 pt-4 border-t border-white/5 text-center text-xs text-white/40">
          Citizen without an account?{' '}
          <Link to="/signup" className="text-civic-400 hover:text-civic-300 font-semibold transition-colors">
            Create an Account
          </Link>
        </div>
      </div>
    </div>
  )
}
