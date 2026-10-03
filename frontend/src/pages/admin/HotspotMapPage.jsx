import { useState, useEffect } from 'react'
import {
  Zap, Loader2, AlertTriangle, Flame, RefreshCw,
  Eye, MapPin, Users, Thermometer, Layers, Box,
} from 'lucide-react'
import DeckMapView from '../../components/DeckMapView'
import useGeolocation from '../../hooks/useGeolocation'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

// Urgency color map (must match DeckMapView URGENCY_COLOR RGB values)
const URGENCY_COLORS = {
  LOW:      '#10b981',
  MEDIUM:   '#f59e0b',
  HIGH:     '#f97316',
  CRITICAL: '#ef4444',
}

/**
 * HotspotMapPage — Upgraded to deck.gl + MapLibre GL (GPU-accelerated).
 * Replaces Leaflet DOM map with DeckMapView.
 * All 4 layers: HeatmapLayer, ScatterplotLayer, HexagonLayer, hotspot rings.
 */
export default function HotspotMapPage() {
  const { session } = useAuth()
  const { lat: userLat, lng: userLng } = useGeolocation()
  const [mapData, setMapData] = useState({ hotspots: [], tickets: [], heatmap_points: [] })
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState(null)

  // Layer toggles
  const [showPins, setShowPins] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showHexagon, setShowHexagon] = useState(false)
  const [showClusters, setShowClusters] = useState(true)

  const fetchMapData = async () => {
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/hotspot-map`, { headers })
      if (res.ok) {
        const data = await res.json()
        setMapData(data)
      }
    } catch (err) {
      console.error('Failed to fetch hotspot map data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMapData()
  }, [session])

  const runDetection = async () => {
    setDetecting(true)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/detect-hotspots`, {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        const result = await res.json()
        alert(`Spatial cluster analysis complete: ${result.alerts_created} hotspots identified`)
        fetchMapData()
      }
    } catch (err) {
      console.error('Hotspot detection error:', err)
    } finally {
      setDetecting(false)
    }
  }

  const initialViewState = userLat && userLng
    ? { longitude: userLng, latitude: userLat, zoom: 12, pitch: 0, bearing: 0 }
    : { longitude: 73.8567, latitude: 18.5204, zoom: 12, pitch: 0, bearing: 0 }

  const openTickets = mapData.tickets || []

  const toggleClass = (active, activeClass) =>
    'btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 font-medium transition-all ' +
    (active ? (activeClass || 'bg-civic-50 text-civic-800 border-civic-300') : 'text-charcoal-500')


  return (
    <div className="page-enter max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-coral-50 text-coral-700 border border-coral-200">
              Spatial Intelligence
            </span>
            <span className="text-xs text-charcoal-400 font-mono">GPU-Accelerated · deck.gl + MapLibre</span>
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight flex items-center gap-2.5">
            <Flame className="w-7 h-7 text-coral-600" />
            Civic Hotspot &amp; Heatmap
          </h1>
          <p className="text-charcoal-500 text-sm mt-1">
            Real-time geospatial density and DBSCAN cluster analysis — powered by WebGL GPU rendering
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button id="toggle-pins" onClick={() => setShowPins(!showPins)} className={toggleClass(showPins)}>
            <MapPin className="w-3.5 h-3.5" />Pins: {showPins ? 'ON' : 'OFF'}
          </button>
          <button id="toggle-heatmap" onClick={() => setShowHeatmap(!showHeatmap)} className={toggleClass(showHeatmap)}>
            <Thermometer className="w-3.5 h-3.5" />Heatmap: {showHeatmap ? 'ON' : 'OFF'}
          </button>
          <button id="toggle-hexagon" onClick={() => setShowHexagon(!showHexagon)}
            className={toggleClass(showHexagon, 'bg-purple-50 text-purple-800 border-purple-300')}>
            <Box className="w-3.5 h-3.5" />3D Hex: {showHexagon ? 'ON' : 'OFF'}
          </button>
          <button id="toggle-clusters" onClick={() => setShowClusters(!showClusters)}
            className={toggleClass(showClusters, 'bg-coral-50 text-coral-800 border-coral-300')}>
            <Eye className="w-3.5 h-3.5" />Clusters: {showClusters ? 'ON' : 'OFF'}
          </button>

          <button onClick={fetchMapData} className="btn-secondary px-3 py-2" title="Refresh data">
            <RefreshCw className="w-4 h-4 text-charcoal-600" />
          </button>
          <button
            onClick={runDetection}
            disabled={detecting}
            className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5 shadow-sm"
          >
            {detecting ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Zap className="w-4 h-4" />}
            Run DBSCAN Clustering
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
        {[
          { label: 'Open Tickets', val: mapData.total_open_tickets ?? openTickets.length, color: 'text-charcoal-900' },
          { label: 'Active Hotspot Zones', val: mapData.total_active_clusters ?? mapData.hotspots?.length ?? 0, color: 'text-coral-600' },
          { label: 'Heatmap Points', val: mapData.total_incident_points ?? mapData.heatmap_points?.length ?? 0, color: 'text-amber-600' },
          { label: 'Render Engine', val: 'WebGL GPU', color: 'text-civic-700' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-white p-4 rounded-2xl border border-ivory-300 shadow-card">
            <p className="text-xs text-charcoal-500 font-medium">{label}</p>
            <p className={'text-2xl font-bold font-mono mt-1 ' + color}>{val}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl border border-ivory-300 shadow-sm mb-4 flex flex-wrap items-center gap-4 py-2.5 px-4">
        <span className="text-xs text-charcoal-500 font-bold uppercase tracking-wide">Urgency:</span>
        {Object.entries(URGENCY_COLORS).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1.5 text-xs text-charcoal-700 font-medium">
            <span style={{ background: color }} className="w-3 h-3 rounded-full inline-block border border-black/10" />
            {level}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-charcoal-700 font-medium ml-2 border-l border-ivory-300 pl-4">
          🔴 Hotspot Ring (DBSCAN cluster boundary)
        </span>
        {showHexagon && (
          <span className="flex items-center gap-1.5 text-xs text-purple-700 font-medium border-l border-ivory-300 pl-4">
            🟩 3D Hexagon = complaint density (height = count)
          </span>
        )}
      </div>

      {/* Main Map — deck.gl */}
      <div
        id="deck-map-wrapper"
        className="bg-white border border-ivory-300 rounded-2xl overflow-hidden shadow-card relative"
        style={{ height: '620px' }}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
          </div>
        ) : (
          <DeckMapView
            tickets={openTickets}
            heatmapPoints={mapData.heatmap_points || []}
            hotspots={mapData.hotspots || []}
            showHeatmap={showHeatmap}
            showPins={showPins}
            showHexagon={showHexagon}
            showClusters={showClusters}
            initialViewState={initialViewState}
            onTicketClick={setSelectedTicket}
            height="620px"
          />
        )}
      </div>

      {/* Selected ticket detail panel */}
      {selectedTicket && (
        <div className="mt-4 glass-card p-4 border-l-4 border-l-civic-500 animate-slide-up">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-charcoal-900">{selectedTicket.category || 'Civic Issue'}</h3>
              {selectedTicket.sub_category && (
                <p className="text-xs text-charcoal-500 font-mono mt-0.5">{selectedTicket.sub_category}</p>
              )}
              <div className="flex gap-3 mt-2 text-xs text-charcoal-600">
                <span><strong>Dept:</strong> {selectedTicket.department || '—'}</span>
                <span><strong>Status:</strong> {selectedTicket.status}</span>
                <span style={{ color: URGENCY_COLORS[selectedTicket.urgency] || '#f59e0b' }} className="font-bold">
                  {selectedTicket.urgency}
                </span>
                {selectedTicket.upvote_count > 1 && (
                  <span className="flex items-center gap-1 text-amber-700">
                    <Users className="w-3 h-3" /> {selectedTicket.upvote_count} reported
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelectedTicket(null)}
              className="text-charcoal-400 hover:text-charcoal-700 text-xl leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && openTickets.length === 0 && mapData.hotspots?.length === 0 && (
        <div className="text-center py-8 text-charcoal-400 mt-4">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-lg">No active tickets or hotspots</p>
          <p className="text-sm mt-1">Submit complaints to see them appear on the map</p>
        </div>
      )}
    </div>
  )
}
