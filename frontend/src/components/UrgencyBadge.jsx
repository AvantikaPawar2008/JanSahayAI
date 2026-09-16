/**
 * UrgencyBadge — color-coded urgency pill (LOW→green, CRITICAL→red with pulse).
 * Props: urgency (string), size ('sm' | 'md')
 */
export default function UrgencyBadge({ urgency, size = 'sm' }) {
  const urgencyConfig = {
    LOW: { class: 'urgency-low', label: 'Low', dot: 'bg-emerald-400' },
    MEDIUM: { class: 'urgency-medium', label: 'Medium', dot: 'bg-amber-400' },
    HIGH: { class: 'urgency-high', label: 'High', dot: 'bg-orange-400' },
    CRITICAL: { class: 'urgency-critical', label: 'Critical', dot: 'bg-red-400' },
  }

  const config = urgencyConfig[urgency] || urgencyConfig.MEDIUM

  return (
    <span
      className={`
        badge ${config.class}
        ${size === 'md' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs'}
        inline-flex items-center gap-1.5
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${urgency === 'CRITICAL' ? 'animate-ping' : ''}`} />
      {config.label}
    </span>
  )
}
