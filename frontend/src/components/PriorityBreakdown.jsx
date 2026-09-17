import { Zap, Clock, AlertTriangle, Users } from 'lucide-react'

/**
 * PriorityBreakdown — displays stored sub-scores from master_tickets (SLA / Urgency / Duplicates)
 * plus the total computed priority score in a clean civic SaaS pill.
 */
export default function PriorityBreakdown({
  slaComponent,
  urgencyComponent,
  duplicateComponent,
  totalScore,
  className = '',
}) {
  const sla = typeof slaComponent === 'number' ? slaComponent.toFixed(1) : (slaComponent ? Number(slaComponent).toFixed(1) : '0.0')
  const urgency = typeof urgencyComponent === 'number' ? urgencyComponent.toFixed(1) : (urgencyComponent ? Number(urgencyComponent).toFixed(1) : '0.0')
  const duplicates = typeof duplicateComponent === 'number' ? duplicateComponent.toFixed(1) : (duplicateComponent ? Number(duplicateComponent).toFixed(1) : '0.0')
  const total = typeof totalScore === 'number' ? totalScore.toFixed(1) : (totalScore ? Number(totalScore).toFixed(1) : '0.0')

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg bg-ivory-100 border border-ivory-300 text-xs text-charcoal-600 ${className}`}
      title="Priority = (SLA Elapsed × 0.4) + (Urgency Weight × 0.4) + (Duplicates × 0.2)"
    >
      <span className="flex items-center gap-1" title="SLA Component">
        <Clock className="w-3 h-3 text-muted-blue-500" />
        <span className="text-charcoal-500">SLA:</span>
        <strong className="text-charcoal-800 font-mono">{sla}</strong>
      </span>

      <span className="text-charcoal-300">·</span>

      <span className="flex items-center gap-1" title="Urgency Component">
        <AlertTriangle className="w-3 h-3 text-amber-500" />
        <span className="text-charcoal-500">Urg:</span>
        <strong className="text-charcoal-800 font-mono">{urgency}</strong>
      </span>

      <span className="text-charcoal-300">·</span>

      <span className="flex items-center gap-1" title="Duplicate Reports Component">
        <Users className="w-3 h-3 text-sage-600" />
        <span className="text-charcoal-500">Dup:</span>
        <strong className="text-charcoal-800 font-mono">{duplicates}</strong>
      </span>

      <span className="text-charcoal-300">=</span>

      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-civic-50 border border-civic-200 text-civic-700 font-semibold">
        <Zap className="w-3 h-3 text-civic-600" />
        <span className="font-mono text-xs">{total}</span>
      </span>
    </div>
  )
}
