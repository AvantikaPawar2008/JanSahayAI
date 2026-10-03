import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Upload, MapPin,
  RefreshCw, RotateCcw, Camera, Info, ShieldCheck, ShieldX, Clock, User
} from 'lucide-react'
import SOPStepsList from '../../components/SOPStepsList'
import PhotoCapture from '../../components/PhotoCapture'
import GpsBadge from '../../components/GpsBadge'
import UrgencyBadge from '../../components/UrgencyBadge'
import MapView from '../../components/MapView'
import useGeolocation from '../../hooks/useGeolocation'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

/**
 * TicketDetailPage — SOP view + after-photo verification + officer UI state machine.
 *
 * Officer UI state machine (Section 5):
 *
 *   [Ticket loaded]
 *       ↓ has after photo?
 *   No  → Show "Upload After Photo" capture UI
 *   Yes → Show "Run Verification" button
 *       ↓ verify result?
 *   FAILED → Show failure banner + "Upload New After Photo" retry only (no bypass path)
 *   PASSED → Show "Awaiting Citizen Confirmation" read-only badge
 *            + "Actually not fixed — reopen" officer self-correction (needs reason text)
 *            NO button that can set RESOLVED or CLOSED.
 *
 * Note on before photos: before-photos are now auto-assigned from citizen reports
 * (backend logic, Migration 009). Officers no longer need to manually upload a before photo.
 * The UI still shows if a citizen before-photo is on file for context.
 */

const VERIFICATION_METHOD_LABELS = {
  before_after_comparison: 'Verified via before/after comparison',
  single_photo_completion: 'Verified via single-photo check (no before-photo was on file for this ticket)',
}

