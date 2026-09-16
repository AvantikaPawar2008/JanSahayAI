import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Upload } from 'lucide-react'
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
        <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-white/30">
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
        className="flex items-center gap-2 text-sm text-white/50 hover:text-white/70 mb-6 transition-colors"
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
            <h1 className="text-xl font-bold text-white/90">{ticket.category}</h1>
            <p className="text-sm text-white/40 mt-1">{ticket.department}</p>
          </div>
          <div className="text-right text-xs text-white/30">
            <p>Reports: {ticket.upvote_count}</p>
            <p className="font-mono mt-1">{ticket.id?.slice(0, 8)}</p>
          </div>
        </div>

        {ticket.description && (
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 mb-4">
            <p className="text-sm text-white/70">{ticket.description}</p>
          </div>
        )}

        {/* GPS */}
        <GpsBadge lat={lat} lng={lng} accuracy={accuracy} loading={gpsLoading} error={gpsError} onRefresh={refreshGps} />
      </div>

      {/* Map */}
      <MapView
        center={[ticket.lat, ticket.lng]}
        zoom={17}
        markers={[{ lat: ticket.lat, lng: ticket.lng, urgency: ticket.urgency, category: ticket.category }]}
        height="200px"
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
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-4">
          Proof of Work Photos
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Before Photo */}
          <div>
            <p className="text-xs text-white/40 mb-2">📸 Before Photo</p>
            {hasBeforePhoto ? (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Before photo uploaded
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
            <p className="text-xs text-white/40 mb-2">📸 After Photo</p>
            {hasAfterPhoto ? (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> After photo uploaded
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
                Running AI Verification...
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
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {verifyResult.overall_passed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              )}
              <span className={`font-semibold ${
                verifyResult.overall_passed ? 'text-emerald-300' : 'text-red-300'
              }`}>
                {verifyResult.overall_passed ? 'Verification Passed' : 'Verification Failed'}
              </span>
            </div>
            <div className="space-y-1 text-xs text-white/60">
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
