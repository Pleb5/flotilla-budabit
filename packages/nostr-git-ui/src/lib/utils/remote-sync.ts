import { getGitServiceApiFromUrl, parseRepoUrl, type NostrEvent } from "@nostr-git/core";
import type { RepoCommunityBinding } from "@nostr-git/core/events";

import {
  buildGraspRepoUrls,
  createGraspRefMap,
  createGraspAnnouncementAndState,
  didRelayAckGraspEvents,
  extractPublishRelayAck,
  fetchLatestGraspRepoStateEvent,
  getGraspRefFullName,
  getGraspStateHeadFromEvent,
  getGraspStateRefsFromEvent,
  mergeGraspRefs,
  normalizeGraspOrigins,
  publishGraspRepoStateAndWait,
  resolveGraspStateHead,
  toNpubOrSelf,
  waitForGraspProvisioning,
  type FetchRelayEvents,
  type GraspRef,
} from "./grasp-pipeline.js";
import { trackLatestRepoMetadataCreatedAt } from "./import-repo-metadata.js";
import {
  getProviderBaseUrl,
  type RemoteTargetProvider,
  type RemoteTargetSelection,
} from "./remote-targets.js";

export interface RemoteSyncRef {
  type: "heads" | "tags";
  name: string;
  ref: string;
  commit?: string;
}

export interface RemoteSyncTargetResult {
  id: string;
  label: string;
  provider: RemoteTargetProvider;
  success: boolean;
  remoteUrl?: string;
  webUrl?: string;
  error?: string;
  createdRemote?: boolean;
  pushedRefs?: string[];
  failedRefs?: Array<{ ref: string; error: string }>;
  warnings?: string[];
}

export interface SyncLocalRepoToTargetsOptions {
  workerApi: any;
  localRepoId: string;
  repoName: string;
  repoDescription: string;
  defaultBranch: string;
  refs: RemoteSyncRef[];
  targets: RemoteTargetSelection[];
  userPubkey: string;
  relays?: string[];
  maintainers?: string[];
  community?: RepoCommunityBinding;
  onPublishEvent?: (event: NostrEvent) => Promise<unknown>;
  onFetchRelayEvents?: FetchRelayEvents;
  updateProgress: (message: string) => void;
  runAbortable: <T>(operation: () => Promise<T>, label: string, timeoutMs: number) => Promise<T>;
  throwIfAborted?: () => void;
  withRateLimit?: <T>(provider: string, method: string, operation: () => Promise<T>) => Promise<T>;
  latestRepoMetadataCreatedAt?: number;
  onLatestRepoMetadataCreatedAt?: (value: number) => void;
  requireNonGraspSuccessBeforeGrasp?: boolean;
  allowApiBranchFastPath?: boolean;
}

interface WorkerCreateRemoteRepoResult {
  success?: boolean;
  remoteUrl?: string;
  error?: string;
}

interface WorkerPushToRemoteResult {
  success?: boolean;
  error?: string;
  reason?: string;
  details?: {
    pushedRefs?: string[];
    failedRefs?: Array<{ ref: string; error: string }>;
    warnings?: string[];
  };
}

class RemotePushResultError extends Error {
  result?: WorkerPushToRemoteResult;

  constructor(message: string, result?: WorkerPushToRemoteResult) {
    super(message);
    this.name = "RemotePushResultError";
    this.result = result;
  }
}

function getPushResultFromError(error: unknown): WorkerPushToRemoteResult | undefined {
  if (error instanceof RemotePushResultError) return error.result;

  const causes = (error as any)?.causes;
  if (Array.isArray(causes)) {
    for (const cause of causes) {
      const result = getPushResultFromError(cause);
      if (result) return result;
    }
  }

  return undefined;
}

function addFailedRef(
  failedRefs: Array<{ ref: string; error: string }>,
  ref: string | undefined,
  error: string
): void {
  const normalizedRef = String(ref || "").trim();
  const message = String(error || "sync failed").trim() || "sync failed";
  if (!normalizedRef) return;
  if (failedRefs.some((item) => item.ref === normalizedRef)) return;
  failedRefs.push({ ref: normalizedRef, error: message });
}

