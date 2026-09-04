import { useLogStore } from '../store/logStore'
import { LEVELS, type LogLevel } from '../parsers/types'
import type { WebhookConfig } from '../lib/webhook'

/**
 * Webhook notifications (M4 checkpoint F): while a URL is set, every LIVE
 * entry appended to a ready file that matches the conditions (AND — text on
 * message OR raw, level, file name) is POSTed as a small JSON batch to the
 * URL (coalesced ≤ 1 s, ≤ 50 entries per POST). The config auto-saves to
 * IndexedDB and is restored at startup; "Send test" fires a one-off probe.
 */
export default function WebhookBar() {
  const webhook = useLogStore(s => s.webhook)
  const webhookStatus = useLogStore(s => s.webhookStatus)
  const setWebhook = useLogStore(s => s.setWebhook)
  const testWebhook = useLogStore(s => s.testWebhook)

  function update(patch: Partial<WebhookConfig>) {
    setWebhook({ ...webhook, ...patch })
  }

  return (
    <div className="webhookbar">
      <span className="webhook-label">Webhook</span>
      <input
        className="rule-input webhook-url"
        data-testid="webhook-url"
        placeholder="https://endpoint (empty = off)"
        value={webhook.url}
        onChange={e => update({ url: e.target.value })}
      />
      <input
        className="rule-input rule-text"
        data-testid="webhook-text"
        placeholder="text…"
        value={webhook.text}
        onChange={e => update({ text: e.target.value })}
      />
      <select
        className="rule-select"
        data-testid="webhook-level"
        title="Level (empty = any)"
        value={webhook.levels[0] ?? ''}
        onChange={e => update({ levels: e.target.value === '' ? [] : [e.target.value as LogLevel] })}
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
        data-testid="webhook-file"
        placeholder="file…"
        value={webhook.file}
        onChange={e => update({ file: e.target.value })}
      />
      <button
        className="btn rule-btn"
        data-testid="webhook-test"
        disabled={webhook.url.trim() === ''}
        title="POST a one-off test payload to the URL"
        onClick={() => void testWebhook()}
      >
        Send test
      </button>
      {webhookStatus != null && (
        <span className="webhook-status" data-testid="webhook-status">
          {webhookStatus}
        </span>
      )}
    </div>
  )
}