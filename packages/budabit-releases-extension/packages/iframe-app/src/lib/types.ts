// ── NIP-82 Constants ─────────────────────────────────────────────────────────

export const APP_KIND = 32267;
export const RELEASE_KIND = 30063;
export const ASSET_KIND = 3063;

/** Legacy kind used by loom pipeline artifact uploads */
export const LEGACY_ARTIFACT_KIND = 1063;

/** Standard release channels (NIP-82 Appendix B) */
export const CHANNELS = ['main', 'beta', 'nightly', 'dev'] as const;
export type Channel = string;

/** Platform identifiers (NIP-82 Appendix A) */
export const PLATFORMS = [
  'android-arm64-v8a',
  'android-armeabi-v7a',
  'android-x86',
  'android-x86_64',
  'darwin-arm64',
  'darwin-x86_64',
  'linux-aarch64',
  'linux-x86_64',
  'linux-armv7l',
  'linux-riscv64',
  'windows-aarch64',
  'windows-x86_64',
  'ios-arm64',
  'freebsd-x86_64',
  'freebsd-aarch64',
  'wasm32',
  'wasm64',
  'wasi-wasm32',
  'wasi-wasm64',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** NIP-82 Appendix C: Supported MIME types → platform + common extension */
export const MIME_TYPES: Record<string, { platform: string; extension: string }> = {
  'application/vnd.android.package-archive': { platform: 'Android', extension: '.apk' },
  'application/vnd.apple.ipa': { platform: 'iOS', extension: '.ipa' },
  'application/x-apple-diskimage': { platform: 'macOS', extension: '.dmg' },
  'application/vnd.apple.installer+xml': { platform: 'macOS', extension: '.pkg' },
  'application/x-msi': { platform: 'Windows', extension: '.msi' },
  'application/vnd.appimage': { platform: 'Linux', extension: '.AppImage' },
  'application/vnd.flatpak': { platform: 'Linux (Flatpak)', extension: '.flatpak' },
  'application/vnd.oci.image.manifest.v1+json': { platform: 'OCI', extension: '' },
  'application/x-executable': { platform: 'Linux (ELF)', extension: '' },
  'application/x-mach-binary': { platform: 'macOS (Mach-O)', extension: '' },
  'application/vnd.microsoft.portable-executable': { platform: 'Windows (PE)', extension: '.exe' },
  'application/vsix': { platform: 'VS Code', extension: '.vsix' },
  'application/x-chrome-extension': { platform: 'Chrome', extension: '.crx' },
  'application/x-xpinstall': { platform: 'Firefox', extension: '.xpi' },
  'application/wasm': { platform: 'Browser/WASI', extension: '.wasm' },
  'application/webbundle': { platform: 'Browser (PWA)', extension: '.wbn' },
};

// ── NIP-82 kind 32267: Software Application ──────────────────────────────────

export interface SoftwareApplication {
  id: string;
  pubkey: string;
  appId: string; // d tag (reverse-domain identifier)
  name: string; // name tag
  summary?: string; // summary tag
  description: string; // content (markdown)
  iconUrl?: string; // icon tag
  imageUrls: string[]; // image tags
  tags: string[]; // t tags
  websiteUrl?: string; // url tag
  repositoryUrl?: string; // repository tag
  repoAddress?: string; // a tag (30617:pubkey:name)
  platforms: string[]; // f tags
  license?: string; // license tag
  createdAt: number;
}

// ── NIP-82 kind 3063: Software Asset ─────────────────────────────────────────

export interface SoftwareAsset {
  eventId: string;
  pubkey: string;
  appId: string; // i tag
  url?: string; // url tag (blossom URL)
  mimeType: string; // m tag
  sha256: string; // x tag
  size?: number; // size tag
  version: string; // version tag
  platforms: string[]; // f tags
  minPlatformVersion?: string;
  targetPlatformVersion?: string;
  variant?: string; // variant tag
  commitId?: string; // commit tag
  minAllowedVersion?: string;
  // Android-specific
  versionCode?: number;
  apkCertificateHashes: string[];
  // Display helpers
  filename: string; // derived from url basename or variant
}

// ── NIP-82 kind 30063: Software Release ──────────────────────────────────────

export interface SoftwareRelease {
  id: string;
  pubkey: string;
  appId: string; // i tag
  version: string; // version tag
  dTag: string; // d tag (<appId>@<version>)
  channel: string; // c tag
  releaseNotes: string; // content (markdown)
  assetEventIds: string[]; // e tag ids (order preserved)
  assets: SoftwareAsset[];
  unresolvedAssetIds: string[];
  complete: boolean;
  createdAt: number;
}

export interface ReleaseListItem {
  id: string;
  pubkey: string;
  appId: string;
  version: string;
  channel: string;
  assetCount: number;
  createdAt: number;
}

// ── Pipeline artifacts (kind 1063 from loom workers) ─────────────────────────
// These are the raw build outputs before being wrapped into NIP-82 kind 3063
// asset events during release creation.

export interface Artifact {
  eventId: string;
  url: string; // url tag (blossom URL)
  sha256: string; // x tag
  filename: string; // filename or name tag
  mimeType: string; // m tag
  size?: number; // size tag (bytes)
  appId?: string;
  version?: string;
  platforms?: string[];
  versionCode?: number;
  apkCertificateHashes?: string[];
  minPlatformVersion?: string;
  targetPlatformVersion?: string;
  variant?: string;
  // Enriched from pipeline run context
  pipelineRunId?: string;
  workflowName?: string;
  branch?: string;
  commitId?: string;
}

// ── kind 5401 workflow run ───────────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  workflowName: string;
  branch: string;
  commitId: string;
  createdAt: number;
  ephemeralPubkey: string; // publisher tag
  triggeredBy: string; // triggered-by tag
}
