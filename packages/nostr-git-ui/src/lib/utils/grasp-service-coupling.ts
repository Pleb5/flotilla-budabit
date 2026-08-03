import { fetchRelayInfoResult, graspCapabilities } from "@nostr-git/core/api";
import {
  hasMatchingGraspRepoCloneUrl,
  normalizeGraspServiceHttpBase,
  normalizeGraspServiceRelayUrl,
  parseGraspRepoHttpUrl,
} from "@nostr-git/core/utils";

export type GraspServiceSource =
  | "user-10317"
  | "community-10222"
  | "selected-target"
  | "clone-url"
  | "nip11";

export interface GraspServiceDescriptor {
  relayUrl: string;
  httpBaseAliases: string[];
  sources: GraspServiceSource[];
}

const nip11Cache = new Map<string, Promise<GraspServiceDescriptor | null>>();

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cloneUrlKey(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function graspServiceKey(value: string): string {
  return normalizeGraspServiceRelayUrl(value);
}

export function buildGraspServiceDescriptors(
  relayUrls: readonly string[],
  source: GraspServiceSource
): GraspServiceDescriptor[] {
  return unique(relayUrls.map(graspServiceKey)).map((relayUrl) => ({
    relayUrl,
    httpBaseAliases: unique([normalizeGraspServiceHttpBase(relayUrl)]),
    sources: [source],
  }));
}

export function getCloneGraspServiceDescriptors(
  cloneUrls: readonly string[]
): GraspServiceDescriptor[] {
  const descriptors: GraspServiceDescriptor[] = [];
  for (const cloneUrl of cloneUrls) {
    const parsed = parseGraspRepoHttpUrl(cloneUrl);
    if (!parsed) continue;
    descriptors.push({
      relayUrl: normalizeGraspServiceRelayUrl(parsed.httpBase),
      httpBaseAliases: [normalizeGraspServiceHttpBase(parsed.httpBase)],
      sources: ["clone-url"],
    });
  }
  return mergeGraspServiceDescriptors(descriptors);
}

export function mergeGraspServiceDescriptors(
  descriptors: readonly GraspServiceDescriptor[]
): GraspServiceDescriptor[] {
  const merged = new Map<string, GraspServiceDescriptor>();
  for (const descriptor of descriptors) {
    const relayUrl = graspServiceKey(descriptor.relayUrl);
    if (!relayUrl) continue;
    const current = merged.get(relayUrl);
    merged.set(relayUrl, {
      relayUrl,
      httpBaseAliases: unique([
        ...(current?.httpBaseAliases || []),
        normalizeGraspServiceHttpBase(relayUrl),
        ...descriptor.httpBaseAliases.map(normalizeGraspServiceHttpBase),
      ]),
      sources: unique([...(current?.sources || []), ...descriptor.sources]) as GraspServiceSource[],
    });
  }
  return Array.from(merged.values());
}

async function resolveNip11GraspService(relayUrl: string): Promise<GraspServiceDescriptor | null> {
  const normalizedRelay = graspServiceKey(relayUrl);
  if (!normalizedRelay) return null;
  const existing = nip11Cache.get(normalizedRelay);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const result = await fetchRelayInfoResult(normalizedRelay);
      if (!result.ok) return null;
      const capabilities = graspCapabilities(result.info, normalizedRelay);
      if (!capabilities.grasp01) return null;
      return {
        relayUrl: normalizedRelay,
        httpBaseAliases: unique(
          capabilities.httpOrigins.map(normalizeGraspServiceHttpBase).filter(Boolean)
        ),
        sources: ["nip11" as const],
      };
    } catch {
      return null;
    }
  })();
  nip11Cache.set(normalizedRelay, pending);
  void pending.then((service) => {
    if (!service && nip11Cache.get(normalizedRelay) === pending) {
      nip11Cache.delete(normalizedRelay);
    }
  });
  return pending;
}

export async function resolveKnownGraspServices(params: {
  relayUrls: readonly string[];
  knownServices?: readonly GraspServiceDescriptor[];
  enrichKnownServices?: boolean;
}): Promise<GraspServiceDescriptor[]> {
  const known = mergeGraspServiceDescriptors(params.knownServices || []);
  // Explicit evidence classifies the service, but NIP-11 may advertise a
  // distinct Smart HTTP origin needed for exact clone matching.
  const discovered = (
    await Promise.all(
      unique([
        ...params.relayUrls.map(graspServiceKey),
        ...(params.enrichKnownServices
          ? known.map((service) => graspServiceKey(service.relayUrl))
          : []),
      ]).map(resolveNip11GraspService)
    )
  ).filter((service): service is GraspServiceDescriptor => Boolean(service));
  return mergeGraspServiceDescriptors([...known, ...discovered]);
}

