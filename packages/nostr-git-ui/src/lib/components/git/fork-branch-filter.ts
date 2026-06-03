export interface BranchCopyFilterConfig {
  branchNames: string[];
  label: string;
  description?: string;
  tooltip?: string;
  minBranchCount?: number;
  status?: "idle" | "loading" | "ready" | "error";
}

export type BranchCopyFilterMode = "hidden" | "loading" | "toggle" | "empty" | "all";

export interface BranchCopyFilterState {
  mode: BranchCopyFilterMode;
  threshold: number;
  totalBranches: number;
  availableBranchNames: string[];
  maintainerBranchNames: string[];
}

export const DEFAULT_BRANCH_COPY_FILTER_TOOLTIP =
  "Maintainer branches are branches targeted by merged pull requests applied by repo maintainers. When none are found, Budabit includes all branches in the fork.";

export function getUniqueBranchNames(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function deriveBranchCopyFilterState(params: {
  branchNames: string[];
  branchCopyFilter?: BranchCopyFilterConfig;
}): BranchCopyFilterState {
  const { branchNames, branchCopyFilter } = params;
  const availableBranchNames = getUniqueBranchNames(branchNames);
  const totalBranches = availableBranchNames.length;
  const threshold = Math.max(0, branchCopyFilter?.minBranchCount ?? 20);

  if (!branchCopyFilter || totalBranches <= threshold) {
    return {
      mode: "hidden",
      threshold,
      totalBranches,
      availableBranchNames,
      maintainerBranchNames: [],
    };
  }

  if ((branchCopyFilter.status || "ready") !== "ready") {
    return {
      mode: "loading",
      threshold,
      totalBranches,
      availableBranchNames,
      maintainerBranchNames: [],
    };
  }

  const availableBranchSet = new Set(availableBranchNames);
  const maintainerBranchNames = getUniqueBranchNames(branchCopyFilter.branchNames || []).filter(
    (branchName) => availableBranchSet.has(branchName)
  );

  return {
    mode:
      maintainerBranchNames.length === 0
        ? "empty"
        : maintainerBranchNames.length < totalBranches
          ? "toggle"
          : "all",
    threshold,
    totalBranches,
    availableBranchNames,
    maintainerBranchNames,
  };
}
