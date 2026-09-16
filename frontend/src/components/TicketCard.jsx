import { MapPin, Clock, Users, ChevronRight, AlertTriangle } from 'lucide-react'
import UrgencyBadge from './UrgencyBadge'
import PriorityBreakdown from './PriorityBreakdown'

/**
 * TicketCard — compact ticket summary with urgency badge, location, and metadata.
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
    'Water Supply & Sewerage': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    'Roads & Infrastructure': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    'Solid Waste Management': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    'Electrical & Streetlighting': 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    'Health & Sanitation': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
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
      className="glass-card cursor-pointer group hover:scale-[1.01] transition-all duration-200 animate-fade-in"
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
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border ${deptBadgeStyles[ticket.department] || 'bg-white/10 text-white/70 border-white/20'}`}>
                {ticket.department}
              </span>
            )}
            {/* Prominent citizen-report-count badge — key signal that duplicates were merged */}
            {ticket.upvote_count > 1 && (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Users className="w-3 h-3" />
                {ticket.upvote_count} citizens reported
              </span>
            )}
            {ticket.needs_admin_review && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-red-400" /> Needs Review
              </span>
            )}
          </div>

          <h3 className="font-semibold text-white/90 text-sm mb-1 truncate">
            {ticket.category || 'Civic Issue'}
          </h3>

          <p className="text-xs text-white/50 line-clamp-2 mb-3">
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
          <div className="flex items-center gap-4 text-xs text-white/40">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {ticket.lat?.toFixed(4)}, {ticket.lng?.toFixed(4)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(ticket.created_at)}
            </span>
          </div>
        </div>

        {/* Right: Arrow */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-1">
          <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-civic-400 transition-colors" />
        </div>
      </div>
    </div>
  )
}
