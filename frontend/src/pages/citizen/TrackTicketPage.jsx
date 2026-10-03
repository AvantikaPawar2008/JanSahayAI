import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Search, Loader2, CheckCircle2, RotateCcw, Clock, MapPin, Users, ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react'
import UrgencyBadge from '../../components/UrgencyBadge'
import SlaBadge from '../../components/SlaBadge'
import MapView from '../../components/MapView'
import { API_BASE } from '../../supabaseClient'
import useAuth from '../../hooks/useAuth'
import useSupabaseRealtime from '../../hooks/useSupabaseRealtime'

/**
 * TrackTicketPage — citizen views their ticket status and can verify/reopen resolutions.
 */
export default function TrackTicketPage() {
  const { ticketId: routeTicketId } = useParams()
  const { session } = useAuth()
  const [searchId, setSearchId] = useState(routeTicketId || '')
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [responding, setResponding] = useState(false)
  const [localRecentTickets, setLocalRecentTickets] = useState([])

  // Community support / upvote state
  const [hasSupported, setHasSupported] = useState(false)
  const [supporting, setSupporting] = useState(false)
  const [supportMessage, setSupportMessage] = useState(null)

  // 3-Option citizen feedback state
  const [feedbackComment, setFeedbackComment] = useState('')

  // Load recently submitted tickets from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('civicpulse_recent_tickets') || '[]')
      if (stored.length > 0) {
        Promise.all(
          stored.slice(0, 5).map((id) =>
            fetch(`${API_BASE}/api/tickets/${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        ).then((res) => {
          setLocalRecentTickets(res.filter(Boolean))
        })
      }
    } catch (_) {}
  }, [])

  // Check if citizen already supported this ticket
  useEffect(() => {
    if (ticket?.id) {
      try {
        const supportedList = JSON.parse(localStorage.getItem('civicpulse_supported_tickets') || '[]')
        setHasSupported(supportedList.includes(ticket.id))
      } catch (_) {}
    }
  }, [ticket?.id])

  // Also show recent tickets via realtime
  const { data: recentTickets, loading: recentLoading } = useSupabaseRealtime('master_tickets')

  const searchTicket = async (id) => {
    const targetId = id || searchId
    if (!targetId) return

    setLoading(true)
    setError(null)

    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const response = await fetch(`${API_BASE}/api/tickets/${targetId}`, { headers })
      if (!response.ok) throw new Error('Ticket not found or access restricted')
      const data = await response.json()
      setTicket(data)
    } catch (err) {
      setError(err.message)
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (routeTicketId) {
      setSearchId(routeTicketId)
      searchTicket(routeTicketId)
    }
  }, [routeTicketId, session])

  const handleSupport = async (isAffected) => {
    if (!ticket || hasSupported) return
    setSupporting(true)
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${ticket.id}/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_affected: isAffected,
          voter_fingerprint: localStorage.getItem('civicpulse_device_id') || 'browser-' + Math.random().toString(36).slice(2),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSupportMessage(data.message)
        setHasSupported(true)
        const stored = JSON.parse(localStorage.getItem('civicpulse_supported_tickets') || '[]')
        stored.push(ticket.id)
        localStorage.setItem('civicpulse_supported_tickets', JSON.stringify(stored))
        setTicket((prev) => ({ ...prev, upvote_count: data.upvote_count }))
      }
    } catch (err) {
      console.error('Support error:', err)
    } finally {
      setSupporting(false)
    }
  }

  const handleCitizenResponse = async (responseChoice) => {
    if (!ticket) return
    setResponding(true)

    try {
      const res = await fetch(`${API_BASE}/api/tickets/${ticket.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: responseChoice,
          comment: feedbackComment.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to submit response')
      }
      setFeedbackComment('')
      // Refresh ticket
      await searchTicket(ticket.id)
    } catch (err) {
      console.error('Response failed:', err)
      setError(err.message)
    } finally {
      setResponding(false)
    }
  }

  const statusTimeline = [
    { key: 'OPEN', label: 'Reported', icon: '📝' },
    { key: 'ASSIGNED', label: 'Assigned', icon: '👷' },
    { key: 'IN_PROGRESS', label: 'In Progress', icon: '🔧' },
    { key: 'RESOLVED_PENDING_CITIZEN', label: 'Resolved — Verify', icon: '✅' },
    { key: 'RESOLVED', label: 'Closed', icon: '🎉' },
  ]

  const getStepIndex = (status) => {
    const idx = statusTimeline.findIndex((s) => s.key === status)
    if (status === 'REOPENED') return 2 // Show as back to "In Progress"
    return idx >= 0 ? idx : 0
  }

  return (
    <div className="page-enter max-w-4xl mx-auto px-4 py-8">
      {/* Breadcrumb back to ticket history */}
      <div className="mb-5">
        <Link
          to="/citizen/history"
          className="inline-flex items-center gap-1.5 text-xs text-charcoal-600 hover:text-charcoal-900 transition-colors py-1.5 px-3 rounded-xl bg-white border border-ivory-300 hover:bg-ivory-100 shadow-sm font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to My Tickets
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-700 border border-civic-200">
          Live Tracking
        </span>
        <span className="text-xs text-charcoal-400 font-mono">Real-time Resolution Status</span>
      </div>
      <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight mb-2">Track Your Ticket</h1>
      <p className="text-charcoal-500 text-sm mb-6">Enter your ticket ID to see real-time field progress and officer notes</p>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-4 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchTicket()}
            placeholder="Paste your ticket ID here..."
            className="w-full bg-ivory-50 border border-ivory-300 rounded-xl px-4 py-2.5 font-mono text-sm text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 focus:bg-white transition-all flex-1"
          />
          <button
            onClick={() => searchTicket()}
            disabled={loading || !searchId}
            className="btn-primary px-6 flex items-center justify-center shadow-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Search className="w-4 h-4 text-white" />}
          </button>
        </div>
        {error && <p className="text-coral-600 font-medium text-xs mt-2.5">{error}</p>}
      </div>

      {/* Ticket Detail */}
      {ticket && (
        <div className="space-y-6 animate-slide-up">
          {/* Status Timeline & Header */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2.5">
                <UrgencyBadge urgency={ticket.urgency} size="md" />
                <h2 className="text-lg font-bold text-charcoal-900">{ticket.category}</h2>
              </div>
              <SlaBadge ticket={ticket} size="md" />
            </div>

            <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
              {statusTimeline.map((step, i) => {
                const currentStep = getStepIndex(ticket.status)
                const isActive = i <= currentStep
                const isCurrent = i === currentStep

                return (
                  <div key={step.key} className="flex items-center flex-shrink-0">
                    <div className={`
                      flex flex-col items-center gap-1 px-3.5 py-2 rounded-xl transition-all
                      ${isCurrent ? 'bg-civic-50 border border-civic-300 text-civic-900 font-semibold shadow-sm' :
                        isActive ? 'text-charcoal-700 opacity-90' : 'text-charcoal-400 opacity-40'}
                    `}>
                      <span className="text-lg">{step.icon}</span>
                      <span className="text-xs font-medium whitespace-nowrap">{step.label}</span>
                    </div>
                    {i < statusTimeline.length - 1 && (
                      <div className={`w-8 h-0.5 flex-shrink-0 ${isActive ? 'bg-civic-500' : 'bg-ivory-300'}`} />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Ticket Info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-ivory-50/70 p-4 rounded-xl border border-ivory-200">
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Department</span>
                <p className="text-charcoal-900 font-semibold truncate">{ticket.department || 'Pending'}</p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Citizen Reports</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-civic-600" /> {ticket.upvote_count} citizen{ticket.upvote_count === 1 ? '' : 's'}
                </p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Reported On</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-charcoal-500" />
                  {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '-'}
                </p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Location</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1 truncate">
                  <MapPin className="w-3.5 h-3.5 text-civic-600 flex-shrink-0" />
                  {ticket.address_text ? ticket.address_text : (ticket.lat && ticket.lng ? `${ticket.lat.toFixed(4)}, ${ticket.lng.toFixed(4)}` : 'Location pending')}
                </p>
              </div>
            </div>

            {ticket.description && (
              <div className="mt-4 p-4 rounded-xl bg-white border border-ivory-300 shadow-sm">
                <span className="text-charcoal-500 text-xs uppercase tracking-wider font-bold">Description</span>
                <p className="text-sm text-charcoal-700 mt-1 leading-relaxed">{ticket.description}</p>
              </div>
            )}
          </div>

          {/* Community Support & Confirmation Widget */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-charcoal-700 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                  <Users className="w-4 h-4 text-civic-600" />
                  Community Impact &amp; Confirmation
                </span>
                <h3 className="text-base font-bold text-charcoal-900">
                  Is this problem affecting you too?
                </h3>
                <p className="text-xs text-charcoal-500 mt-0.5">
                  Confirming this defect boosts municipal priority and merges reports without creating duplicate tickets.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="px-3 py-1.5 rounded-xl bg-ivory-100 text-charcoal-800 font-bold text-xs border border-ivory-300 flex items-center gap-1.5 whitespace-nowrap">
                  👥 Affected citizens: <strong className="text-civic-700 font-mono text-sm">{ticket.upvote_count || 1}</strong>
                </span>

                {hasSupported ? (
                  <span className="text-xs px-3 py-2 rounded-xl bg-emerald-50 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Support Confirmed
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSupport(true)}
                      disabled={supporting}
                      className="btn-primary text-xs px-3.5 py-2 flex items-center gap-1.5 shadow-sm font-semibold whitespace-nowrap"
                    >
                      {supporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "👍 YES, I'M AFFECTED"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSupport(false)}
                      disabled={supporting}
                      className="btn-secondary text-xs px-3 py-2 text-charcoal-600 hover:text-charcoal-800 whitespace-nowrap"
                    >
                      NOT MY ISSUE
                    </button>
                  </div>
                )}
              </div>
            </div>
            {supportMessage && (
              <p className="text-xs font-semibold text-emerald-700 mt-3 animate-fade-in">
                ✓ {supportMessage}
              </p>
            )}
          </div>

          {/* Map */}
          <MapView
            center={[ticket.lat, ticket.lng]}
            zoom={16}
            markers={[{ lat: ticket.lat, lng: ticket.lng, urgency: ticket.urgency, category: ticket.category }]}
            height="250px"
          />

          {/* Verification Proof Photos (if uploaded by officer) */}
          {ticket.verification_photos && ticket.verification_photos.length > 0 && (
            <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-charcoal-700 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Field Verification Photos
                </span>
                <span className="text-xs text-charcoal-400">
                  {ticket.verification_photos.length} photo{ticket.verification_photos.length === 1 ? '' : 's'} recorded
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ticket.verification_photos.map((p, idx) => (
                  <div key={p.id || idx} className="rounded-xl border border-ivory-200 bg-ivory-50/60 p-2.5 overflow-hidden">
                    <div className="flex items-center justify-between text-xs mb-2 px-1">
                      <span className={`font-bold uppercase tracking-wider text-[10px] px-2.5 py-0.5 rounded-full ${
                        p.photo_type === 'after'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-charcoal-200 text-charcoal-800'
                      }`}>
                        {p.photo_type === 'after' ? 'After Resolution' : 'Before Work'}
                      </span>
                      {p.created_at && (
                        <span className="text-charcoal-400 font-mono text-[11px]">
                          {new Date(p.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {p.photo_url ? (
                      <img
                        src={p.photo_url}
                        alt={`${p.photo_type} proof`}
                        className="w-full h-48 object-cover rounded-lg border border-ivory-300 shadow-inner"
                      />
                    ) : (
                      <div className="w-full h-36 bg-ivory-200/50 rounded-lg flex items-center justify-center text-charcoal-400 text-xs">
                        Proof photo recorded
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Citizen Action — 3-Option Feedback: YES / PARTIALLY / NO */}
          {ticket.status === 'RESOLVED_PENDING_CITIZEN' && (
            <div className="bg-gradient-to-br from-emerald-50/90 via-white to-ivory-100 rounded-2xl border border-emerald-300 shadow-card p-6 animate-slide-up">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🎉</span>
                <div>
                  <h3 className="font-bold text-charcoal-900 text-base">Issue Marked as Resolved</h3>
                  <p className="text-xs text-emerald-700 font-medium">Was this issue actually resolved to your satisfaction?</p>
                </div>
              </div>
              <p className="text-xs text-charcoal-600 mb-4 leading-relaxed">
                The municipal field officer has submitted photographic proof of work. Please review the photo evidence above and submit your confirmation.
              </p>

              {/* Feedback comment input */}
              <div className="mb-4">
                <label className="text-[11px] font-bold text-charcoal-600 uppercase tracking-wide block mb-1">
                  Citizen Feedback Comment (Optional)
                </label>
                <textarea
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  placeholder="Share details on the repair quality (e.g. 'Pothole filled smoothly' or 'Debris left behind on sidewalk')..."
                  rows={2}
                  className="w-full bg-white border border-ivory-300 rounded-xl p-3 text-xs text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:border-civic-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleCitizenResponse('YES')}
                  disabled={responding}
                  className="btn-primary py-2.5 text-xs shadow-sm flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  {responding ? 'Submitting...' : 'YES — Fully Resolved'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCitizenResponse('PARTIALLY')}
                  disabled={responding}
                  className="btn-secondary py-2.5 text-xs flex items-center justify-center gap-1.5 border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100"
                >
                  <Clock className="w-4 h-4 text-amber-700" />
                  {responding ? 'Submitting...' : 'PARTIALLY Resolved'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCitizenResponse('NO')}
                  disabled={responding}
                  className="btn-danger py-2.5 text-xs flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  {responding ? 'Submitting...' : 'NO — Not Fixed (Reopen)'}
                </button>
              </div>
            </div>
          )}

          {/* Reopened Notification */}
          {ticket.status === 'REOPENED' && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-6 shadow-card animate-slide-up">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h3 className="font-bold text-amber-950 text-base">Issue Reopened</h3>
                  <p className="text-xs text-amber-800 font-semibold">Priority Supervisory Review Active</p>
                </div>
              </div>
              <p className="text-sm text-amber-900/80 leading-relaxed">
                You indicated that this issue was not adequately fixed. It has been escalated to municipal supervisors, given elevated priority, and will be reassigned for inspection and re-work.
              </p>
            </div>
          )}

          {/* Fully Resolved Notification */}
          {ticket.status === 'RESOLVED' && (
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-6 shadow-card animate-slide-up">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="font-bold text-emerald-950 text-base">Ticket Successfully Closed</h3>
                  <p className="text-xs text-emerald-800 font-medium">Resolution Verified</p>
                </div>
              </div>
              <p className="text-sm text-emerald-900/80 leading-relaxed">
                This grievance has been confirmed resolved and officially closed. Thank you for helping keep your city clean and functioning!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Your Submitted Tickets */}
      {!ticket && localRecentTickets.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-civic-500" />
            <h2 className="text-sm font-bold text-charcoal-900 uppercase tracking-wider">
              Your Recently Submitted Tickets
            </h2>
          </div>
          <div className="space-y-2.5">
            {localRecentTickets.map((t) => (
              <div
                key={t.id}
                onClick={() => { setSearchId(t.id); searchTicket(t.id); }}
                className="bg-civic-50/50 hover:bg-civic-50 border border-civic-200 rounded-xl p-4 transition-all cursor-pointer flex items-center justify-between shadow-sm group"
              >
                <div className="flex items-center gap-3">
                  <UrgencyBadge urgency={t.urgency} size="sm" />
                  <div>
                    <span className="text-sm font-semibold text-charcoal-900 block">{t.category}</span>
                    <span className="text-xs text-charcoal-500 line-clamp-1 max-w-[320px]">{t.description || t.address_text}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-civic-700 font-semibold group-hover:translate-x-0.5 transition-transform">
                  Track Status <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Tickets */}
      {!ticket && (
        <div>
          <h2 className="text-sm font-bold text-charcoal-700 uppercase tracking-wider mb-4">Recent City Complaints</h2>
          {recentLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-civic-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {(recentTickets || []).slice(0, 10).map((t) => (
                <div
                  key={t.id}
                  onClick={() => { setSearchId(t.id); searchTicket(t.id); }}
                  className="bg-white rounded-xl border border-ivory-300 shadow-card hover:shadow-card-hover transition-all cursor-pointer p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <UrgencyBadge urgency={t.urgency} />
                      <span className="text-sm font-semibold text-charcoal-900">{t.category}</span>
                    </div>
                    <span className="text-xs text-charcoal-400 font-mono">ID: {t.id?.slice(0, 8)}...</span>
                  </div>
                </div>
              ))}
              {(!recentTickets || recentTickets.length === 0) && (
                <p className="text-center text-charcoal-400 py-8 text-sm">No tickets yet. Be the first to report an issue!</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
