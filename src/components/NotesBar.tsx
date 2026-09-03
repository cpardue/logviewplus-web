import { useEffect, useRef } from 'react'
import { useLogStore } from '../store/logStore'
import { jumpToRow } from '../lib/gridJump'

/**
 * Pinned rows with notes. Add one by right-clicking a grid row ("Add note…");
 * each entry shows its file:line location plus an editable note. Every change
 * auto-saves to IndexedDB and pins are restored at startup — a pin follows
 * its row across tabs and the merged view (exact file + lineNo identity).
 */
export default function NotesBar() {
  const highlights = useLogStore(s => s.highlights)
  const setHighlightNote = useLogStore(s => s.setHighlightNote)
  const unpinRow = useLogStore(s => s.unpinRow)
  const prevIds = useRef<string[]>([])

  // Start typing right away: focus the note field of a freshly added pin.
  useEffect(() => {
    const prev = prevIds.current
    const ids = highlights.map(h => h.id)
    prevIds.current = ids
    const added = ids.find(id => !prev.includes(id))
    if (added === undefined) return
    document.querySelector<HTMLTextAreaElement>(`[data-testid="note-text-${added}"]`)?.focus()
  }, [highlights])

  return (
    <div className="notesbar">
      {highlights.length === 0 ? (
        <span className="rules-hint" data-testid="notes-empty">
          No notes — right-click a grid row to pin one
        </span>
      ) : (
        highlights.map(h => (
          <div key={h.id} className="note" data-testid={`note-${h.id}`}>
            <span className="note-loc" title={`${h.file}:${h.lineNo}`}>
              {h.file}:{h.lineNo}
            </span>
            <textarea
              className="note-input"
              data-testid={`note-text-${h.id}`}
              placeholder="note…"
              rows={1}
              value={h.note}
              onChange={e => setHighlightNote(h.id, e.target.value)}
            />
            <button
              className="btn note-btn"
              data-testid={`note-go-${h.id}`}
              title="Jump to row"
              onClick={() => jumpToRow(h.file, h.lineNo)}
            >
              →
            </button>
            <button
              className="btn note-btn"
              data-testid={`note-delete-${h.id}`}
              title="Remove note"
              onClick={() => unpinRow(h.id)}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  )
}