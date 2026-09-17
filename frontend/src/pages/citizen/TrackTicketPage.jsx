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
      // Refresh ticket
      await searchTicket(ticket.id)
    } catch (err) {
      console.error('Response failed:', err)
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

          {/* Citizen Action — Verify or Reopen */}
          {ticket.status === 'RESOLVED_PENDING_CITIZEN' && (
            <div className="bg-gradient-to-br from-emerald-50/80 via-white to-ivory-100 rounded-2xl border border-emerald-200 shadow-card p-6 animate-slide-up">
              <h3 className="font-bold text-charcoal-900 text-base mb-2">🎉 Issue marked as resolved by field team</h3>
              <p className="text-sm text-charcoal-600 mb-5 leading-relaxed">
                The municipal field officer has completed work on this issue. Please verify whether the resolution meets standards on site.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleCitizenResponse('verified')}
                  disabled={responding}
                  className="btn-primary flex-1 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  {responding ? 'Processing...' : 'Looks Good — Close Ticket'}
                </button>
                <button
                  onClick={() => handleCitizenResponse('reopen')}
                  disabled={responding}
                  className="btn-danger flex-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  {responding ? 'Processing...' : 'Not Fixed — Reopen Issue'}
                </button>
              </div>
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
