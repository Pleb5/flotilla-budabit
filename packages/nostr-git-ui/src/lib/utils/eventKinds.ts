/**
 * Event Kind Utilities
 * Utility functions for detecting and categorizing Nostr event kinds
 */

// Git-related event kinds that we have dedicated components for
export const KNOWN_GIT_EVENT_KINDS = [
  30617, // Git repository announcement
  30618, // Git repository state
  1621, // Git issue
  1623, // Git permalink
  1630, // Issue status change
  1631, // Merged/resolved status change
  1632, // Repository status change
  1633, // General status change
] as const;

// Other known event kinds that might be handled elsewhere
export const OTHER_KNOWN_EVENT_KINDS = [
  0, // Metadata
  1, // Text note
  3, // Contacts
  4, // Encrypted direct message
  5, // Event deletion
  6, // Repost
  7, // Reaction
  40, // Channel creation
  41, // Channel metadata
  42, // Channel message
  43, // Channel hide message
  44, // Channel mute user
  1984, // Reporting
  9734, // Zap request
  9735, // Zap
  10000, // Mute list
  10001, // Pin list
  10002, // Relay list metadata
  30000, // Categorized people list
  30001, // Categorized bookmark list
  30023, // Long-form content
] as const;

export const ALL_KNOWN_EVENT_KINDS = [
  ...KNOWN_GIT_EVENT_KINDS,
  ...OTHER_KNOWN_EVENT_KINDS,
] as const;

/**
 * Check if an event kind is a known git-related event that we have components for
 */
export function isKnownEventKind(kind: number): boolean {
  return KNOWN_GIT_EVENT_KINDS.includes(kind as any);
}

/**
 * Check if an event kind is known but doesn't have a dedicated component
 * (falls back to Template class rendering)
 */
export function isKnownUnknown(kind: number): boolean {
  return OTHER_KNOWN_EVENT_KINDS.includes(kind as any);
}

/**
 * Check if an event kind is completely unknown
 */
export function isUnknownEventKind(kind: number): boolean {
  return !ALL_KNOWN_EVENT_KINDS.includes(kind as any);
}

/**
 * Get a human-readable description of an event kind
 */
export function getEventKindDescription(kind: number): string {
  switch (kind) {
    case 0:
      return "Profile Metadata";
    case 1:
      return "Text Note";
    case 3:
      return "Contact List";
    case 4:
      return "Encrypted Direct Message";
    case 5:
      return "Event Deletion";
    case 6:
      return "Repost";
    case 7:
      return "Reaction";
    case 40:
      return "Channel Creation";
    case 41:
      return "Channel Metadata";
    case 42:
      return "Channel Message";
    case 43:
      return "Channel Hide Message";
    case 44:
      return "Channel Mute User";
    case 1621:
      return "Git Issue";
    case 1623:
      return "Git Permalink";
    case 1630:
      return "Issue Status Change";
    case 1631:
      return "Merged/Resolved Status Change";
    case 1632:
      return "Repository Status Change";
    case 1633:
      return "General Status Change";
    case 1984:
      return "Reporting";
    case 9734:
      return "Zap Request";
    case 9735:
      return "Zap";
    case 10000:
      return "Mute List";
    case 10001:
      return "Pin List";
    case 10002:
      return "Relay List Metadata";
    case 30000:
      return "Categorized People List";
    case 30001:
      return "Categorized Bookmark List";
    case 30023:
      return "Long-form Content";
    case 30617:
      return "Git Repository";
    case 30618:
      return "Git Repository State";
    default:
      return `Unknown Event Kind ${kind}`;
  }
}

/**
 * Type guard for known git event kinds
 */
export function isGitEventKind(kind: number): kind is (typeof KNOWN_GIT_EVENT_KINDS)[number] {
  return isKnownEventKind(kind);
}
