interface LoadPageBranchParams {
  selectedBranch?: string;
  storedBranch?: string;
  mainBranch?: string;
}

const isNonEmptyBranch = (value?: string) => typeof value === "string" && value.trim().length > 0;

export function resolveLoadPageBranch({
  selectedBranch,
  storedBranch,
  mainBranch,
}: LoadPageBranchParams): string | undefined {
  if (isNonEmptyBranch(selectedBranch)) return selectedBranch;
  if (isNonEmptyBranch(storedBranch)) return storedBranch;
  if (isNonEmptyBranch(mainBranch)) return mainBranch;
  return undefined;
}
