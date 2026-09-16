import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
import {
  publishVerifiedDiagnosticsArtifact,
  uploadDiagnosticsArtifact,
  verifyDiagnosticsArtifactUpload,
  type DiagnosticsEventTemplate,
  type DiagnosticsPublishDependencies,
  type DiagnosticsPublishStage,
} from "@app/core/diagnostics-artifact-publish"
import {
  PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  PERFORMANCE_DIAGNOSTICS_DEFAULT_RELAY,
  PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  type PreparedPerformanceDiagnosticsArtifact,
} from "@app/core/performance-diagnostics"

export const PERFORMANCE_DIAGNOSTICS_MANIFEST_KIND = 30078
export const PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG = "budabit-performance-latest"
export const PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX = "budabit-performance-run:"

export type PerformanceDiagnosticsPublishStage = DiagnosticsPublishStage

export type PerformanceDiagnosticsManifestInput = {
  artifact: PreparedPerformanceDiagnosticsArtifact
  artifactUrl: string
  runId: string
  routes: string[]
  dTag: string
  createdAt?: number
}

export const buildPerformanceDiagnosticsManifest = ({
  artifact,
  artifactUrl,
  runId,
  routes,
  dTag,
  createdAt = Math.floor(Date.now() / 1000),
}: PerformanceDiagnosticsManifestInput): DiagnosticsEventTemplate => {
  const content = JSON.stringify({
    schema: "budabit-performance-manifest-v1",
    artifact: {
      url: artifactUrl,
      sha256: artifact.sha256,
      bytes: artifact.bytes.length,
      uncompressedBytes: artifact.uncompressedBytes,
      encoding: artifact.encoding,
      contentType: artifact.contentType,
    },
    runId,
    routes,
    build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  })

  return {
    kind: PERFORMANCE_DIAGNOSTICS_MANIFEST_KIND,
    created_at: createdAt,
    content,
    tags: [
      ["d", dTag],
      ["x", artifact.sha256],
      ["url", artifactUrl],
      ["run", runId],
      ["schema", String(PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION)],
      ["encoding", artifact.encoding],
      ["size", String(artifact.bytes.length)],
      ["build", APP_BUILD_ID, APP_BUILD_HASH],
      ...Array.from(new Set(routes)).map(route => ["route", route]),
    ],
  }
}

export const uploadPerformanceDiagnosticsArtifact = async (
  artifact: PreparedPerformanceDiagnosticsArtifact,
  server = PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  fetcher: typeof fetch = fetch,
  authorization = "",
) => uploadDiagnosticsArtifact(artifact, server, fetcher, authorization)

export const verifyPerformanceDiagnosticsArtifactUpload = async (
  artifact: PreparedPerformanceDiagnosticsArtifact,
  url: string,
  fetcher: typeof fetch = fetch,
) => verifyDiagnosticsArtifactUpload(artifact, url, fetcher)

export const publishPerformanceDiagnosticsArtifact = async ({
  artifact,
  runId,
  routes,
  blossomServer = PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  relays = [PERFORMANCE_DIAGNOSTICS_DEFAULT_RELAY],
  onStage,
  dependencies,
}: {
  artifact: PreparedPerformanceDiagnosticsArtifact
  runId: string
  routes: string[]
  blossomServer?: string
  relays?: string[]
  onStage?: (stage: PerformanceDiagnosticsPublishStage) => void
  dependencies?: DiagnosticsPublishDependencies<PreparedPerformanceDiagnosticsArtifact>
}) =>
  publishVerifiedDiagnosticsArtifact({
    artifact,
    blossomServer,
    relays,
    runDTag: `${PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX}${runId}`,
    latestDTag: PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG,
    buildManifest: (dTag, artifactUrl) =>
      buildPerformanceDiagnosticsManifest({artifact, artifactUrl, runId, routes, dTag}),
    onStage,
    dependencies,
  })
