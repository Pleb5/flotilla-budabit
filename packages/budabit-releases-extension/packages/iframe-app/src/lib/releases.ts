import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { normalizeRelays, type RepoContext } from './context.js';
import { authorizedApplication, authorizedRelease, replacements, verifiedEvent } from './trust.js';
import { HEX_KEY } from './context.js';
import { safeAssetUrl } from './binary.js';
import { queryAll } from './query.js';
import type {
  SoftwareRelease,
  SoftwareAsset,
  SoftwareApplication,
  ReleaseListItem,
  Artifact,
} from './types.js';
import { APP_KIND, RELEASE_KIND, ASSET_KIND } from './types.js';

export const FALLBACK_RELAYS = [
  'wss://relay.zapstore.dev', // where zapstore-published apps/releases live
  'wss://relay.sharegap.net',
  'wss://nos.lol',
];

/** Hosts cap extension subscriptions at 8 relays. */
const MAX_QUERY_RELAYS = 8;

export function getRelays(repoRelays: string[] | undefined): string[] {
  // The zapstore relay comes first — it's where zapstore-published apps,
  // releases, and assets actually live — followed by the repo's own relays,
  // then generic fallbacks. Capped to the host's per-subscription relay limit,
  // so with many repo relays the generic fallbacks are dropped first.
  const [zapstoreRelay, ...genericFallbacks] = FALLBACK_RELAYS;
  const merged = [zapstoreRelay, ...(repoRelays ?? []), ...genericFallbacks];
  return normalizeRelays(merged).slice(0, MAX_QUERY_RELAYS);
}

export async function queryEvents(
  bridge: WidgetBridge,
  relays: string[],
  filter: Record<string, unknown>
): Promise<NostrEvent[]> {
  const response = await queryAll(bridge, relays, filter);
  if (!response.complete)
    throw new Error(
      response.errors?.join('; ') ||
        'Discovery is incomplete (relay timeout, pagination bound, or older host). Retry before publishing.'
    );
  return response.events;
}

export function tagValue(event: NostrEvent, tagName: string): string | undefined {
  return event.tags.find((tag) => tag[0] === tagName)?.[1];
}

export function tagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName)
    .map((tag) => tag[1])
    .filter((value): value is string => Boolean(value));
}

// ── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Derive a display filename from a kind 3063 asset event.
 * Prefers: explicit filename → url basename → variant → sha256 truncation.
 */
function deriveFilename(event: NostrEvent): string {
  const filename = tagValue(event, 'filename');
  if (filename) return filename;
  const url = tagValue(event, 'url');
  if (url) {
    try {
      const path = new URL(url).pathname;
      const basename = path.split('/').pop();
      if (basename && basename.length > 0 && basename !== '/') return basename;
    } catch {
      /* ignore */
    }
  }
  const variant = tagValue(event, 'variant');
  if (variant) return variant;
  const sha = tagValue(event, 'x');
  return sha ? sha.slice(0, 12) : 'asset';
}

export function parseAsset(event: NostrEvent): SoftwareAsset | null {
  const sha256 = tagValue(event, 'x');
  const mimeType = tagValue(event, 'm');
  if (
    event.kind !== ASSET_KIND ||
    !verifiedEvent(event) ||
    !sha256 ||
    !HEX_KEY.test(sha256) ||
    !mimeType ||
    !tagValue(event, 'i') ||
    !tagValue(event, 'version') ||
    (tagValue(event, 'url') && !safeAssetUrl(tagValue(event, 'url')))
  )
    return null;

  const sizeStr = tagValue(event, 'size');
  const vcStr = tagValue(event, 'version_code');

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    appId: tagValue(event, 'i') ?? '',
    url: tagValue(event, 'url'),
    mimeType,
    sha256,
    size:
      sizeStr !== undefined && /^\d+$/.test(sizeStr) && Number.isSafeInteger(Number(sizeStr))
        ? Number(sizeStr)
        : undefined,
    version: tagValue(event, 'version') ?? '',
    platforms: tagValues(event, 'f'),
    minPlatformVersion: tagValue(event, 'min_platform_version'),
    targetPlatformVersion: tagValue(event, 'target_platform_version'),
    variant: tagValue(event, 'variant'),
    commitId: tagValue(event, 'commit'),
    minAllowedVersion: tagValue(event, 'min_allowed_version'),
    versionCode:
      vcStr !== undefined && /^\d+$/.test(vcStr) && Number.isSafeInteger(Number(vcStr))
        ? Number(vcStr)
        : undefined,
    apkCertificateHashes: tagValues(event, 'apk_certificate_hash'),
    filename: deriveFilename(event),
  };
}

export function parseReleaseListItem(event: NostrEvent): ReleaseListItem {
  return {
    id: event.id,
    pubkey: event.pubkey,
    appId: tagValue(event, 'i') ?? '',
    version: tagValue(event, 'version') ?? tagValue(event, 'd')?.split('@').pop() ?? 'unknown',
    channel: tagValue(event, 'c') ?? 'main',
    assetCount: event.tags.filter((t) => t[0] === 'e').length,
    createdAt: event.created_at,
  };
}

