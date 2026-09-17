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
    NEW: 'bg-red-500/20 text-red-300 border-red-500/30',
    ACKNOWLEDGED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    INVESTIGATING: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    RESOLVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  }

  return (
    <div className="page-enter max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold gradient-text mb-2">Hotspot Alerts</h1>
      <p className="text-white/50 text-sm mb-6">
        Root-cause infrastructure alerts from clustered complaints
      </p>

      {/* Map Overview */}
      <MapView
        center={userLat && userLng ? [userLat, userLng] : [18.52, 73.86]}
        hotspots={hotspots}
        markers={[]}
        height="300px"
        className="mb-6"
      />

      {/* Status Filter */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {['', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0
              ${statusFilter === s
                ? 'bg-civic-600/30 text-civic-300 border border-civic-500/30'
                : 'text-white/40 hover:text-white/60 border border-transparent'
              }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
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
              <div key={hotspot.id} className="glass-card animate-fade-in">
                {/* Header */}
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : hotspot.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white/90 text-sm">
                        🔥 {hotspot.category} Cluster
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {hotspot.center_lat?.toFixed(4)}, {hotspot.center_lng?.toFixed(4)}
                        </span>
                        <span>{hotspot.ticket_count} tickets</span>
                        <span>{hotspot.radius_m}m radius</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`badge border ${statusColors[hotspot.status] || ''}`}>
                      {hotspot.status}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-white/30" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/30" />
                    )}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-4 animate-slide-up">
                    {/* Root Cause Analysis */}
                    {parsedAnalysis ? (
                      <div className="space-y-3">
                        {parsedAnalysis.root_cause && (
                          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                            <span className="text-xs text-white/40 uppercase">Root Cause</span>
                            <p className="text-sm text-white/70 mt-1">{parsedAnalysis.root_cause}</p>
                          </div>
                        )}
                        {parsedAnalysis.recommended_intervention && (
                          <div className="p-3 rounded-xl bg-civic-600/10 border border-civic-500/10">
                            <span className="text-xs text-white/40 uppercase">Recommended Intervention</span>
                            <p className="text-sm text-civic-300 mt-1">{parsedAnalysis.recommended_intervention}</p>
                          </div>
                        )}
                        {parsedAnalysis.estimated_resources && (
                          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                            <span className="text-xs text-white/40 uppercase">Estimated Resources</span>
                            <p className="text-sm text-white/70 mt-1">{parsedAnalysis.estimated_resources}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-white/40 mb-3">No root cause analysis yet</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); analyzeRootCause(hotspot.id); }}
                          disabled={analyzingId === hotspot.id}
                          className="btn-primary text-sm"
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
                    <div className="flex gap-2 flex-wrap">
                      {['ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((s) => (
                        <button
                          key={s}
                          onClick={(e) => { e.stopPropagation(); updateStatus(hotspot.id, s); }}
                          disabled={hotspot.status === s}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-all
                            ${hotspot.status === s
                              ? 'opacity-50 cursor-not-allowed border-white/5 text-white/20'
                              : 'border-white/10 text-white/50 hover:text-white/70 hover:border-white/20'
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
            <div className="text-center py-16 text-white/30">
              <AlertTriangle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-lg">No hotspot alerts</p>
              <p className="text-sm mt-1">Run hotspot detection from the dashboard to find clusters</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
