import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Upload, MapPin } from 'lucide-react'
import SOPStepsList from '../../components/SOPStepsList'
import PhotoCapture from '../../components/PhotoCapture'
import GpsBadge from '../../components/GpsBadge'
import UrgencyBadge from '../../components/UrgencyBadge'
import MapView from '../../components/MapView'
import useGeolocation from '../../hooks/useGeolocation'
import { API_BASE } from '../../supabaseClient'

/**
 * TicketDetailPage — SOP view + before/after photo capture + GPS verification for officers.
 */
export default function TicketDetailPage() {
  const { ticketId } = useParams()
  const navigate = useNavigate()
  const { lat, lng, accuracy, loading: gpsLoading, error: gpsError, refresh: refreshGps } = useGeolocation()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [completedSteps, setCompletedSteps] = useState([])
  const [beforePhoto, setBeforePhoto] = useState(null)
  const [afterPhoto, setAfterPhoto] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)

  useEffect(() => {
    fetchTicketDetail()
  }, [ticketId])

  const fetchTicketDetail = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/officer/ticket/${ticketId}`)
      if (!response.ok) throw new Error('Failed to load ticket')
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error('Ticket detail error:', err)
    } finally {
      setLoading(false)
    }
  }

  const uploadPhoto = async (photoFile, photoType) => {
    if (!lat || !lng) {
      alert('GPS location required for photo submission')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('master_ticket_id', ticketId)
      formData.append('photo_type', photoType)
      formData.append('lat', lat.toString())
      formData.append('lng', lng.toString())
      formData.append('image_file', photoFile)

      const response = await fetch(`${API_BASE}/api/officer/submit-proof`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error('Photo upload failed')
      const result = await response.json()
      setUploadResult(result)
      
      // Refresh data
      await fetchTicketDetail()
    } catch (err) {
      console.error('Upload error:', err)
      alert('Failed to upload photo: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const runVerification = async () => {
    setVerifying(true)
    try {
      const response = await fetch(`${API_BASE}/api/verify/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_ticket_id: ticketId }),
      })

      const result = await response.json()
      setVerifyResult(result)
      
      // Refresh data
      await fetchTicketDetail()
    } catch (err) {
      console.error('Verification error:', err)
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-civic-500 animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-charcoal-400">
        <p>Ticket not found</p>
      </div>
    )
  }

  const ticket = data.ticket
  const photos = data.verification_photos || []
  const hasBeforePhoto = photos.some((p) => p.photo_type === 'before')
  const hasAfterPhoto = photos.some((p) => p.photo_type === 'after')

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 py-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/officer')}
        className="flex items-center gap-2 text-sm text-charcoal-500 hover:text-charcoal-800 mb-6 transition-colors font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Queue
      </button>

      {/* Ticket Header */}
      <div className="glass-card mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <UrgencyBadge urgency={ticket.urgency} size="md" />
              <span className={`badge ${
                ticket.status === 'IN_PROGRESS' ? 'status-in_progress' : 'status-open'
              }`}>
                {ticket.status?.replace(/_/g, ' ')}
              </span>
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

        {/* Prominent Address Text */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-civic-50 border border-civic-200 mb-4">
          <MapPin className="w-4 h-4 text-civic-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-civic-800 uppercase tracking-wide">Incident Address</p>
            <p className="text-sm font-semibold text-charcoal-900 mt-0.5">
              {ticket.address_text || (ticket.lat && ticket.lng ? `${ticket.lat.toFixed(5)}, ${ticket.lng.toFixed(5)}` : 'Location Pending')}
            </p>
            <p className="text-[11px] text-charcoal-500 font-mono mt-0.5">
              GPS: {ticket.lat?.toFixed(5)}, {ticket.lng?.toFixed(5)}
            </p>
          </div>
        </div>

        {/* GPS */}
        <GpsBadge lat={lat} lng={lng} accuracy={accuracy} loading={gpsLoading} error={gpsError} onRefresh={refreshGps} />
      </div>

      {/* Map */}
      <MapView
        center={[ticket.lat, ticket.lng]}
        zoom={17}
        markers={[{ lat: ticket.lat, lng: ticket.lng, urgency: ticket.urgency, category: ticket.category }]}
        height="220px"
        className="mb-6"
      />

      {/* SOP Steps */}
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

      {/* Photo Submission */}
      <div className="glass-card mb-6">
        <h3 className="text-sm font-bold text-charcoal-800 uppercase tracking-wide mb-4">
          Proof of Work Verification
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Before Photo */}
          <div>
            <p className="text-xs font-semibold text-charcoal-600 mb-2">📸 Before Work Photo</p>
            {hasBeforePhoto ? (
              <div className="p-3 rounded-xl bg-civic-50 border border-civic-200 text-sm text-civic-800 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-civic-600" /> Before photo uploaded
              </div>
            ) : (
              <div>
                <PhotoCapture
                  onCapture={(file) => setBeforePhoto(file)}
                  label="Take BEFORE photo"
                />
                {beforePhoto && (
                  <button
                    onClick={() => uploadPhoto(beforePhoto, 'before')}
                    disabled={uploading}
                    className="btn-primary w-full mt-2 text-sm py-2"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Upload Before Photo
                  </button>
                )}
              </div>
            )}
          </div>

          {/* After Photo */}
          <div>
            <p className="text-xs font-semibold text-charcoal-600 mb-2">📸 After Work Photo</p>
            {hasAfterPhoto ? (
              <div className="p-3 rounded-xl bg-civic-50 border border-civic-200 text-sm text-civic-800 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-civic-600" /> After photo uploaded
              </div>
            ) : (
              <div>
                <PhotoCapture
                  onCapture={(file) => setAfterPhoto(file)}
                  label="Take AFTER photo"
                />
                {afterPhoto && (
                  <button
                    onClick={() => uploadPhoto(afterPhoto, 'after')}
                    disabled={uploading}
                    className="btn-primary w-full mt-2 text-sm py-2"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Upload After Photo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Run Verification */}
        {hasBeforePhoto && hasAfterPhoto && !verifyResult && (
          <button
            onClick={runVerification}
            disabled={verifying}
            className="btn-primary w-full mt-4"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Anti-Fraud Verification...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Run Anti-Fraud Verification
              </>
            )}
          </button>
        )}

        {/* Verification Result */}
        {verifyResult && (
          <div className={`mt-4 p-4 rounded-xl border animate-slide-up ${
            verifyResult.overall_passed
              ? 'bg-civic-50 border-civic-200 text-civic-900'
              : 'bg-coral-50 border-coral-200 text-coral-900'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {verifyResult.overall_passed ? (
                <CheckCircle2 className="w-5 h-5 text-civic-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-coral-600" />
              )}
              <span className={`font-bold ${
                verifyResult.overall_passed ? 'text-civic-800' : 'text-coral-700'
              }`}>
                {verifyResult.overall_passed ? 'Verification Passed' : 'Verification Failed'}
              </span>
            </div>
            <div className="space-y-1 text-xs text-charcoal-600 font-medium">
              <p>🗺️ Geofence: {verifyResult.geofence_passed ? '✅ Passed' : '❌ Failed'}</p>
              <p>📍 Same Location: {verifyResult.same_location ? '✅ Yes' : '❌ No'}</p>
              <p>🔧 Defect Resolved: {verifyResult.defect_resolved ? '✅ Yes' : '❌ No'}</p>
              <p>⭐ Confidence: {(verifyResult.confidence * 100).toFixed(0)}%</p>
              {verifyResult.notes && <p>📝 Notes: {verifyResult.notes}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
