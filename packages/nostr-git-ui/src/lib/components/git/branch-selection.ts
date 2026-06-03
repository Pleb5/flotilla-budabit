import { normalizeGitRefName } from "./branch-ref";

type Ref = { name: string; type: "heads" | "tags" };

type ResolvePreferredBranchParams = {
  refs: Ref[];
  persistedBranch?: string;
  headHint?: string;
  mainBranch?: string;
};

const COMMON_DEFAULT_BRANCHES = ["main", "master", "develop", "dev"] as const;

export function resolvePreferredBranchFromRefs({
  refs,
  persistedBranch,
  headHint,
  mainBranch,
}: ResolvePreferredBranchParams): string | undefined {
  const allRefs = refs.filter((ref) => normalizeGitRefName(ref.name));
  const heads = allRefs.filter((ref) => ref.type === "heads");
  const allRefNames = new Set(allRefs.map((ref) => ref.name));
  const headNames = new Set(heads.map((ref) => ref.name));

  const persisted = normalizeGitRefName(persistedBranch || "");
  if (persisted && allRefNames.has(persisted)) return persisted;

  const head = normalizeGitRefName(headHint || "");
  if (head && headNames.has(head)) return head;

  const main = normalizeGitRefName(mainBranch || "");
  if (main && headNames.has(main)) return main;

  const commonDefault = COMMON_DEFAULT_BRANCHES.find((branch) => headNames.has(branch));
  if (commonDefault) return commonDefault;

  return heads[0]?.name || allRefs[0]?.name;
}
