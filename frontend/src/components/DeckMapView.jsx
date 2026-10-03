import { useState, useCallback, useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map } from 'react-map-gl/maplibre'
import { ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers'
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers'
import 'maplibre-gl/dist/maplibre-gl.css'

// ── Free MapLibre style — no API key required (OpenStreetMap-based Carto Positron)
const MAPLIBRE_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

// ── Urgency -> RGBA color mapping (matches existing JanSahayAI design system)
const URGENCY_COLOR = {
  LOW:      [16, 185, 129, 210],   // emerald-500
  MEDIUM:   [245, 158, 11, 210],   // amber-500
  HIGH:     [249, 115, 22, 230],   // orange-500
  CRITICAL: [239, 68, 68, 255],    // red-500
}

const DEFAULT_COLOR = [107, 114, 128, 200]  // gray

// ── Department -> accent color (for future GeoJsonLayer ward coloring)
const DEPT_COLOR = {
  'Water Supply & Sewerage':      [59, 130, 246, 180],   // blue
  'Roads & Infrastructure':       [161, 161, 170, 180],  // gray
  'Solid Waste Management':       [34, 197, 94, 180],    // green
  'Electrical & Streetlighting':  [234, 179, 8, 180],    // yellow
  'Health & Sanitation':          [168, 85, 247, 180],   // purple
}

/**
 * DeckMapView — GPU-accelerated civic map using deck.gl + MapLibre GL (free, no API key).
 *
 * Renders up to 4 simultaneous layers:
 *   1. HeatmapLayer   — urgency-weighted density gradient
 *   2. ScatterplotLayer — individual ticket pins (urgency coloured)
 *   3. HexagonLayer   — 3D hexagonal complaint density aggregation
 *   4. GeoJsonLayer   — future: ward boundary polygons (accepts wardGeoJson prop)
 *
 * Props:
 *   tickets         [{ lat, lng, urgency, category, department, status, id }]
 *   heatmapPoints   [[lat, lng, intensity]]   (pre-computed by backend)
 *   hotspots        [{ center_lat, center_lng, radius_m, category, ticket_count, status }]
 *   showHeatmap     boolean
 *   showPins        boolean
 *   showHexagon     boolean
 *   showClusters    boolean
 *   wardGeoJson     GeoJSON FeatureCollection | null
 *   initialViewState { longitude, latitude, zoom, pitch, bearing }
 *   onTicketClick   (ticket) => void
 *   height          string (CSS height, default '620px')
 */
export default function DeckMapView({
  tickets = [],
  heatmapPoints = [],
  hotspots = [],
  showHeatmap = false,
  showPins = true,
  showHexagon = false,
  showClusters = true,
  wardGeoJson = null,
  initialViewState = { longitude: 73.8567, latitude: 18.5204, zoom: 12, pitch: 0, bearing: 0 },
  onTicketClick,
  height = '620px',
}) {
  const [viewState, setViewState] = useState(initialViewState)
  const [hoveredTicket, setHoveredTicket] = useState(null)
  const [tooltip, setTooltip] = useState(null)

  // Normalize heatmap points: backend sends [lat, lng, intensity]
  // deck.gl expects [lng, lat] — swap here once
  const normalizedHeatmap = useMemo(() =>
    heatmapPoints
      .filter(p => p && p.length >= 2 && p[0] && p[1])
      .map(p => ({ position: [p[1], p[0]], weight: p[2] ?? 0.5 })),
    [heatmapPoints]
  )

  // Normalize tickets: [lng, lat] for deck.gl
  const normalizedTickets = useMemo(() =>
    tickets.filter(t => t.lat && t.lng),
    [tickets]
  )

  const handleHover = useCallback(({ object, x, y }) => {
    setHoveredTicket(object || null)
    if (object) {
      setTooltip({ x, y, data: object })
    } else {
      setTooltip(null)
    }
  }, [])

  const handleClick = useCallback(({ object }) => {
    if (object && onTicketClick) {
      onTicketClick(object)
    }
  }, [onTicketClick])

  // ── Build deck.gl layers ────────────────────────────────────────────────
  const layers = useMemo(() => {
    const active = []

    // 1. HeatmapLayer — GPU-smooth urgency-weighted gradient
    if (showHeatmap && normalizedHeatmap.length > 0) {
      active.push(
        new HeatmapLayer({
          id: 'jansahay-heatmap',
          data: normalizedHeatmap,
          getPosition: d => d.position,
          getWeight: d => d.weight,
          radiusPixels: 80,
          intensity: 1.2,
          threshold: 0.05,
          colorRange: [
            [6, 182, 212],    // cyan   — very low density
            [16, 185, 129],   // green  — low
            [245, 158, 11],   // amber  — medium
            [249, 115, 22],   // orange — high
            [239, 68, 68],    // red    — very high
            [139, 0, 0],      // dark red — critical cluster
          ],
          updateTriggers: { getWeight: [normalizedHeatmap.length] },
        })
      )
    }

    // 2. HexagonLayer — 3D complaint density (WOW view)
    if (showHexagon && normalizedTickets.length > 0) {
      active.push(
        new HexagonLayer({
          id: 'jansahay-hexagon',
          data: normalizedTickets,
          getPosition: d => [d.lng, d.lat],
          radius: 300,            // 300m hexagons match ward granularity
          elevationScale: 6,
          extruded: true,
          pickable: false,
          coverage: 0.88,
          colorRange: [
            [236, 253, 245],
            [167, 243, 208],
            [52, 211, 153],
            [5, 150, 105],
            [4, 120, 87],
            [2, 75, 48],
          ],
          material: {
            ambient: 0.64,
            diffuse: 0.6,
            shininess: 32,
            specularColor: [51, 51, 51],
          },
        })
      )
    }

    // 3. ScatterplotLayer — individual ticket pins (urgency coloured)
    if (showPins && normalizedTickets.length > 0) {
      active.push(
        new ScatterplotLayer({
          id: 'jansahay-tickets',
          data: normalizedTickets,
          getPosition: d => [d.lng, d.lat],
          getFillColor: d => URGENCY_COLOR[d.urgency] || DEFAULT_COLOR,
          getLineColor: [255, 255, 255, 200],
          getRadius: d => {
            // CRITICAL & HIGH tickets get larger dots
            if (d.urgency === 'CRITICAL') return 45
            if (d.urgency === 'HIGH') return 35
            return 24
          },
          lineWidthMinPixels: 1,
          lineWidthMaxPixels: 2,
          stroked: true,
          filled: true,
          radiusMinPixels: 4,
          radiusMaxPixels: 18,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 80],
          onHover: handleHover,
          onClick: handleClick,
          updateTriggers: {
            getFillColor: [normalizedTickets.length],
            getRadius: [normalizedTickets.length],
          },
        })
      )
    }

    // 4. Hotspot cluster rings — pulsing GeoJsonLayer circles
    if (showClusters && hotspots.length > 0) {
      const hotspotGeoJson = {
        type: 'FeatureCollection',
        features: hotspots
          .filter(h => h.center_lat && h.center_lng)
          .map(h => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [h.center_lng, h.center_lat],
            },
            properties: {
              radius_m: h.radius_m || 100,
              category: h.category,
              ticket_count: h.ticket_count,
              status: h.status,
            },
          })),
      }

      active.push(
        new ScatterplotLayer({
          id: 'jansahay-hotspot-rings',
          data: hotspots.filter(h => h.center_lat && h.center_lng),
          getPosition: h => [h.center_lng, h.center_lat],
          getRadius: h => h.radius_m || 100,
          getFillColor: [239, 68, 68, 35],
          getLineColor: [239, 68, 68, 220],
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          lineWidthMaxPixels: 4,
          radiusUnits: 'meters',
          pickable: true,
          onHover: handleHover,
          updateTriggers: { getRadius: [hotspots.length] },
        })
      )

      // Hotspot centre flame icons (TextLayer)
      active.push(
        new ScatterplotLayer({
          id: 'jansahay-hotspot-centres',
          data: hotspots.filter(h => h.center_lat && h.center_lng),
          getPosition: h => [h.center_lng, h.center_lat],
          getFillColor: [239, 68, 68, 255],
          getRadius: 16,
          radiusMinPixels: 6,
          radiusMaxPixels: 16,
          pickable: false,
        })
      )
    }

    // 5. Ward GeoJSON layer (Future-02 — accepts wardGeoJson prop)
    if (wardGeoJson) {
      active.push(
        new GeoJsonLayer({
          id: 'jansahay-wards',
          data: wardGeoJson,
          filled: true,
          stroked: true,
          getFillColor: f => {
            const dept = f.properties?.primary_department
            return DEPT_COLOR[dept] || [200, 200, 200, 100]
          },
          getLineColor: [100, 100, 100, 200],
          lineWidthMinPixels: 1,
          pickable: true,
        })
      )
    }

    return active
  }, [
    showHeatmap, showPins, showHexagon, showClusters, wardGeoJson,
    normalizedHeatmap, normalizedTickets, hotspots,
    handleHover, handleClick,
  ])

  return (
    <div
      id="deck-map-container"
      className="relative w-full rounded-[14px] overflow-hidden"
      style={{ height }}
    >
      {/* deck.gl canvas + MapLibre base map */}
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        controller={true}
        layers={layers}
        style={{ position: 'relative', width: '100%', height: '100%' }}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
      >
        {/* MapLibre free base map — no API key */}
        <Map
          mapStyle={MAPLIBRE_STYLE}
          attributionControl={false}
          reuseMaps
        />
      </DeckGL>

      {/* Hover tooltip */}
      {tooltip && tooltip.data && (
        <div
          id="deck-tooltip"
          className="absolute z-50 pointer-events-none bg-white/95 backdrop-blur-sm border border-ivory-200 rounded-xl shadow-card px-3 py-2.5 text-xs max-w-[200px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="font-bold text-charcoal-900 mb-1">
            {tooltip.data.category || tooltip.data.category || '🔥 Hotspot'}
          </p>
          {tooltip.data.urgency && (
            <p className="text-charcoal-600">
              Urgency:{' '}
              <span
                className="font-semibold"
                style={{ color: gb() }}
              >
                {tooltip.data.urgency}
              </span>
            </p>
          )}
          {tooltip.data.department && (
            <p className="text-charcoal-500 truncate">{tooltip.data.department}</p>
          )}
          {tooltip.data.ticket_count !== undefined && (
            <p className="text-red-600 font-semibold mt-0.5">
              {tooltip.data.ticket_count} tickets clustered
            </p>
          )}
          {tooltip.data.status && (
            <p className="text-charcoal-400 text-[10px] mt-0.5">{tooltip.data.status}</p>
          )}
        </div>
      )}

      {/* Attribution */}
      <div className="absolute bottom-2 right-2 text-[9px] text-charcoal-400 bg-white/80 px-1.5 py-0.5 rounded">
        © CartoDB · OSM · deck.gl
      </div>
    </div>
  )
}
