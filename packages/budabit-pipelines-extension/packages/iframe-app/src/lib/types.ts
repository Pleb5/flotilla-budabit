import type { WidgetBridge } from 'budabit-sdk';

export interface RepoContext {
  contextId?: string;
  userPubkey?: string;
  relays?: string[];
  repo?: {
    repoPubkey: string;
    repoName: string;
    repoAddress?: string;
    repoRelays: string[];
    maintainers?: string[];
  };
}

export interface RepoContextNormalized {
  contextId?: string;
  userPubkey?: string;
  repoPubkey: string;
  repoName: string;
  repoAddress?: string;
  repoRelays: string[];
  maintainers?: string[];
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export type WorkflowStatus =
  | 'success'
  | 'failure'
  | 'running'
  | 'queued'
  | 'in_progress'
  | 'cancelled'
  | 'pending'
  | 'skipped'
  | 'unknown';

export interface WorkflowRun {
  id: string;
  name: string;
  workflowPath?: string;
  status: WorkflowStatus;
  /**
   * True when the failure status was inferred from the loom result event
   * (worker-reported) without an authoritative workflow log event. Renderers
   * should signal "the workflow itself never confirmed failure" — e.g. a
   * warning glyph instead of a hard red X.
   */
  inferredFailure?: boolean;
  branch: string;
  commit: string;
  commitMessage: string;
  actor: string;
  event: string;
  createdAt: number;
  updatedAt: number;
  duration?: number;
  workerPubkey?: string;
  workerName?: string;
  runEvent?: NostrEvent;
  workflowLogEvent?: NostrEvent;
  loomJobEvent?: NostrEvent;
  loomStatusEvent?: NostrEvent;
  loomResultEvent?: NostrEvent;
}

export interface LoomWorker {
  pubkey: string;
  name: string;
  description: string;
  architecture?: string;
  actVersion?: string;
  pricing?: {
    baseFee?: number;
    perSecondRate?: number;
    unit?: string;
  };
  mints: string[];
  minDuration?: number;
  maxDuration?: number;
  maxConcurrentJobs?: number;
  currentQueueDepth?: number;
  /**
   * Address of the worker's advertised NIP-51 freelist event
   * (naddr / nevent / kind:pubkey[:d_tag]), when the operator opted into
   * publishing it (`freelist_event` tag / content field on the kind:10100 ad).
   */
  freelistEventAddress?: string;
  /**
   * Max runtime (seconds) the worker allows for free jobs — the
   * `freelist_timeout` tag on its kind:10100 ad, present when the operator
   * enabled the freelist. Free jobs carry no payment, so this caps them.
   */
  freelistTimeout?: number;
  /**
   * True when the current user's pubkey is on this worker's freelist — runs
   * execute without payment. Resolved live from the freelist event.
   */
  freeForUser?: boolean;
  online: boolean;
  lastSeen: number;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  worker?: LoomWorker | null;
}

export interface WorkflowDefinition {
  name: string;
  path: string;
  content: string;
}

export interface RepoBranchInfo {
  name: string;
  commitId?: string;
}

export type ReclaimStatus =
  | 'idle'
  | 'pending'
  | 'redeemed'
  | 'rateLimited'
  | 'failed'
  | 'p2pkUnsupported';

export interface ReclaimUiState {
  kind: 'change' | 'original';
  status: ReclaimStatus;
  amount?: number;
  error?: string;
  /** Unix ms when a rate-limit cooldown lifts. */
  rateLimitUntil?: number;
}

export interface RerunDraft {
  repoAddress: string;
  workflowPath: string;
  branch: string;
  commit: string;
  workerPubkey: string;
  command: string;
  args: string[];
  envVars: Array<{ key: string; value: string }>;
  repoNostrUrl: string;
  publishRelays: string[];
}

export type BridgeLike = WidgetBridge;
