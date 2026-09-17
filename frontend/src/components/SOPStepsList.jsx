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
        <h4 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider">Standard Operating Procedure</h4>
        <div className="space-y-2">
          {steps.map((step, i) => {
            const isCompleted = completedSteps.includes(i)
            return (
              <div
                key={i}
                onClick={() => onToggle?.(i)}
                className={`
                  flex items-start gap-3 p-3.5 rounded-xl border transition-all duration-200 cursor-pointer
                  ${isCompleted
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-white border-ivory-300 hover:border-civic-400 hover:bg-ivory-50 shadow-sm'
                  }
                `}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <Circle className="w-5 h-5 text-charcoal-300" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-[11px] text-charcoal-400 font-semibold uppercase tracking-wider block mb-0.5">Step {i + 1}</span>
                  <p className={`text-sm leading-relaxed ${isCompleted ? 'text-emerald-800 line-through opacity-70' : 'text-charcoal-800 font-medium'}`}>
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
        <div className="space-y-2 pt-1">
          <h4 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-civic-600" /> Equipment &amp; Tools Required
          </h4>
          <div className="flex flex-wrap gap-2">
            {tools.map((tool, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-lg bg-civic-50 border border-civic-200 text-xs font-medium text-civic-800"
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
