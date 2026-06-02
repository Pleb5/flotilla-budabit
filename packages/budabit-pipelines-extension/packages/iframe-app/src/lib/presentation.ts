// date-fns' formatDistanceToNow was dropped — it jumps straight from
// "days" to "about N months" with no week bucket, which reads oddly for
// CI runs in that 1-8 week range.
import { TriangleAlert, Check, Circle, Clock, RotateCw, X } from '@lucide/svelte'
import type { LoomWorker, RepoContextNormalized, WorkflowStatus, RerunDraft } from './types'

interface StatusVisualOpts {
  /**
   * True when failure was inferred from a loom result event without an
   * authoritative workflow log event. Renderers should signal this softer
   * "loom-only failure" with a warning glyph instead of a hard X.
   */
  inferred?: boolean
}

export function getStatusIcon(status: WorkflowStatus, opts: StatusVisualOpts = {}) {
  switch (status) {
    case 'success':
      return Check
    case 'failure':
      return opts.inferred ? TriangleAlert : X
    case 'running':
    case 'in_progress':
      return RotateCw
    case 'queued':
    case 'pending':
      return Clock
    case 'cancelled':
    case 'skipped':
    case 'unknown':
    default:
      return Circle
  }
}

export function getStatusColor(status: WorkflowStatus, _opts: StatusVisualOpts = {}) {
  switch (status) {
    case 'success':
      return 'text-green-400'
    case 'failure':
      return 'text-red-400'
    case 'running':
    case 'in_progress':
      return 'text-yellow-400'
    case 'queued':
      return 'text-sky-400'
    case 'pending':
      return 'text-zinc-400'
    default:
      return 'text-zinc-400'
  }
}

export function getStatusBadge(status: WorkflowStatus, _opts: StatusVisualOpts = {}) {
  switch (status) {
    case 'success':
      return 'border-green-500/20 bg-green-500/10 text-green-300'
    case 'failure':
      return 'border-red-500/20 bg-red-500/10 text-red-300'
    case 'running':
    case 'in_progress':
      return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
    case 'queued':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-300'
    case 'pending':
      return 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300'
    default:
      return 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300'
  }
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return plural(minutes, 'minute')

  const hours = Math.round(minutes / 60)
  if (hours < 24) return plural(hours, 'hour')

  const days = Math.round(hours / 24)
  if (days < 7) return plural(days, 'day')
  if (days < 28) return plural(Math.floor(days / 7), 'week')

  const months = Math.floor(days / 30)
  if (months < 12) return plural(Math.max(1, months), 'month')

  const years = Math.floor(days / 365)
  return plural(years, 'year')
}

/** Exact wall-clock time with minute precision (no seconds), for tooltips. */
export function formatExactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(seconds?: number) {
  if (!seconds) return '—'
  if (seconds < 60) return `${seconds}s`

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export function shortId(value?: string, size = 8) {
  return value ? value.slice(0, size) : '—'
}

export function repoName(value: RepoContextNormalized | null) {
  return value?.repoName || 'Loading repository…'
}

export function buildAutoTokenCandidateKey(args: {
  draft: RerunDraft | null
  selectedWorker: LoomWorker | null
  selectedMint: string
  canGenerateSuggestedToken: boolean
  rerunPaymentToken: string
  submissionMode: 'new' | 'rerun' | null
  paymentAmount: number
}) {
  const {
    draft,
    selectedWorker,
    selectedMint,
    canGenerateSuggestedToken,
    rerunPaymentToken,
    submissionMode,
    paymentAmount,
  } = args

  if (!draft || !selectedWorker || !selectedMint || !canGenerateSuggestedToken || rerunPaymentToken.trim()) {
    return ''
  }

  return [
    submissionMode || 'draft',
    selectedWorker.pubkey,
    selectedMint,
    paymentAmount,
    draft.workflowPath,
    draft.branch,
    draft.commit,
  ].join(':')
}