export default function TicketDetailPage() {
  const { ticketId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { lat, lng, accuracy, loading: gpsLoading, error: gpsError, refresh: refreshGps } = useGeolocation()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [completedSteps, setCompletedSteps] = useState([])

  // After-photo capture & upload
  const [afterPhoto, setAfterPhoto] = useState(null)
  const [uploading, setUploading] = useState(false)

  // Verification
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [deviceTilt, setDeviceTilt] = useState(null)
  const [deviceHeading, setDeviceHeading] = useState(null)

  // Demo Geofence Simulation Mode (for hackathon indoor presentations)
  const [gpsSimMode, setGpsSimMode] = useState('real') // 'real' | 'onsite_demo' | 'offsite_demo'

  // Officer Allotment State
  const [officersList, setOfficersList] = useState([])
  const [selectedOfficerId, setSelectedOfficerId] = useState('')
  const [allotting, setAllotting] = useState(false)
  const [allotMsg, setAllotMsg] = useState(null)

  const fetchDepartmentOfficers = async (dept) => {
    try {
      const res = await fetch(`${API_BASE}/api/officer/list?department=${encodeURIComponent(dept || '')}`)
      if (res.ok) {
        const offList = await res.json()
        setOfficersList(offList)
      }
    } catch (e) {
      console.error('Failed to load officers:', e)
    }
  }

  const handleAllotTicket = async () => {
    if (!selectedOfficerId) return
    setAllotting(true)
    setAllotMsg(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch(`${API_BASE}/api/officer/allot`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ticket_id: ticketId,
          officer_id: selectedOfficerId,
        }),
      })
      const resp = await res.json()
      if (res.ok) {
        setAllotMsg(resp.message || 'Allotted successfully!')
        await fetchTicketDetail(session?.access_token)
      } else {
        setAllotMsg(`Failed: ${resp.detail || 'Error'}`)
      }
    } catch (err) {
      setAllotMsg(`Error: ${err.message}`)
    } finally {
      setAllotting(false)
      setTimeout(() => setAllotMsg(null), 5000)
    }
  }

  const effectiveLat = gpsSimMode === 'onsite_demo'
    ? (data?.ticket?.lat ? data.ticket.lat + 0.0002 : 18.5204)  // ~25m away (passes 150m geofence)
    : gpsSimMode === 'offsite_demo'
    ? (data?.ticket?.lat ? data.ticket.lat + 0.006 : 18.56)      // ~660m away (breaches 150m geofence)
    : (lat || data?.ticket?.lat)

  const effectiveLng = gpsSimMode === 'onsite_demo'
    ? (data?.ticket?.lng ? data.ticket.lng + 0.0002 : 73.8567)
    : gpsSimMode === 'offsite_demo'
    ? (data?.ticket?.lng ? data.ticket.lng + 0.006 : 73.89)
    : (lng || data?.ticket?.lng)

  useEffect(() => {
    const handleOrientation = (e) => {
      if (e.beta !== null && e.beta !== undefined) setDeviceTilt(Math.round(e.beta))
      if (e.alpha !== null && e.alpha !== undefined) setDeviceHeading(Math.round(e.alpha))
    }
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true)
    }
    return () => {
      if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation)
      }
    }
  }, [])

  // Officer self-correction reopen
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState(null)

  const hasFetched = useRef(false)

  const fetchTicketDetail = async (token) => {
    setLoading(true)
    setFetchError(null)
    try {
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const response = await fetch(`${API_BASE}/api/officer/ticket/${ticketId}`, { headers })
      if (!response.ok) throw new Error(`Failed to load ticket (${response.status})`)
      const result = await response.json()
      setData(result)
      if (result?.ticket?.assigned_officer_id) {
        setSelectedOfficerId(result.ticket.assigned_officer_id)
      }
      if (result?.ticket?.department) {
        fetchDepartmentOfficers(result.ticket.department)
      }
      // Reset verification state when ticket data refreshes
      // (if the ticket is back to IN_PROGRESS after a reopen, clear stale result)
      if (result?.ticket?.status === 'IN_PROGRESS') {
        setVerifyResult(null)
      }
    } catch (err) {
      console.error('Ticket detail error:', err)
      setFetchError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true
      fetchTicketDetail(session?.access_token)
    }
  }, [ticketId])

  useEffect(() => {
    if (session?.access_token && hasFetched.current && !data && !loading) {
      fetchTicketDetail(session.access_token)
    }
  }, [session?.access_token])

  /** Upload officer after photo to /api/officer/submit-proof */
  const uploadAfterPhoto = async (photoFile) => {
    const uploadLat = effectiveLat || lat || data?.ticket?.lat
    const uploadLng = effectiveLng || lng || data?.ticket?.lng

    if (!uploadLat || !uploadLng) {
      alert('GPS location is required for photo submission. Please enable location services.')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('master_ticket_id', ticketId)
      formData.append('photo_type', 'after')
      formData.append('lat', uploadLat.toString())
      formData.append('lng', uploadLng.toString())
      formData.append('image_file', photoFile)

      const headers = {}
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

      const response = await fetch(`${API_BASE}/api/officer/submit-proof`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}))
        throw new Error(errJson.detail || `Server responded with ${response.status}`)
      }

      setAfterPhoto(null) // Clear file selection after upload
      await fetchTicketDetail(session?.access_token)
    } catch (err) {
      console.error('Upload error:', err)
      alert('Failed to upload photo: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  /** Trigger VLM + geofence verification for the uploaded after photo */
  const runVerification = async () => {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

      const response = await fetch(`${API_BASE}/api/verify/photo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          master_ticket_id: ticketId,
          officer_id: session?.user?.id || null,
          device_tilt: deviceTilt,
          device_heading: deviceHeading,
          is_mock_location: accuracy === 0, // Mock providers frequently report exactly 0m accuracy
        }),
      })

      const result = await response.json()
      setVerifyResult(result)
      await fetchTicketDetail(session?.access_token)
    } catch (err) {
      console.error('Verification error:', err)
      setVerifyResult({ overall_passed: false, notes: 'Verification request failed — please retry.' })
    } finally {
      setVerifying(false)
    }
  }

  /** Officer self-correction: revert RESOLVED_PENDING_CITIZEN → IN_PROGRESS */
  const submitOfficerReopen = async () => {
    if (!reopenReason.trim()) {
      setReopenError('Please provide a short reason before reverting.')
      return
    }
    setReopening(true)
    setReopenError(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

      const response = await fetch(`${API_BASE}/api/verify/reopen-by-officer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          master_ticket_id: ticketId,
          reason: reopenReason.trim(),
          officer_id: session?.user?.id || null,
        }),
      })

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}))
        throw new Error(errJson.detail || `Server responded with ${response.status}`)
      }

      // Reset state and reload ticket
      setVerifyResult(null)
      setReopenReason('')
      await fetchTicketDetail(session?.access_token)
    } catch (err) {
      console.error('Officer reopen error:', err)
      setReopenError(err.message)
    } finally {
      setReopening(false)
    }
  }

  // ─── Render: loading / error states ──────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 text-civic-500 animate-spin" />
        <span className="text-xs text-charcoal-400 font-medium">Loading ticket details & SOP...</span>
      </div>
    )
  }

  if (!data || !data.ticket) {
    return (
      <div className="page-enter max-w-lg mx-auto px-4 py-20 text-center">
        <div className="glass-card p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-coral-50 border border-coral-200 flex items-center justify-center mx-auto text-coral-600">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-charcoal-900">Ticket Not Found</h2>
          <p className="text-sm text-charcoal-500">
            {fetchError || "The requested ticket could not be found or you don't have permission to view it."}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button onClick={() => navigate('/officer')} className="btn btn-secondary text-xs">
              Back to Queue
            </button>
            <button
              onClick={() => fetchTicketDetail(session?.access_token)}
              className="btn btn-primary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const ticket = data.ticket
  const photos = data.verification_photos || []

  // Before-photo: auto-assigned from citizen reports (Migration 009) or manually uploaded
  const citizenBeforePhoto = photos.find((p) => p.photo_type === 'before')
  const hasBeforePhoto = Boolean(citizenBeforePhoto) || Boolean(ticket.has_before_photo)

  const afterPhotoRecord = photos.find((p) => p.photo_type === 'after')
  const hasAfterPhoto = Boolean(afterPhotoRecord)

  const isAwaitingCitizenConfirmation = ticket.status === 'RESOLVED_PENDING_CITIZEN'

  // Read verification_method from the after-photo record or from last verify result
  const effectiveVerifMethod =
    verifyResult?.verification_method ||
    afterPhotoRecord?.verification_method ||
    (hasBeforePhoto ? 'before_after_comparison' : 'single_photo_completion')

  const verifMethodLabel = VERIFICATION_METHOD_LABELS[effectiveVerifMethod] || effectiveVerifMethod

  // ─── Main Render ──────────────────────────────────────────────────────────

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 py-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/officer')}
        className="flex items-center gap-2 text-sm text-charcoal-500 hover:text-charcoal-800 mb-6 transition-colors font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Queue
      </button>

      {/* ── Ticket Header ── */}
      <div className="glass-card mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <UrgencyBadge urgency={ticket.urgency} size="md" />
              <span className={`badge ${
                ticket.status === 'IN_PROGRESS' ? 'status-in_progress' :
                ticket.status === 'RESOLVED_PENDING_CITIZEN' ? 'status-resolved_pending_citizen' :
                'status-open'
              }`}>
                {ticket.status?.replace(/_/g, ' ')}
              </span>
              {isAwaitingCitizenConfirmation && (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Awaiting citizen confirmation
                </span>
              )}
              {ticket.needs_admin_review && (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-coral-50 text-coral-700 border border-coral-200 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-coral-600" /> Needs review
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-charcoal-900">{ticket.category}</h1>
            <p className="text-sm text-charcoal-500 mt-0.5">{ticket.department}</p>
          </div>
          <div className="text-right text-xs text-charcoal-400">
            <p className="font-medium text-charcoal-700">Reports: {ticket.upvote_count}</p>
            <p className="font-mono mt-0.5 text-charcoal-400">ID: {ticket.id?.slice(0, 8)}</p>
          </div>
        </div>

        {ticket.description && (
          <div className="p-3.5 rounded-xl bg-ivory-100 border border-ivory-300 mb-4">
            <p className="text-sm text-charcoal-700 leading-relaxed">{ticket.description}</p>
          </div>
        )}

        {/* Address */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-civic-50 border border-civic-200 mb-4">
          <MapPin className="w-4 h-4 text-civic-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-civic-800 uppercase tracking-wide">Incident Address</p>
            <p className="text-sm font-semibold text-charcoal-900 mt-0.5">
              {ticket.address_text || (ticket.lat && ticket.lng
                ? `${ticket.lat.toFixed(5)}, ${ticket.lng.toFixed(5)}`
                : 'Location Pending')}
            </p>
            <p className="text-[11px] text-charcoal-500 font-mono mt-0.5">
              GPS: {ticket.lat?.toFixed(5)}, {ticket.lng?.toFixed(5)}
            </p>
          </div>
        </div>

        {/* Officer Allotment Card */}
        <div className="p-3.5 rounded-xl bg-white border border-ivory-300 mb-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wide flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-civic-600" /> Allotted Field Officer
              </p>
              <p className="text-sm font-bold text-charcoal-900 mt-0.5">
                {officersList.find((o) => o.id === ticket.assigned_officer_id)?.name || (ticket.assigned_officer_id ? 'Assigned Field Officer' : '⚠️ Unallotted Ticket')}
              </p>
              {ticket.assigned_officer_id && (
                <p className="text-xs text-charcoal-500">
                  {officersList.find((o) => o.id === ticket.assigned_officer_id)?.phone_number || 'Official Contact on file'}
                </p>
              )}
            </div>

            {/* Re-allotment Form */}
            <div className="flex items-center gap-2">
              <select
                value={selectedOfficerId}
                onChange={(e) => setSelectedOfficerId(e.target.value)}
                className="input text-xs py-1.5 min-w-[180px]"
              >
                <option value="">Select Officer to Allot...</option>
                {officersList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.current_pending_count ?? 0} pending)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAllotTicket}
                disabled={allotting || !selectedOfficerId || selectedOfficerId === ticket.assigned_officer_id}
                className="btn btn-primary text-xs whitespace-nowrap"
              >
                {allotting ? 'Allotting...' : 'Re-allot'}
              </button>
            </div>
          </div>

          {allotMsg && (
            <p className="text-xs text-civic-700 font-medium mt-2 bg-civic-50 p-2 rounded-lg border border-civic-100">
              {allotMsg}
            </p>
          )}
        </div>

        <GpsBadge lat={lat} lng={lng} accuracy={accuracy} loading={gpsLoading} error={gpsError} onRefresh={refreshGps} />
      </div>

      {/* ── Map ── */}
      <MapView
        center={[ticket.lat, ticket.lng]}
        zoom={17}
        markers={[{ lat: ticket.lat, lng: ticket.lng, urgency: ticket.urgency, category: ticket.category }]}
        height="220px"
        className="mb-6"
      />

      {/* ── SOP Steps ── */}
      <div className="glass-card mb-6">
        <SOPStepsList
          steps={ticket.sop_steps || []}
          completedSteps={completedSteps}
          onToggle={(i) => {
            setCompletedSteps((prev) =>
              prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
            )
          }}
          tools={ticket.tools_required || []}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
           PROOF OF WORK VERIFICATION SECTION
          ══════════════════════════════════════════════════════ */}
      <div className="glass-card mb-6">
        <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wide mb-4">
          Proof of Work Verification
        </h3>

        {/* ── Citizen before-photo context banner ── */}
        <div className={`flex items-start gap-2.5 p-3 rounded-xl border mb-4 text-xs ${
          hasBeforePhoto
            ? 'bg-civic-50 border-civic-200 text-civic-800'
            : 'bg-ivory-100 border-ivory-300 text-charcoal-500'
        }`}>
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">
              {hasBeforePhoto
                ? '📸 Before-photo on file (auto-assigned from citizen report)'
                : 'ℹ️ No before-photo on file'}
            </span>
            {!hasBeforePhoto && (
              <p className="mt-0.5 text-charcoal-400">
                Verification will use a single-photo completion check instead of a before/after comparison.
              </p>
            )}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────
             STATE: RESOLVED_PENDING_CITIZEN
             Read-only status badge + officer self-correction only
            ───────────────────────────────────────────────────── */}
        {isAwaitingCitizenConfirmation && (
          <div className="space-y-4">
            {/* Passed banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-civic-50 border border-civic-200 animate-slide-up">
              <ShieldCheck className="w-5 h-5 text-civic-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-civic-800 text-sm">
                  Verification passed — Awaiting citizen confirmation
                </p>
                <p className="text-xs text-charcoal-500 mt-1">
                  The citizen will be notified and can confirm or reopen this ticket.
                  This ticket is now read-only for officers.
                </p>
                {/* Verification method transparency note */}
                <p className="text-[11px] text-charcoal-400 mt-2 italic">
                  🔍 {verifMethodLabel}
                </p>
                {ticket.needs_admin_review && (
                  <p className="text-[11px] text-amber-600 mt-1 font-semibold">
                    ⚠️ This is a CRITICAL ticket verified without a before-photo — flagged for supervisor review.
                  </p>
                )}
              </div>
            </div>

            {/* Officer self-correction — the ONLY officer action allowed at this state */}
            <div className="p-4 rounded-xl bg-ivory-100 border border-ivory-300">
              <p className="text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                Actually not fixed? Revert before the citizen sees it.
              </p>
              <p className="text-[11px] text-charcoal-500 mb-3">
                If you realise the repair wasn't complete, you can revert the ticket to In Progress.
                This is an officer self-correction, not a closure action.
              </p>
              <textarea
                id="officer-reopen-reason"
                rows={2}
                placeholder="Short reason (required) — e.g. 'Missed a section of pothole fill'"
                value={reopenReason}
                onChange={(e) => { setReopenReason(e.target.value); setReopenError(null) }}
                className="w-full text-xs rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-charcoal-800 placeholder-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-400 resize-none mb-2"
              />
              {reopenError && (
                <p className="text-xs text-coral-600 mb-2">{reopenError}</p>
              )}
              <button
                id="btn-officer-self-correction-reopen"
                onClick={submitOfficerReopen}
                disabled={reopening || !reopenReason.trim()}
                className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reopening ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reverting...</>
                ) : (
                  <><RotateCcw className="w-3.5 h-3.5" /> Actually not fixed — reopen for correction</>
                )}
              </button>
              <p className="text-[10px] text-charcoal-400 mt-1.5 text-center">
                ⚠️ This will NOT close the ticket. It returns it to In Progress in your queue.
              </p>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────
             STATE: Verification just RAN and FAILED
             Show failure details + retry upload only — no bypass
            ───────────────────────────────────────────────────── */}
        {verifyResult && !verifyResult.overall_passed && !isAwaitingCitizenConfirmation && (
          <div className="space-y-4 animate-slide-up">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-coral-50 border border-coral-200">
              <ShieldX className="w-5 h-5 text-coral-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-coral-800 text-sm">Verification failed</p>
                <div className="space-y-1 text-xs text-charcoal-600 font-medium mt-2">
                  <p>🗺️ Geofence: {verifyResult.geofence_passed ? '✅ Passed' : '❌ Failed'}</p>
                  {verifyResult.verification_method === 'before_after_comparison' && (
                    <p>📍 Same Location: {verifyResult.same_location ? '✅ Yes' : '❌ No'}</p>
                  )}
                  <p>🔧 Defect Resolved: {verifyResult.defect_resolved ? '✅ Yes' : '❌ No'}</p>
                  {verifyResult.notes && <p className="text-charcoal-500">📝 {verifyResult.notes}</p>}
                </div>
                {/* Method transparency */}
                <p className="text-[11px] text-charcoal-400 mt-2 italic">
                  🔍 {verifMethodLabel}
                </p>
              </div>
            </div>

            {/* ONLY allowed action after failure: re-upload */}
            <div>
              <p className="text-xs font-semibold text-charcoal-600 mb-2 flex items-center gap-1.5">
                <Camera className="w-4 h-4" /> Retry — Upload a new after photo
              </p>
              <PhotoCapture onCapture={(file) => setAfterPhoto(file)} label="Take new AFTER photo" />
              {afterPhoto && (
                <button
                  id="btn-retry-upload-after-photo"
                  onClick={() => uploadAfterPhoto(afterPhoto)}
                  disabled={uploading}
                  className="btn btn-primary w-full mt-2 text-sm py-2 flex items-center justify-center gap-2"
                >
                  {uploading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                    : <><Upload className="w-4 h-4" /> Upload New After Photo</>}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────
             STATE: No after photo yet — capture & upload flow
            ───────────────────────────────────────────────────── */}
        {!hasAfterPhoto && !isAwaitingCitizenConfirmation && !(verifyResult && !verifyResult.overall_passed) && (
          <div>
            {/* Geofence Demo Mode Selector */}
            <div className="mb-4 p-3 rounded-xl bg-ivory-100 border border-ivory-300 text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-charcoal-700 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-civic-600" />
                  Officer GPS Location (150m Geofence Enforced)
                </span>
                <span className="text-[10px] bg-civic-100 text-civic-800 px-2 py-0.5 rounded font-mono font-bold">
                  {gpsSimMode === 'real' ? 'LIVE GPS' : 'DEMO MODE'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGpsSimMode('real')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    gpsSimMode === 'real'
                      ? 'bg-civic-600 text-white shadow-sm'
                      : 'bg-white border border-charcoal-200 text-charcoal-600 hover:bg-ivory-200'
                  }`}
                >
                  Real Device GPS
                </button>
                <button
                  type="button"
                  onClick={() => setGpsSimMode('onsite_demo')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    gpsSimMode === 'onsite_demo'
                      ? 'bg-civic-600 text-white shadow-sm'
                      : 'bg-white border border-charcoal-200 text-charcoal-600 hover:bg-ivory-200'
                  }`}
                >
                  🟢 On-Site (25m - Demo Pass)
                </button>
                <button
                  type="button"
                  onClick={() => setGpsSimMode('offsite_demo')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    gpsSimMode === 'offsite_demo'
                      ? 'bg-coral-600 text-white shadow-sm'
                      : 'bg-white border border-charcoal-200 text-charcoal-600 hover:bg-ivory-200'
                  }`}
                >
                  🔴 Off-Site (660m - Demo Reject)
                </button>
              </div>
              <p className="text-[11px] text-charcoal-400 mt-2">
                {gpsSimMode === 'real' && 'Using browser navigator.geolocation.'}
                {gpsSimMode === 'onsite_demo' && 'Simulating officer standing 25 meters from complaint site (within 150m geofence).'}
                {gpsSimMode === 'offsite_demo' && 'Simulating officer standing 660 meters away (violates 150m geofence).'}
              </p>
            </div>

            <p className="text-xs font-semibold text-charcoal-600 mb-2 flex items-center gap-1.5">
              <Camera className="w-4 h-4" /> 📸 After Work Photo (required)
            </p>
            <PhotoCapture onCapture={(file) => setAfterPhoto(file)} label="Take AFTER photo" />
            {afterPhoto && (
              <button
                id="btn-upload-after-photo"
                onClick={() => uploadAfterPhoto(afterPhoto)}
                disabled={uploading}
                className="btn btn-primary w-full mt-2 text-sm py-2 flex items-center justify-center gap-2"
              >
                {uploading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                  : <><Upload className="w-4 h-4" /> Upload After Photo</>}
              </button>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────
             STATE: After photo uploaded, not yet verified
             (and no stale failed result in view)
            ───────────────────────────────────────────────────── */}
        {hasAfterPhoto && !isAwaitingCitizenConfirmation && !(verifyResult && !verifyResult.overall_passed) && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-civic-50 border border-civic-200 text-sm text-civic-800 flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-civic-600" /> After photo uploaded
            </div>

            {!verifyResult && (
              <button
                id="btn-run-verification"
                onClick={runVerification}
                disabled={verifying}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Running Verification...</>
                ) : (
                  <><ShieldCheck className="w-4 h-4" /> Run Anti-Fraud Verification</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
