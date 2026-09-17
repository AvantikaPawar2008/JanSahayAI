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
        citizen: '/citizen/history',
        officer: '/officer/queue',
        admin: '/admin/dashboard',
      }

      const defaultHome = roleHomeMap[userRole] || '/citizen/history'
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
      <div className="bg-white rounded-3xl max-w-md w-full p-8 border border-ivory-300 shadow-card relative overflow-hidden">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-civic-600 text-white mx-auto flex items-center justify-center shadow-md shadow-civic-600/20 mb-3.5">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-charcoal-900 tracking-tight">Welcome to CivicPulse</h1>
          <p className="text-xs text-charcoal-500 mt-1 font-medium">Municipal resolution &amp; geospatial response portal</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-coral-50 border border-coral-200 flex items-start gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-coral-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-coral-700 font-medium">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-charcoal-600 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-charcoal-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@pune.gov.in"
                className="w-full bg-ivory-50 border border-ivory-300 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-charcoal-600 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-charcoal-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-ivory-50 border border-ivory-300 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 mt-6 text-sm font-semibold tracking-wide shadow-md"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 text-white" />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Quick Credentials Info Box for testing */}
        <div className="mt-6 p-4 rounded-xl bg-ivory-100 border border-ivory-200 text-xs text-charcoal-600 space-y-1.5">
          <p className="font-bold text-charcoal-800 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-civic-600" />
            Configured Demo Accounts:
          </p>
          <p>• Officer: <code className="bg-amber-100/70 text-amber-900 px-1 py-0.5 rounded font-mono text-[11px]">officer@pune.gov.in</code> / <code className="text-charcoal-600 font-mono text-[11px]">Password@123</code></p>
          <p>• Admin: <code className="bg-blue-100/70 text-blue-900 px-1 py-0.5 rounded font-mono text-[11px]">admin@pune.gov.in</code> / <code className="text-charcoal-600 font-mono text-[11px]">Password@123</code></p>
          <p>• Citizen: <code className="bg-emerald-100/70 text-emerald-900 px-1 py-0.5 rounded font-mono text-[11px]">citizen@pune.gov.in</code> / <code className="text-charcoal-600 font-mono text-[11px]">Password@123</code></p>
        </div>

        {/* Footer Link */}
        <div className="mt-6 pt-4 border-t border-ivory-200 text-center text-xs text-charcoal-500">
          Citizen without an account?{' '}
          <Link to="/signup" className="text-civic-700 hover:text-civic-800 font-semibold transition-colors">
            Create an Account
          </Link>
        </div>
      </div>
    </div>
  )
}
