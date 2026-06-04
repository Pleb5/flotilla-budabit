export interface ImportStep2TargetState {
  id: string;
  status: string;
}

export function canProceedImportStep2(params: {
  hasRepoMetadata: boolean;
  effectiveRelayCount: number;
  isOwner: boolean;
  selectedImportTargetIds: string[];
  importTargets: ImportStep2TargetState[];
}): boolean {
  const { hasRepoMetadata, effectiveRelayCount, isOwner, selectedImportTargetIds, importTargets } =
    params;

  return (
    hasRepoMetadata &&
    effectiveRelayCount > 0 &&
    (isOwner ||
      importTargets.some(
        (target) => selectedImportTargetIds.includes(target.id) && target.status === "ready"
      ))
  );
}
