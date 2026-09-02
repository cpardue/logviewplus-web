import { useEffect, useRef, useState } from 'react'
import { useLogStore } from '../store/logStore'
import { LEVELS } from '../parsers/types'
import { deleteFilter, listSavedFilters, saveFilter, type SavedFilter } from '../lib/filters-db'

/**
 * Text filter (250 ms debounce) + level chips + saved filter sets (IndexedDB).
 * Empty level selection = all levels.
 */
export default function FilterBar() {
  const filters = useLogStore(s => s.filters)
  const setText = useLogStore(s => s.setText)
  const toggleLevel = useLogStore(s => s.toggleLevel)
  const clearFilters = useLogStore(s => s.clearFilters)
  const setFilters = useLogStore(s => s.setFilters)
  const tzMode = useLogStore(s => s.tzMode)
  const setTzMode = useLogStore(s => s.setTzMode)
  const [text, setTextLocal] = useState('')
  const [saved, setSaved] = useState<SavedFilter[]>([])
  const [selectedName, setSelectedName] = useState('')
  // Last text value pushed to the store; distinguishes our own debounce from
  // external store changes (saved filter applied, cleared) that must update the input.
  const appliedRef = useRef('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setText(text)
      appliedRef.current = text
    }, 250)
    return () => window.clearTimeout(timer.current)
  }, [text, setText])

  useEffect(() => {
    if (filters.text !== appliedRef.current) {
      appliedRef.current = filters.text
      setTextLocal(filters.text)
    }
  }, [filters.text])

  const refresh = () => {
    listSavedFilters().then(setSaved).catch(() => setSaved([]))
  }

  useEffect(refresh, [])

  const anyFilter = text !== '' || filters.levels.length > 0

  async function onSave() {
    const name = window.prompt('Name for this filter set:')?.trim()
    if (!name) return
    try {
      await saveFilter({ name, filters, savedAt: Date.now() })
      setSelectedName(name)
      refresh()
    } catch {
      // DB unavailable — ignore.
    }
  }

  async function onDelete() {
    if (!selectedName) return
    try {
      await deleteFilter(selectedName)
    } finally {
      setSelectedName('')
      refresh()
    }
  }

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
      <select
        data-testid="saved-select"
        value={selectedName}
        onChange={e => {
          const name = e.target.value
          setSelectedName(name)
          const f = saved.find(s => s.name === name)
          if (f) setFilters(f.filters)
        }}
      >
        <option value="">Saved filters…</option>
        {saved.map(s => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn" data-testid="save-filter" disabled={!anyFilter} onClick={() => void onSave()}>
        Save
      </button>
      <button className="btn" data-testid="delete-filter" disabled={!selectedName} onClick={() => void onDelete()}>
        Delete
      </button>
      <label className="tz" title="How timestamps without an explicit timezone are interpreted (applies to files opened after the change)">
        Naive times
        <select
          data-testid="tz-select"
          value={tzMode}
          onChange={e => setTzMode(e.target.value === 'utc' ? 'utc' : 'local')}
        >
          <option value="local">Local</option>
          <option value="utc">UTC</option>
        </select>
      </label>
      <button className="btn" disabled={!anyFilter} onClick={clearFilters}>
        Clear
      </button>
    </div>
  )
}