export function getUnbackedKnownGraspRelayUrls(params: {
  repoRelayUrls: readonly string[];
  backedGraspRelayUrls: readonly string[];
  knownServices: readonly GraspServiceDescriptor[];
}): string[] {
  const knownKeys = new Set(
    params.knownServices.map((service) => graspServiceKey(service.relayUrl))
  );
  const backedKeys = new Set(params.backedGraspRelayUrls.map(graspServiceKey));
  return unique(
    params.repoRelayUrls.filter((relayUrl) => {
      const key = graspServiceKey(relayUrl);
      return knownKeys.has(key) && !backedKeys.has(key);
    })
  );
}

export function getGraspRelayUrlsBackedByCloneUrls(params: {
  repoRelayUrls: readonly string[];
  cloneUrls: readonly string[];
  knownServices?: readonly GraspServiceDescriptor[];
  ownerPubkey: string;
  identifier: string;
}): string[] {
  const services = mergeGraspServiceDescriptors([
    ...(params.knownServices || []),
    ...getCloneGraspServiceDescriptors(params.cloneUrls),
  ]);

  return unique(
    params.repoRelayUrls.filter((relayUrl) => {
      const service = services.find(
        (candidate) => graspServiceKey(candidate.relayUrl) === graspServiceKey(relayUrl)
      );
      return Boolean(
        service &&
        hasMatchingGraspRepoCloneUrl(params.cloneUrls, {
          relayUrl: service.relayUrl,
          httpBaseAliases: service.httpBaseAliases,
          ownerPubkey: params.ownerPubkey,
          identifier: params.identifier,
        })
      );
    })
  );
}

export function getUnbackedGraspCloneRelayUrls(params: {
  repoRelayUrls: readonly string[];
  cloneUrls: readonly string[];
  knownServices: readonly GraspServiceDescriptor[];
  ownerPubkey: string;
  identifier: string;
}): string[] {
  const effectiveServices = mergeGraspServiceDescriptors([
    ...params.knownServices,
    ...getCloneGraspServiceDescriptors(params.cloneUrls),
  ]);
  const relayKeys = new Set(params.repoRelayUrls.map(graspServiceKey));
  return effectiveServices.flatMap((service) => {
    const key = graspServiceKey(service.relayUrl);
    if (!relayKeys.has(key)) return [];
    return hasMatchingGraspRepoCloneUrl(params.cloneUrls, {
      relayUrl: service.relayUrl,
      httpBaseAliases: service.httpBaseAliases,
      ownerPubkey: params.ownerPubkey,
      identifier: params.identifier,
    })
      ? []
      : [service.relayUrl];
  });
}

export function getOrphanedGraspCloneUrls(params: {
  repoRelayUrls: readonly string[];
  cloneUrls: readonly string[];
  knownServices?: readonly GraspServiceDescriptor[];
  ownerPubkey: string;
  identifier: string;
}): string[] {
  const relayKeys = new Set(params.repoRelayUrls.map(graspServiceKey));
  const services = mergeGraspServiceDescriptors(params.knownServices || []);

  return unique(
    params.cloneUrls.filter((cloneUrl) => {
      const parsed = parseGraspRepoHttpUrl(cloneUrl);
      if (!parsed) return false;
      const matchingService = services.find((service) =>
        hasMatchingGraspRepoCloneUrl([cloneUrl], {
          relayUrl: service.relayUrl,
          httpBaseAliases: service.httpBaseAliases,
          ownerPubkey: params.ownerPubkey,
          identifier: params.identifier,
        })
      );
      if (matchingService) return !relayKeys.has(graspServiceKey(matchingService.relayUrl));

      const matchesCoordinate = hasMatchingGraspRepoCloneUrl([cloneUrl], {
        relayUrl: parsed.httpBase,
        ownerPubkey: params.ownerPubkey,
        identifier: params.identifier,
      });
      return matchesCoordinate && !relayKeys.has(graspServiceKey(parsed.httpBase));
    })
  );
}

export function assertGraspCloneRelayCoupling(params: {
  repoRelayUrls: readonly string[];
  cloneUrls: readonly string[];
  knownServices: readonly GraspServiceDescriptor[];
  ownerPubkey: string;
  identifier: string;
  allowedUnlistedCloneUrls?: readonly string[];
}): void {
  const unbackedRelays = getUnbackedGraspCloneRelayUrls(params);
  if (unbackedRelays.length > 0) {
    throw new Error(formatUnbackedGraspRelayError(unbackedRelays));
  }
  const allowedUnlistedCloneUrls = new Set(
    (params.allowedUnlistedCloneUrls || []).map(cloneUrlKey).filter(Boolean)
  );
  const orphanedClones = getOrphanedGraspCloneUrls({
    ...params,
    cloneUrls: params.cloneUrls.filter((url) => !allowedUnlistedCloneUrls.has(cloneUrlKey(url))),
  });
  if (orphanedClones.length > 0) {
    throw new Error(
      `${orphanedClones.join(", ")} can only be included when its matching GRASP repository relay is listed.`
    );
  }
}

export function formatUnbackedGraspRelayError(relayUrls: readonly string[]): string {
  return `${relayUrls.join(", ")} can only be used as a repository relay when its matching GRASP remote is selected and its clone URL is included.`;
}
