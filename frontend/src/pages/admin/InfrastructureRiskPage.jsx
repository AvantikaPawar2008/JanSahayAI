import { useState } from 'react'
import {
  Loader2, CloudRain, AlertTriangle, Thermometer, CheckCircle2,
  RefreshCw, MapPin, Zap, TrendingUp, Shield,
} from 'lucide-react'
import MapView from '../../components/MapView'
import useGeolocation from '../../hooks/useGeolocation'
import { API_BASE } from '../../supabaseClient'

/**
 * InfrastructureRiskPage — [TODO-HS-02]
 * Weather + asset age risk fusion. Queries Open-Meteo rainfall data and
 * pipe degradation proxy to compute combined infrastructure risk score.
 */
export default function InfrastructureRiskPage() {
  const { lat: userLat, lng: userLng } = useGeolocation()
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState(200)
  const [hoursAhead, setHoursAhead] = useState(24)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const handleGeoFill = () => {
    if (userLat && userLng) {
      setLat(userLat.toFixed(6))
      setLng(userLng.toFixed(6))
    }
  }

  const fetchRisk = async () => {
    const qLat = parseFloat(lat)
    const qLng = parseFloat(lng)
    if (!qLat || !qLng) { setError('Please enter valid coordinates.'); return }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ lat: qLat, lng: qLng, radius_meters: radius, hours_ahead: hoursAhead })
      const res = await fetch(`${API_BASE}/api/admin/infrastructure-risk?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResult(data)
      setHistory(h => [{ lat: qLat, lng: qLng, ...data, ts: new Date().toLocaleTimeString() }, ...h.slice(0, 4)])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const riskColor = (score) => {
    if (score >= 0.7) return { bar: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-300', label: 'CRITICAL RISK' }
    if (score >= 0.5) return { bar: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-300', label: 'HIGH RISK' }
    if (score >= 0.3) return { bar: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-300', label: 'MODERATE RISK' }
    return { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-300', label: 'LOW RISK' }
  }

  return (
    <div className="page-enter max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          Predictive Analytics
        </span>
        <span className="text-xs text-charcoal-400 font-mono">[TODO-HS-02]</span>
      </div>
      <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight mb-2">Infrastructure Risk Dashboard</h1>
      <p className="text-charcoal-500 text-sm mb-8">
        Fuses <strong>Open-Meteo rainfall radar</strong> with <strong>pipe age degradation proxy</strong> to surface proactive tender alerts.
        Risk = 0.6 × AssetAgeRisk + 0.4 × RainfallRisk.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Query Panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-card p-5 space-y-4">
            <h2 className="text-sm font-bold text-charcoal-700 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-civic-600" />Location Query
            </h2>
            <div>
              <label className="text-xs font-semibold text-charcoal-600 mb-1 block">Latitude</label>
              <input
                type="number" value={lat} onChange={e => setLat(e.target.value)}
                placeholder="e.g. 18.5204"
                className="w-full text-sm border border-ivory-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-civic-300 bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-charcoal-600 mb-1 block">Longitude</label>
              <input
                type="number" value={lng} onChange={e => setLng(e.target.value)}
                placeholder="e.g. 73.8567"
                className="w-full text-sm border border-ivory-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-civic-300 bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-charcoal-600 mb-1 block">Asset Search Radius (m)</label>
              <select value={radius} onChange={e => setRadius(Number(e.target.value))}
                className="w-full text-sm border border-ivory-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-civic-300">
                {[100, 200, 500, 1000].map(r => <option key={r} value={r}>{r}m</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-charcoal-600 mb-1 block">Forecast Horizon</label>
              <select value={hoursAhead} onChange={e => setHoursAhead(Number(e.target.value))}
                className="w-full text-sm border border-ivory-300 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-civic-300">
                {[6, 12, 24, 48, 72].map(h => <option key={h} value={h}>Next {h}h</option>)}
              </select>
            </div>
            {userLat && userLng && (
              <button onClick={handleGeoFill} className="w-full btn-secondary text-xs flex items-center justify-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />Use My Location
              </button>
            )}
            <button onClick={fetchRisk} disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2 text-sm">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Analysing…</> : <><Zap className="w-4 h-4" />Compute Risk</>}
            </button>
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">{error}</p>}
          </div>

          {/* Formula Card */}
          <div className="glass-card p-4">
            <p className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-3">Risk Formula</p>
            <div className="bg-ivory-50 rounded-xl p-3 border border-ivory-200 text-center font-mono text-xs text-charcoal-700">
              Risk = 0.6 × AssetAge + 0.4 × Rainfall
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-charcoal-500">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500" /><span>≥ 0.70 → Tender Alert 🚨</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-orange-400" /><span>0.50–0.69 → High Risk</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-400" /><span>0.30–0.49 → Moderate</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /><span>&lt; 0.30 → Low Risk</span></div>
            </div>
          </div>
        </div>

        {/* Result Panel */}
        <div className="lg:col-span-2 space-y-4">
          {result ? (
            <>
              {/* Combined Score */}
              <div className="glass-card p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">Combined Risk Score</p>
                    <p className="text-4xl font-extrabold text-charcoal-900 mt-1">
                      {((result.combined_risk_score || 0) * 100).toFixed(0)}
                      <span className="text-lg font-medium text-charcoal-400">%</span>
                    </p>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-full border font-bold uppercase tracking-wide ${riskColor(result.combined_risk_score || 0).badge}`}>
                    {riskColor(result.combined_risk_score || 0).label}
                  </span>
                </div>
                <div className="h-3 bg-ivory-200 rounded-full overflow-hidden">
                  <div
                    className={`h-3 rounded-full transition-all duration-700 ${riskColor(result.combined_risk_score || 0).bar}`}
                    style={{ width: `${((result.combined_risk_score || 0) * 100).toFixed(1)}%` }}
                  />
                </div>
                {result.should_raise_tender_alert && (
                  <div className="mt-4 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-300">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <p className="text-sm font-bold text-red-800">🚨 Proactive Tender Alert Recommended</p>
                  </div>
                )}
              </div>

              {/* Component Scores */}
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-orange-500" />
                    <span className="text-xs font-bold text-charcoal-600 uppercase tracking-wider">Asset Age Risk</span>
                  </div>
                  <p className="text-3xl font-extrabold text-charcoal-900">
                    {((result.asset_risk_score || 0) * 100).toFixed(0)}<span className="text-base text-charcoal-400">%</span>
                  </p>
                  {result.asset_complaint_count !== undefined && (
                    <p className="text-xs text-charcoal-500 mt-1">{result.asset_complaint_count} complaints in radius</p>
                  )}
                  {result.pipe_age_estimate_years && (
                    <p className="text-xs text-charcoal-500">~{result.pipe_age_estimate_years}yr pipe age estimate</p>
                  )}
                </div>
                <div className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CloudRain className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-charcoal-600 uppercase tracking-wider">Rainfall Risk</span>
                  </div>
                  <p className="text-3xl font-extrabold text-charcoal-900">
                    {((result.rainfall_risk_score || 0) * 100).toFixed(0)}<span className="text-base text-charcoal-400">%</span>
                  </p>
                  {result.rainfall_max_mm_per_hr !== undefined && (
                    <p className="text-xs text-charcoal-500 mt-1">Peak: {result.rainfall_max_mm_per_hr?.toFixed(1)} mm/hr</p>
                  )}
                </div>
              </div>

              {/* Raw JSON preview */}
              <details className="glass-card p-4">
                <summary className="text-xs font-bold text-charcoal-500 uppercase tracking-wider cursor-pointer">Raw API Response</summary>
                <pre className="mt-3 text-[11px] text-charcoal-600 bg-ivory-50 rounded-xl p-3 border border-ivory-200 overflow-auto max-h-48">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <div className="glass-card py-20 text-center text-charcoal-400">
              <CloudRain className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-bold text-charcoal-600 text-lg">Enter coordinates to compute risk</p>
              <p className="text-sm mt-1">Queries Open-Meteo + complaint density for the next {hoursAhead}h</p>
            </div>
          )}

          {/* Query History */}
          {history.length > 0 && (
            <div className="glass-card p-4">
              <p className="text-xs font-bold text-charcoal-500 uppercase tracking-wider mb-3">Recent Queries</p>
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b border-ivory-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-charcoal-600 font-mono">{h.lat?.toFixed(4)}, {h.lng?.toFixed(4)}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${riskColor(h.combined_risk_score || 0).badge}`}>
                      {((h.combined_risk_score || 0) * 100).toFixed(0)}%
                    </span>
                    <span className="text-charcoal-400">{h.ts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
