import React from 'react'
import { Clock, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react'

/**
 * SlaBadge — Real-time Municipal SLA & Escalation indicator.
 * Displays:
 *  🟢 Within SLA: Target, elapsed, and remaining hours.
 *  🟡 Near Deadline: < 25% or < 4 hours remaining.
 *  🔴 SLA Breached: Overdue and escalated to Department Supervisor / HOD.
 */
export default function SlaBadge({
  ticket,
  size = 'md',
  showProgressBar = false,
  className = '',
}) {
  if (!ticket) return null

  const status = ticket.status || 'OPEN'
  const isResolved = ['RESOLVED', 'CLOSED', 'RESOLVED_PENDING_CITIZEN'].includes(status)
  
  // Calculate or read SLA properties
  const targetHours = ticket.sla_target_hours || (
    ticket.urgency === 'CRITICAL' ? 12 :
    ticket.urgency === 'HIGH' ? 24 :
    ticket.urgency === 'LOW' ? 72 : 48
  )
  
  let elapsed = ticket.sla_elapsed_hours
  if (elapsed === undefined || elapsed === null) {
    if (ticket.created_at) {
      elapsed = Math.max(0, (Date.now() - new Date(ticket.created_at).getTime()) / 3600000)
    } else {
      elapsed = 0
    }
  }

  const remaining = Math.max(0, targetHours - elapsed)
  const isBreached = elapsed > targetHours
  const isNearDeadline = !isBreached && (remaining <= 4 || (elapsed / targetHours) >= 0.75)
  const isEscalated = ticket.is_escalated || (isBreached && !isResolved) || ticket.needs_admin_review
  const escalationLevel = ticket.escalation_level || (elapsed >= targetHours * 1.5 ? 'LEVEL_2_HOD' : 'LEVEL_1_SUPERVISOR')
  const progressPercent = Math.min(100, Math.round((elapsed / targetHours) * 100))

  const isSmall = size === 'sm'

  if (isResolved) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 ${className}`}>
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        Resolved within SLA ({Math.round(elapsed)}h)
      </span>
    )
  }

  if (isBreached) {
    const overdueHrs = Math.round(elapsed - targetHours)
    return (
      <div className={`inline-flex flex-col gap-1 ${className}`}>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border animate-pulse ${
          isSmall ? 'text-[10px]' : 'text-xs'
        } bg-coral-50 text-coral-800 border-coral-300`}>
          <ShieldAlert className="w-3.5 h-3.5 text-coral-600" />
          <span>🔴 SLA Breached (+{overdueHrs}h overdue)</span>
          {isEscalated && (
            <span className="ml-1 px-1.5 py-0.2 bg-coral-200 text-coral-900 rounded text-[9px] uppercase tracking-wider font-extrabold">
              {escalationLevel === 'LEVEL_2_HOD' ? 'Escalated to HOD' : 'Escalated to Supervisor'}
            </span>
          )}
        </span>
        {showProgressBar && (
          <div className="w-full bg-ivory-200 h-1.5 rounded-full overflow-hidden mt-0.5">
            <div className="bg-coral-600 h-full w-full" />
          </div>
        )}
      </div>
    )
  }

  if (isNearDeadline) {
    return (
      <div className={`inline-flex flex-col gap-1 ${className}`}>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold border ${
          isSmall ? 'text-[10px]' : 'text-xs'
        } bg-amber-50 text-amber-900 border-amber-300`}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
          <span>🟡 Near Deadline ({remaining.toFixed(1)}h left of {targetHours}h)</span>
        </span>
        {showProgressBar && (
          <div className="w-full bg-ivory-200 h-1.5 rounded-full overflow-hidden mt-0.5">
            <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>
    )
  }

  // Within SLA
  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium border ${
        isSmall ? 'text-[10px]' : 'text-xs'
      } bg-emerald-50 text-emerald-800 border-emerald-200`}>
        <Clock className="w-3.5 h-3.5 text-emerald-600" />
        <span>🟢 Within SLA ({remaining.toFixed(1)}h left / {targetHours}h SLA)</span>
      </span>
      {showProgressBar && (
        <div className="w-full bg-ivory-200 h-1.5 rounded-full overflow-hidden mt-0.5">
          <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
      )}
    </div>
  )
}
