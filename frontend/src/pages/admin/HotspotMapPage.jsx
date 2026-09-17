import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Circle, Popup, Marker } from 'react-leaflet'
import L from 'leaflet'
import {
  Zap, Loader2, AlertTriangle, Flame, Layers, RefreshCw,
  Eye, MapPin, Users, Thermometer,
} from 'lucide-react'
import HeatmapLayer from '../../components/HeatmapLayer'
import useGeolocation from '../../hooks/useGeolocation'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

// Fix Leaflet default icons for Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// ── Urgency-coloured SVG pin icon (same logic as MapView.jsx) ──────────────
const URGENCY_COLORS = {
  LOW: '#10b981',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
}

function createUrgencyIcon(urgency) {
  const color = URGENCY_COLORS[urgency] || URGENCY_COLORS.MEDIUM
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        width:26px;height:26px;border-radius:50% 50% 50% 0;
        background:${color};border:2px solid white;
        transform:rotate(-45deg);position:relative;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
      ">
        <div style="
          width:9px;height:9px;border-radius:50%;
          background:white;position:absolute;
          top:50%;left:50%;transform:translate(-50%,-50%);
        "></div>
      </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -28],
  })
}

// Hotspot alert icon — always stands out on top
function createHotspotIcon() {
  return L.divIcon({
    className: 'hotspot-marker',
    html: `
      <div style="
        width:34px;height:34px;border-radius:50%;
        background:rgba(239,68,68,0.15);border:2px solid #ef4444;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 12px rgba(239,68,68,0.5);
        animation:pulse 2s infinite;
      ">
        <span style="font-size:16px">🔥</span>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  })
}

export default function HotspotMapPage() {
  const { session } = useAuth()
  const { lat: userLat, lng: userLng } = useGeolocation()
  const [mapData, setMapData] = useState({ hotspots: [], tickets: [], heatmap_points: [] })
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)

  // Layer toggles
  const [showPins, setShowPins] = useState(true)       // individual master ticket pins
  const [showHeatmap, setShowHeatmap] = useState(false) // density heatmap (off by default when pins on)
  const [showClusters, setShowClusters] = useState(true) // hotspot alert circles (always recommended)

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

  const defaultCenter = userLat && userLng ? [userLat, userLng] : [18.52, 73.86]
  const openTickets = mapData.tickets || []

  return (
    <div className="page-enter max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-coral-50 text-coral-700 border border-coral-200">
              Spatial Intelligence
            </span>
            <span className="text-xs text-charcoal-400 font-mono">DBSCAN Density Analysis</span>
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight flex items-center gap-2.5">
            <Flame className="w-7 h-7 text-coral-600" />
            Civic Hotspot &amp; Heatmap
          </h1>
          <p className="text-charcoal-500 text-sm mt-1">
            Real-time geospatial density and DBSCAN cluster analysis of municipal complaints
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Layer toggles */}
          <button
            id="toggle-pins"
            onClick={() => setShowPins(!showPins)}
            title="Toggle individual ticket pins"
            className={`btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 font-medium ${
              showPins ? 'bg-civic-50 text-civic-800 border-civic-300' : 'text-charcoal-500'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            Pins: {showPins ? 'ON' : 'OFF'}
          </button>

          <button
            id="toggle-heatmap"
            onClick={() => setShowHeatmap(!showHeatmap)}
            title="Toggle density heatmap"
            className={`btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 font-medium ${
              showHeatmap ? 'bg-civic-50 text-civic-800 border-civic-300' : 'text-charcoal-500'
            }`}
          >
            <Thermometer className="w-3.5 h-3.5" />
            Heatmap: {showHeatmap ? 'ON' : 'OFF'}
          </button>

          <button
            id="toggle-clusters"
            onClick={() => setShowClusters(!showClusters)}
            title="Toggle hotspot cluster circles"
            className={`btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 font-medium ${
              showClusters ? 'bg-coral-50 text-coral-800 border-coral-300' : 'text-charcoal-500'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Clusters: {showClusters ? 'ON' : 'OFF'}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
        <div className="bg-white p-4 rounded-2xl border border-ivory-300 shadow-card">
          <p className="text-xs text-charcoal-500 font-medium">Open Tickets (Pins)</p>
          <p className="text-2xl font-bold font-mono text-charcoal-900 mt-1">
            {mapData.total_open_tickets ?? openTickets.length}
          </p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-ivory-300 shadow-card">
          <p className="text-xs text-charcoal-500 font-medium">Active Hotspot Zones</p>
          <p className="text-2xl font-bold font-mono text-coral-600 mt-1">
            {mapData.total_active_clusters ?? mapData.hotspots?.length ?? 0}
          </p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-ivory-300 shadow-card">
          <p className="text-xs text-charcoal-500 font-medium">Heatmap Points</p>
          <p className="text-2xl font-bold font-mono text-amber-600 mt-1">
            {mapData.total_incident_points ?? mapData.heatmap_points?.length ?? 0}
          </p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-ivory-300 shadow-card">
          <p className="text-xs text-charcoal-500 font-medium">Cluster Radius</p>
          <p className="text-2xl font-bold font-mono text-civic-700 mt-1">100 m</p>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl border border-ivory-300 shadow-sm mb-4 flex flex-wrap items-center gap-4 py-2.5 px-4">
        <span className="text-xs text-charcoal-500 font-bold uppercase tracking-wide">Pin Legend:</span>
        {Object.entries(URGENCY_COLORS).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1.5 text-xs text-charcoal-700 font-medium">
            <span style={{ background: color }} className="w-3 h-3 rounded-full inline-block border border-black/10" />
            {level}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-charcoal-700 font-medium ml-2 border-l border-ivory-300 pl-4">
          🔥 Hotspot Alert (always shown)
        </span>
      </div>

      {/* Map Container */}
      <div className="bg-white p-2 border border-ivory-300 rounded-2xl overflow-hidden shadow-card relative" style={{ height: '620px' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
          </div>
        ) : (
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ height: '100%', width: '100%', borderRadius: '14px' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* ── LAYER 1: Heatmap (density) ─────────────────────────────── */}
            {showHeatmap && mapData.heatmap_points?.length > 0 && (
              <HeatmapLayer points={mapData.heatmap_points} />
            )}

            {/* ── LAYER 2: Pinpoint layer — one marker per open master ticket ── */}
            {showPins && openTickets.map((ticket) => {
              if (!ticket.lat || !ticket.lng) return null
              return (
                <Marker
                  key={ticket.id}
                  position={[ticket.lat, ticket.lng]}
                  icon={createUrgencyIcon(ticket.urgency)}
                >
                  <Popup minWidth={220}>
                    <div className="p-1 text-gray-900 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          style={{ background: URGENCY_COLORS[ticket.urgency] || '#f59e0b' }}
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        />
                        <strong className="text-sm font-bold text-gray-800">
                          {ticket.category || 'Civic Issue'}
                        </strong>
                      </div>
                      {ticket.sub_category && (
                        <p className="text-[10px] text-gray-500 font-mono">
                          {ticket.sub_category}
                        </p>
                      )}
                      <p><strong>Dept:</strong> {ticket.department || '—'}</p>
                      <p>
                        <strong>Urgency:</strong>{' '}
                        <span style={{ color: URGENCY_COLORS[ticket.urgency] || '#f59e0b' }} className="font-semibold">
                          {ticket.urgency}
                        </span>
                      </p>
                      <p><strong>Status:</strong> {ticket.status}</p>
                      {ticket.upvote_count > 1 && (
                        <p className="flex items-center gap-1 text-amber-700 font-semibold">
                          <Users className="w-3 h-3" />
                          {ticket.upvote_count} citizens reported this
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* ── LAYER 3: Hotspot alert circles — rendered last, always on top ── */}
            {showClusters &&
              mapData.hotspots?.map((h, i) => (
                <Circle
                  key={h.id || i}
                  center={[h.center_lat, h.center_lng]}
                  radius={h.radius_m || 100}
                  pathOptions={{
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.22,
                    weight: 3,
                    dashArray: '6, 8',
                  }}
                >
                  <Popup>
                    <div className="p-1 text-gray-900 text-xs">
                      <strong className="text-sm font-bold text-red-600 block">
                        🔥 {h.category} Hotspot
                      </strong>
                      {h.sub_category && (
                        <p className="text-[10px] text-gray-500 font-mono">{h.sub_category}</p>
                      )}
                      <p className="mt-1">
                        <strong>{h.ticket_count}</strong> clustered complaints detected.
                      </p>
                      <p className="text-gray-500 mt-0.5">Status: {h.status}</p>
                      {h.root_cause_analysis && (
                        <div className="mt-2 pt-1 border-t border-gray-200 text-gray-700">
                          <strong>Root Cause:</strong>
                          <p className="mt-0.5 italic">{h.root_cause_analysis}</p>
                        </div>
                      )}
                    </div>
                  </Popup>
                </Circle>
              ))}

            {/* ── Hotspot centre marker pins (🔥 icon, always visible over clusters) ── */}
            {mapData.hotspots?.map((h, i) => (
              <Marker
                key={`hotspot-pin-${h.id || i}`}
                position={[h.center_lat, h.center_lng]}
                icon={createHotspotIcon()}
                zIndexOffset={1000}
              >
                <Popup>
                  <div className="p-1 text-gray-900 text-xs">
                    <strong className="text-sm font-bold text-red-600">
                      🔥 {h.category} Hotspot Centre
                    </strong>
                    <p className="mt-1">{h.ticket_count} reports · Status: {h.status}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Empty state */}
      {!loading && openTickets.length === 0 && mapData.hotspots?.length === 0 && (
        <div className="text-center py-8 text-white/30 mt-4">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-lg">No active tickets or hotspots</p>
          <p className="text-sm mt-1">Submit complaints to see them appear on the map</p>
        </div>
      )}
    </div>
  )
}
