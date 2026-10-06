import { useEffect, useState } from 'react'

export type BlankFieldHandler = (fieldId: string, label: string, blank: boolean) => void

interface Props {
  fieldId: string
  label: string
  value: number
  unit: string
  step?: number
  min?: number
  max?: number
  readOnly?: boolean
  resetKey?: number
  onChange: (value: number) => void
  onBlankChange?: BlankFieldHandler
}

export function blankFieldWarning(labels: string[], action: string): string {
  if (labels.length === 1) return `${labels[0]} is blank. Enter a value before ${action}.`
  const joined = labels.length === 2
    ? `${labels[0]} and ${labels[1]}`
    : `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
  return `${joined} are blank. Enter values before ${action}.`
}

export function NumericInput({ fieldId, label, value, unit, step = 1, min, max, readOnly = false, resetKey = 0, onChange, onBlankChange }: Props) {
  const [draft, setDraft] = useState(() => String(value))
  const blank = draft.trim() === ''

  useEffect(() => {
    setDraft(String(value))
    onBlankChange?.(fieldId, label, false)
  }, [fieldId, label, onBlankChange, resetKey, value])

  useEffect(() => () => onBlankChange?.(fieldId, label, false), [fieldId, label, onBlankChange])

  return (
    <label className={`number-field ${!readOnly && blank ? 'invalid' : ''}`}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          readOnly={readOnly}
          required={!readOnly}
          aria-invalid={!readOnly && blank}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            const nextBlank = next.trim() === ''
            onBlankChange?.(fieldId, label, nextBlank)
            if (nextBlank) return
            const parsed = Number(next)
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
        />
        <em>{unit}</em>
      </div>
    </label>
  )
}
