import { useState, useEffect } from 'react'
import {
  Loader2, Eye, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, ShieldCheck, Camera, Clock, Star, Info,
} from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

/**
 * SupervisorReviewPage — [TODO-VF-03]
 * Verification photos scoring 8-11/15 (BORDERLINE) or CRITICAL tickets
 * requiring human supervisor sign-off before auto-resolution.
 */
export default function SupervisorReviewPage() {
  const { session } = useAuth()
  const [queue, setQueue] = useState([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  const authHeaders = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {}

  const fetchQueue = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/supervisor-review-queue`, { headers: authHeaders })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setQueue(data.review_queue || [])
      setCount(data.count || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchQueue() }, [])

  const verdictConfig = {
    BORDERLINE: { label: 'Borderline', color: 'bg-amber-50 text-amber-800 border-amber-300' },
    PASS:       { label: 'Pass',       color: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
    FAIL:       { label: 'Fail',       color: 'bg-red-50 text-red-700 border-red-200' },
  }
  const urgencyColors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-300',
    HIGH:     'bg-orange-50 text-orange-700 border-orange-300',
    MEDIUM:   'bg-amber-50 text-amber-700 border-amber-200',
    LOW:      'bg-green-50 text-green-700 border-green-200',
  }

  const RubricBar = ({ label, score, max = 5 }) => (
    <div className="flex items-center gap-3">
      <span className="text-xs text-charcoal-500 w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-ivory-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-400' : 'bg-red-400'}`}
          style={{ width: `${(score / max) * 100}%` }}
        />
      </div>
      <span className="text-xs font-bold text-charcoal-700 w-8 text-right">{score}/{max}</span>
    </div>
  )

  return (
    <div className="page-enter max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Human Review Required</span>
        <span className="text-xs text-charcoal-400 font-mono">[TODO-VF-03]</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">Supervisor Review Queue</h1>
        <button onClick={fetchQueue} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>
      <p className="text-charcoal-500 text-sm mb-6">
        Verification photos scoring <strong>8–11 / 15</strong> (BORDERLINE) or attached to <strong>CRITICAL</strong> tickets — require your manual sign-off.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { icon: <Eye className="w-5 h-5 text-amber-600" />, bg: 'bg-amber-50 border-amber-200', val: count, label: 'Pending Reviews' },
          { icon: <AlertTriangle className="w-5 h-5 text-red-600" />, bg: 'bg-red-50 border-red-200', val: queue.filter(q => q.master_tickets?.urgency === 'CRITICAL').length, label: 'Critical Urgency' },
          { icon: <Star className="w-5 h-5 text-civic-600" />, bg: 'bg-civic-50 border-civic-200', val: '15 pt', label: 'Rubric Scale' },
        ].map(({ icon, bg, val, label }) => (
          <div key={label} className="glass-card p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${bg}`}>{icon}</div>
            <div>
              <p className="text-2xl font-extrabold text-charcoal-900">{val}</p>
              <p className="text-xs text-charcoal-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card p-4 mb-6 flex flex-wrap gap-4 text-xs">
        {[
          { color: 'bg-emerald-500', label: '12–15: PASS (auto-approved)' },
          { color: 'bg-amber-400', label: '8–11: BORDERLINE (this queue)' },
          { color: 'bg-red-400', label: '0–7: FAIL (auto-reopened)' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <span className="text-charcoal-600 font-medium">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-charcoal-600 font-medium">CRITICAL always needs human sign-off</span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-civic-600 animate-spin" /></div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-red-600">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
          <p className="font-semibold">Failed to load review queue</p>
          <p className="text-sm text-charcoal-500 mt-1">{error}</p>
        </div>
      ) : queue.length === 0 ? (
        <div className="glass-card py-16 text-center text-charcoal-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
          <p className="text-lg font-bold text-charcoal-700">Queue is clear!</p>
          <p className="text-sm mt-1">No verification photos pending supervisor review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => {
            const isExpanded = expandedId === item.id
            const ticket = item.master_tickets || {}
            const verdict = item.rubric_verdict || 'BORDERLINE'
            const urgency = ticket.urgency || 'MEDIUM'
            const vCfg = verdictConfig[verdict] || verdictConfig.BORDERLINE
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-ivory-300 shadow-card hover:shadow-card-hover transition-all duration-200 animate-fade-in">
                <div className="flex items-start justify-between p-5 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                  <div className="flex items-start gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Camera className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-charcoal-900 text-sm leading-snug">
                        {ticket.category || 'Verification Photo'} — <span className="font-normal text-charcoal-500">{ticket.department || 'Dept Unknown'}</span>
                      </h3>
                      <p className="text-xs text-charcoal-500 mt-0.5 line-clamp-1">{ticket.description || 'No description'}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${urgencyColors[urgency] || ''}`}>{urgency}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${vCfg.color}`}>{vCfg.label}</span>
                        <span className="text-xs text-charcoal-500 flex items-center gap-1">
                          <Star className="w-3 h-3 text-amber-500" />Score: <strong className="text-charcoal-700">{item.rubric_total_score ?? '—'}/15</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-charcoal-400 flex items-center gap-1 flex-shrink-0 ml-4">
                    <Clock className="w-3 h-3" />
                    {item.captured_at ? new Date(item.captured_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                </div>

                {isExpanded && (
                  <div className="border-t border-ivory-200 p-5 space-y-4 animate-slide-up">
                    <div>
                      <p className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-3">Rubric Breakdown</p>
                      <div className="space-y-2.5">
                        <RubricBar label="Site Match" score={item.rubric_site_match ?? 0} />
                        <RubricBar label="Defect Resolved" score={item.rubric_defect_resolved ?? 0} />
                        <RubricBar label="Repair Quality" score={item.rubric_repair_quality ?? 0} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-charcoal-600">Total Score</span>
                        <span className={`text-sm font-extrabold px-3 py-1 rounded-lg ${(item.rubric_total_score ?? 0) >= 12 ? 'bg-emerald-50 text-emerald-700' : (item.rubric_total_score ?? 0) >= 8 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                          {item.rubric_total_score ?? '—'} / 15
                        </span>
                      </div>
                    </div>
                    {ticket.id && (
                      <div className="bg-ivory-50 rounded-xl p-3 border border-ivory-200">
                        <p className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-1.5">Linked Ticket</p>
                        <div className="flex items-center gap-2 text-xs text-charcoal-600">
                          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span className="font-mono text-[11px]">{ticket.id?.slice(0, 12)}…</span>
                          <span className="text-charcoal-400">·</span>
                          <span>{ticket.category}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => window.open(item.photo_url || '#', '_blank')} className="btn-secondary text-xs flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5" />View Photo
                      </button>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />Approve
                      </button>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 transition-colors font-medium">
                        <XCircle className="w-3.5 h-3.5" />Reject &amp; Reopen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
