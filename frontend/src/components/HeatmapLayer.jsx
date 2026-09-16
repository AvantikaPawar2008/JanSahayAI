import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'

/**
 * HeatmapLayer — Leaflet Heatmap wrapper using leaflet.heat.
 * Props:
 *  - points: array of [lat, lng, intensity]
 *  - options: radius, blur, maxZoom, gradient
 */
export default function HeatmapLayer({ points = [], options = {} }) {
  const map = useMap()

  useEffect(() => {
    if (!map || !points || points.length === 0) return

    const heatOptions = {
      radius: options.radius ?? 25,
      blur: options.blur ?? 15,
      maxZoom: options.maxZoom ?? 16,
      max: options.max ?? 1.0,
      gradient: options.gradient ?? {
        0.2: '#06b6d4',
        0.4: '#10b981',
        0.6: '#f59e0b',
        0.8: '#f97316',
        1.0: '#ef4444',
      },
    }

    let heatLayer
    try {
      if (typeof L.heatLayer === 'function') {
        heatLayer = L.heatLayer(points, heatOptions).addTo(map)
      }
    } catch (err) {
      console.warn('Leaflet heatLayer initialization note:', err)
    }

    return () => {
      if (heatLayer && map) {
        map.removeLayer(heatLayer)
      }
    }
  }, [map, points, options.radius, options.blur, options.max])

  return null
}
