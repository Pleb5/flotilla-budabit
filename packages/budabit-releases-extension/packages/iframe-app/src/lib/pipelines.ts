import type { WidgetBridge } from 'budabit-sdk';
import { HEX_KEY, type RepoContext } from './context.js';
import type { Artifact, PipelineRun } from './types.js';
import { queryEvents, getRelays, tagValue, tagValues } from './releases.js';
import { safeAssetUrl } from './binary.js';

export interface PipelineArtifactData {
  runs: PipelineRun[];
  artifactsByRun: Map<string, Artifact[]>;
}

/** A publisher delegation is accepted only from the authenticated run author. */
export async function loadPipelineArtifacts(
  bridge: WidgetBridge,
  repo: RepoContext
): Promise<PipelineArtifactData> {
  const relays = getRelays(repo.repoRelays);
  const runsByPublisher = new Map<string, PipelineRun>();
  const delegations = new Map<string, string>();
  const ambiguous = new Set<string>();
  const events = await queryEvents(bridge, relays, {
    kinds: [5401],
    authors: [...repo.maintainers],
    // Scan maintainer namespaces across ALL repositories. Filtering #a here
    // conceals reused publisher keys and misattributes unlinked legacy artifacts.
  });
  for (const event of events) {
    const publisher = tagValue(event, 'publisher');
    const actor = tagValue(event, 'triggered-by');
    const commit = tagValue(event, 'commit');
    if (event.kind !== 5401 || !repo.maintainers.includes(event.pubkey)) continue;
    for (const delegated of tagValues(event, 'publisher').filter((p) => HEX_KEY.test(p))) {
      const previous = delegations.get(delegated);
      if (previous && previous !== event.id) ambiguous.add(delegated);
      delegations.set(delegated, event.id);
    }
    if (
      actor !== event.pubkey ||
      tagValues(event, 'a').filter((a) => a.startsWith('30617:')).length !== 1 ||
      !event.tags.some((t) => t[0] === 'a' && t[1] === repo.repoAddress) ||
      tagValues(event, 'publisher').length !== 1 ||
      !publisher ||
      !HEX_KEY.test(publisher) ||
      !commit ||
      !/^[0-9a-f]{40,64}$/.test(commit)
    )
      continue;
    runsByPublisher.set(publisher, {
      id: event.id,
      workflowName: tagValue(event, 'workflow') ?? 'workflow',
      branch: tagValue(event, 'branch') ?? '',
      commitId: commit,
      createdAt: event.created_at,
      ephemeralPubkey: publisher,
      triggeredBy: event.pubkey,
    });
  }
  for (const publisher of ambiguous) runsByPublisher.delete(publisher);
  const runs = [...runsByPublisher.values()].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  );
  const artifactsByRun = new Map<string, Artifact[]>();
  if (!runs.length) return { runs, artifactsByRun };
  const artifacts = await queryEvents(bridge, relays, {
    kinds: [1063],
    authors: [...runsByPublisher.keys()],
  });
  const seen = new Set<string>();
  for (const event of artifacts) {
    const run = runsByPublisher.get(event.pubkey);
    const url = safeAssetUrl(tagValue(event, 'url'));
    const sha256 = tagValue(event, 'x');
    const refs = tagValues(event, 'e');
    const commit = tagValue(event, 'commit');
    // Legacy unlinked events rely on a unique delegation in the completed
    // cross-repository maintainer scan. Conflicting references are never accepted.
    if (
      event.kind !== 1063 ||
      !run ||
      !url ||
      !sha256 ||
      !HEX_KEY.test(sha256) ||
      seen.has(event.id) ||
      (refs.length > 0 && refs.some((id) => id !== run.id)) ||
      (commit && commit !== run.commitId)
    )
      continue;
    seen.add(event.id);
    const integer = (key: string) => {
      const text = tagValue(event, key);
      return text !== undefined && /^\d+$/.test(text) && Number.isSafeInteger(Number(text))
        ? Number(text)
        : undefined;
    };
    const artifact: Artifact = {
      eventId: event.id,
      url,
      sha256,
      filename: tagValue(event, 'filename') ?? tagValue(event, 'name') ?? sha256,
      mimeType: tagValue(event, 'm') ?? 'application/octet-stream',
      size: integer('size'),
      appId: tagValue(event, 'i'),
      version: tagValue(event, 'version'),
      platforms: tagValues(event, 'f'),
      versionCode: integer('version_code'),
      apkCertificateHashes: tagValues(event, 'apk_certificate_hash'),
      minPlatformVersion: tagValue(event, 'min_platform_version'),
      targetPlatformVersion: tagValue(event, 'target_platform_version'),
      variant: tagValue(event, 'variant'),
      pipelineRunId: run.id,
      workflowName: run.workflowName,
      branch: run.branch,
      commitId: run.commitId,
    };
    artifactsByRun.set(run.id, [...(artifactsByRun.get(run.id) ?? []), artifact]);
  }
  return { runs, artifactsByRun };
}
