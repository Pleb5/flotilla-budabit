import type { ForkProgress } from "../../hooks/useForkRepo.svelte";

export const FORK_PROGRESS_PHASES = ["validate", "user", "fork", "events", "publish"] as const;

export type ForkProgressPhaseId = (typeof FORK_PROGRESS_PHASES)[number] | "rollback";
export type ForkProgressPhaseStatus = "completed" | "active" | "pending" | "error";

export interface ForkProgressPhase {
  id: ForkProgressPhaseId;
  label: string;
  status: ForkProgressPhaseStatus;
  detail?: string;
  steps: ForkProgress[];
}

export const FORK_PROGRESS_PHASE_LABELS: Record<ForkProgressPhaseId, string> = {
  validate: "Validate access",
  user: "Resolve destination",
  fork: "Prepare fork",
  events: "Create Nostr events",
  publish: "Publish and sync",
  rollback: "Rollback",
};

export function getForkProgressPhaseId(step: string): ForkProgressPhaseId {
  if (step === "validate") return "validate";
  if (step === "user") return "user";
  if (step === "events") return "events";
  if (step === "rollback") return "rollback";

  if (
    step === "publish" ||
    step === "publish-announcement" ||
    step === "preflight" ||
    step === "push" ||
    step === "publish-final-state"
  ) {
    return "publish";
  }

  if (step === "fork" || step.startsWith("clone-source-url-")) {
    return "fork";
  }

  return "fork";
}

export function deriveForkProgressPhases(progress: ForkProgress[] = []): ForkProgressPhase[] {
  const grouped = new Map<ForkProgressPhaseId, ForkProgress[]>();

  for (const item of progress) {
    const phaseId = getForkProgressPhaseId(item.step);
    grouped.set(phaseId, [...(grouped.get(phaseId) || []), item]);
  }

  const ids: ForkProgressPhaseId[] = [...FORK_PROGRESS_PHASES];
  if (grouped.has("rollback")) ids.push("rollback");

  return ids.map((id) => {
    const steps = grouped.get(id) || [];
    const lastStep = steps[steps.length - 1];
    const hasError = steps.some((step) => step.status === "error");
    const hasRunning = steps.some((step) => step.status === "running");
    const hasCompleted = steps.length > 0 && steps.every((step) => step.status === "completed");

    const status: ForkProgressPhaseStatus = hasError
      ? "error"
      : hasRunning
        ? "active"
        : hasCompleted
          ? "completed"
          : "pending";

    return {
      id,
      label: FORK_PROGRESS_PHASE_LABELS[id],
      status,
      detail: lastStep?.message,
      steps,
    };
  });
}
