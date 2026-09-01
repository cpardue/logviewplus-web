import { useEffect, useRef, useState } from 'react'
import { useLogStore } from '../store/logStore'
import { LEVELS } from '../parsers/types'

/** Text filter (250 ms debounce) + level chips. Empty level selection = all levels. */
export default function FilterBar() {
  const filters = useLogStore(s => s.filters)
  const setText = useLogStore(s => s.setText)
  const toggleLevel = useLogStore(s => s.toggleLevel)
  const clearFilters = useLogStore(s => s.clearFilters)
  const [text, setTextLocal] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(text), 250)
    return () => window.clearTimeout(timer.current)
  }, [text, setText])

  const anyFilter = text !== '' || filters.levels.length > 0

  return (
    <div className="filterbar">
      <input
        data-testid="text-filter"
        className="text-input"
        placeholder="Filter text (substring, case-insensitive)…"
        value={text}
        onChange={e => setTextLocal(e.target.value)}
      />
      <div className="chips">
        {LEVELS.map(l => (
          <button
            key={l}
            data-testid={`level-${l}`}
            className={`chip lvl-${l}${filters.levels.includes(l) ? ' on' : ''}`}
            onClick={() => toggleLevel(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <button className="btn" disabled={!anyFilter} onClick={clearFilters}>
        Clear
      </button>
    </div>
  )
}