export function parseApplication(event: NostrEvent): SoftwareApplication {
  return {
    id: event.id,
    pubkey: event.pubkey,
    appId: tagValue(event, 'd') ?? '',
    name: tagValue(event, 'name') ?? tagValue(event, 'd') ?? '',
    summary: tagValue(event, 'summary'),
    description: event.content,
    iconUrl: tagValue(event, 'icon'),
    imageUrls: tagValues(event, 'image'),
    tags: tagValues(event, 't'),
    websiteUrl: tagValue(event, 'url'),
    repositoryUrl: tagValue(event, 'repository'),
    repoAddress: event.tags.find((t) => t[0] === 'a' && t[1]?.startsWith('30617:'))?.[1],
    platforms: tagValues(event, 'f'),
    license: tagValue(event, 'license'),
    createdAt: event.created_at,
  };
}

// ── Application discovery ────────────────────────────────────────────────────

/**
 * Exact repository identity only; display names and URL basenames are not authority.
 */
export function appMatchesRepo(app: SoftwareApplication, repo: RepoContext): boolean {
  return app.repoAddress === repo.repoAddress && repo.maintainers.includes(app.pubkey);
}

/**
 * Find kind 32267 Software Application events that belong to this repo.
 * Query publisher namespaces before filtering links so newer revisions can revoke a link.
 */
export async function loadRepoApps(
  bridge: WidgetBridge,
  repo: RepoContext,
  candidates: NostrEvent[] = []
): Promise<SoftwareApplication[]> {
  const relays = getRelays(repo.repoRelays);

  const authors = [...new Set([repo.repoPubkey, ...repo.maintainers].filter(Boolean))] as string[];

  // Query by authors so a replacement removing the repo link can revoke it.
  const results = await queryEvents(bridge, relays, { kinds: [APP_KIND], authors });
  // A saved signed application is a candidate revision, never a substitute for
  // current discovery. In particular, reconcile revocations BEFORE authorization.
  return replacements([
    ...results,
    ...candidates.map(verifiedEvent).filter((e): e is NostrEvent => !!e),
  ])
    .filter((event) => authorizedApplication(event, repo))
    .map(parseApplication);
}

// ── Release data loading ─────────────────────────────────────────────────────

/**
 * Load full release detail: fetch linked kind 3063 asset events.
 */
export interface ReleaseAuthority {
  apps: SoftwareApplication[];
  events: NostrEvent[];
}

export async function loadReleaseDetail(
  bridge: WidgetBridge,
  repo: RepoContext,
  releaseEvent: NostrEvent,
  currentAuthority: () => ReleaseAuthority
): Promise<SoftwareRelease> {
  const assertCurrent = () => {
    const current = currentAuthority();
    if (
      !current.events.some((e) => e.id === releaseEvent.id) ||
      !authorizedRelease(releaseEvent, repo, current.apps)
    )
      throw new Error('Release is not the current authorized revision');
  };
  assertCurrent();
  const relays = normalizeRelays([
    ...releaseEvent.tags.filter((t) => t[0] === 'e').map((t) => t[2]),
    ...getRelays(repo.repoRelays),
  ]).slice(0, 8);
  const appId = tagValue(releaseEvent, 'i') ?? '';
  const version =
    tagValue(releaseEvent, 'version') ?? tagValue(releaseEvent, 'd')?.split('@').pop() ?? 'unknown';
  const dTag = tagValue(releaseEvent, 'd') ?? `${appId}@${version}`;
  const channel = tagValue(releaseEvent, 'c') ?? 'main';
  const assetEventIds = [
    ...new Set(
      releaseEvent.tags
        .filter((tag) => tag[0] === 'e')
        .map((tag) => tag[1])
        .filter((id): id is string => Boolean(id))
    ),
  ];

  let assets: SoftwareAsset[] = [];
  let complete = true;
  if (assetEventIds.length > 0) {
    const result = await queryAll(bridge, relays, {
      kinds: [ASSET_KIND],
      ids: assetEventIds,
    });
    complete = result.complete;
    assets = result.events.map(parseAsset).filter((a): a is SoftwareAsset => a !== null);
    // Preserve declaration order from the release event
    const byId = new Map(assets.map((a) => [a.eventId, a]));
    assets = assetEventIds.map((id) => byId.get(id)).filter((a): a is SoftwareAsset => !!a);
  }

  assertCurrent();
  return {
    id: releaseEvent.id,
    pubkey: releaseEvent.pubkey,
    appId,
    version,
    dTag,
    channel,
    releaseNotes: releaseEvent.content,
    assetEventIds,
    assets,
    unresolvedAssetIds: assetEventIds.filter((id) => !assets.some((a) => a.eventId === id)),
    complete,
    createdAt: releaseEvent.created_at,
  };
}

// ── Event builders ───────────────────────────────────────────────────────────

/**
 * Build an unsigned kind 32267 Software Application event.
 */
