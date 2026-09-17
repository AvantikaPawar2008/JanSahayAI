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
import { useAuth } from '../../context/AuthContext'
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
  const DEFAULT_CITY_COORDS = [18.5204, 73.8567] // Pune city center fallback
  const { lat: gpsLat, lng: gpsLng, accuracy, loading: gpsLoading, error: gpsError, refresh: refreshGps } = useGeolocation()

  // Location state: pin represents where the problem is, not citizen's physical phone
  const [pinLat, setPinLat] = useState(null)
  const [pinLng, setPinLng] = useState(null)
  const [pinTouched, setPinTouched] = useState(false)
  const [locationSource, setLocationSource] = useState('gps')
  const [addressQuery, setAddressQuery] = useState('')
  const [addressSearching, setAddressSearching] = useState(false)
  const [addressError, setAddressError] = useState(null)
  const geocodeTimerRef = useRef(null)

  // Best-effort live GPS: use as initial suggestion only if citizen hasn't already interacted with the pin
  useEffect(() => {
    if (!pinTouched && gpsLat && gpsLng) {
      setPinLat(gpsLat)
      setPinLng(gpsLng)
      setLocationSource('gps')
    }
  }, [gpsLat, gpsLng, pinTouched])

  // Fallback to default city center if GPS is denied/unavailable and no pin placed yet
  useEffect(() => {
    if (!pinLat && !pinLng && !gpsLoading && (gpsError || (!gpsLat && !gpsLng))) {
      setPinLat(DEFAULT_CITY_COORDS[0])
      setPinLng(DEFAULT_CITY_COORDS[1])
      setLocationSource('manual')
    }
  }, [gpsLoading, gpsError, gpsLat, gpsLng, pinLat, pinLng])

  const { session } = useAuth()
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

  // Submitted coordinates are ALWAYS the pin's current position
  const finalLat = pinLat
  const finalLng = pinLng

  const handlePinDrag = (lat, lng) => {
    setPinLat(lat)
    setPinLng(lng)
    setPinTouched(true)
    setLocationSource('manual')
  }

  const handleMapClick = (lat, lng) => {
    setPinLat(lat)
    setPinLng(lng)
    setPinTouched(true)
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
          setPinTouched(true)
          setLocationSource('manual')
          setAddressError(null)
        } else {
          setAddressError('Address not found — try a more specific location or landmark')
        }
      } catch {
        setAddressError('Geocoding search failed — check your connection')
      } finally {
        setAddressSearching(false)
      }
    }, 800)
  }

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!finalLat || !finalLng || (finalLat === 0 && finalLng === 0)) {
      setError('Location is required. Please pinpoint the problem on the map or search an address.')
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

      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(`${API_BASE}/api/intake`, {
        method: 'POST',
        headers,
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
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-civic-50 text-civic-700 text-xs font-semibold mb-3 border border-civic-200">
          Citizen Reporting Portal
        </div>
        <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight mb-2">Report a Civic Issue</h1>
        <p className="text-charcoal-500 text-sm max-w-md mx-auto">
          Help improve your city — report potholes, water leaks, garbage overflow, or streetlighting failures directly to municipal teams
        </p>
      </div>

      {/* Success State */}
      {result && (
        <div className="bg-white rounded-2xl border border-civic-300 shadow-card p-6 mb-6 animate-slide-up">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-civic-50 border border-civic-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-6 h-6 text-civic-700" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-charcoal-900 text-lg mb-1">
                {result.is_duplicate ? 'Report Added to Existing Ticket' : 'New Ticket Created'}
              </h3>
              <p className="text-sm text-charcoal-600 mb-4 leading-relaxed">{result.message}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {result.urgency && <UrgencyBadge urgency={result.urgency} />}
                {result.department && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-800 border border-civic-200 font-medium">
                    {result.department}
                  </span>
                )}
                {result.category && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-ivory-100 text-charcoal-700 border border-ivory-300 font-medium">
                    {result.category}
                  </span>
                )}
                {result.sub_category && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-ivory-100 text-charcoal-500 border border-ivory-300 font-mono text-[11px]">
                    {result.sub_category}
                  </span>
                )}
              </div>
              <p className="text-xs text-charcoal-400 font-mono">Ticket ID: {result.master_ticket_id}</p>
              {result.upvote_count > 1 && (
                <p className="text-xs text-amber-700 font-semibold mt-1.5 flex items-center gap-1">
                  👥 {result.upvote_count} citizens have reported this issue
                </p>
              )}
              <button onClick={() => setResult(null)} className="btn-primary mt-5 text-sm shadow-sm">
                Report Another Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      {!result && (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── LOCATION SECTION: Problem Location ── */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-xs text-charcoal-600 uppercase tracking-wider font-bold flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-civic-600" />
                  Where is the problem located?
                  <span className="text-coral-600">*</span>
                </label>
                <p className="text-charcoal-500 text-xs mt-0.5">
                  Pinpoint where the issue actually is on the ground (e.g. at the pothole or leak, not your home).
                </p>
              </div>

              {/* Status Indicator */}
              <div className="text-xs flex items-center gap-1.5 self-start sm:self-auto">
                {locationSource === 'manual' ? (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-amber-600" /> Pin placed manually
                  </span>
                ) : (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-civic-50 text-civic-800 border border-civic-200 flex items-center gap-1">
                    <Navigation className="w-3 h-3 text-civic-600" /> Pre-filled from Live GPS
                  </span>
                )}
              </div>
            </div>

            {/* Hint for reporting from elsewhere */}
            <div className="bg-civic-50/60 border border-civic-200 rounded-xl p-3 text-xs text-civic-900 flex items-start gap-2.5">
              <span className="text-sm flex-shrink-0">💡</span>
              <span className="leading-relaxed">
                <strong className="font-semibold text-civic-950">Reporting from somewhere else?</strong> Drag the pin on the map or search an address below to place the pin directly at the incident.
              </span>
            </div>

            {/* Optional GPS reading badge for transparency */}
            {gpsLat && gpsLng && !gpsError && (
              <div className="flex items-center justify-between text-xs text-charcoal-500 px-1">
                <span>Phone GPS: {gpsLat.toFixed(5)}, {gpsLng.toFixed(5)}</span>
                {accuracy && <span>Accuracy: ±{Math.round(accuracy)}m</span>}
              </div>
            )}

            {/* Map preview with draggable pin — always active and centered on problem pin */}
            {(finalLat && finalLng) && (
              <div className="rounded-xl overflow-hidden border border-ivory-300 relative shadow-sm" style={{ height: '240px' }}>
                <MapContainer
                  center={[finalLat, finalLng]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={true}
                  key={`${finalLat}-${finalLng}`}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapClickHandler enabled={true} onMapClick={handleMapClick} />
                  <DraggablePin
                    position={[finalLat, finalLng]}
                    onDragEnd={handlePinDrag}
                  />
                </MapContainer>
              </div>
            )}

            {/* Address search — prominent and always accessible */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs text-charcoal-500 uppercase tracking-wider font-bold block">
                Search address / landmark to move pin
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => handleAddressInput(e.target.value)}
                  placeholder="e.g. FC Road, Pune or MG Road or Shivaji Nagar"
                  className="w-full bg-ivory-50 border border-ivory-300 rounded-xl pl-9 pr-9 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white transition-all"
                />
                {addressSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-civic-600 animate-spin" />
                )}
                {addressQuery && !addressSearching && (
                  <button
                    type="button"
                    onClick={() => { setAddressQuery(''); setAddressError(null) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {addressError && (
                <p className="text-xs text-coral-600 font-medium">{addressError}</p>
              )}
              <div className="flex items-center justify-between text-[11px] text-charcoal-400 px-0.5 pt-0.5">
                <span>Click anywhere on the map or drag the pin directly</span>
                <span className="font-mono">Pin: {finalLat ? finalLat.toFixed(5) : '—'}, {finalLng ? finalLng.toFixed(5) : '—'}</span>
              </div>
            </div>
          </div>

          {/* ── DESCRIBE THE ISSUE ── */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 space-y-4">
            <label className="text-xs text-charcoal-600 uppercase tracking-wider font-bold block">
              Describe the Issue
            </label>

            {/* Text field — ALWAYS visible */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-charcoal-400" />
                <span className="text-xs text-charcoal-600 font-medium">
                  Issue details{(!audioBlob && !imageFile) ? '' : ' (optional if photo/voice provided)'}
                </span>
              </div>
              <textarea
                id="issue-description"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. 'Large pothole on MG Road near Deccan Gymkhana, about 2 feet deep, causing traffic problems'"
                rows={4}
                className="w-full bg-ivory-50 border border-ivory-300 rounded-xl p-3.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white resize-none transition-all leading-relaxed"
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-ivory-200" />
              <span className="text-xs text-charcoal-400 font-medium">+ add multimedia evidence</span>
              <div className="flex-1 h-px bg-ivory-200" />
            </div>

            {/* Voice & Photo toggle buttons */}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowVoice(!showVoice)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  showVoice || audioBlob
                    ? 'bg-civic-50 border-civic-300 text-civic-800 shadow-sm'
                    : 'bg-ivory-50 border-ivory-300 text-charcoal-600 hover:bg-ivory-100 hover:text-charcoal-800'
                }`}
              >
                <Mic className="w-4 h-4" />
                Voice Note {audioBlob ? '✓' : ''}
              </button>
              <button
                type="button"
                onClick={() => setShowPhoto(!showPhoto)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all border ${
                  showPhoto || imageFile
                    ? 'bg-civic-50 border-civic-300 text-civic-800 shadow-sm'
                    : 'bg-ivory-50 border-ivory-300 text-charcoal-600 hover:bg-ivory-100 hover:text-charcoal-800'
                }`}
              >
                <Camera className="w-4 h-4" />
                Photo Proof {imageFile ? '✓' : ''}
              </button>
            </div>

            {/* Voice recorder panel */}
            {showVoice && (
              <div className="flex flex-col items-center py-4 rounded-xl bg-ivory-50 border border-ivory-300">
                <VoiceRecorderButton
                  onRecordingComplete={(blob) => setAudioBlob(blob)}
                  disabled={submitting}
                />
                {audioBlob && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-civic-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-civic-600" />
                    Voice recording saved ({(audioBlob.size / 1024).toFixed(0)} KB)
                    <button
                      type="button"
                      onClick={() => setAudioBlob(null)}
                      className="ml-1 text-charcoal-400 hover:text-coral-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Photo capture panel */}
            {showPhoto && (
              <div className="rounded-xl bg-ivory-50 border border-ivory-300 p-4">
                <PhotoCapture
                  onCapture={(file) => setImageFile(file)}
                  label="Take or upload a photo of the issue"
                  disabled={submitting}
                />
                {imageFile && (
                  <div className="mt-2.5 flex items-center gap-2 text-xs text-civic-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-civic-600" />
                    Photo attached: {imageFile.name || 'captured'} ({(imageFile.size / 1024).toFixed(0)} KB)
                    <button
                      type="button"
                      onClick={() => setImageFile(null)}
                      className="ml-1 text-charcoal-400 hover:text-coral-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Summary of what will be submitted */}
            {(text || audioBlob || imageFile) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {text && <span className="text-xs px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-800 border border-civic-200 font-medium">✓ Text details</span>}
                {audioBlob && <span className="text-xs px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-800 border border-civic-200 font-medium">✓ Voice note</span>}
                {imageFile && <span className="text-xs px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-800 border border-civic-200 font-medium">✓ Photo evidence</span>}
              </div>
            )}
          </div>

          {/* Phone Number */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
            <label className="text-xs text-charcoal-600 uppercase tracking-wider font-bold mb-2 block">
              Phone Number (for SMS &amp; status updates)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full bg-ivory-50 border border-ivory-300 rounded-xl px-3.5 py-2.5 text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white transition-all"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-coral-50 border border-coral-200 text-sm text-coral-700 font-medium animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || gpsLoading || (!finalLat && !finalLng) || (!text && !audioBlob && !imageFile)}
            className="btn-primary w-full py-3.5 text-base shadow-md"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-white" />
                Analyzing &amp; Submitting...
              </>
            ) : (
              <>
                <Send className="w-5 h-5 text-white" />
                Submit Report
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}
