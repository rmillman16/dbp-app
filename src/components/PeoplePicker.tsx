import type { Who } from '../lib/rfiContext'

// chips for the people chosen, and a list to add more from (the project directory and DBP's team)
export default function PeoplePicker({ whos, value, onChange, placeholder }: { whos: Who[]; value: string[]; onChange: (keys: string[]) => void; placeholder: string }) {
  const left = whos.filter((w) => !value.includes(w.key))
  return (
    <div className="people-picker">
      <div className="chips">
        {value.map((k) => {
          const w = whos.find((x) => x.key === k)
          return (
            <span key={k} className={'chip person-chip' + (w?.external ? ' ext' : '')} title={w?.email ?? ''}>
              {w?.name ?? 'Someone'}
              <button type="button" aria-label={`Remove ${w?.name ?? ''}`} onClick={() => onChange(value.filter((x) => x !== k))}>
                ✕
              </button>
            </span>
          )
        })}
      </div>
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        aria-label={placeholder}
      >
        <option value="">{value.length ? '+ Add another…' : placeholder}</option>
        {left.some((w) => w.external) && (
          <optgroup label="Project directory (outside DBP)">
            {left.filter((w) => w.external).map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </optgroup>
        )}
        {left.some((w) => !w.external) && (
          <optgroup label="DBP team">
            {left.filter((w) => !w.external).map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}
