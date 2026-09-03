import { useLogStore } from '../store/logStore'
import { LEVELS, type LogLevel } from '../parsers/types'
import { makeRule, RULE_COLORS, type Rule } from '../lib/rules'

/**
 * Row-coloring rules: text/level/file conditions (AND) → row background.
 * List order = priority (first match wins). The working set is auto-saved to
 * IndexedDB on every change and restored at startup.
 */
export default function RulesBar() {
  const rules = useLogStore(s => s.rules)
  const setRules = useLogStore(s => s.setRules)

  function update(id: string, patch: Partial<Rule>) {
    setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  function add() {
    // Cycle the palette so successive rules are distinguishable by default.
    setRules([...rules, makeRule(RULE_COLORS[rules.length % RULE_COLORS.length])])
  }

  function remove(id: string) {
    setRules(rules.filter(r => r.id !== id))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    setRules(next)
  }

  return (
    <div className="rulesbar">
      <button className="btn" data-testid="rules-add" onClick={add}>
        Add rule
      </button>
      {rules.length === 0 && (
        <span className="rules-hint" data-testid="rules-empty">
          No rules — add one to color matching rows (first match wins)
        </span>
      )}
      {rules.map((r, i) => (
        <div key={r.id} className="rule" data-testid={`rule-row-${r.id}`}>
          <input
            type="color"
            className="rule-color"
            data-testid={`rule-color-${r.id}`}
            value={r.color}
            title="Row color"
            onChange={e => update(r.id, { color: e.target.value })}
          />
          <input
            className="rule-input rule-text"
            data-testid={`rule-text-${r.id}`}
            placeholder="text…"
            value={r.text}
            onChange={e => update(r.id, { text: e.target.value })}
          />
          <select
            className="rule-select"
            data-testid={`rule-level-${r.id}`}
            title="Level (empty = any)"
            value={r.levels[0] ?? ''}
            onChange={e =>
              update(r.id, { levels: e.target.value === '' ? [] : [e.target.value as LogLevel] })
            }
          >
            <option value="">Any level</option>
            {LEVELS.map(l => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="rule-input rule-file"
            data-testid={`rule-file-${r.id}`}
            placeholder="file…"
            value={r.file}
            onChange={e => update(r.id, { file: e.target.value })}
          />
          <button
            className="btn rule-btn"
            data-testid={`rule-up-${r.id}`}
            disabled={i === 0}
            title="Higher priority"
            onClick={() => move(i, -1)}
          >
            ↑
          </button>
          <button
            className="btn rule-btn"
            data-testid={`rule-down-${r.id}`}
            disabled={i === rules.length - 1}
            title="Lower priority"
            onClick={() => move(i, 1)}
          >
            ↓
          </button>
          <button
            className="btn rule-btn"
            data-testid={`rule-delete-${r.id}`}
            title="Delete rule"
            onClick={() => remove(r.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
