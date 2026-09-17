import { MapPin, Clock, Users, ChevronRight, AlertTriangle } from 'lucide-react'
import UrgencyBadge from './UrgencyBadge'
import PriorityBreakdown from './PriorityBreakdown'

/**
 * TicketCard — clean civic-tech card with urgency badge, location in words, and metadata.
 * Props: ticket (object), onClick, showPriority
 */
export default function TicketCard({ ticket, onClick, showPriority = false }) {
  const statusLabels = {
    OPEN: 'Open',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In Progress',
    RESOLVED_PENDING_CITIZEN: 'Pending Verification',
    RESOLVED: 'Resolved',
    REOPENED: 'Reopened',
    CLOSED: 'Closed',
  }

  const statusClass = {
    OPEN: 'status-open',
    ASSIGNED: 'status-assigned',
    IN_PROGRESS: 'status-in_progress',
    RESOLVED_PENDING_CITIZEN: 'status-resolved',
    RESOLVED: 'status-resolved',
    REOPENED: 'status-reopened',
    CLOSED: 'status-resolved',
  }

  const deptBadgeStyles = {
    'Water Supply & Sewerage': 'bg-muted-blue-50 text-muted-blue-700 border-muted-blue-200',
    'Roads & Infrastructure': 'bg-amber-50 text-amber-700 border-amber-200',
    'Solid Waste Management': 'bg-sage-50 text-sage-800 border-sage-200',
    'Electrical & Streetlighting': 'bg-yellow-50 text-yellow-800 border-yellow-200',
    'Health & Sanitation': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  }

  const timeAgo = (dateStr) => {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const hasPriorityBreakdown =
    ticket.priority_sla_component !== undefined ||
    ticket.priority_urgency_component !== undefined ||
    ticket.priority_score !== undefined

  return (
    <div
      onClick={onClick}
      className="glass-card cursor-pointer group hover:scale-[1.005] hover:border-civic-300 transition-all duration-200 animate-fade-in"
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: Category + Description */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <UrgencyBadge urgency={ticket.urgency} />
            <span className={`badge ${statusClass[ticket.status] || 'status-open'}`}>
              {statusLabels[ticket.status] || ticket.status}
            </span>
            {ticket.department && (
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border ${deptBadgeStyles[ticket.department] || 'bg-ivory-200 text-charcoal-600 border-ivory-300'}`}>
                {ticket.department}
              </span>
            )}
            {/* Prominent citizen-report-count badge — key signal that duplicates were merged */}
            {ticket.upvote_count > 1 && (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Users className="w-3 h-3 text-amber-600" />
                {ticket.upvote_count} citizens reported
              </span>
            )}
            {ticket.needs_admin_review && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-coral-50 text-coral-700 border border-coral-200 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-coral-600" /> Needs Review
              </span>
            )}
          </div>

          <h3 className="font-bold text-charcoal-900 text-sm mb-1.5 truncate group-hover:text-civic-700 transition-colors">
            {ticket.category || 'Civic Issue'}
          </h3>

          {/* Prominent Human-Readable Address in Words */}
          <div className="flex items-center gap-1.5 text-xs text-civic-800 font-medium mb-2.5 bg-civic-50 px-2.5 py-1.5 rounded-lg border border-civic-100">
            <MapPin className="w-3.5 h-3.5 text-civic-600 flex-shrink-0" />
            <span className="truncate" title={ticket.address_text || (ticket.lat && ticket.lng ? `${ticket.lat.toFixed(5)}, ${ticket.lng.toFixed(5)}` : 'Location')}>
              {ticket.address_text || (ticket.lat && ticket.lng ? `${ticket.lat.toFixed(4)}, ${ticket.lng.toFixed(4)}` : 'Location Pending')}
            </span>
          </div>

          <p className="text-xs text-charcoal-500 line-clamp-2 mb-3 leading-relaxed">
            {ticket.description || 'No description available'}
          </p>

          {/* Priority Breakdown (if available) */}
          {hasPriorityBreakdown && (
            <div className="mb-3">
              <PriorityBreakdown
                slaComponent={ticket.priority_sla_component}
                urgencyComponent={ticket.priority_urgency_component}
                duplicateComponent={ticket.priority_duplicate_component}
                totalScore={ticket.priority_score}
              />
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-charcoal-400 font-medium">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-charcoal-400" />
              {ticket.lat?.toFixed(4)}, {ticket.lng?.toFixed(4)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-charcoal-400" />
              {timeAgo(ticket.created_at)}
            </span>
          </div>
        </div>

        {/* Right: Arrow */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-1">
          <ChevronRight className="w-4 h-4 text-charcoal-300 group-hover:text-civic-600 transition-colors" />
        </div>
      </div>
    </div>
  )
}
