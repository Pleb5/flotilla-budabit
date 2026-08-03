import type {
  RepoAnnouncementEvent,
  RepoCommunityBinding,
  RepoStateEvent,
  NostrEvent,
} from "@nostr-git/core/events";
import { createRepoAnnouncementEvent, createRepoStateEvent } from "@nostr-git/core/events";
import {
  hasMatchingGraspRepoCloneUrl,
  parseGraspRepoHttpUrl,
  parseRepoId,
} from "@nostr-git/core/utils";
import { nip19 } from "nostr-tools";

import type { Token } from "$lib/stores/tokens";
import { tokens as tokensStore } from "$lib/stores/tokens";

import { getFinalRepoMetadataCreatedAt } from "../utils/import-repo-metadata.js";
import {
  applyReconciledGraspResults,
  getRemoteSyncProvisionalEvents,
  guessWebUrl,
  publishRepoSyncAnnouncement,
  syncLocalRepoToTargets,
  type RemoteSyncRef,
  type RepoSyncAnnouncementAdmission,
  type RemoteSyncTargetResult,
} from "../utils/remote-sync.js";
import {
  getProviderBaseUrl,
  normalizeRelayUrl,
  normalizeTokenHostForTarget,
  preflightNewRemoteTargets,
  type RemoteTargetSelection,
} from "../utils/remote-targets.js";
import { matchesHost } from "../utils/tokenMatcher.js";
import {
  getRepoCreationProvisionalEvents,
  RepoCreationTransactionJournal,
  trackRepoCreationPublisher,
} from "../utils/repo-creation-transaction.js";
import {
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  normalizeGraspOrigins,
  reconcileRepoCreationEvents,
  toNpubOrSelf,
  type DeleteRepoEvent,
  type PublishRepoEvent,
} from "../utils/grasp-pipeline.js";
import { getForkRollbackPlan } from "./fork-rollback";
import {
  createGitOperationId,
  createGitOperationProgressObserver,
  type GitOperationActivity,
  type SubscribeGitProgress,
} from "../utils/git-operation-progress.js";
import {
  assertRepoCoordinateAvailable,
  assertRepoCreationPrerequisites,
} from "../utils/repo-creation-preflight.js";
import {
  WorkerOperationSession,
  hasUnknownWorkerOperation,
} from "../utils/worker-operation-session.js";
import {
  buildGraspServiceDescriptors,
  formatUnbackedGraspRelayError,
  getGraspRelayUrlsBackedByCloneUrls,
  getUnbackedKnownGraspRelayUrls,
  graspServiceKey,
  type GraspServiceDescriptor,
} from "../utils/grasp-service-coupling.js";

export interface ForkConfig {
  forkName: string;
  visibility?: "public" | "private";
  targets: RemoteTargetSelection[];
  earliestUniqueCommit?: string;
  tags?: string[];
  maintainers?: string[];
  relays?: string[];
  includeBranches?: string[];
  community?: RepoCommunityBinding | null;
  knownGraspRelayUrls?: string[];
  knownGraspServices?: GraspServiceDescriptor[];
}

export interface ForkProgress {
  step: string;
  message: string;
  status: "pending" | "running" | "completed" | "error";
  error?: string;
}

export interface ForkProgressActivity extends ForkProgress {
  id: number;
}

export interface ForkResult {
  repoId: string;
  forkUrl: string;
  webUrl?: string;
  defaultBranch: string;
  branches: string[];
  tags: string[];
  announcementEvent: RepoAnnouncementEvent;
  stateEvent: RepoStateEvent;
  remotePushResults: RemoteSyncTargetResult[];
}

export type ForkRepositoryResult = ForkResult;

export interface UseForkRepoOptions {
  workerApi?: any;
  workerInstance?: Worker;
  userPubkey?: string;
  onProgress?: (progress: ForkProgress[]) => void;
  onForkCompleted?: (result: ForkResult) => void;
  onPublishEvent?: PublishRepoEvent;
  onDeleteEvent?: DeleteRepoEvent;
  onFetchRelayEvents?: (params: {
    relays: string[];
    filters: import("@nostr-git/core").NostrFilter[];
    timeoutMs?: number;
    throwOnTimeout?: boolean;
  }) => Promise<NostrEvent[]>;
  onRollbackPublishedRepoEvents?: (params: {
    repoName: string;
    relays: string[];
    events?: NostrEvent[];
  }) => Promise<void>;
  subscribeGitProgress?: SubscribeGitProgress;
}

export interface PreparedSourceRefs {
  defaultBranch: string;
  branches: string[];
  tags: string[];
  refs: RemoteSyncRef[];
}

class ForkAbortedError extends Error {
  constructor(message = "Fork cancelled") {
    super(message);
    this.name = "ForkAbortedError";
  }
}

function dedupeCloneUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const url of urls) {
    const trimmed = String(url || "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("nostr://") || trimmed.startsWith("nostr:")) continue;

    try {
      const parsed = new URL(trimmed);
      const isBareOrigin = !parsed.pathname || parsed.pathname === "/";
      const isRelayProtocol = parsed.protocol === "ws:" || parsed.protocol === "wss:";
      if (isBareOrigin || isRelayProtocol) continue;
    } catch {
      // keep non-URL values as-is
    }

    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}

function comparableRemoteUrl(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function getSelectedGraspSourceUrls(params: {
  cloneUrls: string[];
  webUrls: string[];
  targets: RemoteTargetSelection[];
  knownGraspServices?: GraspServiceDescriptor[];
  ownerPubkey: string;
  identifier: string;
}): { cloneUrls: string[]; webUrls: string[] } {
  const matchesSelectedGraspTarget = (url: string, isWebUrl = false) =>
    params.targets.some((target) => {
      if (target.provider !== "grasp" || !target.relayUrl) return false;
      const existingHttpBase = parseGraspRepoHttpUrl(target.existingRemoteUrl || "")?.httpBase;
      const knownService = params.knownGraspServices?.find(
        (service) => graspServiceKey(service.relayUrl) === graspServiceKey(target.relayUrl || "")
      );
      const candidateUrl = isWebUrl ? `${url.replace(/\/+$/, "").replace(/\.git$/i, "")}.git` : url;
      return hasMatchingGraspRepoCloneUrl([candidateUrl], {
        relayUrl: target.relayUrl,
        httpBaseAliases: [
          ...(knownService?.httpBaseAliases || []),
          ...(existingHttpBase ? [existingHttpBase] : []),
        ],
        ownerPubkey: params.ownerPubkey,
        identifier: params.identifier,
      });
    });
  const selectedCloneUrls = params.cloneUrls.filter((cloneUrl) =>
    matchesSelectedGraspTarget(cloneUrl)
  );
  const selectedWebUrlKeys = new Set(
    [
      ...selectedCloneUrls.map((cloneUrl) => guessWebUrl(cloneUrl)),
      ...params.targets
        .filter((target) => target.provider === "grasp")
        .map((target) => target.existingWebUrl),
    ]
      .map(comparableRemoteUrl)
      .filter(Boolean)
  );

  return {
    cloneUrls: selectedCloneUrls,
    webUrls: params.webUrls.filter(
      (webUrl) =>
        matchesSelectedGraspTarget(webUrl, true) ||
        selectedWebUrlKeys.has(comparableRemoteUrl(webUrl))
    ),
  };
}

export function getForkRemoteSyncWarning(results: RemoteSyncTargetResult[]): string | null {
  const failedTargets = results.filter((result) => !result.success);
  if (failedTargets.length === 0) return null;
  return `Synced ${results.length - failedTargets.length}/${results.length} targets. Failed: ${failedTargets
    .map((result) => `${result.label} (${result.error || "sync failed"})`)
    .join("; ")}`;
}

function buildSourceCloneCandidates(...urls: Array<string | undefined>): string[] {
  const candidates: string[] = [];
  const add = (value?: string) => {
    const normalized = String(value || "")
      .trim()
      .replace(/\/+$/, "");
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);

    if (/^https?:\/\//i.test(normalized)) {
      if (!normalized.endsWith(".git")) {
        const withGit = `${normalized}.git`;
        if (!candidates.includes(withGit)) candidates.push(withGit);
      } else {
        const withoutGit = normalized.replace(/\.git$/i, "");
        if (withoutGit && !candidates.includes(withoutGit)) candidates.push(withoutGit);
      }
    }
  };

  for (const url of urls) add(url);
  return candidates;
}

function prioritizeCloneCandidate(candidates: string[], preferredUrl: string): string[] {
  const preferred = String(preferredUrl || "").trim();
  if (!preferred) return candidates;

  return Array.from(new Set([preferred, ...candidates]));
}

function compactCloneUrlLabel(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "unknown URL";

  try {
    const parsed = new URL(raw);
    const compactPath = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.host}${compactPath}`;
  } catch {
    return raw;
  }
}

function pubkeyToHexOrNull(value?: string): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();

  if (raw.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      return null;
    }
  }

  return null;
}

function isSamePubkeyOwner(owner: string, userPubkey?: string): boolean {
  const ownerHex = pubkeyToHexOrNull(owner);
  const userHex = pubkeyToHexOrNull(userPubkey);
  if (!ownerHex || !userHex) return false;
  return ownerHex === userHex;
}

export function isSameLogicalRepoAugmentation(params: {
  sourceAnnouncementEvent?: Pick<NostrEvent, "kind" | "pubkey" | "tags">;
  destinationName: string;
  userPubkey?: string;
}): boolean {
  const sourceEvent = params.sourceAnnouncementEvent;
  const sourceIdentifier = sourceEvent?.tags.find((tag) => tag[0] === "d")?.[1]?.trim() || "";
  return (
    sourceEvent?.kind === 30617 &&
    Boolean(sourceIdentifier) &&
    params.destinationName.trim() === sourceIdentifier &&
    isSamePubkeyOwner(sourceEvent.pubkey, params.userPubkey)
  );
}

function getHostFromUrl(value: string): string {
  try {
    return normalizeTokenHostForTarget(new URL(value).hostname);
  } catch {
    return "";
  }
}

function getSourceTokenForUrl(url: string, tokens: Token[]): string | undefined {
  const sourceHost = getHostFromUrl(url);
  if (!sourceHost) return undefined;

  const match = tokens.find((entry) => {
    const tokenHost = normalizeTokenHostForTarget(entry.host);
    return matchesHost(tokenHost, sourceHost) || matchesHost(sourceHost, tokenHost);
  });

  return match?.token;
}

export function getRollbackRemoteRepoTokens(target: RemoteTargetSelection | undefined): string[] {
  if (!target) return [];
  if (target.provider === "grasp") return [];

  return Array.from(
    new Set([target.token, ...(target.tokens || [])].map((token) => token?.trim()).filter(Boolean))
  ) as string[];
}

export function hasForkLocalRollbackResource(
  localRepoId: string | null,
  stage: RepoCreationTransactionJournal["record"]["localResource"]["stage"] | undefined
): boolean {
  return Boolean(localRepoId && stage && stage !== "planned" && stage !== "cleaned");
}

async function discoverSourceRefs(params: {
  workerApi: any;
  sourceUrlCandidates: string[];
  localRepoId: string;
  fallbackDefaultBranch?: string;
  updateProgress: (message: string) => void;
  throwIfAborted?: () => void;
}): Promise<PreparedSourceRefs> {
  const {
    workerApi,
    sourceUrlCandidates,
    localRepoId,
    fallbackDefaultBranch,
    updateProgress,
    throwIfAborted,
  } = params;

  const branchByName = new Map<string, string | undefined>();
  const tagByName = new Map<string, string | undefined>();
  let defaultBranch = String(fallbackDefaultBranch || "").trim() || "main";

  try {
    const resolvedDefault = await workerApi.resolveBranch?.({ repoId: localRepoId });
    if (resolvedDefault) defaultBranch = String(resolvedDefault || "").trim() || defaultBranch;
  } catch {
    // pass
  }

  for (const sourceUrl of sourceUrlCandidates) {
    throwIfAborted?.();
    try {
      updateProgress(`Discovering refs from ${compactCloneUrlLabel(sourceUrl)}...`);
      const remoteRefs = await workerApi.listServerRefs({ url: sourceUrl, symrefs: true });

      for (const item of remoteRefs || []) {
        const rawRef = String(item?.ref || "").trim();
        const oid = typeof item?.oid === "string" && item.oid.trim() ? item.oid.trim() : undefined;

        if (rawRef === "HEAD") {
          const target = String(item?.target || item?.symrefTarget || "");
          if (target.startsWith("refs/heads/")) {
            defaultBranch = target.replace(/^refs\/heads\//, "") || defaultBranch;
          }
          continue;
        }

        if (rawRef.startsWith("refs/heads/")) {
          const branchName = rawRef.replace(/^refs\/heads\//, "").trim();
          if (!branchName || branchName === "HEAD") continue;
          branchByName.set(branchName, oid || branchByName.get(branchName));
          continue;
        }

        if (rawRef.startsWith("refs/tags/")) {
          const normalizedRef = rawRef.replace(/\^\{\}$/, "");
          const tagName = normalizedRef.replace(/^refs\/tags\//, "").trim();
          if (!tagName) continue;

          const existing = tagByName.get(tagName);
          if (rawRef.endsWith("^{}") || !existing) {
            tagByName.set(tagName, oid || existing);
          }
        }
      }

      if (branchByName.size > 0 || tagByName.size > 0) {
        break;
      }
    } catch {
      // try next source candidate
    }
  }

  if (branchByName.size === 0) {
    try {
      const localBranches = await workerApi.listBranches?.({ repoId: localRepoId });
      for (const branchName of localBranches || []) {
        const trimmed = String(branchName || "").trim();
        if (!trimmed || trimmed === "HEAD") continue;
        branchByName.set(trimmed, branchByName.get(trimmed));
      }
    } catch {
      // pass
    }
  }

  if (tagByName.size === 0) {
    try {
      const localTags = await workerApi.listTags?.({ repoId: localRepoId });
      for (const tagName of localTags || []) {
        const trimmed = String(tagName || "").trim();
        if (!trimmed) continue;
        tagByName.set(trimmed, tagByName.get(trimmed));
      }
    } catch {
      // pass
    }
  }

  const resolveMissingOid = async (ref: string): Promise<string | undefined> => {
    try {
      const resolved = await workerApi.resolveRef?.({ repoId: localRepoId, ref });
      const oid = String(resolved || "").trim();
      return oid || undefined;
    } catch {
      return undefined;
    }
  };

  for (const [branchName, oid] of [...branchByName.entries()]) {
    if (oid) continue;
    branchByName.set(branchName, await resolveMissingOid(`refs/heads/${branchName}`));
  }

  for (const [tagName, oid] of [...tagByName.entries()]) {
    if (oid) continue;
    tagByName.set(tagName, await resolveMissingOid(`refs/tags/${tagName}`));
  }

  const branches = Array.from(branchByName.keys()).filter((name) => name !== "HEAD");
  const tags = Array.from(tagByName.keys());

  if (!branches.includes(defaultBranch)) {
    if (branches.includes("main")) defaultBranch = "main";
    else if (branches.includes("master")) defaultBranch = "master";
    else if (branches.length > 0) defaultBranch = branches[0];
  }

  const refs: RemoteSyncRef[] = [
    ...branches.map((branch) => ({
      type: "heads" as const,
      name: branch,
      ref: `refs/heads/${branch}`,
      commit: branchByName.get(branch),
    })),
    ...tags.map((tag) => ({
      type: "tags" as const,
      name: tag,
      ref: `refs/tags/${tag}`,
      commit: tagByName.get(tag),
    })),
  ];

  if (refs.length === 0) {
    throw new Error("No branches or tags available in the source repository");
  }

  return {
    defaultBranch,
    branches,
    tags,
    refs,
  };
}

export function filterPreparedSourceRefs(params: {
  preparedSource: PreparedSourceRefs;
  includeBranches?: string[];
  preserveDefaultBranch?: boolean;
}): PreparedSourceRefs {
  const { preparedSource, includeBranches, preserveDefaultBranch = true } = params;
  const normalizedBranchNames = Array.from(
    new Set(
      (includeBranches || []).map((branchName) => String(branchName || "").trim()).filter(Boolean)
    )
  );

  if (normalizedBranchNames.length === 0) {
    return preparedSource;
  }

  const allowedBranches = new Set(normalizedBranchNames);
  const defaultBranch = String(preparedSource.defaultBranch || "").trim();
  if (preserveDefaultBranch && defaultBranch) {
    allowedBranches.add(defaultBranch);
  }

  const branches = preparedSource.branches.filter((branchName) =>
    allowedBranches.has(String(branchName || "").trim())
  );
  const refs = preparedSource.refs.filter(
    (ref) => ref.type !== "heads" || allowedBranches.has(String(ref.name || "").trim())
  );

  return {
    ...preparedSource,
    defaultBranch:
      branches.includes(defaultBranch) || branches.length === 0
        ? preparedSource.defaultBranch
        : branches[0],
    branches,
    refs,
  };
}

export function useForkRepo(options: UseForkRepoOptions = {}) {
  let isForking = $state(false);
  let isComplete = $state(false);
  let progress = $state<ForkProgress[]>([]);
  let progressHistory = $state<ForkProgressActivity[]>([]);
  let error = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);
  let operationActivity = $state<GitOperationActivity | undefined>();
  let activeOperationSession: WorkerOperationSession | null = null;
  let progressActivityId = 0;

  let tokens = $state<Token[]>([]);
  tokensStore.subscribe((value: Token[]) => {
    tokens = value;
  });

  const { onProgress, onForkCompleted, onPublishEvent, onRollbackPublishedRepoEvents, userPubkey } =
    options;

  function updateProgress(
    step: string,
    message: string,
    status: "pending" | "running" | "completed" | "error",
    errorMessage?: string
  ) {
    const existingIndex = progress.findIndex((item) => item.step === step);
    const progressItem: ForkProgress = { step, message, status, error: errorMessage };

    if (existingIndex >= 0) {
      progress[existingIndex] = progressItem;
    } else {
      progress.push(progressItem);
    }

    progress = $state.snapshot(progress) as ForkProgress[];
    progressActivityId += 1;
    progressHistory = [...progressHistory, { id: progressActivityId, ...progressItem }];
    onProgress?.($state.snapshot(progress) as ForkProgress[]);
  }

  function getAbortMessage(reason: unknown): string {
    if (typeof reason === "string" && reason.trim()) return reason.trim();
    if (reason instanceof Error && reason.message) return reason.message;
    return "Fork cancelled";
  }

  function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new ForkAbortedError(getAbortMessage(signal.reason));
    }
  }

  async function runAbortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    throwIfAborted(signal);

    let onAbort: (() => void) | null = null;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ForkAbortedError(getAbortMessage(signal.reason)));
      signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      return await Promise.race([operation(), abortPromise]);
    } finally {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async function forkRepository(
    originalRepo: {
      owner: string;
      name: string;
      description?: string;
      cloneUrls?: string[];
      webUrls?: string[];
      sourceAnnouncementEvent?: NostrEvent;
      displayName?: string;
      defaultBranch?: string;
      community?: RepoCommunityBinding;
      earliestUniqueCommit?: string;
    },
    config: ForkConfig
  ): Promise<ForkRepositoryResult | null> {
    if (isForking) {
      throw new Error("Fork operation already in progress");
    }

    isForking = true;
    isComplete = false;
    error = null;
    warning = null;
    progress = [];
    progressHistory = [];
    progressActivityId = 0;

    const sessionAbortController = new AbortController();
    abortController = sessionAbortController;
    const abortSignal = sessionAbortController.signal;
    const operationId = createGitOperationId("fork");
    operationActivity = undefined;
    const onOperationProgress = createGitOperationProgressObserver(
      operationId,
      (activity) => (operationActivity = activity)
    );
    const unsubscribeGitProgress = options.subscribeGitProgress?.(onOperationProgress);

    let gitWorkerApi: any = options.workerApi || null;
    let temporaryWorkerClient: { api: any; terminate?: () => void } | null = null;
    let localRepoId: string | null = null;
    let publishedRepoRollbackContext: { repoName: string; relays: string[] } | null = null;
    let remotePushResults: RemoteSyncTargetResult[] = [];
    let selectedTargets: RemoteTargetSelection[] = [];
    let transactionJournal: RepoCreationTransactionJournal | undefined;
    let transactionPublisher = onPublishEvent;
    let operationSession: WorkerOperationSession | undefined;

    try {
      throwIfAborted(abortSignal);

      if (!userPubkey) {
        throw new Error("Forking requires a user pubkey");
      }

      if (!onPublishEvent) {
        throw new Error("Forking requires an onPublishEvent callback");
      }

      const forkName = String(config.forkName || "").trim();
      if (!forkName) {
        throw new Error("Fork name is required");
      }
      const sameLogicalRepo = isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: originalRepo.sourceAnnouncementEvent,
        destinationName: forkName,
        userPubkey,
      });
      const effectiveCommunity =
        config.community === null
          ? undefined
          : config.community || (sameLogicalRepo ? originalRepo.community : undefined);
      if (sameLogicalRepo && !originalRepo.sourceAnnouncementEvent) {
        throw new Error("Repository augmentation requires the exact source announcement event");
      }
      const repoDescription = sameLogicalRepo
        ? originalRepo.description || ""
        : originalRepo.description || `Fork of ${originalRepo.owner}/${originalRepo.name}`;

      const sourceUrlCandidates = buildSourceCloneCandidates(...(originalRepo.cloneUrls || []));
      if (sourceUrlCandidates.length === 0) {
        throw new Error("No valid source clone URLs available for duplication");
      }

      selectedTargets = (config.targets || []).filter((target) => Boolean(target?.id));
      if (selectedTargets.length === 0) {
        throw new Error("Select at least one writable fork target");
      }

      const selectedGraspRelays = selectedTargets
        .filter((target) => target.provider === "grasp" && target.relayUrl)
        .map((target) => normalizeGraspOrigins(target.relayUrl as string).wsOrigin);
      const knownGraspServices =
        config.knownGraspServices && config.knownGraspServices.length > 0
          ? config.knownGraspServices
          : buildGraspServiceDescriptors(config.knownGraspRelayUrls || [], "selected-target");
      const authoritativeSourceCloneUrls = sameLogicalRepo
        ? originalRepo.sourceAnnouncementEvent?.tags
            .filter((tag) => tag[0] === "clone")
            .flatMap((tag) => tag.slice(1)) || []
        : [];
      const advertisedGraspRelays = sameLogicalRepo
        ? getGraspRelayUrlsBackedByCloneUrls({
            repoRelayUrls: config.relays || [],
            cloneUrls: authoritativeSourceCloneUrls,
            knownServices: knownGraspServices,
            ownerPubkey: userPubkey,
            identifier: forkName,
          })
        : [];
      const unbackedGraspRelays = getUnbackedKnownGraspRelayUrls({
        repoRelayUrls: config.relays || [],
        backedGraspRelayUrls: [...selectedGraspRelays, ...advertisedGraspRelays],
        knownServices: knownGraspServices,
      });
      if (unbackedGraspRelays.length > 0) {
        throw new Error(formatUnbackedGraspRelayError(unbackedGraspRelays));
      }
      const verifiedRelayUrls = assertRepoCreationPrerequisites({
        ownerPubkey: userPubkey,
        repoName: forkName,
        targets: selectedTargets,
        relayUrls: getEffectiveRepoRelayUrls(config.relays || [], selectedGraspRelays),
        onPublishEvent,
        onFetchRelayEvents: options.onFetchRelayEvents,
        onDeleteEvent: options.onDeleteEvent,
        hasRollbackCallback: Boolean(options.onRollbackPublishedRepoEvents),
      });
      if (!sameLogicalRepo) {
        await assertRepoCoordinateAvailable({
          ownerPubkey: userPubkey,
          repoName: forkName,
          relayUrls: verifiedRelayUrls,
          onFetchRelayEvents: options.onFetchRelayEvents!,
        });
      }
      const availableTokens = await tokensStore.waitForInitialization();
      selectedTargets = await preflightNewRemoteTargets({
        targets: selectedTargets,
        tokenList: availableTokens,
        userPubkey,
        repoName: forkName,
        allowExistingRepoReuse: sameLogicalRepo,
        existingRepoMessage: "Destination already exists. A renamed fork requires unused targets.",
      });

      const rollbackRelays = verifiedRelayUrls;
      publishedRepoRollbackContext = {
        repoName: forkName,
        relays: rollbackRelays,
      };

      localRepoId = parseRepoId(`${userPubkey}:fork-${forkName}-${Date.now()}`);
      transactionJournal = new RepoCreationTransactionJournal({
        id: `fork:${userPubkey}:${forkName}:${Date.now()}`,
        operation: "fork",
        ownerPubkey: userPubkey,
        repoName: forkName,
        repositoryRelayUrls: verifiedRelayUrls,
        localRepoId,
        localResource: { ownedByTransaction: true, stage: "planned" },
        sourceMetadata: sameLogicalRepo
          ? {
              cloneUrls: originalRepo.cloneUrls || [],
              webUrls: originalRepo.webUrls || [],
              announcementEvent: originalRepo.sourceAnnouncementEvent,
            }
          : undefined,
      });
      transactionJournal.setTargets(selectedTargets);
      transactionPublisher = trackRepoCreationPublisher(transactionJournal, onPublishEvent);
      let latestRepoMetadataCreatedAt = 0;

      updateProgress("publish", "Publishing repository metadata before source clone...", "running");
      const announcementAdmission: RepoSyncAnnouncementAdmission =
        sameLogicalRepo && selectedGraspRelays.length === 0
          ? {
              announcementEvent: originalRepo.sourceAnnouncementEvent!,
              ackedRelayUrls: [],
              graspRelayUrls: [],
              announcementByGraspRelay: {},
              latestAnnouncementCreatedAt: originalRepo.sourceAnnouncementEvent?.created_at || 0,
            }
          : await publishRepoSyncAnnouncement({
              repoName: forkName,
              repoDescription,
              userPubkey,
              targets: selectedTargets,
              relayUrls: sameLogicalRepo ? selectedGraspRelays : verifiedRelayUrls,
              sourceCloneUrls: sameLogicalRepo ? originalRepo.cloneUrls : undefined,
              sourceWebUrls: sameLogicalRepo ? originalRepo.webUrls : undefined,
              community: effectiveCommunity,
              onPublishEvent: transactionPublisher!,
              onFetchRelayEvents: options.onFetchRelayEvents,
              updateProgress: (message) => updateProgress("publish", message, "running"),
              runAbortable: (operation) => runAbortable(abortSignal, operation),
            });
      for (const [relayUrl, event] of Object.entries(
        announcementAdmission.announcementByGraspRelay
      )) {
        transactionJournal.recordGraspAnnouncementEvidence(relayUrl, event);
      }
      latestRepoMetadataCreatedAt = Math.max(
        latestRepoMetadataCreatedAt,
        announcementAdmission.latestAnnouncementCreatedAt
      );

      updateProgress("validate", "Validating fork configuration...", "running");
      updateProgress(
        "validate",
        `Ready to sync ${selectedTargets.length} target${selectedTargets.length === 1 ? "" : "s"}`,
        "completed"
      );

      if (!gitWorkerApi) {
        const { getGitWorker } = await import("@nostr-git/core/worker");
        temporaryWorkerClient = getGitWorker();
        gitWorkerApi = temporaryWorkerClient.api;
      }
      operationSession = new WorkerOperationSession(gitWorkerApi, operationId, 5000, (status) =>
        transactionJournal?.recordWorkerOperationStatus(status)
      );
      activeOperationSession = operationSession;

      const localCloneDir = `/repos/${localRepoId}`;

      transactionJournal.setLocalResourceStatus("creating");
      updateProgress("fork", "Preparing local duplicate...", "running");

      let clonedFrom = "";
      let cloneFailure = "";
      for (let index = 0; index < sourceUrlCandidates.length; index++) {
        const sourceUrl = sourceUrlCandidates[index];
        const sourceToken = getSourceTokenForUrl(sourceUrl, tokens);
        try {
          updateProgress(
            "fork",
            `Cloning source repository (${index + 1}/${sourceUrlCandidates.length}): ${compactCloneUrlLabel(sourceUrl)}`,
            "running"
          );

          await runAbortable(abortSignal, () =>
            operationSession!.runOperation("cloneRemoteRepo", (childOperationId) =>
              gitWorkerApi.cloneRemoteRepo({
                url: sourceUrl,
                dir: localCloneDir,
                operationId: childOperationId,
                ...(sourceToken ? { token: sourceToken } : {}),
              })
            )
          );

          clonedFrom = sourceUrl;
          transactionJournal.setLocalResourceStatus("created");
          break;
        } catch (cloneError) {
          cloneFailure = cloneError instanceof Error ? cloneError.message : String(cloneError);
          const cloneStatuses = await operationSession.waitForTrackedOperations();
          if (hasUnknownWorkerOperation(cloneStatuses)) {
            transactionJournal.setLocalResourceStatus("unknown", cloneError);
            throw cloneError;
          }
          try {
            const cleanup = await operationSession.runOperation<any>(
              "deleteRepo",
              (childOperationId) =>
                gitWorkerApi.deleteRepo?.({ repoId: localRepoId, operationId: childOperationId })
            );
            const cleanupStatuses = await operationSession.waitForTrackedOperations();
            if (hasUnknownWorkerOperation(cleanupStatuses)) {
              transactionJournal.setLocalResourceStatus(
                "unknown",
                "Local fork mirror reset outcome is unknown"
              );
              throw cloneError;
            }
            if (cleanup?.success === false) {
              throw new Error(cleanup.error || "Failed to reset local fork mirror");
            }
            transactionJournal.setLocalResourceStatus("planned");
            throwIfAborted(abortSignal);
          } catch (cleanupError) {
            transactionJournal.setLocalResourceStatus("cleanup-pending", cleanupError);
            throw cloneError;
          }
        }
      }

      if (!clonedFrom) {
        throw new Error(
          `Failed to clone source repository from ${sourceUrlCandidates.length} candidate URL(s): ${cloneFailure || "unknown error"}`
        );
      }

      const sourceDiscoveryCandidates = prioritizeCloneCandidate(sourceUrlCandidates, clonedFrom);
      const discoveredSource = await discoverSourceRefs({
        workerApi: gitWorkerApi,
        sourceUrlCandidates: sourceDiscoveryCandidates,
        localRepoId,
        fallbackDefaultBranch: originalRepo.defaultBranch,
        updateProgress: (message) => updateProgress("fork", message, "running"),
        throwIfAborted: () => throwIfAborted(abortSignal),
      });
      const preparedSource = filterPreparedSourceRefs({
        preparedSource: discoveredSource,
        includeBranches: sameLogicalRepo ? undefined : config.includeBranches,
      });

      updateProgress(
        "fork",
        `Prepared ${preparedSource.branches.length} branch${preparedSource.branches.length === 1 ? "" : "es"} and ${preparedSource.tags.length} tag${preparedSource.tags.length === 1 ? "" : "s"}`,
        "completed"
      );

      const remoteMaintainers = Array.from(
        new Set((config.maintainers || []).filter((value) => Boolean(value?.trim())))
      );
      remotePushResults = await syncLocalRepoToTargets({
        workerApi: gitWorkerApi,
        localRepoId,
        repoName: forkName,
        repoDescription,
        defaultBranch: preparedSource.defaultBranch,
        refs: preparedSource.refs,
        targets: selectedTargets,
        userPubkey,
        relays: verifiedRelayUrls,
        maintainers: remoteMaintainers.length > 0 ? remoteMaintainers : undefined,
        community: effectiveCommunity,
        onPublishEvent: transactionPublisher!,
        onFetchRelayEvents: options.onFetchRelayEvents,
        updateProgress: (message) => updateProgress("publish", message, "running"),
        runAbortable: (operation, _label, _timeoutMs) => runAbortable(abortSignal, operation),
        throwIfAborted: () => throwIfAborted(abortSignal),
        latestRepoMetadataCreatedAt,
        onLatestRepoMetadataCreatedAt: (value) => {
          latestRepoMetadataCreatedAt = value;
        },
        requireNonGraspSuccessBeforeGrasp: false,
        allowApiBranchFastPath: false,
        graspFirst: true,
        operationId,
        onOperationProgress,
        createWorkerOperationId: (operation) => operationSession!.createOperationId(operation),
        onWorkerOperationStart: (childOperationId, operation) =>
          operationSession!.registerOperation(childOperationId, operation),
        onWorkerOperationSettled: (childOperationId) =>
          operationSession!.unregisterOperation(childOperationId),
        waitForWorkerOperationTerminal: (childOperationId) =>
          operationSession!.waitForOperationTerminal(childOperationId),
        prepublishedAnnouncement: announcementAdmission.announcementEvent,
        prepublishedAnnouncementByGraspRelay: announcementAdmission.announcementByGraspRelay,
        preprovisionedGraspRelayUrls: announcementAdmission.graspRelayUrls,
        onCheckpoint: (checkpoint) => transactionJournal!.recordRemoteSyncCheckpoint(checkpoint),
        onTargetSettled: (targetResult) => transactionJournal!.recordTargetResult(targetResult),
      });
      operationActivity = undefined;
      transactionJournal.setTargetResults(remotePushResults);
      throwIfAborted(abortSignal);
      if (remotePushResults.some((result) => result.outcome === "unknown")) {
        throw new Error("Remote synchronization has an unknown outcome; recovery is required");
      }

      const successfulTargets = remotePushResults.filter((result) => result.success);

      if (successfulTargets.length === 0) {
        const failedSummary = remotePushResults
          .map((result) => `${result.label}: ${result.error || "sync failed"}`)
          .join("; ");
        throw new Error(`Failed to sync all selected fork targets (${failedSummary})`);
      }

      warning = getForkRemoteSyncWarning(remotePushResults);

      updateProgress("publish", "Remote targets synced", "completed");

      updateProgress("events", "Creating final Nostr events...", "running");

      const finalRepoId = `${toNpubOrSelf(userPubkey)}/${forkName}`;

      const successfulRemoteUrls = Array.from(
        new Set(successfulTargets.map((result) => result.remoteUrl).filter(Boolean) as string[])
      );
      const selectedGraspSourceUrls = sameLogicalRepo
        ? getSelectedGraspSourceUrls({
            cloneUrls: originalRepo.cloneUrls || [],
            webUrls: originalRepo.webUrls || [],
            targets: selectedTargets,
            knownGraspServices,
            ownerPubkey: userPubkey,
            identifier: forkName,
          })
        : { cloneUrls: [], webUrls: [] };
      const selectedGraspSourceCloneUrlKeys = new Set(
        selectedGraspSourceUrls.cloneUrls.map(comparableRemoteUrl)
      );
      const selectedGraspSourceWebUrlKeys = new Set(
        selectedGraspSourceUrls.webUrls.map(comparableRemoteUrl)
      );
      const retainedSourceCloneUrls = sameLogicalRepo
        ? (originalRepo.cloneUrls || []).filter(
            (cloneUrl) => !selectedGraspSourceCloneUrlKeys.has(comparableRemoteUrl(cloneUrl))
          )
        : [];
      const retainedSourceWebUrls = sameLogicalRepo
        ? (originalRepo.webUrls || []).filter(
            (webUrl) => !selectedGraspSourceWebUrlKeys.has(comparableRemoteUrl(webUrl))
          )
        : [];
      const successfulWebUrls = Array.from(
        new Set(
          [
            ...retainedSourceWebUrls,
            ...successfulTargets.map((result) => result.webUrl || guessWebUrl(result.remoteUrl)),
          ].filter(Boolean) as string[]
        )
      );
      let cloneUrls = sameLogicalRepo
        ? dedupeCloneUrls([...successfulRemoteUrls, ...retainedSourceCloneUrls])
        : dedupeCloneUrls(successfulRemoteUrls);
      const selectedGraspTargetRelays = selectedTargets
        .filter((target) => target.provider === "grasp" && target.relayUrl)
        .map((target) => normalizeRelayUrl(target.relayUrl as string))
        .filter(Boolean);
      const successfulGraspRelays = selectedTargets
        .filter((target) =>
          successfulTargets.some(
            (result) => result.id === target.id && result.provider === "grasp" && result.success
          )
        )
        .map((target) => normalizeRelayUrl(target.relayUrl || ""))
        .filter(Boolean);
      let relays = getEffectiveRepoRelayUrls(
        getEditableRepoRelayUrls(config.relays || [], selectedGraspTargetRelays),
        successfulGraspRelays
      );
      const hashtags = Array.from(
        new Set((config.tags || []).map((tag) => tag.trim()).filter(Boolean))
      );
      const maintainers = Array.from(
        new Set((config.maintainers || []).map((value) => value.trim()).filter(Boolean))
      );
      const stateRefs = preparedSource.refs.filter(
        (ref): ref is RemoteSyncRef & { commit: string } => Boolean(ref.commit)
      );
      const finalCreatedAt = getFinalRepoMetadataCreatedAt(
        Math.floor(Date.now() / 1000),
        latestRepoMetadataCreatedAt
      );

      const stateEvent = createRepoStateEvent({
        repoId: finalRepoId,
        refs:
          stateRefs.length > 0
            ? stateRefs.map((ref) => ({ type: ref.type, name: ref.name, commit: ref.commit }))
            : undefined,
        head: preparedSource.defaultBranch,
        created_at: finalCreatedAt,
      });

      updateProgress("events", "Final Nostr events created", "completed");

      updateProgress("publish-announcement", "Publishing final repo metadata...", "running");
      transactionJournal.setPhase("metadata-pending");
      const successfulGraspTargets = successfulTargets
        .filter((result) => result.provider === "grasp" && result.relayUrl && result.remoteUrl)
        .map((result) => ({
          relayUrl: result.relayUrl as string,
          cloneUrl: result.remoteUrl as string,
        }));
      const successfulGraspCloneUrls = new Set(
        successfulGraspTargets.map((target) => target.cloneUrl)
      );
      const sourceCloneUrls = new Set(
        sameLogicalRepo ? dedupeCloneUrls(retainedSourceCloneUrls) : []
      );
      const fixedCloneUrls = cloneUrls.filter(
        (cloneUrl) => sourceCloneUrls.has(cloneUrl) || !successfulGraspCloneUrls.has(cloneUrl)
      );
      const candidateCloneOrder = [...cloneUrls];
      const graspWebUrlByCloneUrl = new Map(
        successfulTargets
          .filter((result) => result.provider === "grasp" && result.remoteUrl)
          .map((result) => [
            result.remoteUrl as string,
            result.webUrl || guessWebUrl(result.remoteUrl),
          ])
      );
      const graspWebUrls = new Set(Array.from(graspWebUrlByCloneUrl.values()).filter(Boolean));
      const sourceWebUrls = new Set(sameLogicalRepo ? retainedSourceWebUrls : []);
      const fixedWebUrls = successfulWebUrls.filter(
        (webUrl) => sourceWebUrls.has(webUrl) || !graspWebUrls.has(webUrl)
      );
      const reconciled = await reconcileRepoCreationEvents({
        relayUrls: relays,
        provisionalRelayUrls: selectedGraspTargetRelays,
        graspTargets: successfulGraspTargets,
        stateEvent,
        onPublishEvent: transactionPublisher!,
        fetchRelayEvents: options.onFetchRelayEvents,
        provisionalEvents: getRepoCreationProvisionalEvents(transactionJournal.record),
        onDeleteEvent: options.onDeleteEvent,
        minCreatedAt: latestRepoMetadataCreatedAt,
        ownerPubkey: userPubkey,
        identifier: forkName,
        allowedUnlistedCloneUrls: authoritativeSourceCloneUrls.filter(
          (cloneUrl) => !selectedGraspSourceCloneUrlKeys.has(comparableRemoteUrl(cloneUrl))
        ),
        buildAnnouncement: ({ relays: nextRelays, graspCloneUrls, createdAt }) => {
          const retainedCloneUrls = new Set([...fixedCloneUrls, ...graspCloneUrls]);
          return createRepoAnnouncementEvent({
            repoId: finalRepoId,
            name: sameLogicalRepo ? originalRepo.displayName || forkName : forkName,
            description: repoDescription,
            clone: candidateCloneOrder.filter((cloneUrl) => retainedCloneUrls.has(cloneUrl)),
            web: Array.from(
              new Set(
                [
                  ...fixedWebUrls,
                  ...graspCloneUrls.map((cloneUrl) => graspWebUrlByCloneUrl.get(cloneUrl)),
                ].filter((value): value is string => Boolean(value))
              )
            ),
            relays: nextRelays,
            ...(maintainers.length > 0 ? { maintainers } : {}),
            ...(hashtags.length > 0 ? { hashtags } : {}),
            ...(config.earliestUniqueCommit ||
            (sameLogicalRepo && originalRepo.earliestUniqueCommit)
              ? {
                  earliestUniqueCommit:
                    config.earliestUniqueCommit || originalRepo.earliestUniqueCommit,
                }
              : {}),
            community: effectiveCommunity,
            created_at: createdAt,
          });
        },
      });
      const announcementEvent = reconciled.announcementEvent as RepoAnnouncementEvent;
      const publishedStateEvent = reconciled.stateEvent as RepoStateEvent;
      remotePushResults = applyReconciledGraspResults(remotePushResults, reconciled.graspCloneUrls);
      warning = getForkRemoteSyncWarning(remotePushResults);
      transactionJournal.setTargetResults(remotePushResults);
      transactionJournal.setPendingCompensations(reconciled.cleanupFailures);
      if (!remotePushResults.some((target) => target.success)) {
        throw new Error(
          `Final repository metadata omitted all selected targets (${remotePushResults
            .map((target) => `${target.label}: ${target.error || "sync failed"}`)
            .join("; ")})`
        );
      }
      const retainedCloneUrls = new Set([...fixedCloneUrls, ...reconciled.graspCloneUrls]);
      cloneUrls = candidateCloneOrder.filter((cloneUrl) => retainedCloneUrls.has(cloneUrl));
      relays = reconciled.relays;
      updateProgress("publish-announcement", "Published final repo metadata", "completed");

      const committedCloneUrls = new Set(cloneUrls);
      const committedTargets = successfulTargets.filter(
        (target) => target.provider !== "grasp" || committedCloneUrls.has(target.remoteUrl || "")
      );
      const primaryTarget = committedTargets[0];
      const result: ForkResult = {
        repoId: finalRepoId,
        forkUrl: primaryTarget?.remoteUrl || "",
        webUrl: primaryTarget?.webUrl || guessWebUrl(primaryTarget?.remoteUrl),
        defaultBranch: preparedSource.defaultBranch,
        branches: preparedSource.branches,
        tags: preparedSource.tags,
        announcementEvent,
        stateEvent: publishedStateEvent,
        remotePushResults,
      };

      const terminalStatuses = await operationSession.waitForTrackedOperations();
      if (hasUnknownWorkerOperation(terminalStatuses)) {
        transactionJournal.setLocalResourceStatus(
          "unknown",
          "Worker operation status is unknown; temporary fork mirror was retained"
        );
      } else {
        transactionJournal.setLocalResourceStatus("cleanup-pending");
        const localCleanup = await operationSession.runOperation<any>(
          "deleteRepo",
          (childOperationId) =>
            gitWorkerApi.deleteRepo?.({ repoId: localRepoId, operationId: childOperationId })
        );
        const cleanupStatuses = await operationSession.waitForTrackedOperations();
        if (hasUnknownWorkerOperation(cleanupStatuses)) {
          transactionJournal.setLocalResourceStatus(
            "unknown",
            "Temporary fork mirror deletion outcome is unknown"
          );
        } else if (localCleanup?.success === false) {
          transactionJournal.setLocalResourceStatus(
            "cleanup-pending",
            localCleanup.error || "Failed to delete temporary fork mirror"
          );
        } else {
          transactionJournal.setLocalResourceStatus("cleaned");
        }
      }
      isComplete = true;
      onForkCompleted?.(result);
      transactionJournal.complete();
      return result;
    } catch (err) {
      const terminalStatuses = operationSession
        ? await operationSession.waitForTrackedOperations()
        : [];
      const workerOutcomeUnknown =
        hasUnknownWorkerOperation(terminalStatuses) ||
        remotePushResults.some((result) => result.outcome === "unknown");
      const successfulTargetCount = remotePushResults.filter((result) => result.success).length;
      const remoteRollbackTargets = remotePushResults.filter(
        (result) =>
          result.createdRemote &&
          result.remoteUrl &&
          result.provider !== "grasp" &&
          result.cleanup?.attempted &&
          !result.cleanup.success
      );
      const rollbackPlan = getForkRollbackPlan({
        successfulTargetCount,
        hasPublishedRepoRollbackContext: Boolean(publishedRepoRollbackContext),
        hasRollbackPublishedRepoEvents: Boolean(
          options.onDeleteEvent || onRollbackPublishedRepoEvents
        ),
        createdRemoteRepoCount: remoteRollbackTargets.length,
        hasGitWorkerApi: Boolean(gitWorkerApi),
        hasRollbackLocalRepoId: hasForkLocalRollbackResource(
          localRepoId,
          transactionJournal?.record.localResource.stage
        ),
        workerOutcomeUnknown,
      });
      const rollbackFailures: string[] = [];
      let rollbackWorkerOutcomeUnknown = false;

      if (rollbackPlan.hasAnyRollback) {
        updateProgress("rollback", "Rolling back incomplete fork resources...", "running");
      }

      if (rollbackPlan.rollbackPublishedEvents && publishedRepoRollbackContext) {
        const provisionalEvents = transactionJournal
          ? getRepoCreationProvisionalEvents(transactionJournal.record)
          : getRemoteSyncProvisionalEvents(remotePushResults);
        const failedCompensations: Array<{
          action: "delete";
          eventId: string;
          relayUrls: string[];
          error: string;
        }> = [];
        for (const item of provisionalEvents.filter((event) => event.relayUrls.length > 0)) {
          try {
            if (options.onDeleteEvent) {
              await options.onDeleteEvent(item.event, item.relayUrls);
            } else {
              await onRollbackPublishedRepoEvents?.({
                repoName: publishedRepoRollbackContext.repoName,
                relays: item.relayUrls,
                events: [item.event],
              });
            }
          } catch (rollbackError) {
            const message =
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
            failedCompensations.push({
              action: "delete",
              eventId: item.event.id,
              relayUrls: item.relayUrls,
              error: message,
            });
            rollbackFailures.push(`repo event ${item.event.id}: ${message}`);
          }
        }
        transactionJournal?.setPendingCompensations(failedCompensations);
      }

      if (rollbackPlan.rollbackRemoteRepos) {
        for (const result of remoteRollbackTargets) {
          const target = selectedTargets.find((item) => item.id === result.id);
          if (!result.remoteUrl) continue;

          const rollbackTokens = getRollbackRemoteRepoTokens(target);
          if (rollbackTokens.length === 0) {
            rollbackFailures.push(`${result.label}: no token available for rollback`);
            continue;
          }

          let deleted = false;
          let lastRollbackError = "";
          for (const rollbackToken of rollbackTokens) {
            try {
              updateProgress("rollback", `Deleting created remote ${result.label}...`, "running");
              const rollbackResult = await operationSession!.runOperation<any>(
                "deleteRemoteRepo",
                (childOperationId) =>
                  gitWorkerApi.deleteRemoteRepo({
                    remoteUrl: result.remoteUrl,
                    token: rollbackToken,
                    provider: result.provider,
                    baseUrl: getProviderBaseUrl(result.provider, target?.host),
                    operationId: childOperationId,
                  })
              );
              const rollbackStatuses = await operationSession!.waitForTrackedOperations();
              if (hasUnknownWorkerOperation(rollbackStatuses)) {
                rollbackWorkerOutcomeUnknown = true;
                throw new Error(`Deletion outcome is unknown for ${result.label}`);
              }
              if (!rollbackResult?.success) {
                throw new Error(rollbackResult?.error || `Failed to delete ${result.label}`);
              }
              deleted = true;
              break;
            } catch (rollbackError) {
              lastRollbackError =
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
              if (rollbackWorkerOutcomeUnknown) break;
            }
          }

          if (!deleted) {
            rollbackFailures.push(
              `${result.label}: ${lastRollbackError || `Failed to delete ${result.label}`}`
            );
          }
          if (rollbackWorkerOutcomeUnknown) break;
        }
      }

      if (rollbackPlan.rollbackLocalRepo && localRepoId && !rollbackWorkerOutcomeUnknown) {
        try {
          transactionJournal?.setLocalResourceStatus("cleanup-pending");
          const cleanup = await operationSession!.runOperation<any>(
            "deleteRepo",
            (childOperationId) =>
              gitWorkerApi.deleteRepo?.({ repoId: localRepoId, operationId: childOperationId })
          );
          const cleanupStatuses = await operationSession!.waitForTrackedOperations();
          if (hasUnknownWorkerOperation(cleanupStatuses)) {
            transactionJournal?.setLocalResourceStatus(
              "unknown",
              "Local fork mirror deletion outcome is unknown"
            );
          } else if (cleanup?.success === false) {
            throw new Error(cleanup.error || "Failed to delete local fork mirror");
          } else {
            transactionJournal?.setLocalResourceStatus("cleaned");
          }
        } catch (rollbackError) {
          transactionJournal?.setLocalResourceStatus("cleanup-pending", rollbackError);
          rollbackFailures.push(
            `local mirror: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
      } else if ((err instanceof ForkAbortedError || workerOutcomeUnknown) && transactionJournal) {
        transactionJournal.setLocalResourceStatus(
          workerOutcomeUnknown ? "unknown" : "cleanup-pending",
          err
        );
      }

      if (rollbackPlan.hasAnyRollback) {
        if (rollbackFailures.length > 0) {
          const rollbackMessage = `Rollback incomplete: ${rollbackFailures.join("; ")}`;
          warning = [warning, rollbackMessage].filter(Boolean).join(" | ");
          updateProgress("rollback", rollbackMessage, "error", rollbackMessage);
        } else {
          updateProgress("rollback", "Rolled back incomplete fork resources", "completed");
        }
      }

      transactionJournal?.setTargetResults(remotePushResults);
      if (transactionJournal?.record.phase === "metadata-pending") {
        transactionJournal?.setPhase("metadata-pending", err);
      } else if (rollbackPlan.hasAnyRollback && rollbackFailures.length === 0) {
        transactionJournal?.complete();
      } else {
        transactionJournal?.setPhase("failed", err);
      }

      const errorMessage =
        err instanceof ForkAbortedError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      error = errorMessage;
      isComplete = false;

      const currentStep = progress.find((item) => item.status === "running");
      if (currentStep) {
        updateProgress(currentStep.step, `Failed: ${errorMessage}`, "error", errorMessage);
      } else {
        updateProgress("fork", `Failed: ${errorMessage}`, "error", errorMessage);
      }

      return null;
    } finally {
      unsubscribeGitProgress?.();
      temporaryWorkerClient?.terminate?.();
      isForking = false;
      if (abortController === sessionAbortController) {
        abortController = null;
      }
      if (activeOperationSession === operationSession) activeOperationSession = null;
    }
  }

  function abortFork(reason?: string): void {
    if (!abortController || abortController.signal.aborted) return;
    const message = reason || "Fork cancelled by user";
    void activeOperationSession?.requestCancellation(message);
    abortController.abort(message);
  }

  function reset(): void {
    isComplete = false;
    progress = [];
    progressHistory = [];
    progressActivityId = 0;
    error = null;
    warning = null;
    abortFork("Fork reset");
    isForking = false;
  }

  return {
    get progress() {
      return progress;
    },
    get isComplete() {
      return isComplete;
    },
    get progressHistory() {
      return progressHistory;
    },
    get error() {
      return error;
    },
    get warning() {
      return warning;
    },
    get isForking() {
      return isForking;
    },
    get operationActivity() {
      return operationActivity;
    },
    forkRepository,
    abortFork,
    reset,
  };
}
