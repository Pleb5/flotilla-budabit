/**
 * NIP-32 Label Event Fixtures
 * Kind 1985: Labels for assignees, reviewers, and categorization
 */

import {
  TEST_PUBKEYS,
  BASE_TIMESTAMP,
  getRepoAddress,
  type UnsignedEvent,
} from './repo';
import { TEST_EVENT_IDS } from './patch';
import { TEST_ISSUE_IDS } from './issue';

/**
 * Label kind constant (NIP-32)
 */
export const LABEL_KIND = 1985;

/**
 * Common label namespaces used in git workflows
 */
export const LABEL_NAMESPACES = {
  /** User-generated content (default) */
  UGC: 'ugc',
  /** Git-related labels */
  GIT: 'git',
  /** Review status labels */
  REVIEW: 'review',
  /** Priority labels */
  PRIORITY: 'priority',
  /** Status labels */
  STATUS: 'status',
  /** Type labels */
  TYPE: 'type',
  /** Role-based labels (assignee, reviewer) */
  ROLE: 'role',
} as const;

/**
 * Target specification for label events
 */
export interface LabelTargets {
  /** Event IDs (e tags) */
  events?: string[];
  /** Addressable event coordinates (a tags) */
  addresses?: string[];
  /** Pubkeys (p tags) */
  pubkeys?: string[];
  /** URLs/references (r tags) */
  references?: string[];
  /** Hashtags (t tags) */
  hashtags?: string[];
}

/**
 * Label definition
 */
export interface LabelDefinition {
  /** Label namespace (L tag) */
  namespace?: string;
  /** Label value (l tag) */
  value: string;
}

/**
 * Options for creating a Label event (kind 1985)
 */
export interface LabelOptions {
  /** Labels to apply */
  labels: LabelDefinition[];
  /** Targets for the labels */
  targets: LabelTargets;
  /** Optional content/description */
  content?: string;
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Label event (kind 1985)
 *
 * NIP-32 specifies label events for categorizing Nostr events.
 * Tags:
 * - L: Label namespace
 * - l: Label value (with optional namespace marker)
 * - e/a/p/r/t: Target references
 */
export function createLabel(opts: LabelOptions): UnsignedEvent {
  const tags: string[][] = [];

  // Collect unique namespaces
  const namespaces = new Set<string>();
  for (const label of opts.labels) {
    if (label.namespace) {
      namespaces.add(label.namespace);
    }
  }

  // Add namespace declarations (L tags)
  for (const ns of namespaces) {
    tags.push(['L', ns]);
  }

  // Add label values (l tags)
  for (const label of opts.labels) {
    if (label.namespace) {
      tags.push(['l', label.value, label.namespace]);
    } else {
      tags.push(['l', label.value]);
    }
  }

  // Add targets
  if (opts.targets.events) {
    for (const e of opts.targets.events) {
      tags.push(['e', e]);
    }
  }

  if (opts.targets.addresses) {
    for (const a of opts.targets.addresses) {
      tags.push(['a', a]);
    }
  }

  if (opts.targets.pubkeys) {
    for (const p of opts.targets.pubkeys) {
      tags.push(['p', p]);
    }
  }

  if (opts.targets.references) {
    for (const r of opts.targets.references) {
      tags.push(['r', r]);
    }
  }

  if (opts.targets.hashtags) {
    for (const t of opts.targets.hashtags) {
      tags.push(['t', t]);
    }
  }

  return {
    kind: LABEL_KIND,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content ?? '',
    pubkey: opts.pubkey ?? TEST_PUBKEYS.alice,
  };
}

/**
 * Creates an assignee label (role:assignee)
 */
export function createAssigneeLabel(
  targetEventId: string,
  assigneePubkey: string,
  opts?: Partial<Omit<LabelOptions, 'labels' | 'targets'>>
): UnsignedEvent {
  return createLabel({
    labels: [
      { namespace: LABEL_NAMESPACES.ROLE, value: 'assignee' },
    ],
    targets: {
      events: [targetEventId],
      pubkeys: [assigneePubkey],
    },
    ...opts,
  });
}

/**
 * Creates a reviewer label (role:reviewer)
 */
export function createReviewerLabel(
  targetEventId: string,
  reviewerPubkey: string,
  opts?: Partial<Omit<LabelOptions, 'labels' | 'targets'>>
): UnsignedEvent {
  return createLabel({
    labels: [
      { namespace: LABEL_NAMESPACES.ROLE, value: 'reviewer' },
    ],
    targets: {
      events: [targetEventId],
      pubkeys: [reviewerPubkey],
    },
    ...opts,
  });
}

/**
 * Creates a review status label (approved, changes-requested, etc.)
 */
export function createReviewStatusLabel(
  targetEventId: string,
  status: 'approved' | 'changes-requested' | 'commented' | 'pending',
  opts?: Partial<Omit<LabelOptions, 'labels' | 'targets'>>
): UnsignedEvent {
  return createLabel({
    labels: [
      { namespace: LABEL_NAMESPACES.REVIEW, value: status },
    ],
    targets: {
      events: [targetEventId],
    },
    ...opts,
  });
}

/**
 * Creates a priority label
 */
export function createPriorityLabel(
  targetEventId: string,
  priority: 'critical' | 'high' | 'medium' | 'low',
  opts?: Partial<Omit<LabelOptions, 'labels' | 'targets'>>
): UnsignedEvent {
  return createLabel({
    labels: [
      { namespace: LABEL_NAMESPACES.PRIORITY, value: priority },
    ],
    targets: {
      events: [targetEventId],
    },
    ...opts,
  });
}

/**
 * Creates a type label (bug, feature, docs, etc.)
 */
export function createTypeLabel(
  targetEventId: string,
  type: 'bug' | 'feature' | 'enhancement' | 'documentation' | 'question' | 'security',
  opts?: Partial<Omit<LabelOptions, 'labels' | 'targets'>>
): UnsignedEvent {
  return createLabel({
    labels: [
      { namespace: LABEL_NAMESPACES.TYPE, value: type },
    ],
    targets: {
      events: [targetEventId],
    },
    ...opts,
  });
}

// ============================================================================
// Pre-built Fixtures
// ============================================================================

const FLOTILLA_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit');

/**
 * Assignee label for an issue
 */
export const ISSUE_ASSIGNEE_LABEL = createAssigneeLabel(
  TEST_ISSUE_IDS.issue1,
  TEST_PUBKEYS.bob,
  {
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP,
  }
);

/**
 * Multiple assignees for an issue
 */
export const ISSUE_MULTI_ASSIGNEE_LABEL = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.ROLE, value: 'assignee' },
  ],
  targets: {
    events: [TEST_ISSUE_IDS.bugReport],
    pubkeys: [TEST_PUBKEYS.bob, TEST_PUBKEYS.charlie],
  },
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
});

