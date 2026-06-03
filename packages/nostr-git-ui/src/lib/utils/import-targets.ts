import { parseRepoUrl, type RepoMetadata } from "@nostr-git/core";

interface ExistingTargetRepoMatchParams {
  provider: "github" | "gitlab" | "gitea" | "bitbucket" | "grasp";
  requestedOwner: string;
  requestedRepo: string;
  existingRepo: RepoMetadata;
}

export interface ExistingTargetRepoConflict {
  reason: "pending_deletion" | "path_mismatch";
  message: string;
}

function normalizePathSegment(value: string | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function getProviderLabel(provider: ExistingTargetRepoMatchParams["provider"]): string {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  if (provider === "gitea") return "Gitea";
  if (provider === "bitbucket") return "Bitbucket";
  return "GRASP";
}

function parseRepoPathCandidate(value: string | undefined): { owner: string; repo: string } | null {
  if (!value) return null;

  try {
    const parsed = parseRepoUrl(value);
    return { owner: parsed.owner, repo: parsed.repo };
  } catch {
    return null;
  }
}

export function findExistingTargetRepoConflict({
  provider,
  requestedOwner,
  requestedRepo,
  existingRepo,
}: ExistingTargetRepoMatchParams): ExistingTargetRepoConflict | null {
  const expectedOwner = normalizePathSegment(requestedOwner);
  const expectedRepo = normalizePathSegment(requestedRepo);
  const candidates = [
    existingRepo.fullName && existingRepo.fullName.includes("/")
      ? (() => {
          const [owner, repo] = existingRepo.fullName.split("/", 2);
          return { owner, repo };
        })()
      : null,
    existingRepo.owner?.login && existingRepo.name
      ? { owner: existingRepo.owner.login, repo: existingRepo.name }
      : null,
    parseRepoPathCandidate(existingRepo.cloneUrl),
    parseRepoPathCandidate(existingRepo.htmlUrl),
  ].filter((value): value is { owner: string; repo: string } => Boolean(value));

  const exactMatch = candidates.some((candidate) => {
    return (
      normalizePathSegment(candidate.owner) === expectedOwner &&
      normalizePathSegment(candidate.repo) === expectedRepo
    );
  });

  if (exactMatch) return null;

  const summary = [
    existingRepo.fullName,
    existingRepo.name,
    existingRepo.cloneUrl,
    existingRepo.htmlUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (provider === "gitlab" && summary.includes("deletion_scheduled")) {
    return {
      reason: "pending_deletion",
      message:
        "GitLab has a project with this name pending deletion. Wait for deletion to finish or choose a different destination name.",
    };
  }

  const resolvedPath = candidates[0]
    ? `${candidates[0].owner}/${candidates[0].repo}`
    : existingRepo.fullName || existingRepo.name;

  return {
    reason: "path_mismatch",
    message: `${getProviderLabel(provider)} resolved this target name to ${resolvedPath}. Review the destination name or remove the conflicting repository first.`,
  };
}
