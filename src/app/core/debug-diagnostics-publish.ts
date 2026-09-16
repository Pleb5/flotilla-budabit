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
  DEBUG_DIAGNOSTICS_DEFAULT_BLOSSOM,
  DEBUG_DIAGNOSTICS_DEFAULT_RELAY,
  DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
  type DebugDiagnosticCategory,
  type PreparedDebugDiagnosticsArtifact,
} from "@app/core/debug-diagnostics"

export const DEBUG_DIAGNOSTICS_MANIFEST_KIND = 30078
export const DEBUG_DIAGNOSTICS_LATEST_D_TAG = "budabit-debug-latest"
export const DEBUG_DIAGNOSTICS_RUN_D_TAG_PREFIX = "budabit-debug-run:"
export type DebugDiagnosticsPublishStage = DiagnosticsPublishStage

export type DebugDiagnosticsManifestInput = {
  artifact: PreparedDebugDiagnosticsArtifact
  artifactUrl: string
  runId: string
  categories: DebugDiagnosticCategory[]
  recordCount: number
  observationCount: number
  dTag: string
  createdAt?: number
}

export const buildDebugDiagnosticsManifest = ({
  artifact,
  artifactUrl,
  runId,
  categories,
  recordCount,
  observationCount,
  dTag,
  createdAt = Math.floor(Date.now() / 1000),
}: DebugDiagnosticsManifestInput): DiagnosticsEventTemplate => ({
  kind: DEBUG_DIAGNOSTICS_MANIFEST_KIND,
  created_at: createdAt,
  content: JSON.stringify({
    schema: "budabit-debug-manifest-v1",
    artifact: {
      url: artifactUrl,
      sha256: artifact.sha256,
      bytes: artifact.bytes.length,
      uncompressedBytes: artifact.uncompressedBytes,
      encoding: artifact.encoding,
      contentType: artifact.contentType,
    },
    runId,
    categories,
    recordCount,
    observationCount,
    build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
    diagnosticsSchemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
  }),
  tags: [
    ["d", dTag],
    ["x", artifact.sha256],
    ["url", artifactUrl],
    ["run", runId],
    ["schema", String(DEBUG_DIAGNOSTICS_SCHEMA_VERSION)],
    ["encoding", artifact.encoding],
    ["size", String(artifact.bytes.length)],
    ["records", String(recordCount)],
    ["observations", String(observationCount)],
    ["build", APP_BUILD_ID, APP_BUILD_HASH],
    ...Array.from(new Set(categories)).map(category => ["category", category]),
  ],
})

export const uploadDebugDiagnosticsArtifact = async (
  artifact: PreparedDebugDiagnosticsArtifact,
  server = DEBUG_DIAGNOSTICS_DEFAULT_BLOSSOM,
  fetcher: typeof fetch = fetch,
  authorization = "",
) => uploadDiagnosticsArtifact(artifact, server, fetcher, authorization)

export const verifyDebugDiagnosticsArtifactUpload = async (
  artifact: PreparedDebugDiagnosticsArtifact,
  url: string,
  fetcher: typeof fetch = fetch,
) => verifyDiagnosticsArtifactUpload(artifact, url, fetcher)

export const publishDebugDiagnosticsArtifact = async ({
  artifact,
  runId,
  categories,
  recordCount,
  observationCount,
  blossomServer = DEBUG_DIAGNOSTICS_DEFAULT_BLOSSOM,
  relays = [DEBUG_DIAGNOSTICS_DEFAULT_RELAY],
  onStage,
  dependencies,
}: {
  artifact: PreparedDebugDiagnosticsArtifact
  runId: string
  categories: DebugDiagnosticCategory[]
  recordCount: number
  observationCount: number
  blossomServer?: string
  relays?: string[]
  onStage?: (stage: DebugDiagnosticsPublishStage) => void
  dependencies?: DiagnosticsPublishDependencies<PreparedDebugDiagnosticsArtifact>
}) =>
  publishVerifiedDiagnosticsArtifact({
    artifact,
    blossomServer,
    relays,
    runDTag: `${DEBUG_DIAGNOSTICS_RUN_D_TAG_PREFIX}${runId}`,
    latestDTag: DEBUG_DIAGNOSTICS_LATEST_D_TAG,
    buildManifest: (dTag, artifactUrl) =>
      buildDebugDiagnosticsManifest({
        artifact,
        artifactUrl,
        runId,
        categories,
        recordCount,
        observationCount,
        dTag,
      }),
    onStage,
    dependencies,
  })
