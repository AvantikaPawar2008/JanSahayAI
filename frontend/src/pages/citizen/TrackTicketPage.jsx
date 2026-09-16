import { useState, useEffect } from 'react'
import { Search, Loader2, CheckCircle2, RotateCcw, Clock, MapPin, Users } from 'lucide-react'
import UrgencyBadge from '../../components/UrgencyBadge'
import MapView from '../../components/MapView'
import { API_BASE } from '../../supabaseClient'
import useSupabaseRealtime from '../../hooks/useSupabaseRealtime'

/**
 * TrackTicketPage — citizen views their ticket status and can verify/reopen resolutions.
 */
export default function TrackTicketPage() {
  const [searchId, setSearchId] = useState('')
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [responding, setResponding] = useState(false)

  // Also show recent tickets via realtime
  const { data: recentTickets, loading: recentLoading } = useSupabaseRealtime('master_tickets')

  const searchTicket = async (id) => {
    const ticketId = id || searchId
    if (!ticketId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE}/api/tickets/${ticketId}`)
      if (!response.ok) throw new Error('Ticket not found')
      const data = await response.json()
      setTicket(data)
    } catch (err) {
      setError(err.message)
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }

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
      <h1 className="text-3xl font-bold gradient-text mb-2">Track Your Ticket</h1>
      <p className="text-white/50 text-sm mb-8">Enter your ticket ID to see the current status</p>

      {/* Search Bar */}
      <div className="glass-card-static mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchTicket()}
            placeholder="Paste your ticket ID here..."
            className="glass-input flex-1 font-mono text-sm"
          />
          <button
            onClick={() => searchTicket()}
            disabled={loading || !searchId}
            className="btn-primary px-6"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      {/* Ticket Detail */}
      {ticket && (
        <div className="space-y-6 animate-slide-up">
          {/* Status Timeline */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4">
              <UrgencyBadge urgency={ticket.urgency} size="md" />
              <h2 className="text-lg font-semibold text-white/90">{ticket.category}</h2>
            </div>

            <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
              {statusTimeline.map((step, i) => {
                const currentStep = getStepIndex(ticket.status)
                const isActive = i <= currentStep
                const isCurrent = i === currentStep

                return (
                  <div key={step.key} className="flex items-center flex-shrink-0">
                    <div className={`
                      flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all
                      ${isCurrent ? 'bg-civic-600/30 border border-civic-500/30' :
                        isActive ? 'opacity-80' : 'opacity-30'}
                    `}>
                      <span className="text-lg">{step.icon}</span>
                      <span className="text-xs font-medium whitespace-nowrap">{step.label}</span>
                    </div>
                    {i < statusTimeline.length - 1 && (
                      <div className={`w-8 h-0.5 flex-shrink-0 ${isActive ? 'bg-civic-500' : 'bg-white/10'}`} />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Ticket Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-white/40 text-xs">Department</span>
                <p className="text-white/80">{ticket.department || 'Pending'}</p>
              </div>
              <div>
                <span className="text-white/40 text-xs">Reports</span>
                <p className="text-white/80 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> {ticket.upvote_count}
                </p>
              </div>
              <div>
                <span className="text-white/40 text-xs">Created</span>
                <p className="text-white/80 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '-'}
                </p>
              </div>
              <div>
                <span className="text-white/40 text-xs">Location</span>
                <p className="text-white/80 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {ticket.lat?.toFixed(4)}, {ticket.lng?.toFixed(4)}
                </p>
              </div>
            </div>

            {ticket.description && (
              <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-white/40 text-xs">Description</span>
                <p className="text-sm text-white/70 mt-1">{ticket.description}</p>
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
            <div className="glass-card border-emerald-500/20 animate-slide-up">
              <h3 className="font-semibold text-white/90 mb-2">🎉 Issue has been resolved!</h3>
              <p className="text-sm text-white/50 mb-4">
                The field officer has fixed this issue. Please verify the resolution.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleCitizenResponse('verified')}
                  disabled={responding}
                  className="btn-primary flex-1"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {responding ? 'Processing...' : 'Looks Good!'}
                </button>
                <button
                  onClick={() => handleCitizenResponse('reopen')}
                  disabled={responding}
                  className="btn-danger flex-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  {responding ? 'Processing...' : 'Not Fixed — Reopen'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Tickets */}
      {!ticket && (
        <div>
          <h2 className="text-lg font-semibold text-white/70 mb-4">Recent Tickets</h2>
          {recentLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-civic-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {(recentTickets || []).slice(0, 10).map((t) => (
                <div
                  key={t.id}
                  onClick={() => { setSearchId(t.id); searchTicket(t.id); }}
                  className="glass-card cursor-pointer hover:scale-[1.01] transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UrgencyBadge urgency={t.urgency} />
                      <span className="text-sm font-medium text-white/80">{t.category}</span>
                    </div>
                    <span className="text-xs text-white/30 font-mono">{t.id?.slice(0, 8)}...</span>
                  </div>
                </div>
              ))}
              {(!recentTickets || recentTickets.length === 0) && (
                <p className="text-center text-white/30 py-8">No tickets yet. Be the first to report an issue!</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
