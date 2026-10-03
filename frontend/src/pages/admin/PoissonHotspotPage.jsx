import { useState } from 'react'
import {
  Loader2, TrendingUp, AlertTriangle, CheckCircle2,
  Zap, RefreshCw, BarChart3, MapPin, Activity,
} from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

/**
 * PoissonHotspotPage — [TODO-HS-01]
 * Triggers DBSCAN clustering + Poisson z-score statistical testing.
 * Only clusters with z-score >= 2.0 are flagged as statistically abnormal.
 */
export default function PoissonHotspotPage() {
  const { session } = useAuth()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  const authHeaders = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {}

  const runDetection = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/detect-hotspots-with-stats`, {
        method: 'POST',
        headers: authHeaders,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredAlerts = () => {
    if (!result?.alerts) return []
    if (filter === 'abnormal') return result.alerts.filter(a => a.is_statistically_abnormal)
    if (filter === 'normal') return result.alerts.filter(a => !a.is_statistically_abnormal)
    return result.alerts
  }

  const zScoreColor = (z) => {
    if (!z && z !== 0) return 'text-charcoal-400'
    if (z >= 3.0) return 'text-red-700'
    if (z >= 2.0) return 'text-orange-600'
    if (z >= 1.0) return 'text-amber-600'
    return 'text-emerald-600'
  }

  const zScoreBadge = (z, isAbnormal) => {
    if (isAbnormal) return 'bg-red-50 text-red-700 border-red-300'
    return 'bg-emerald-50 text-emerald-700 border-emerald-300'
  }

  return (
    <div className="page-enter max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
          Statistical Intelligence
        </span>
        <span className="text-xs text-charcoal-400 font-mono">[TODO-HS-01]</span>
      </div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">Poisson Hotspot Analysis</h1>
        <button onClick={runDetection} disabled={loading}
          className="btn-primary flex items-center gap-2 text-sm">
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" />Detecting…</>
            : <><Zap className="w-4 h-4" />Run Detection</>}
        </button>
      </div>
      <p className="text-charcoal-500 text-sm mb-8">
        Runs <strong>DBSCAN clustering</strong> on recent complaint coordinates, then applies
        <strong> Poisson z-score testing</strong> (Z = (N − μ) / σ) against a 30-day rolling baseline per 500m ward cell.
        Only clusters with <strong>Z ≥ 2.0</strong> fire administrative alarms.
      </p>

      {error && (
        <div className="glass-card p-4 mb-6 flex items-center gap-2 text-red-600 bg-red-50 border-red-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {result && (
        <>
          {/* Summary Banners */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { icon: <Activity className="w-5 h-5 text-blue-600" />, bg: 'bg-blue-50 border-blue-200', val: result.total_clusters, label: 'Total Clusters' },
              { icon: <AlertTriangle className="w-5 h-5 text-red-600" />, bg: 'bg-red-50 border-red-200', val: result.statistically_abnormal, label: 'Abnormal (Z ≥ 2.0)' },
              { icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />, bg: 'bg-emerald-50 border-emerald-200', val: (result.total_clusters || 0) - (result.statistically_abnormal || 0), label: 'Normal Traffic' },
            ].map(({ icon, bg, val, label }) => (
              <div key={label} className="glass-card p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${bg}`}>{icon}</div>
                <div>
                  <p className="text-2xl font-extrabold text-charcoal-900">{val ?? 0}</p>
                  <p className="text-xs text-charcoal-500 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Z-score explanation */}
          <div className="glass-card p-4 mb-6 flex flex-wrap gap-4 text-xs">
            <span className="text-xs font-bold text-charcoal-600 uppercase tracking-wider self-center">Z-Score Scale:</span>
            {[
              { range: 'Z < 1.0', color: 'bg-emerald-500', label: 'Normal' },
              { range: '1.0–1.9', color: 'bg-amber-400', label: 'Elevated' },
              { range: '2.0–2.9', color: 'bg-orange-500', label: 'Abnormal ⚠️' },
              { range: '≥ 3.0', color: 'bg-red-600', label: 'Critical 🚨' },
            ].map(({ range, color, label }) => (
              <div key={range} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-charcoal-600 font-medium">{range}: <strong>{label}</strong></span>
              </div>
            ))}
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 mb-5">
            {[
              { key: 'all', label: `All (${result.total_clusters})` },
              { key: 'abnormal', label: `🚨 Abnormal (${result.statistically_abnormal})` },
              { key: 'normal', label: `✅ Normal (${(result.total_clusters || 0) - (result.statistically_abnormal || 0)})` },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all border
                  ${filter === key
                    ? 'bg-civic-50 text-civic-800 border-civic-300 font-semibold shadow-sm'
                    : 'bg-white text-charcoal-500 hover:text-charcoal-800 border-ivory-300'
                  }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Alerts List */}
          <div className="space-y-3">
            {filteredAlerts().map((alert, i) => (
              <div key={alert.id || i}
                className={`bg-white rounded-2xl border shadow-card hover:shadow-card-hover transition-all duration-200 p-5 animate-fade-in ${alert.is_statistically_abnormal ? 'border-red-200' : 'border-ivory-300'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${alert.is_statistically_abnormal ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                      {alert.is_statistically_abnormal
                        ? <AlertTriangle className="w-5 h-5 text-red-600" />
                        : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-charcoal-900 text-sm leading-snug">
                        {alert.category || 'Complaint'} Cluster
                        {alert.sub_category && <span className="font-normal text-charcoal-500"> — {alert.sub_category}</span>}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-charcoal-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-civic-600" />
                          {alert.center_lat?.toFixed(4)}, {alert.center_lng?.toFixed(4)}
                        </span>
                        <span className="font-semibold text-charcoal-700">{alert.ticket_count} tickets</span>
                        {alert.radius_m && <span>{alert.radius_m}m radius</span>}
                        {alert.department && <span className="text-civic-700 font-medium">{alert.department}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase tracking-wide ${zScoreBadge(alert.z_score, alert.is_statistically_abnormal)}`}>
                      {alert.is_statistically_abnormal ? '🚨 ABNORMAL' : '✅ NORMAL'}
                    </span>
                    {alert.z_score !== null && alert.z_score !== undefined && (
                      <div className="text-right">
                        <p className={`text-lg font-extrabold ${zScoreColor(alert.z_score)}`}>Z = {alert.z_score?.toFixed(2)}</p>
                        {alert.baseline_mean !== null && alert.baseline_mean !== undefined && (
                          <p className="text-[10px] text-charcoal-400">baseline μ = {alert.baseline_mean?.toFixed(1)}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {filteredAlerts().length === 0 && (
              <div className="glass-card py-12 text-center text-charcoal-400">
                <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-charcoal-600">No clusters in this category</p>
              </div>
            )}
          </div>
        </>
      )}

      {!result && !loading && (
        <div className="glass-card py-20 text-center text-charcoal-400">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-charcoal-600 text-lg">Click "Run Detection" to start Poisson analysis</p>
          <p className="text-sm mt-1">DBSCAN clustering + z-score testing on all active complaints</p>
        </div>
      )}
    </div>
  )
}
