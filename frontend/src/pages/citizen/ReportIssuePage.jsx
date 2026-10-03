import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  Send, Loader2, CheckCircle2, AlertCircle, Mic, Camera,
  FileText, MapPin, Navigation, Search, X, ExternalLink, ArrowRight, Clock,
} from 'lucide-react'
import VoiceRecorderButton from '../../components/VoiceRecorderButton'
import PhotoCapture from '../../components/PhotoCapture'
import GpsBadge from '../../components/GpsBadge'
import UrgencyBadge from '../../components/UrgencyBadge'
import ErrorBoundary from '../../components/ErrorBoundary'
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

// Pan map when center coordinates update without tearing down the Leaflet instance
function MapCenterUpdater({ center }) {
  const map = useMap()
  const lat = center?.[0]
  const lng = center?.[1]
  const lastCenter = useRef(null)

  useEffect(() => {
    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      if (!lastCenter.current || Math.abs(lastCenter.current[0] - lat) > 0.0001 || Math.abs(lastCenter.current[1] - lng) > 0.0001) {
        lastCenter.current = [lat, lng]
        try {
          map.panTo([lat, lng], { animate: true, duration: 0.4 })
        } catch (_) {}
      }
    }
  }, [lat, lng, map])
  return null
}

// Draggable pin component — updates parent lat/lng on drag end
function DraggablePin({ position, onDragEnd }) {
  const markerRef = useRef(null)
  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current
        if (marker) {
          const { lat, lng } = marker.getLatLng()
          onDragEnd(lat, lng)
        }
      },
    }),
    [onDragEnd],
  )
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
  const navigate = useNavigate()
  const DEFAULT_CITY_COORDS = [18.5204, 73.8567] // Pune city center fallback
  const { lat: gpsLat, lng: gpsLng, accuracy, loading: gpsLoading, error: gpsError, refresh: refreshGps } = useGeolocation()

  // Location state: pin represents where the problem is, not citizen's physical phone
  const [pinLat, setPinLat] = useState(null)
  const [pinLng, setPinLng] = useState(null)
  const [pinTouched, setPinTouched] = useState(false)
  const [reportingMode, setReportingMode] = useState('at_site') // 'at_site' | 'elsewhere'
  const [locationSource, setLocationSource] = useState('gps')
  const [addressQuery, setAddressQuery] = useState('')
  const [addressSearching, setAddressSearching] = useState(false)
  const [addressError, setAddressError] = useState(null)
  const geocodeTimerRef = useRef(null)

  // Best-effort live GPS: use as initial suggestion only if citizen is at site and hasn't manually moved pin
  useEffect(() => {
    if (!pinTouched && gpsLat && gpsLng && reportingMode === 'at_site') {
      setPinLat(gpsLat)
      setPinLng(gpsLng)
      setLocationSource('gps')
    }
  }, [gpsLat, gpsLng, pinTouched, reportingMode])

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
  const [result, setResult] = useState(() => {
    try {
      const saved = localStorage.getItem('civicpulse_last_created_ticket')
      return saved ? JSON.parse(saved) : null
    } catch (_) {
      return null
    }
  })
  const [error, setError] = useState(null)
  const [recentTickets, setRecentTickets] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(false)

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

  const loadRecentTickets = useCallback(async () => {
    try {
      const localIds = JSON.parse(localStorage.getItem('civicpulse_recent_tickets') || '[]')
      if (localIds.length === 0) return
      setLoadingRecent(true)
      const fetched = []
      for (const id of localIds.slice(0, 5)) {
        try {
          const res = await fetch(`${API_BASE}/api/tickets/${id}`)
          if (res.ok) {
            const data = await res.json()
            fetched.push(data)
          }
        } catch (_) {}
      }
      setRecentTickets(fetched)
    } catch (_) {} finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    loadRecentTickets()
  }, [loadRecentTickets])

  const handleReportAnother = () => {
    try {
      localStorage.removeItem('civicpulse_last_created_ticket')
    } catch (_) {}
    setResult(null)
    setError(null)
    setText('')
    setAudioBlob(null)
    setImageFile(null)
    setAddressQuery('')
    const formEl = document.getElementById('report-issue-form')
    if (formEl) {
      formEl.scrollIntoView({ behavior: 'smooth' })
    }
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
      formData.append('problem_lat', finalLat.toString())
      formData.append('problem_lng', finalLng.toString())
      if (gpsLat && gpsLng) {
        formData.append('device_lat', gpsLat.toString())
        formData.append('device_lng', gpsLng.toString())
      }
      formData.append('citizen_phone', phone)
      formData.append('location_source', locationSource)
      if (addressQuery.trim()) {
        formData.append('problem_landmark', addressQuery.trim())
      }

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

      // Persist ticket locally so citizen can track or view immediately, and persists on page refresh
      try {
        localStorage.setItem('civicpulse_last_created_ticket', JSON.stringify(data))
        sessionStorage.removeItem('civicpulse_cached_reports')
      } catch (_) {}

      if (data?.master_ticket_id) {
        try {
          const stored = JSON.parse(localStorage.getItem('civicpulse_recent_tickets') || '[]')
          if (!stored.includes(data.master_ticket_id)) {
            stored.unshift(data.master_ticket_id)
            localStorage.setItem('civicpulse_recent_tickets', JSON.stringify(stored.slice(0, 30)))
          }
        } catch (_) {}
      }

      // Reload recent tickets list
      loadRecentTickets()

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
  }, [finalLat, finalLng, text, audioBlob, imageFile, phone, locationSource, gpsLat, gpsLng, addressQuery, session?.access_token, loadRecentTickets])


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
        <div className="bg-white rounded-2xl border border-emerald-300 shadow-card p-6 mb-6 animate-slide-up">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Saved to Database
                </span>
                <span className="text-xs text-charcoal-400 font-mono">
                  ID: {result.master_ticket_id?.slice(0, 8)}...
                </span>
              </div>
              <h3 className="font-bold text-charcoal-900 text-lg mb-1">
                {result.is_duplicate ? 'Report Added to Existing Master Ticket' : 'New Master Ticket Successfully Created'}
              </h3>
              <p className="text-sm text-charcoal-600 mb-4 leading-relaxed">{result.message}</p>
              
              {/* Structured Submission Summary: ID, Category, Urgency, Location, Status, SLA */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-ivory-50 rounded-xl border border-ivory-200 mb-4 text-xs">
                <div>
                  <span className="text-charcoal-400 block font-medium">Ticket ID</span>
                  <span className="font-mono font-bold text-charcoal-900 select-all">{result.master_ticket_id?.slice(0, 8)}...</span>
                </div>
                <div>
                  <span className="text-charcoal-400 block font-medium">Category</span>
                  <span className="font-semibold text-charcoal-900">{result.category || 'Civic Defect'}</span>
                  {result.sub_category && <span className="text-[10px] text-charcoal-500 block">({result.sub_category})</span>}
                </div>
                <div>
                  <span className="text-charcoal-400 block font-medium">Detected Urgency</span>
                  <span className="inline-block mt-0.5">
                    {result.urgency && <UrgencyBadge urgency={result.urgency} size="sm" />}
                  </span>
                </div>
                <div>
                  <span className="text-charcoal-400 block font-medium">Current Status</span>
                  <span className="inline-flex items-center gap-1 font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full text-[10px] mt-0.5">
                    {result.status || 'OPEN'}
                  </span>
                </div>
                <div>
                  <span className="text-charcoal-400 block font-medium">Expected SLA</span>
                  <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    Within {result.sla_target_hours || (result.urgency === 'CRITICAL' ? 12 : result.urgency === 'HIGH' ? 24 : 48)} Hours
                  </span>
                </div>
                <div>
                  <span className="text-charcoal-400 block font-medium">Location</span>
                  <span className="font-semibold text-charcoal-800 truncate block mt-0.5">
                    {result.address_text || (result.lat && result.lng ? `${Number(result.lat).toFixed(4)}, ${Number(result.lng).toFixed(4)}` : 'Location pinned')}
                  </span>
                </div>
              </div>

              {result.upvote_count > 1 && (
                <p className="text-xs text-amber-700 font-semibold mb-4 flex items-center gap-1">
                  👥 {result.upvote_count} citizens have reported this physical defect (merged into this master ticket)
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => navigate(`/citizen/track/${result.master_ticket_id}`)}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 shadow-sm"
                >
                  Track This Ticket <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/citizen/history')}
                  className="btn-secondary flex items-center gap-2 text-xs py-2 px-4 shadow-sm"
                >
                  View My Tickets
                </button>
                <button
                  type="button"
                  onClick={handleReportAnother}
                  className="text-xs text-charcoal-500 hover:text-charcoal-800 px-3 py-2"
                >
                  Report Another Issue
                </button>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <form id="report-issue-form" onSubmit={handleSubmit} className="space-y-6">

          {/* ── LOCATION SECTION: Problem Location ── */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-charcoal-900 font-bold flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-civic-600" />
                  Problem Location
                  <span className="text-coral-600">*</span>
                </label>
                <p className="text-charcoal-500 text-xs mt-0.5">
                  Pinpoint where the defect exists so field officers resolve it at the right spot
                </p>
              </div>

              {gpsLat && gpsLng && (
                <button
                  type="button"
                  onClick={() => {
                    setPinLat(gpsLat)
                    setPinLng(gpsLng)
                    setPinTouched(true)
                    setLocationSource('gps')
                    setAddressQuery('')
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-civic-700 bg-civic-50 hover:bg-civic-100 border border-civic-200 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                  title="Reset pin to current GPS location"
                >
                  <Navigation className="w-3.5 h-3.5 text-civic-600" />
                  Use Current GPS
                </button>
              )}
            </div>

            {/* Address search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
              <input
                type="text"
                value={addressQuery}
                onChange={(e) => handleAddressInput(e.target.value)}
                placeholder="Search landmark or address (e.g. FC Road, Pune or Shivaji Nagar)"
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

            {/* Map preview with draggable pin */}
            {(finalLat && finalLng) && (
              <div className="rounded-xl overflow-hidden border border-ivory-300 relative shadow-sm" style={{ height: '220px' }}>
                <ErrorBoundary
                  fallback={() => (
                    <div className="h-full w-full flex flex-col items-center justify-center bg-ivory-100 text-charcoal-500 text-xs p-4 text-center">
                      <MapPin className="w-6 h-6 text-civic-500 mb-1" />
                      <span>Map preview unavailable. Coordinates set to: {Number(finalLat).toFixed(4)}, {Number(finalLng).toFixed(4)}</span>
                    </div>
                  )}
                >
                  <MapContainer
                    center={[finalLat, finalLng]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={true}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapCenterUpdater center={[finalLat, finalLng]} />
                    <MapClickHandler enabled={true} onMapClick={handleMapClick} />
                    <DraggablePin
                      position={[finalLat, finalLng]}
                      onDragEnd={handlePinDrag}
                    />
                  </MapContainer>
                </ErrorBoundary>
              </div>
            )}
            <p className="text-[11px] text-charcoal-400">
              💡 Tip: Click anywhere on the map or drag the pin directly to set the exact position.
            </p>
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

      {/* ── RECENT TICKETS BY THIS CITIZEN / BROWSER ── */}
      {recentTickets.length > 0 && (
        <div className="mt-10 pt-8 border-t border-ivory-300 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-civic-50 border border-civic-200 flex items-center justify-center text-civic-700">
                <Clock className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-charcoal-900">Your Recent Submissions</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-civic-50 text-civic-700 font-semibold border border-civic-200">
                {recentTickets.length}
              </span>
            </div>
            <Link
              to="/citizen/history"
              className="text-xs font-semibold text-civic-700 hover:text-civic-800 flex items-center gap-1"
            >
              View My Tickets <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-2.5">
            {recentTickets.filter(Boolean).map((t, idx) => {
              const ticketId = t?.id || `ticket-${idx}`
              return (
                <div
                  key={ticketId}
                  onClick={() => t?.id && navigate(`/citizen/track/${t.id}`)}
                  className="p-3.5 rounded-xl bg-white border border-ivory-300 shadow-sm hover:shadow-card hover:border-civic-300 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-charcoal-900">{t?.category || 'Civic Issue'}</span>
                      {t?.sub_category && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-ivory-100 text-charcoal-600 border border-ivory-200">
                          {t.sub_category}
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        t?.status === 'RESOLVED' || t?.status === 'CLOSED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : t?.status === 'IN_PROGRESS' || t?.status === 'ASSIGNED'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {t?.status || 'OPEN'}
                      </span>
                      <span className="text-[10px] text-charcoal-400 font-mono">
                        #{typeof t?.id === 'string' ? t.id.slice(0, 8) : '...'}
                      </span>
                    </div>
                    <p className="text-xs text-charcoal-600 line-clamp-1 leading-relaxed">
                      {t?.description || 'Civic issue recorded'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                    {t?.id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/citizen/track/${t.id}`)
                        }}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 group-hover:border-civic-400 font-medium"
                      >
                        Track Status <ArrowRight className="w-3 h-3 text-civic-600" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

