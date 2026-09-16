import { useState, useCallback, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  Send, Loader2, CheckCircle2, AlertCircle, Mic, Camera,
  FileText, MapPin, Navigation, Search, X, ToggleLeft, ToggleRight,
} from 'lucide-react'
import VoiceRecorderButton from '../../components/VoiceRecorderButton'
import PhotoCapture from '../../components/PhotoCapture'
import GpsBadge from '../../components/GpsBadge'
import UrgencyBadge from '../../components/UrgencyBadge'
import useGeolocation from '../../hooks/useGeolocation'
import { API_BASE } from '../../supabaseClient'

// Fix Leaflet default icon for Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Draggable pin component — updates parent lat/lng on drag end
function DraggablePin({ position, onDragEnd }) {
  const markerRef = useRef(null)
  const eventHandlers = {
    dragend() {
      const marker = markerRef.current
      if (marker) {
        const { lat, lng } = marker.getLatLng()
        onDragEnd(lat, lng)
      }
    },
  }
  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={position}
      ref={markerRef}
    />
  )
}

// Clicking the map moves the pin (only in manual mode)
function MapClickHandler({ enabled, onMapClick }) {
  useMapEvents({
    click(e) {
      if (enabled) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Nominatim geocoding — free OSM API, no key required, rate-limited to 1 req/s
async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  const data = await res.json()
  if (data && data.length > 0) {
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name }
  }
  return null
}

/**
 * ReportIssuePage — citizen complaint submission.
 * - Voice, photo, and text are always independent (not mutually exclusive)
 * - Location can be live GPS or manually set via address search / pin drag
 */
export default function ReportIssuePage() {
  const { lat: gpsLat, lng: gpsLng, accuracy, loading: gpsLoading, error: gpsError, refresh: refreshGps } = useGeolocation()

  // Location state — starts from GPS, can be overridden manually
  const [manualMode, setManualMode] = useState(false)
  const [pinLat, setPinLat] = useState(null)
  const [pinLng, setPinLng] = useState(null)
  const [locationSource, setLocationSource] = useState('gps')
  const [addressQuery, setAddressQuery] = useState('')
  const [addressSearching, setAddressSearching] = useState(false)
  const [addressError, setAddressError] = useState(null)
  const geocodeTimerRef = useRef(null)

  // When GPS resolves and we haven't manually moved the pin, sync pin to GPS
  useEffect(() => {
    if (!manualMode && gpsLat && gpsLng) {
      setPinLat(gpsLat)
      setPinLng(gpsLng)
    }
  }, [gpsLat, gpsLng, manualMode])

  // Input state — all independent
  const [text, setText] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // Track which optional input panels are open (text always open now)
  const [showVoice, setShowVoice] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)

  // Final submitted lat/lng — whichever pin position is current
  const finalLat = manualMode ? pinLat : (gpsLat || pinLat)
  const finalLng = manualMode ? pinLng : (gpsLng || pinLng)

  const handleManualToggle = () => {
    const next = !manualMode
    setManualMode(next)
    if (next) {
      // Switching to manual — keep current GPS pin as starting point
      if (gpsLat && gpsLng) { setPinLat(gpsLat); setPinLng(gpsLng) }
      setLocationSource('manual')
    } else {
      // Switching back to GPS
      setPinLat(gpsLat); setPinLng(gpsLng)
      setLocationSource('gps')
      setAddressQuery('')
      setAddressError(null)
    }
  }

  const handlePinDrag = (lat, lng) => {
    setPinLat(lat); setPinLng(lng)
    setLocationSource('manual')
  }

  const handleMapClick = (lat, lng) => {
    setPinLat(lat); setPinLng(lng)
    setLocationSource('manual')
  }

  // Debounced Nominatim address search (1 req/s max)
  const handleAddressInput = (val) => {
    setAddressQuery(val)
    setAddressError(null)
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current)
    if (!val.trim()) return
    geocodeTimerRef.current = setTimeout(async () => {
      setAddressSearching(true)
      try {
        const result = await geocodeAddress(val)
        if (result) {
          setPinLat(result.lat)
          setPinLng(result.lng)
          setLocationSource('manual')
          setAddressError(null)
        } else {
          setAddressError('Address not found — try a more specific location')
        }
      } catch {
        setAddressError('Geocoding failed — check your connection')
      } finally {
        setAddressSearching(false)
      }
    }, 1000)
  }

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!finalLat || !finalLng) {
      setError('Location is required. Enable GPS or set manually.')
      return
    }
    if (!text && !audioBlob && !imageFile) {
      setError('Please provide at least one form of input: text, voice, or photo.')
      return
    }

    setSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('lat', finalLat.toString())
      formData.append('lng', finalLng.toString())
      formData.append('citizen_phone', phone)
      formData.append('location_source', locationSource)

      if (text) formData.append('text', text)
      if (audioBlob) formData.append('audio_file', audioBlob, 'recording.webm')
      if (imageFile) formData.append('image_file', imageFile)

      const response = await fetch(`${API_BASE}/api/intake`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to submit complaint')
      }

      const data = await response.json()
      setResult(data)

      // Reset form on success
      setText('')
      setAudioBlob(null)
      setImageFile(null)
      setAddressQuery('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }, [finalLat, finalLng, text, audioBlob, imageFile, phone, locationSource])

  const mapCenter = (finalLat && finalLng) ? [finalLat, finalLng] : [18.52, 73.86]

  return (
    <div className="page-enter max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold gradient-text mb-2">Report a Civic Issue</h1>
        <p className="text-white/50 text-sm">
          Help improve your city — report potholes, water leaks, garbage, and more
        </p>
      </div>

      {/* Success State */}
      {result && (
        <div className="glass-card mb-6 border-emerald-500/30 animate-slide-up">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-emerald-300 mb-1">
                {result.is_duplicate ? 'Report Added to Existing Ticket' : 'New Ticket Created'}
              </h3>
              <p className="text-sm text-white/60 mb-3">{result.message}</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {result.urgency && <UrgencyBadge urgency={result.urgency} />}
                {result.department && (
                  <span className="badge bg-civic-600/20 text-civic-300 border border-civic-500/20">
                    {result.department}
                  </span>
                )}
                {result.category && (
                  <span className="badge bg-white/10 text-white/60 border border-white/10">
                    {result.category}
                  </span>
                )}
                {result.sub_category && (
                  <span className="badge bg-white/8 text-white/40 border border-white/10 font-mono text-[10px]">
                    {result.sub_category}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/30 font-mono">Ticket ID: {result.master_ticket_id}</p>
              {result.upvote_count > 1 && (
                <p className="text-xs text-amber-400 mt-1">
                  👥 {result.upvote_count} citizens have reported this issue
                </p>
              )}
              <button onClick={() => setResult(null)} className="btn-primary mt-4 text-sm">
                Report Another Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      {!result && (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── LOCATION SECTION ── */}
          <div className="glass-card-static space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-white/40 uppercase tracking-wide font-semibold">
                Location
              </label>
              <button
                type="button"
                onClick={handleManualToggle}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                  manualMode
                    ? 'bg-civic-600/30 text-civic-300 border border-civic-500/30'
                    : 'bg-white/5 text-white/40 hover:text-white/60 border border-white/10'
                }`}
              >
                {manualMode
                  ? <><ToggleRight className="w-4 h-4" /> Manual mode ON</>
                  : <><ToggleLeft className="w-4 h-4" /> Set location manually</>
                }
              </button>
            </div>

            {/* GPS Badge — always visible */}
            <GpsBadge
              lat={manualMode ? pinLat : gpsLat}
              lng={manualMode ? pinLng : gpsLng}
              accuracy={manualMode ? null : accuracy}
              loading={!manualMode && gpsLoading}
              error={!manualMode ? gpsError : null}
              onRefresh={manualMode ? null : refreshGps}
            />

            {/* Location source label */}
            <div className="flex items-center gap-2 text-xs">
              {locationSource === 'manual' ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <MapPin className="w-3 h-3" /> Location set manually
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Navigation className="w-3 h-3" /> Using live GPS
                </span>
              )}
            </div>

            {/* Map preview — always shown; draggable only in manual mode */}
            {(finalLat && finalLng) && (
              <div className="rounded-xl overflow-hidden border border-white/10" style={{ height: '220px' }}>
                <MapContainer
                  center={mapCenter}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={true}
                  key={`${mapCenter[0]}-${mapCenter[1]}`}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapClickHandler enabled={manualMode} onMapClick={handleMapClick} />
                  <DraggablePin
                    position={[finalLat, finalLng]}
                    onDragEnd={handlePinDrag}
                  />
                </MapContainer>
              </div>
            )}

            {/* Address search — visible only in manual mode */}
            {manualMode && (
              <div className="space-y-2">
                <label className="text-xs text-white/40 uppercase tracking-wide font-semibold block">
                  Search address
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type="text"
                    value={addressQuery}
                    onChange={(e) => handleAddressInput(e.target.value)}
                    placeholder="e.g. MG Road, Pune or Connaught Place, Delhi"
                    className="glass-input pl-9 pr-9"
                  />
                  {addressSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 animate-spin" />
                  )}
                  {addressQuery && !addressSearching && (
                    <button
                      type="button"
                      onClick={() => { setAddressQuery(''); setAddressError(null) }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {addressError && (
                  <p className="text-xs text-red-400">{addressError}</p>
                )}
                <p className="text-[11px] text-white/25">
                  Or drag the pin on the map · Click the map to move pin · Powered by OpenStreetMap Nominatim
                </p>
              </div>
            )}
          </div>

          {/* ── DESCRIBE THE ISSUE ── */}
          <div className="glass-card-static space-y-4">
            <label className="text-xs text-white/40 uppercase tracking-wide font-semibold block">
              Describe the Issue
            </label>

            {/* Text field — ALWAYS visible, not tab-exclusive */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-white/40" />
                <span className="text-sm text-white/60">
                  Describe the issue{(!audioBlob && !imageFile) ? '' : ' (optional if photo/voice provided)'}
                </span>
              </div>
              <textarea
                id="issue-description"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. 'Large pothole on MG Road near Deccan Gymkhana, about 2 feet deep, causing traffic problems'"
                rows={4}
                className="glass-input resize-none"
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/25">+ add more evidence</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Voice & Photo toggle buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowVoice(!showVoice)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  showVoice || audioBlob
                    ? 'bg-civic-600/30 border border-civic-500/30 text-civic-300'
                    : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/60 hover:bg-white/8'
                }`}
              >
                <Mic className="w-4 h-4" />
                Voice {audioBlob ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => setShowPhoto(!showPhoto)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  showPhoto || imageFile
                    ? 'bg-civic-600/30 border border-civic-500/30 text-civic-300'
                    : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/60 hover:bg-white/8'
                }`}
              >
                <Camera className="w-4 h-4" />
                Photo {imageFile ? '✓' : ''}
              </button>
            </div>

            {/* Voice recorder panel */}
            {showVoice && (
              <div className="flex flex-col items-center py-4 rounded-xl bg-white/3 border border-white/8">
                <VoiceRecorderButton
                  onRecordingComplete={(blob) => setAudioBlob(blob)}
                  disabled={submitting}
                />
                {audioBlob && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Voice recording saved ({(audioBlob.size / 1024).toFixed(0)} KB)
                    <button
                      type="button"
                      onClick={() => setAudioBlob(null)}
                      className="ml-1 text-white/30 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Photo capture panel */}
            {showPhoto && (
              <div className="rounded-xl bg-white/3 border border-white/8 p-3">
                <PhotoCapture
                  onCapture={(file) => setImageFile(file)}
                  label="Take or upload a photo of the issue"
                  disabled={submitting}
                />
                {imageFile && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Photo attached: {imageFile.name || 'captured'} ({(imageFile.size / 1024).toFixed(0)} KB)
                    <button
                      type="button"
                      onClick={() => setImageFile(null)}
                      className="ml-1 text-white/30 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Summary of what will be submitted */}
            {(text || audioBlob || imageFile) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {text && <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Text</span>}
                {audioBlob && <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Voice</span>}
                {imageFile && <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Photo</span>}
              </div>
            )}
          </div>

          {/* Phone Number */}
          <div className="glass-card-static">
            <label className="text-xs text-white/40 uppercase tracking-wide font-semibold mb-2 block">
              Phone Number (for updates)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="glass-input"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300 animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || gpsLoading || (!finalLat && !finalLng) || (!text && !audioBlob && !imageFile)}
            className="btn-primary w-full py-4 text-base"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing &amp; Submitting...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit Report
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}
