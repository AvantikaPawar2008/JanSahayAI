import { useState, useEffect } from 'react'
import { MapPin, Crosshair, Loader2 } from 'lucide-react'

/**
 * GpsBadge — displays current GPS coordinates with accuracy indicator and live street address.
 * Props: lat, lng, accuracy, loading, error, onRefresh
 */
export default function GpsBadge({ lat, lng, accuracy, loading, error, onRefresh }) {
  const [address, setAddress] = useState('')
  const [addressLoading, setAddressLoading] = useState(false)

  useEffect(() => {
    if (!lat || !lng) return
    let isCancelled = false
    setAddressLoading(true)

    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled && data?.display_name) {
          setAddress(data.display_name)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setAddressLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [lat, lng])

  const getAccuracyColor = () => {
    if (!accuracy) return 'text-white/40'
    if (accuracy <= 10) return 'text-emerald-400'
    if (accuracy <= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  const getAccuracyLabel = () => {
    if (!accuracy) return 'Unknown'
    if (accuracy <= 10) return 'Excellent'
    if (accuracy <= 50) return 'Good'
    return 'Low'
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm">
        <Loader2 className="w-4 h-4 text-civic-400 animate-spin" />
        <span className="text-white/50">Acquiring GPS...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
        <MapPin className="w-4 h-4 text-red-400" />
        <span className="text-red-300">{error}</span>
        {onRefresh && (
          <button onClick={onRefresh} className="ml-auto text-red-400 hover:text-red-300">
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm">
      <div className="flex items-center gap-3">
        <MapPin className="w-4 h-4 text-civic-400 flex-shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-white/70 font-mono text-xs truncate">
            {lat?.toFixed(6)}, {lng?.toFixed(6)}
          </span>
          <span className={`text-[11px] ${getAccuracyColor()}`}>
            ±{accuracy?.toFixed(0)}m ({getAccuracyLabel()})
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="ml-auto p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/60 transition-colors"
            title="Refresh GPS"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {address && (
        <div className="mt-1 pt-1.5 border-t border-white/5 text-[12px] text-civic-300/80 line-clamp-2">
          📍 {address}
        </div>
      )}
    </div>
  )
}

