import { useState, useEffect } from 'react'
import { Loader2, AlertTriangle, MapPin, Search, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import MapView from '../../components/MapView'
import useGeolocation from '../../hooks/useGeolocation'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

/**
 * HotspotAlertsPage — root-cause infrastructure alert list with map clusters.
 */
export default function HotspotAlertsPage() {
  const { session } = useAuth()
  const { lat: userLat, lng: userLng } = useGeolocation()
  const [hotspots, setHotspots] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    fetchHotspots()
  }, [statusFilter])

  const fetchHotspots = async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      
      const response = await fetch(`${API_BASE}/api/admin/hotspots?${params}`)
      if (response.ok) {
        setHotspots(await response.json())
      }
    } catch (err) {
      console.error('Hotspots fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const analyzeRootCause = async (alertId) => {
    setAnalyzingId(alertId)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const response = await fetch(`${API_BASE}/api/admin/hotspots/${alertId}/analyze`, {
        method: 'POST',
        headers,
      })
      if (response.ok) {
        fetchHotspots()
      }
    } catch (err) {
      console.error('Analysis error:', err)
    } finally {
      setAnalyzingId(null)
    }
  }

  const updateStatus = async (alertId, newStatus) => {
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      await fetch(`${API_BASE}/api/admin/hotspots/${alertId}?status=${newStatus}`, {
        method: 'PATCH',
        headers,
      })
      fetchHotspots()
    } catch (err) {
      console.error('Status update error:', err)
    }
  }

  const statusColors = {
    NEW: 'bg-coral-50 text-coral-700 border-coral-200 font-semibold',
    ACKNOWLEDGED: 'bg-amber-50 text-amber-800 border-amber-200 font-semibold',
    INVESTIGATING: 'bg-blue-50 text-blue-700 border-blue-200 font-semibold',
    RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
  }

  return (
    <div className="page-enter max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-coral-50 text-coral-700 border border-coral-200">
          Clustered Incidents
        </span>
        <span className="text-xs text-charcoal-400 font-mono">Automated Triage</span>
      </div>
      <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight mb-2">Hotspot Alerts</h1>
      <p className="text-charcoal-500 text-sm mb-6">
        Root-cause infrastructure alerts synthesized from dense geospatial complaint clusters
      </p>

      {/* Map Overview */}
      <MapView
        center={userLat && userLng ? [userLat, userLng] : [18.52, 73.86]}
        hotspots={hotspots}
        markers={[]}
        height="300px"
        className="mb-6 rounded-2xl border border-ivory-300 shadow-card overflow-hidden"
      />

      {/* Status Filter */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {['', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0 border
              ${statusFilter === s
                ? 'bg-civic-50 text-civic-800 border-civic-300 font-semibold shadow-sm'
                : 'bg-white text-charcoal-500 hover:text-charcoal-800 border-ivory-300 hover:border-ivory-400'
              }`}
          >
            {s || 'All Alerts'}
          </button>
        ))}
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {hotspots.map((hotspot) => {
            const isExpanded = expandedId === hotspot.id
            let parsedAnalysis = null
            if (hotspot.root_cause_analysis) {
              try {
                parsedAnalysis = JSON.parse(hotspot.root_cause_analysis)
              } catch {
                parsedAnalysis = { root_cause: hotspot.root_cause_analysis }
              }
            }

            return (
              <div key={hotspot.id} className="bg-white rounded-2xl border border-ivory-300 shadow-card hover:shadow-card-hover transition-all duration-200 p-5 animate-fade-in">
                {/* Header */}
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : hotspot.id)}
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-coral-50 border border-coral-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle className="w-5 h-5 text-coral-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-charcoal-900 text-sm flex items-center gap-1.5">
                        🔥 {hotspot.category} Cluster
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-charcoal-500">
                        <span className="flex items-center gap-1 font-medium">
                          <MapPin className="w-3.5 h-3.5 text-civic-600" />
                          {hotspot.center_lat?.toFixed(4)}, {hotspot.center_lng?.toFixed(4)}
                        </span>
                        <span className="font-semibold text-charcoal-700">{hotspot.ticket_count} tickets clustered</span>
                        <span>{hotspot.radius_m}m radius</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${statusColors[hotspot.status] || ''}`}>
                      {hotspot.status}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-charcoal-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-charcoal-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-ivory-200 space-y-4 animate-slide-up">
                    {/* Root Cause Analysis */}
                    {parsedAnalysis ? (
                      <div className="space-y-3">
                        {parsedAnalysis.root_cause && (
                          <div className="p-3.5 rounded-xl bg-ivory-100 border border-ivory-300">
                            <span className="text-xs font-bold text-charcoal-500 uppercase tracking-wider">Root Cause</span>
                            <p className="text-sm text-charcoal-800 font-medium mt-1 leading-relaxed">{parsedAnalysis.root_cause}</p>
                          </div>
                        )}
                        {parsedAnalysis.recommended_intervention && (
                          <div className="p-3.5 rounded-xl bg-civic-50 border border-civic-200">
                            <span className="text-xs font-bold text-civic-800 uppercase tracking-wider">Recommended Intervention</span>
                            <p className="text-sm text-civic-900 mt-1 leading-relaxed">{parsedAnalysis.recommended_intervention}</p>
                          </div>
                        )}
                        {parsedAnalysis.estimated_resources && (
                          <div className="p-3.5 rounded-xl bg-ivory-100 border border-ivory-300">
                            <span className="text-xs font-bold text-charcoal-500 uppercase tracking-wider">Estimated Resources</span>
                            <p className="text-sm text-charcoal-700 mt-1">{parsedAnalysis.estimated_resources}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-ivory-50 rounded-xl border border-ivory-200">
                        <p className="text-sm text-charcoal-500 mb-3">No root cause analysis yet</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); analyzeRootCause(hotspot.id); }}
                          disabled={analyzingId === hotspot.id}
                          className="btn-primary text-sm shadow-sm"
                        >
                          {analyzingId === hotspot.id ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              Run AI Root Cause Analysis
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Status Actions */}
                    <div className="flex gap-2 flex-wrap pt-1">
                      {['ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((s) => (
                        <button
                          key={s}
                          onClick={(e) => { e.stopPropagation(); updateStatus(hotspot.id, s); }}
                          disabled={hotspot.status === s}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium
                            ${hotspot.status === s
                              ? 'opacity-40 cursor-not-allowed border-ivory-200 text-charcoal-300'
                              : 'border-ivory-300 text-charcoal-700 hover:bg-ivory-100'
                            }`}
                        >
                          Mark as {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {hotspots.length === 0 && (
            <div className="text-center py-16 text-charcoal-400">
              <AlertTriangle className="w-8 h-8 mx-auto mb-3 opacity-40 text-charcoal-400" />
              <p className="text-lg font-semibold text-charcoal-700">No hotspot alerts</p>
              <p className="text-sm mt-1">Run hotspot detection from the dashboard to find clusters</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
