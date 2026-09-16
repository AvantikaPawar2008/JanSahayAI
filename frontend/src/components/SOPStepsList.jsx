import { CheckCircle2, Circle, Wrench } from 'lucide-react'

/**
 * SOPStepsList — numbered SOP steps with checkboxes.
 * Props: steps (string[]), completedSteps (number[]), onToggle(index), tools (string[])
 */
export default function SOPStepsList({ steps = [], completedSteps = [], onToggle, tools = [] }) {
  return (
    <div className="space-y-4">
      {/* SOP Steps */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wide">Standard Operating Procedure</h4>
        <div className="space-y-1.5">
          {steps.map((step, i) => {
            const isCompleted = completedSteps.includes(i)
            return (
              <div
                key={i}
                onClick={() => onToggle?.(i)}
                className={`
                  flex items-start gap-3 p-3 rounded-xl border transition-all duration-200 cursor-pointer
                  ${isCompleted
                    ? 'bg-emerald-500/10 border-emerald-500/20'
                    : 'bg-white/5 border-white/10 hover:border-civic-500/30 hover:bg-white/8'
                  }
                `}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Circle className="w-5 h-5 text-white/30" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-xs text-white/30 font-medium">Step {i + 1}</span>
                  <p className={`text-sm ${isCompleted ? 'text-emerald-300 line-through opacity-70' : 'text-white/80'}`}>
                    {step}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tools Required */}
      {tools.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wide flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Tools Required
          </h4>
          <div className="flex flex-wrap gap-2">
            {tools.map((tool, i) => (
              <span
                key={i}
                className="px-3 py-1.5 rounded-lg bg-civic-600/20 border border-civic-500/20 text-xs text-civic-300"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
