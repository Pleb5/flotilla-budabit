export interface ImportStep2TargetState {
  id: string;
  status: string;
  provider?: string;
  relayUrl?: string;
}

function relayKey(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^wss?:\/\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

export function getUnbackedGraspRelayUrls(params: {
  repoRelayUrls: string[];
  selectedImportTargetIds: string[];
  importTargets: ImportStep2TargetState[];
}): string[] {
  const selectedTargetIds = new Set(params.selectedImportTargetIds);
  const knownGraspRelays = new Map<string, string>();
  const selectedGraspRelayKeys = new Set<string>();

  for (const target of params.importTargets) {
    if (target.provider !== "grasp" || !target.relayUrl) continue;
    const key = relayKey(target.relayUrl);
    if (!key) continue;
    knownGraspRelays.set(key, target.relayUrl);
    if (target.status === "ready" && selectedTargetIds.has(target.id)) {
      selectedGraspRelayKeys.add(key);
    }
  }

  return Array.from(
    new Set(
      params.repoRelayUrls.filter((relayUrl) => {
        const key = relayKey(relayUrl);
        return knownGraspRelays.has(key) && !selectedGraspRelayKeys.has(key);
      })
    )
  );
}

export function canProceedImportStep2(params: {
  hasRepoMetadata: boolean;
  effectiveRelayCount: number;
  isOwner: boolean;
  selectedImportTargetIds: string[];
  importTargets: ImportStep2TargetState[];
  unbackedGraspRelayCount?: number;
}): boolean {
  const {
    hasRepoMetadata,
    effectiveRelayCount,
    isOwner,
    selectedImportTargetIds,
    importTargets,
    unbackedGraspRelayCount = 0,
  } = params;

  return (
    hasRepoMetadata &&
    effectiveRelayCount > 0 &&
    unbackedGraspRelayCount === 0 &&
    (isOwner ||
      importTargets.some(
        (target) => selectedImportTargetIds.includes(target.id) && target.status === "ready"
      ))
  );
}
