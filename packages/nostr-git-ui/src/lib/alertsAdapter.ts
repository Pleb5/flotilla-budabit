// @nostr-git/ui: alertsAdapter.ts
// Adapter to route long-lived actionable notifications into the host app's alert system.
// For now, this shims into the local toast store; the app can override wiring later.

import { toast } from "./stores/toast.js";

export type RepoAlertKind = "status-change" | "new-issue" | "new-pr" | "review-request" | "grasp-delay";

export function pushRepoAlert(a: {
  repoKey: string;
  kind: RepoAlertKind;
  title: string;
  body?: string;
  href?: string;
}): void {
  const message = a.body ? `${a.title}: ${a.body}` : a.title;
  toast.push({ message, timeout: 6000 });
}
