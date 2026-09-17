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
    if (!accuracy) return 'text-charcoal-400'
    if (accuracy <= 10) return 'text-emerald-600 font-medium'
    if (accuracy <= 50) return 'text-amber-600 font-medium'
    return 'text-coral-600 font-medium'
  }

  const getAccuracyLabel = () => {
    if (!accuracy) return 'Unknown'
    if (accuracy <= 10) return 'Excellent'
    if (accuracy <= 50) return 'Good'
    return 'Low'
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ivory-50 border border-ivory-300 text-sm">
        <Loader2 className="w-4 h-4 text-civic-600 animate-spin" />
        <span className="text-charcoal-500 text-xs">Acquiring GPS fix...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-coral-50 border border-coral-200 text-sm">
        <MapPin className="w-4 h-4 text-coral-600" />
        <span className="text-coral-700 text-xs font-medium">{error}</span>
        {onRefresh && (
          <button onClick={onRefresh} className="ml-auto text-coral-600 hover:text-coral-700">
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 rounded-xl bg-ivory-50 border border-ivory-300 text-sm">
      <div className="flex items-center gap-3">
        <MapPin className="w-4 h-4 text-civic-600 flex-shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-charcoal-800 font-mono text-xs truncate font-medium">
            {lat?.toFixed(6)}, {lng?.toFixed(6)}
          </span>
          <span className={`text-[11px] ${getAccuracyColor()}`}>
            ±{accuracy?.toFixed(0)}m ({getAccuracyLabel()})
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="ml-auto p-1 rounded-lg hover:bg-ivory-200 text-charcoal-400 hover:text-charcoal-700 transition-colors"
            title="Refresh GPS"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {address && (
        <div className="mt-1 pt-1.5 border-t border-ivory-200 text-[11px] text-civic-800 font-medium line-clamp-2 leading-relaxed">
          📍 {address}
        </div>
      )}
    </div>
  )
}

