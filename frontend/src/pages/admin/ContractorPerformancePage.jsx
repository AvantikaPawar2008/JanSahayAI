import { useState } from 'react'
import {
  Loader2, User, AlertTriangle, CheckCircle2, TrendingDown,
  Search, Award, ShieldAlert, BarChart3, Clock,
} from 'lucide-react'
import { API_BASE } from '../../supabaseClient'

/**
 * ContractorPerformancePage — [TODO-DD-01]
 * Lookup contractor warranty breach stats and performance score.
 * Fetches GET /api/admin/contractor-performance/:id
 */
export default function ContractorPerformancePage() {
  const [contractorId, setContractorId] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchPerformance = async () => {
    if (!contractorId.trim()) { setError('Please enter a contractor ID.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/contractor-performance/${contractorId.trim()}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = (score) => {
    if (score >= 80) return { bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'Excellent', badge: 'bg-emerald-50 border-emerald-300 text-emerald-700' }
    if (score >= 60) return { bar: 'bg-amber-400', text: 'text-amber-700', label: 'Average', badge: 'bg-amber-50 border-amber-300 text-amber-700' }
    return { bar: 'bg-red-500', text: 'text-red-700', label: 'Poor', badge: 'bg-red-50 border-red-300 text-red-700' }
  }

  return (
    <div className="page-enter max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sage-100 text-civic-800 border border-sage-200">
          Warranty Engine
        </span>
        <span className="text-xs text-charcoal-400 font-mono">[TODO-DD-01]</span>
      </div>
      <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight mb-2">Contractor Performance</h1>
      <p className="text-charcoal-500 text-sm mb-8">
        60-day defect liability tracking. Each warranty breach deducts <strong>−5 pts</strong> from the contractor's
        performance score and auto-assigns rework at zero cost.
      </p>

      {/* Search */}
      <div className="glass-card p-5 mb-6">
        <h2 className="text-sm font-bold text-charcoal-700 flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-civic-600" />Lookup Contractor
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={contractorId}
            onChange={e => setContractorId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchPerformance()}
            placeholder="Officer / Contractor UUID…"
            className="flex-1 text-sm border border-ivory-300 rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-civic-300 bg-white"
          />
          <button onClick={fetchPerformance} disabled={loading}
            className="btn-primary flex items-center gap-2 text-sm px-5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Look Up
          </button>
        </div>
        {error && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
          </p>
        )}
      </div>

      {result && (() => {
        const sc = scoreColor(result.performance_score ?? 100)
        return (
          <div className="space-y-5 animate-fade-in">
            {/* Score Card */}
            <div className="glass-card p-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-civic-50 border border-civic-200 flex items-center justify-center">
                    <User className="w-6 h-6 text-civic-700" />
                  </div>
                  <div>
                    <p className="font-bold text-charcoal-900 text-base">{result.full_name || 'Contractor'}</p>
                    <p className="text-xs text-charcoal-500 font-mono">{result.contractor_id?.slice(0, 16)}…</p>
                    {result.department && (
                      <p className="text-xs text-charcoal-500 mt-0.5">{result.department}</p>
                    )}
                  </div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full border font-bold uppercase tracking-wide ${sc.badge}`}>
                  {sc.label}
                </span>
              </div>

              <div className="mb-2 flex items-baseline gap-2">
                <span className={`text-5xl font-extrabold ${sc.text}`}>{result.performance_score ?? 100}</span>
                <span className="text-lg text-charcoal-400">/ 200 pts</span>
              </div>
              <div className="h-4 bg-ivory-200 rounded-full overflow-hidden">
                <div
                  className={`h-4 rounded-full transition-all duration-700 ${sc.bar}`}
                  style={{ width: `${((result.performance_score ?? 100) / 200) * 100}%` }}
                />
              </div>
              <p className="text-xs text-charcoal-500 mt-2">Each warranty breach = −5 pts. Floors at 0.</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />, bg: 'bg-emerald-50 border-emerald-200', val: result.total_resolved ?? 0, label: 'Total Resolved' },
                { icon: <ShieldAlert className="w-5 h-5 text-red-600" />, bg: 'bg-red-50 border-red-200', val: result.breach_count ?? 0, label: 'Warranty Breaches' },
                { icon: <BarChart3 className="w-5 h-5 text-orange-600" />, bg: 'bg-orange-50 border-orange-200', val: `${result.breach_rate ?? 0}%`, label: 'Breach Rate' },
                { icon: <TrendingDown className="w-5 h-5 text-amber-600" />, bg: 'bg-amber-50 border-amber-200', val: `−${(result.breach_count ?? 0) * 5} pts`, label: 'Points Deducted' },
              ].map(({ icon, bg, val, label }) => (
                <div key={label} className="glass-card p-4">
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-2 ${bg}`}>{icon}</div>
                  <p className="text-2xl font-extrabold text-charcoal-900">{val}</p>
                  <p className="text-xs text-charcoal-500 font-medium mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Recent Breaches */}
            {result.recent_breaches && result.recent_breaches.length > 0 && (
              <div className="glass-card p-5">
                <p className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-4">Recent Warranty Breaches</p>
                <div className="space-y-3">
                  {result.recent_breaches.map((breach, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded-xl">
                      <div className="flex items-center gap-2.5">
                        <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-charcoal-800">{breach.category || 'Unknown category'}</p>
                          <p className="text-[11px] text-charcoal-500 font-mono">{breach.ticket_id?.slice(0, 12)}…</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-red-700">−5 pts</p>
                        <p className="text-[10px] text-charcoal-400 flex items-center gap-1 justify-end">
                          <Clock className="w-2.5 h-2.5" />
                          {breach.breach_date ? new Date(breach.breach_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warranty Info */}
            <div className="glass-card p-4 border-l-4 border-l-civic-500">
              <p className="text-xs font-bold text-charcoal-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-civic-600" />60-Day Warranty Policy
              </p>
              <p className="text-xs text-charcoal-500 leading-relaxed">
                Any defect reported within <strong>25m</strong> of a resolved ticket within the <strong>60-day warranty window</strong>
                auto-triggers a breach: the ticket is reopened, rework auto-assigned to this contractor at zero cost,
                and <strong>−5 pts</strong> are deducted from this performance score.
              </p>
            </div>
          </div>
        )
      })()}

      {!result && !loading && (
        <div className="glass-card py-20 text-center text-charcoal-400">
          <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-charcoal-600 text-lg">Enter a contractor ID to view their record</p>
          <p className="text-sm mt-1">Performance scores, breach counts, and warranty history</p>
        </div>
      )}
    </div>
  )
}
