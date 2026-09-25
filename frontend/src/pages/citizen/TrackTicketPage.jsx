import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Search, Loader2, CheckCircle2, RotateCcw, Clock, MapPin, Users, ArrowLeft } from 'lucide-react'
import UrgencyBadge from '../../components/UrgencyBadge'
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

  const handleCitizenResponse = async (response) => {
    if (!ticket) return
    setResponding(true)

    try {
      const res = await fetch(`${API_BASE}/api/verify/citizen-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_ticket_id: ticket.id,
          response: response,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to submit response')
      }
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
          {/* Status Timeline */}
          <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <UrgencyBadge urgency={ticket.urgency} size="md" />
              <h2 className="text-lg font-bold text-charcoal-900">{ticket.category}</h2>
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
            <div className="grid grid-cols-2 gap-4 text-sm bg-ivory-50/70 p-4 rounded-xl border border-ivory-200">
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Department</span>
                <p className="text-charcoal-900 font-semibold">{ticket.department || 'Pending'}</p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Reports</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-civic-600" /> {ticket.upvote_count} citizen{ticket.upvote_count === 1 ? '' : 's'}
                </p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Created</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-charcoal-500" />
                  {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '-'}
                </p>
              </div>
              <div>
                <span className="text-charcoal-400 text-xs block mb-0.5 font-medium">Location</span>
                <p className="text-charcoal-900 font-semibold flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-civic-600" />
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

          {/* Citizen Action — Verify or Reopen */}
          {ticket.status === 'RESOLVED_PENDING_CITIZEN' && (
            <div className="bg-gradient-to-br from-emerald-50/90 via-white to-ivory-100 rounded-2xl border border-emerald-300 shadow-card p-6 animate-slide-up">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🎉</span>
                <div>
                  <h3 className="font-bold text-charcoal-900 text-base">Issue Marked as Resolved</h3>
                  <p className="text-xs text-emerald-700 font-medium">Action Required: Verify the work on site</p>
                </div>
              </div>
              <p className="text-sm text-charcoal-600 mb-5 leading-relaxed">
                The municipal field officer has submitted photographic proof of work. Please review the photo evidence above and confirm if the issue has been resolved to your satisfaction.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleCitizenResponse('verified')}
                  disabled={responding}
                  className="btn-primary flex-1 shadow-sm py-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  {responding ? 'Submitting...' : 'Looks Good — Close Ticket'}
                </button>
                <button
                  onClick={() => handleCitizenResponse('reopen')}
                  disabled={responding}
                  className="btn-danger flex-1 py-2.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  {responding ? 'Submitting...' : 'Not Fixed — Reopen Issue'}
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