function collectPushResultDetails(
  pushResult: WorkerPushToRemoteResult | undefined,
  fallbackRef: string | undefined,
  fallbackError: string | undefined,
  pushedRefsForTarget: string[],
  failedRefsForTarget: Array<{ ref: string; error: string }>,
  warningsForTarget: string[]
): string[] {
  const pushedRefs = Array.isArray(pushResult?.details?.pushedRefs)
    ? pushResult.details.pushedRefs.filter(Boolean)
    : [];
  const effectivePushedRefs =
    pushedRefs.length > 0
      ? pushedRefs
      : pushResult?.success && fallbackRef
        ? [fallbackRef]
        : [];

  pushedRefsForTarget.push(...effectivePushedRefs);

  if (Array.isArray(pushResult?.details?.failedRefs)) {
    for (const failedRef of pushResult.details.failedRefs) {
      addFailedRef(failedRefsForTarget, failedRef.ref, failedRef.error);
    }
  }

  if (!pushResult?.success && fallbackError) {
    addFailedRef(failedRefsForTarget, fallbackRef, fallbackError);
  }

  if (Array.isArray(pushResult?.details?.warnings)) {
    warningsForTarget.push(...pushResult.details.warnings.filter(Boolean));
  }

  return effectivePushedRefs;
}

function getTargetTokens(target: RemoteTargetSelection): string[] {
  return Array.from(new Set([target.token, ...(target.tokens || [])].filter(Boolean) as string[]));
}

async function tryTargetTokens<T>(
  target: RemoteTargetSelection,
  operation: (token: string) => Promise<T>
): Promise<T> {
  const tokens = getTargetTokens(target);
  if (target.provider !== "grasp" && tokens.length === 0) {
    throw new Error("Missing token for target host");
  }

  const failures: string[] = [];
  const failureErrors: unknown[] = [];
  for (const token of tokens) {
    try {
      return await operation(token);
    } catch (error) {
      failureErrors.push(error);
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length === 0) {
    throw new Error(`No usable token for ${target.label}`);
  }

  if (failures.length === 1) {
    const [failure] = failureErrors;
    throw failure instanceof Error ? failure : new Error(failures[0]);
  }

  const error = new Error(
    `All tokens failed for ${target.label}: ${Array.from(new Set(failures)).join(" | ")}`
  );
  (error as any).causes = failureErrors;
  throw error;
}

async function withRateLimit<T>(
  fn: SyncLocalRepoToTargetsOptions["withRateLimit"],
  provider: string,
  method: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!fn) return await operation();
  return await fn(provider, method, operation);
}