/**
 * Reviewer label for a PR
 */
export const PR_REVIEWER_LABEL = createReviewerLabel(
  TEST_EVENT_IDS.pr1,
  TEST_PUBKEYS.maintainer,
  {
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP,
  }
);

/**
 * Multiple reviewers for a PR
 */
export const PR_MULTI_REVIEWER_LABEL = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.ROLE, value: 'reviewer' },
  ],
  targets: {
    events: [TEST_EVENT_IDS.pr1],
    pubkeys: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  },
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
});

/**
 * PR approved by reviewer
 */
export const PR_APPROVED_LABEL = createReviewStatusLabel(
  TEST_EVENT_IDS.pr1,
  'approved',
  {
    content: 'LGTM! Great work.',
    pubkey: TEST_PUBKEYS.maintainer,
    created_at: BASE_TIMESTAMP + 43200,
  }
);

/**
 * PR needs changes
 */
export const PR_CHANGES_REQUESTED_LABEL = createReviewStatusLabel(
  TEST_EVENT_IDS.pr2,
  'changes-requested',
  {
    content: 'Please address the comments before merging.',
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP + 21600,
  }
);

/**
 * Critical priority issue
 */
export const CRITICAL_PRIORITY_LABEL = createPriorityLabel(
  TEST_ISSUE_IDS.bugReport,
  'critical',
  {
    pubkey: TEST_PUBKEYS.maintainer,
    created_at: BASE_TIMESTAMP,
  }
);

/**
 * Bug type label
 */
export const BUG_TYPE_LABEL = createTypeLabel(
  TEST_ISSUE_IDS.bugReport,
  'bug',
  {
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP,
  }
);

/**
 * Feature type label
 */
export const FEATURE_TYPE_LABEL = createTypeLabel(
  TEST_ISSUE_IDS.featureRequest,
  'feature',
  {
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP,
  }
);

/**
 * Security issue label
 */
export const SECURITY_LABEL = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.TYPE, value: 'security' },
    { namespace: LABEL_NAMESPACES.PRIORITY, value: 'critical' },
  ],
  targets: {
    events: [TEST_ISSUE_IDS.issue3],
  },
  pubkey: TEST_PUBKEYS.maintainer,
  created_at: BASE_TIMESTAMP,
});

/**
 * Repository-wide label (applied to repo address)
 */
export const REPO_LABEL = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.STATUS, value: 'active' },
    { value: 'svelte' },
    { value: 'nostr' },
    { value: 'typescript' },
  ],
  targets: {
    addresses: [FLOTILLA_REPO_ADDRESS],
  },
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
});

/**
 * Combined label with multiple namespaces
 */
export const COMBINED_LABELS = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.TYPE, value: 'bug' },
    { namespace: LABEL_NAMESPACES.PRIORITY, value: 'high' },
    { namespace: LABEL_NAMESPACES.STATUS, value: 'in-progress' },
    { namespace: LABEL_NAMESPACES.ROLE, value: 'assignee' },
  ],
  targets: {
    events: [TEST_ISSUE_IDS.bugReport],
    pubkeys: [TEST_PUBKEYS.bob],
  },
  content: 'Triaged and assigned',
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 3600,
});

/**
 * Minimal label (no namespace)
 */
export const MINIMAL_LABEL = createLabel({
  labels: [
    { value: 'needs-review' },
  ],
  targets: {
    events: [TEST_EVENT_IDS.pr1],
  },
});

/**
 * Label targeting multiple events
 */
export const BATCH_LABEL = createLabel({
  labels: [
    { namespace: LABEL_NAMESPACES.STATUS, value: 'stale' },
  ],
  targets: {
    events: [
      TEST_ISSUE_IDS.issue1,
      TEST_ISSUE_IDS.issue2,
      TEST_ISSUE_IDS.issue3,
    ],
  },
  content: 'Marking as stale due to inactivity',
  pubkey: TEST_PUBKEYS.maintainer,
  created_at: BASE_TIMESTAMP + 2592000, // 30 days later
});

// Re-export for convenience
export { TEST_PUBKEYS, BASE_TIMESTAMP, getRepoAddress };
export { TEST_EVENT_IDS } from './patch';
export { TEST_ISSUE_IDS } from './issue';
