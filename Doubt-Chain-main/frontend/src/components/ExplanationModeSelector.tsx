import { ExplanationMode, ExplanationModeInfo } from '../types/api'

type Props = {
  modes: ExplanationModeInfo[]
  value: ExplanationMode
  onChange: (mode: ExplanationMode) => void
  disabled?: boolean
  compact?: boolean
}

export default function ExplanationModeSelector({ modes, value, onChange, disabled, compact }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="AI explanation mode"
      className={`flex flex-wrap gap-2 ${compact ? '' : 'sm:gap-2.5'}`}
    >
      {modes.map((mode) => {
        const active = mode.id === value
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={mode.description}
            disabled={disabled}
            onClick={() => onChange(mode.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-dc-blue/60 bg-dc-blue/15 text-dc-text'
                : 'border-dc-border text-dc-subtext hover:border-dc-blue/40 hover:text-dc-text'
            }`}
          >
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}