async function waitForGitLabPushReady(
  options: Pick<SyncLocalRepoToTargetsOptions, "runAbortable" | "throwIfAborted" | "withRateLimit">,
  target: RemoteTargetSelection,
  remoteUrl: string,
  token: string
): Promise<void> {
  let parsedRemote: ReturnType<typeof parseRepoUrl>;
  try {
    parsedRemote = parseRepoUrl(remoteUrl);
  } catch {
    return;
  }

  const api = getGitServiceApiFromUrl(remoteUrl, token);
  const delays = [1200, 2200, 3500];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    options.throwIfAborted?.();

    try {
      await withRateLimit(options.withRateLimit, target.provider, "GET", () =>
        api.getRepo(parsedRemote.owner, parsedRemote.repo)
      );
      return;
    } catch (error) {
      lastError = error;
      await options.runAbortable(
        () => new Promise<void>((resolve) => setTimeout(resolve, delays[attempt])),
        `Waiting for ${target.label} to be ready`,
        0
      );
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export function guessWebUrl(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  if (/^wss?:\/\//i.test(remoteUrl)) {
    return remoteUrl
      .replace(/^wss:\/\//i, "https://")
      .replace(/^ws:\/\//i, "http://")
      .replace(/\.git$/, "");
  }
  return remoteUrl.replace(/\.git$/, "");
}

function sortRefs(refs: RemoteSyncRef[], defaultBranch: string): RemoteSyncRef[] {
  const seen = new Set<string>();
  const deduped = refs.filter((ref) => {
    const key = `${ref.ref}:${ref.commit || ""}`;
    if (!ref.ref || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...deduped].sort((a, b) => {
    const rank = (item: RemoteSyncRef) => {
      if (item.type === "heads" && item.name === defaultBranch) return 0;
      if (item.type === "heads") return 1;
      return 2;
    };

    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });
}

function updateLatestRepoMetadataCreatedAt(
  current: number,
  onUpdate: SyncLocalRepoToTargetsOptions["onLatestRepoMetadataCreatedAt"],
  ...events: Array<{ created_at?: number } | null | undefined>
): number {
  const next = trackLatestRepoMetadataCreatedAt(current, ...events);
  onUpdate?.(next);
  return next;
}

export async function syncLocalRepoToTargets(
  options: SyncLocalRepoToTargetsOptions
): Promise<RemoteSyncTargetResult[]> {
  const {
    workerApi,
    localRepoId,
    repoName,
    repoDescription,
    defaultBranch,
    targets,
    userPubkey,
    relays = [],
    maintainers,
    community,
    onPublishEvent,
    updateProgress,
    runAbortable,
    throwIfAborted,
    withRateLimit: rateLimiter,
    requireNonGraspSuccessBeforeGrasp = false,
    allowApiBranchFastPath = true,
  } = options;

  if (!targets.length) return [];

  if (!workerApi) {
    return targets.map((target) => ({
      id: target.id,
      label: target.label,
      provider: target.provider,
      success: false,
      error: "Git worker unavailable for remote sync",
    }));
  }

  const orderedRefs = sortRefs(options.refs, defaultBranch);
  if (orderedRefs.length === 0) {
    return targets.map((target) => ({
      id: target.id,
      label: target.label,
      provider: target.provider,
      success: false,
      error: "No git refs available for remote sync",
    }));
  }

  const orderedTargets = [...targets].sort((a, b) => {
    const aIsGrasp = a.provider === "grasp" ? 1 : 0;
    const bIsGrasp = b.provider === "grasp" ? 1 : 0;
    return aIsGrasp - bIsGrasp;
  });
  const hasAnyNonGraspTarget = orderedTargets.some((target) => target.provider !== "grasp");
  const selectedGraspCloneUrls = buildGraspRepoUrls({
    relayUrls: orderedTargets
      .filter((target) => target.provider === "grasp" && target.relayUrl)
      .map((target) => target.relayUrl as string),
    ownerPubkey: userPubkey,
    repoName,
  }).cloneUrls;

  const results: RemoteSyncTargetResult[] = [];
  let latestRepoMetadataCreatedAt = options.latestRepoMetadataCreatedAt || 0;

  for (let i = 0; i < orderedTargets.length; i++) {
    const target = orderedTargets[i];
    throwIfAborted?.();
    updateProgress(`Syncing target ${i + 1}/${orderedTargets.length}: ${target.label}`);

    let remoteUrl = target.existingRemoteUrl;
    let webUrl = target.existingWebUrl;
    let createdRemote = false;
    const pushedRefsForTarget: string[] = [];
    const failedRefsForTarget: Array<{ ref: string; error: string }> = [];
    const warningsForTarget: string[] = [];
    let activeRef: RemoteSyncRef | null = null;

    try {
      if (target.provider === "grasp") {
        if (!target.relayUrl) {
          throw new Error("Missing relay URL");
        }

        const hasSuccessfulNonGraspPush = results.some(
          (result) => result.success && result.provider !== "grasp"
        );
        if (
          !remoteUrl &&
          requireNonGraspSuccessBeforeGrasp &&
          hasAnyNonGraspTarget &&
          !hasSuccessfulNonGraspPush
        ) {
          throw new Error(
            "Skipping GRASP repo-event provisioning because no non-GRASP target succeeded"
          );
        }

        if (!remoteUrl) {
          const createResult = (await runAbortable(
            () =>
              workerApi.createRemoteRepo({
                provider: "grasp",
                token: userPubkey,
                name: repoName,
                description: repoDescription,
                isPrivate: false,
                baseUrl: target.relayUrl,
              }),
            `Creating remote repository on ${target.label}`,
            45000
          )) as WorkerCreateRemoteRepoResult;

          if (!createResult?.success || !createResult?.remoteUrl) {
            throw new Error(createResult?.error || "Failed to create GRASP repository");
          }

          if (!onPublishEvent) {
            throw new Error(
              "Missing onPublishEvent callback required for GRASP target provisioning"
            );
          }

          createdRemote = true;
          remoteUrl = createResult.remoteUrl;
          webUrl = guessWebUrl(createResult.remoteUrl);
          const graspRemoteUrl = createResult.remoteUrl;

          const graspRelays = Array.from(
            new Set([normalizeGraspOrigins(target.relayUrl).wsOrigin, ...relays])
          );
          const graspEvents = createGraspAnnouncementAndState({
            relayUrl: target.relayUrl,
            ownerPubkey: userPubkey,
            repoName,
            description: repoDescription,
            relays: graspRelays,
            cloneUrls:
              selectedGraspCloneUrls.length > 0 ? selectedGraspCloneUrls : [graspRemoteUrl],
            webUrls: webUrl ? [webUrl] : undefined,
            maintainers,
            community,
          });

          latestRepoMetadataCreatedAt = updateLatestRepoMetadataCreatedAt(
            latestRepoMetadataCreatedAt,
            options.onLatestRepoMetadataCreatedAt,
            graspEvents.announcementEvent,
            graspEvents.stateEvent
          );

          const relayAck = extractPublishRelayAck(
            await onPublishEvent(graspEvents.announcementEvent)
          );
          if (relayAck.hasRelayOutcomes && !didRelayAckGraspEvents(relayAck, target.relayUrl)) {
            throw new Error(
              "Selected GRASP relay did not ACK repository announcement; skipping push"
            );
          }

          try {
            await runAbortable(
              () =>
                waitForGraspProvisioning({
                  relayUrl: target.relayUrl!,
                  userPubkey,
                  owner: toNpubOrSelf(userPubkey),
                  repoName,
                  maxAttempts: 15,
                  delayMs: 3000,
                }),
              `Waiting for GRASP provisioning on ${target.label}`,
              0
            );
          } catch (provisionError) {
            const message =
              provisionError instanceof Error
                ? provisionError.message
                : String(provisionError || "Unknown provisioning error");
            updateProgress(
              `Provisioning check timed out (${message}). Continuing with push retries...`
            );
          }
        }

        if (!remoteUrl) {
          throw new Error("No GRASP remote URL available for push");
        }
        const graspRemoteUrl = remoteUrl;

        const refDetailsByFullRef = new Map(
          orderedRefs
            .filter((item) => Boolean(item.commit))
            .map((item) => [
              item.ref,
              { type: item.type, name: item.name, commit: item.commit as string },
            ])
        );
        let stateRefsByFullRef = new Map<string, GraspRef>();
        let currentStateHead: string | undefined;

        if (onPublishEvent) {
          try {
            const existingStateEvent = await fetchLatestGraspRepoStateEvent({
              relayUrl: target.relayUrl,
              repoName,
              fetchRelayEvents: options.onFetchRelayEvents,
              authorPubkey: userPubkey,
            });
            stateRefsByFullRef = createGraspRefMap(getGraspStateRefsFromEvent(existingStateEvent));
            currentStateHead = getGraspStateHeadFromEvent(existingStateEvent);
          } catch (stateFetchError) {
            console.warn("[GRASP] Failed to fetch existing repo state before sync:", stateFetchError);
          }
        }

        for (let refIndex = 0; refIndex < orderedRefs.length; refIndex++) {
          const ref = orderedRefs[refIndex];
          activeRef = ref;
          throwIfAborted?.();

          if (onPublishEvent && refDetailsByFullRef.size > 0) {
            const refDetail = refDetailsByFullRef.get(ref.ref);
            updateProgress(
              `Publishing GRASP state for ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} (${refIndex + 1}/${orderedRefs.length})...`
            );

            const stateRefs = refDetail
              ? mergeGraspRefs(Array.from(stateRefsByFullRef.values()), [refDetail])
              : Array.from(stateRefsByFullRef.values());

            if (stateRefs.length > 0) {
              const stateHead = resolveGraspStateHead({
                existingHead: currentStateHead,
                refs: stateRefs,
                fallbackHead: defaultBranch,
                preferFallback: ref.type === "heads" && ref.name === defaultBranch,
              });

              const graspState = createGraspAnnouncementAndState({
                relayUrl: target.relayUrl,
                ownerPubkey: userPubkey,
                repoName,
                description: repoDescription,
                relays: Array.from(
                  new Set([normalizeGraspOrigins(target.relayUrl).wsOrigin, ...relays])
                ),
                cloneUrls:
                  selectedGraspCloneUrls.length > 0 ? selectedGraspCloneUrls : [graspRemoteUrl],
                webUrls: [
                  webUrl || guessWebUrl(graspRemoteUrl) || graspRemoteUrl.replace(/\.git$/, ""),
                ],
                maintainers,
                community,
                refs: stateRefs,
                head: stateHead,
              });

              latestRepoMetadataCreatedAt = updateLatestRepoMetadataCreatedAt(
                latestRepoMetadataCreatedAt,
                options.onLatestRepoMetadataCreatedAt,
                graspState.announcementEvent,
                graspState.stateEvent
              );

              await runAbortable(
                () =>
                  publishGraspRepoStateAndWait({
                    relayUrl: target.relayUrl!,
                    stateEvent: graspState.stateEvent,
                    onPublishEvent,
                    fetchRelayEvents: options.onFetchRelayEvents,
                    authorPubkey: userPubkey,
                  }),
                `Waiting for GRASP state visibility for ${ref.name}`,
                0
              );

              currentStateHead = stateHead;
            }
          }

          updateProgress(
            `Pushing ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} to ${target.label} (${refIndex + 1}/${orderedRefs.length})...`
          );

          const pushResult = (await runAbortable(
            () =>
              workerApi.pushToRemote({
                repoId: localRepoId,
                remoteUrl: graspRemoteUrl,
                branch: defaultBranch,
                ref: ref.ref,
                token: userPubkey,
                provider: "grasp",
              }),
            `Pushing ${ref.name} to ${target.label}`,
            0
          )) as WorkerPushToRemoteResult;

          if (!pushResult?.success) {
            const message = pushResult?.error || `Failed to push ${ref.name} to GRASP target`;
            throw new RemotePushResultError(message, pushResult);
          }

          const pushedRefs = collectPushResultDetails(
            pushResult,
            ref.ref,
            undefined,
            pushedRefsForTarget,
            failedRefsForTarget,
            warningsForTarget
          );

          if (pushedRefs.includes(ref.ref)) {
            const refDetail = refDetailsByFullRef.get(ref.ref);
            if (refDetail) {
              stateRefsByFullRef.set(getGraspRefFullName(refDetail), refDetail);
            }
          }
        }
        activeRef = null;

        results.push({
          id: target.id,
          label: target.label,
          provider: target.provider,
          success: true,
          remoteUrl,
          webUrl: webUrl || guessWebUrl(remoteUrl),
          createdRemote,
          pushedRefs: Array.from(new Set(pushedRefsForTarget)),
          failedRefs: failedRefsForTarget.length > 0 ? failedRefsForTarget : undefined,
          warnings:
            warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
        });
        continue;
      }

      if (getTargetTokens(target).length === 0) {
        throw new Error("Missing token for target host");
      }

      if (!remoteUrl) {
        const createResult = await tryTargetTokens<WorkerCreateRemoteRepoResult>(
          target,
          async (token) => {
            const result = (await runAbortable(
              () =>
                workerApi.createRemoteRepo({
                  provider: target.provider,
                  token,
                  name: repoName,
                  description: repoDescription,
                  isPrivate: false,
                  baseUrl: getProviderBaseUrl(target.provider, target.host),
                }),
              `Creating remote repository on ${target.label}`,
              45000
            )) as WorkerCreateRemoteRepoResult;

            if (!result?.success || !result?.remoteUrl) {
              throw new Error(result?.error || "Failed to create remote repository");
            }

            return result;
          }
        );

        remoteUrl = createResult.remoteUrl;
        webUrl = guessWebUrl(createResult.remoteUrl);
        createdRemote = true;
      }

      if (!remoteUrl) {
        throw new Error("No remote URL available for push");
      }
      const targetRemoteUrl = remoteUrl;

      let targetOwner = "";
      let targetRepo = "";
      try {
        const parsedTarget = parseRepoUrl(targetRemoteUrl);
        targetOwner = parsedTarget.owner;
        targetRepo = parsedTarget.repo;
      } catch {
        targetOwner = "";
        targetRepo = "";
      }

      for (let refIndex = 0; refIndex < orderedRefs.length; refIndex++) {
        const ref = orderedRefs[refIndex];
        activeRef = ref;
        throwIfAborted?.();

        const isDefaultBranchRef = ref.type === "heads" && ref.name === defaultBranch;
        const canUseApiFastPath =
          allowApiBranchFastPath &&
          ref.type === "heads" &&
          !isDefaultBranchRef &&
          Boolean(ref.commit) &&
          Boolean(targetOwner && targetRepo);

        if (canUseApiFastPath && targetOwner && targetRepo) {
          updateProgress(
            `Syncing branch ${ref.name} via ${target.label} API (${refIndex + 1}/${orderedRefs.length})...`
          );

          try {
            await tryTargetTokens(target, async (token) => {
              const targetApi = getGitServiceApiFromUrl(targetRemoteUrl, token);
              if (!targetApi.upsertBranchRef) {
                throw new Error(`Branch sync API unavailable for ${target.label}`);
              }

              await withRateLimit(rateLimiter, target.provider, "upsertBranchRef", () =>
                targetApi.upsertBranchRef!(targetOwner, targetRepo, ref.name, ref.commit as string)
              );
            });

            pushedRefsForTarget.push(ref.ref);
            continue;
          } catch {
            // fall back to git push below
          }
        }

        updateProgress(
          `Pushing ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} to ${target.label} (${refIndex + 1}/${orderedRefs.length})...`
        );

        const pushResult = await tryTargetTokens<WorkerPushToRemoteResult>(
          target,
          async (token) => {
            if (target.provider === "gitlab" && createdRemote) {
              await waitForGitLabPushReady(
                { runAbortable, throwIfAborted, withRateLimit: rateLimiter },
                target,
                targetRemoteUrl,
                token
              );
            }

            const maxAttempts = target.provider === "gitlab" && createdRemote ? 3 : 1;
            let lastError: unknown = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                const result = (await runAbortable(
                  () =>
                    workerApi.pushToRemote({
                      repoId: localRepoId,
                      remoteUrl: targetRemoteUrl,
                      branch: defaultBranch,
                      ref: ref.ref,
                      token,
                      provider: target.provider,
                    }),
                  `Pushing ${ref.name} to ${target.label}`,
                  0
                )) as WorkerPushToRemoteResult;

                if (!result?.success) {
                  const message = result?.error || `Failed to push ${ref.name} to ${target.label}`;
                  throw new RemotePushResultError(message, result);
                }

                return result;
              } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error || "");
                const isRetryableGitLabError =
                  /404|not found|repository .* empty|project .* not found|could not read from remote/i.test(
                    message
                  );

                if (
                  attempt >= maxAttempts ||
                  target.provider !== "gitlab" ||
                  !createdRemote ||
                  !isRetryableGitLabError
                ) {
                  throw error;
                }

                await runAbortable(
                  () => new Promise<void>((resolve) => setTimeout(resolve, 1500 * attempt)),
                  `Retrying ${ref.name} push to ${target.label}`,
                  0
                );
              }
            }

            throw lastError instanceof Error
              ? lastError
              : new Error(String(lastError || "Push failed"));
          }
        );

        if (!pushResult?.success) {
          const message = pushResult?.error || `Failed to push ${ref.name} to ${target.label}`;
          throw new RemotePushResultError(message, pushResult);
        }

        collectPushResultDetails(
          pushResult,
          ref.ref,
          undefined,
          pushedRefsForTarget,
          failedRefsForTarget,
          warningsForTarget
        );
      }
      activeRef = null;

      results.push({
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: true,
        remoteUrl,
        webUrl: webUrl || guessWebUrl(remoteUrl),
        createdRemote,
        pushedRefs: Array.from(new Set(pushedRefsForTarget)),
        failedRefs: failedRefsForTarget.length > 0 ? failedRefsForTarget : undefined,
        warnings: warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedPushResult = getPushResultFromError(error);
      if (failedPushResult && activeRef) {
        collectPushResultDetails(
          failedPushResult,
          activeRef.ref,
          message,
          pushedRefsForTarget,
          failedRefsForTarget,
          warningsForTarget
        );
      } else if (activeRef) {
        addFailedRef(failedRefsForTarget, activeRef.ref, message);
      }
      const partialSuffix =
        pushedRefsForTarget.length > 0
          ? ` (pushed ${Array.from(new Set(pushedRefsForTarget)).length}/${orderedRefs.length} refs before failure)`
          : "";

      results.push({
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: false,
        remoteUrl,
        webUrl: webUrl || guessWebUrl(remoteUrl),
        createdRemote,
        error: `${message}${partialSuffix}`,
        pushedRefs:
          pushedRefsForTarget.length > 0 ? Array.from(new Set(pushedRefsForTarget)) : undefined,
        failedRefs:
          failedRefsForTarget.length > 0
            ? Array.from(new Map(failedRefsForTarget.map((item) => [item.ref, item])).values())
            : undefined,
        warnings: warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
      });
    }
  }

  return results;
}