export function buildApplicationEvent(opts: {
  appId: string;
  name: string;
  description?: string;
  summary?: string;
  repoAddress: string; // 30617:pubkey:identifier
  repoRelay: string;
  repositoryUrl?: string;
  license?: string;
}): Record<string, unknown> {
  const tags: string[][] = [
    ['d', opts.appId],
    ['name', opts.name],
    ['a', opts.repoAddress, opts.repoRelay],
  ];
  if (opts.summary) tags.push(['summary', opts.summary]);
  if (opts.repositoryUrl) tags.push(['repository', opts.repositoryUrl]);
  if (opts.license) tags.push(['license', opts.license]);

  return {
    kind: APP_KIND,
    content: opts.description ?? '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Build an unsigned kind 3063 Software Asset event from a pipeline artifact.
 */
export function buildAssetEvent(opts: {
  appId: string;
  version: string;
  artifact: Artifact;
  platforms?: string[];
  commitId?: string;
  variant?: string;
}): Record<string, unknown> {
  const artifact = opts.artifact;
  if (!HEX_KEY.test(artifact.sha256) || !safeAssetUrl(artifact.url))
    throw new Error('Asset needs a valid SHA-256 and HTTPS URL');
  if (!artifact.mimeType.includes('/')) throw new Error('Asset needs a MIME type');
  if (artifact.size !== undefined && (!Number.isSafeInteger(artifact.size) || artifact.size < 0))
    throw new Error('Invalid asset size');
  if (
    artifact.mimeType === 'application/vnd.android.package-archive' &&
    (!Number.isSafeInteger(artifact.versionCode) ||
      (artifact.versionCode ?? -1) < 0 ||
      !artifact.apkCertificateHashes?.length ||
      artifact.apkCertificateHashes.some((h) => !HEX_KEY.test(h)))
  ) {
    throw new Error('APK requires version_code and apk_certificate_hash metadata');
  }
  const tags: string[][] = [
    ['i', artifact.appId || opts.appId],
    ['version', artifact.version || opts.version],
    ['m', opts.artifact.mimeType],
    ['x', opts.artifact.sha256],
    ['filename', artifact.filename],
  ];
  if (opts.artifact.url) tags.push(['url', opts.artifact.url]);
  if (opts.artifact.size != null) tags.push(['size', String(opts.artifact.size)]);
  if (artifact.platforms ?? opts.platforms) {
    for (const p of artifact.platforms ?? opts.platforms ?? []) tags.push(['f', p]);
  }
  const commitId = opts.artifact.commitId ?? opts.commitId;
  if (commitId) tags.push(['commit', commitId]);
  if (opts.variant) tags.push(['variant', opts.variant]);
  else if (artifact.variant) tags.push(['variant', artifact.variant]);
  if (artifact.versionCode !== undefined) tags.push(['version_code', String(artifact.versionCode)]);
  for (const hash of artifact.apkCertificateHashes ?? []) tags.push(['apk_certificate_hash', hash]);
  if (artifact.minPlatformVersion) tags.push(['min_platform_version', artifact.minPlatformVersion]);
  if (artifact.targetPlatformVersion)
    tags.push(['target_platform_version', artifact.targetPlatformVersion]);

  return {
    kind: ASSET_KIND,
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Build an unsigned kind 30063 Software Release event (NIP-82 compliant).
 */
export function buildReleaseEvent(opts: {
  appId: string;
  appPubkey: string;
  version: string;
  channel: string;
  assetEventIds: string[];
  releaseNotes: string;
  relayHint?: string;
  platforms?: string[];
}): Record<string, unknown> {
  if (!HEX_KEY.test(opts.appPubkey) || !opts.appId.trim() || !opts.version.trim())
    throw new Error('Invalid application coordinate or version');
  const tags: string[][] = [
    ['a', `32267:${opts.appPubkey}:${opts.appId}`, opts.relayHint ?? ''],
    ['d', `${opts.appId}@${opts.version}`],
    ['i', opts.appId],
    ['version', opts.version],
    ['c', opts.channel],
    ...opts.assetEventIds.map((id) => ['e', id, opts.relayHint ?? '']),
    ...[...new Set(opts.platforms ?? [])].map((platform) => ['f', platform]),
  ];

  return {
    kind: RELEASE_KIND,
    content: opts.releaseNotes,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12) + '…';
}

/** Resolve a blossom download URL for an asset (by SHA-256 if no URL tag). */
export function assetDownloadUrl(asset: SoftwareAsset, blossomServer?: string): string {
  if (asset.url) return safeAssetUrl(asset.url) ?? '';
  if (!HEX_KEY.test(asset.sha256)) return '';
  const server = blossomServer ?? 'https://blossom.primal.net';
  return safeAssetUrl(`${server}/${asset.sha256}`) ?? '';
}

/** Human-readable platform label from f-tag identifiers. */
export function platformLabel(platforms: string[]): string {
  if (platforms.length === 0) return 'Not declared';
  return platforms
    .map((p) => {
      const parts = p.split('-');
      const os = parts[0] ?? p;
      const arch = parts.slice(1).join('-');
      return arch ? `${os} (${arch})` : os;
    })
    .join(', ');
}
