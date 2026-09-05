import type { FileState } from '../store/logStore'
import { formatBytes, formatCount, formatDuration } from '../lib/format'

export default function Toolbar({ file }: { file: FileState | null }) {
  if (!file) return <div className="toolbar" />
  // Elapsed time is only rendered once parsing has finished (deterministic values).
  const elapsed = file.status === 'ready' && file.finishedAt != null ? file.finishedAt - file.startedAt : null
  return (
    <div className="toolbar">
      <span className="t-name">{file.name}</span>
      {file.tail && <span className="t-tail" data-testid="tail-badge">● tailing</span>}
      {file.encoding && (
        <span className="t-enc" data-testid="file-encoding" title="Encoding used to decode this file">
          {file.encoding}
        </span>
      )}
      <span>{formatBytes(file.size)}</span>
      {file.status === 'parsing' && <span>parsing… {formatCount(file.lines)} lines</span>}
      {file.status === 'ready' && elapsed != null && (
        <span>
          {formatCount(file.entries.length)} entries / {formatCount(file.lines)} lines ·{' '}
          {formatDuration(elapsed)}
        </span>
      )}
      {file.status === 'error' && <span className="t-error">{file.error}</span>}
      {file.status === 'parsing' && (
        <div className="progress" data-testid="progress">
          <div style={{ width: `${Math.round(file.fraction * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
