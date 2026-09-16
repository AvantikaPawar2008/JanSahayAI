import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'

/**
 * MapView — Leaflet wrapper reused by officer + admin views.
 * Props: center ([lat, lng]), zoom, markers ([{lat, lng, label, urgency, id}]),
 *        hotspots ([{lat, lng, radius, label}]), height, onMarkerClick
 */

// Fix default marker icons (Leaflet + Vite issue)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Custom urgency-colored marker icons
const createUrgencyIcon = (urgency) => {
  const colors = {
    LOW: '#10b981',
    MEDIUM: '#f59e0b',
    HIGH: '#f97316',
    CRITICAL: '#ef4444',
  }
  const color = colors[urgency] || colors.MEDIUM

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        width: 28px; height: 28px; border-radius: 50% 50% 50% 0;
        background: ${color}; border: 2px solid white;
        transform: rotate(-45deg); position: relative;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      ">
        <div style="
          width: 10px; height: 10px; border-radius: 50%;
          background: white; position: absolute;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
        "></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  })
}

// Pan map when center prop updates
function CenterUpdater({ center, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, zoom || 13)
    }
  }, [center, zoom, map])
  return null
}

// Auto-fit map bounds to markers
function FitBounds({ markers }) {
  const map = useMap()

  useEffect(() => {
    if (markers && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]))
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    }
  }, [markers, map])

  return null
}

export default function MapView({
  center = [18.52, 73.86], // Pune default
  zoom = 13,
  markers = [],
  hotspots = [],
  height = '400px',
  onMarkerClick,
  className = '',
}) {
  return (
    <div className={`rounded-xl overflow-hidden border border-white/10 ${className}`} style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <CenterUpdater center={center} zoom={zoom} />

        {markers.length > 0 && <FitBounds markers={markers} />}

        {/* Ticket markers */}
        {markers.map((marker, i) => (
          <Marker
            key={marker.id || i}
            position={[marker.lat, marker.lng]}
            icon={createUrgencyIcon(marker.urgency)}
            eventHandlers={{
              click: () => onMarkerClick?.(marker),
            }}
          >
            <Popup>
              <div className="text-gray-900 text-sm">
                <strong>{marker.category || marker.label || 'Issue'}</strong>
                {marker.description && (
                  <p className="text-xs mt-1 text-gray-600">{marker.description}</p>
                )}
                {marker.urgency && (
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs text-white ${
                    marker.urgency === 'CRITICAL' ? 'bg-red-500' :
                    marker.urgency === 'HIGH' ? 'bg-orange-500' :
                    marker.urgency === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}>
                    {marker.urgency}
                  </span>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Hotspot circles */}
        {hotspots.map((hotspot, i) => (
          <Circle
            key={`hotspot-${i}`}
            center={[hotspot.lat || hotspot.center_lat, hotspot.lng || hotspot.center_lng]}
            radius={hotspot.radius || hotspot.radius_m || 100}
            pathOptions={{
              color: '#ef4444',
              fillColor: '#ef4444',
              fillOpacity: 0.15,
              weight: 2,
              dashArray: '5, 10',
            }}
          >
            <Popup>
              <div className="text-gray-900 text-sm">
                <strong>🔥 Hotspot: {hotspot.category || hotspot.label}</strong>
                <p className="text-xs mt-1">{hotspot.ticket_count || 0} tickets in this area</p>
              </div>
            </Popup>
          </Circle>
        ))}
      </MapContainer>
    </div>
  )
}
