import { Zap, Clock, AlertTriangle, Users } from 'lucide-react'

/**
 * PriorityBreakdown — displays stored sub-scores from master_tickets (SLA / Urgency / Duplicates)
 * plus the total computed priority score.
 * Example: "SLA: 3.2 · Urgency: 4.0 · Duplicates: 1.2 = 8.4"
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
      className={`inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-800/90 border border-civic-500/20 text-xs shadow-sm ${className}`}
      title="Priority = (SLA Elapsed × 0.4) + (Urgency Weight × 0.4) + (Duplicates × 0.2)"
    >
      <span className="flex items-center gap-1 text-white/50" title="SLA Component">
        <Clock className="w-3 h-3 text-blue-400" />
        <span>SLA: <strong className="text-white/80 font-mono">{sla}</strong></span>
      </span>

      <span className="text-white/20">·</span>

      <span className="flex items-center gap-1 text-white/50" title="Urgency Component">
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        <span>Urgency: <strong className="text-white/80 font-mono">{urgency}</strong></span>
      </span>

      <span className="text-white/20">·</span>

      <span className="flex items-center gap-1 text-white/50" title="Duplicate Reports Component">
        <Users className="w-3 h-3 text-purple-400" />
        <span>Duplicates: <strong className="text-white/80 font-mono">{duplicates}</strong></span>
      </span>

      <span className="text-white/30 font-semibold">=</span>

      <span className="flex items-center gap-1 font-semibold text-civic-300">
        <Zap className="w-3 h-3 text-civic-400" />
        <span className="font-mono text-xs">{total}</span>
      </span>
    </div>
  )
}
