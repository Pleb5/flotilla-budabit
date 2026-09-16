import {pubkey, publishThunk, signer} from "@welshman/app"
import {request} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {makeBudabitBlossomAuthEvent, makeBudabitBlossomAuthHeader} from "@app/util/blossom-auth"

export type PreparedDiagnosticsArtifact = {
  filename: string
  encoding: "gzip" | "identity"
  contentType: "application/gzip" | "application/json"
  bytes: Uint8Array
  sha256: string
  uncompressedBytes: number
}

export type DiagnosticsPublishStage =
  | "preparing"
  | "signing-upload"
  | "uploading"
  | "verifying-upload"
  | "signing-run"
  | "publishing-run"
  | "verifying-run"
  | "signing-latest"
  | "publishing-latest"
  | "verifying-latest"
  | "complete"

export type DiagnosticsEventTemplate = {
  kind: number
  created_at: number
  content: string
  tags: string[][]
}

type Signer = {sign: (template: DiagnosticsEventTemplate) => Promise<TrustedEvent>}

export type DiagnosticsPublishDependencies<T extends PreparedDiagnosticsArtifact> = {
  getIdentity: () => {pubkey: string; signer: Signer | undefined}
  upload: (
    artifact: T,
    server: string,
    authorization: string,
  ) => Promise<{url: string; sha256: string; size?: number}>
  verifyUpload: (artifact: T, url: string) => Promise<boolean>
  publish: (event: TrustedEvent, relays: string[]) => Promise<number>
  verify: (event: TrustedEvent, relays: string[]) => Promise<boolean>
}

export const uploadDiagnosticsArtifact = async <T extends PreparedDiagnosticsArtifact>(
  artifact: T,
  server: string,
  fetcher: typeof fetch = fetch,
  authorization = "",
) => {
  artifact = {...artifact, bytes: artifact.bytes.slice()}
  const origin = server.replace(/\/+$/, "")
  const response = await fetcher(`${origin}/upload`, {
    method: "PUT",
    headers: {
      "content-type": artifact.contentType,
      "x-sha-256": artifact.sha256,
      ...(authorization ? {authorization} : {}),
    },
    body: artifact.bytes as BodyInit,
  })
  if (!response.ok) throw new Error(`Blossom upload failed (${response.status})`)

  const descriptor = (await response.json()) as {url?: unknown; sha256?: unknown; size?: unknown}
  const sha256 = typeof descriptor.sha256 === "string" ? descriptor.sha256.toLowerCase() : ""
  const url = typeof descriptor.url === "string" ? descriptor.url : ""
  if (!url || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Blossom returned an invalid blob descriptor")
  }
  if (sha256 !== artifact.sha256) throw new Error("Blossom artifact hash mismatch")

  return {
    url,
    sha256,
    size: typeof descriptor.size === "number" ? descriptor.size : undefined,
  }
}

export const verifyDiagnosticsArtifactUpload = async <T extends PreparedDiagnosticsArtifact>(
  artifact: T,
  url: string,
  fetcher: typeof fetch = fetch,
) => {
  const response = await fetcher(url, {cache: "no-store", redirect: "error"})
  if (!response.ok) return false

  const uploaded = new Uint8Array(await response.arrayBuffer())
  if (uploaded.length !== artifact.bytes.length) return false
  return uploaded.every((value, index) => value === artifact.bytes[index])
}

const defaultPublish = async (event: TrustedEvent, relays: string[]) => {
  const thunk = publishThunk({event, relays})
  await thunk.complete
  return Object.values(thunk.results || {}).filter(result => result?.status === "success").length
}

const defaultVerify = async (event: TrustedEvent, relays: string[]) => {
  const events = await request({
    relays,
    filters: [{ids: [event.id], limit: 1}],
    autoClose: true,
    signal: AbortSignal.timeout(5_000),
  })
  return events.some(candidate => candidate.id === event.id)
}

const makeDefaultDependencies = <
  T extends PreparedDiagnosticsArtifact,
>(): DiagnosticsPublishDependencies<T> => ({
  getIdentity: () => ({
    pubkey: pubkey.get() || "",
    signer: signer.get() as unknown as Signer | undefined,
  }),
  upload: (artifact, server, authorization) =>
    uploadDiagnosticsArtifact(artifact, server, fetch, authorization),
  verifyUpload: (artifact, url) => verifyDiagnosticsArtifactUpload(artifact, url, fetch),
  publish: defaultPublish,
  verify: defaultVerify,
})

export const publishVerifiedDiagnosticsArtifact = async <T extends PreparedDiagnosticsArtifact>({
  artifact,
  blossomServer,
  relays,
  runDTag,
  latestDTag,
  buildManifest,
  onStage,
  dependencies = makeDefaultDependencies<T>(),
}: {
  artifact: T
  blossomServer: string
  relays: string[]
  runDTag: string
  latestDTag: string
  buildManifest: (dTag: string, artifactUrl: string) => DiagnosticsEventTemplate
  onStage?: (stage: DiagnosticsPublishStage) => void
  dependencies?: DiagnosticsPublishDependencies<T>
}) => {
  // Keep the artifact bytes stable across signing, upload and verification.
  artifact = {...artifact, bytes: artifact.bytes.slice()}
  const initial = dependencies.getIdentity()
  if (!initial.pubkey) throw new Error("Log in before publishing diagnostics")
  if (!initial.signer) throw new Error("No active signer available")
  const assertIdentity = () => {
    const current = dependencies.getIdentity()
    if (current.pubkey !== initial.pubkey || current.signer !== initial.signer) {
      throw new Error("Active account changed during diagnostics publication")
    }
  }

  onStage?.("signing-upload")
  assertIdentity()
  const uploadAuthEvent = await initial.signer.sign(
    makeBudabitBlossomAuthEvent({
      action: "upload",
      server: blossomServer,
      hashes: [artifact.sha256],
    }),
  )
  assertIdentity()
  if (uploadAuthEvent.pubkey !== initial.pubkey)
    throw new Error("Signer returned the wrong account")

  onStage?.("uploading")
  assertIdentity()
  const uploaded = await dependencies.upload(
    artifact,
    blossomServer,
    makeBudabitBlossomAuthHeader(uploadAuthEvent),
  )
  assertIdentity()
  if (uploaded.size !== undefined && uploaded.size !== artifact.bytes.length) {
    throw new Error("Blossom artifact size mismatch")
  }

  onStage?.("verifying-upload")
  assertIdentity()
  const uploadVerified = await dependencies.verifyUpload(artifact, uploaded.url)
  assertIdentity()
  if (!uploadVerified) throw new Error("Blossom artifact upload could not be read back exactly")

  const publishManifest = async (
    dTag: string,
    signStage: DiagnosticsPublishStage,
    publishStage: DiagnosticsPublishStage,
    verifyStage: DiagnosticsPublishStage,
  ) => {
    onStage?.(signStage)
    assertIdentity()
    const event = await initial.signer!.sign(buildManifest(dTag, uploaded.url))
    assertIdentity()
    if (event.pubkey !== initial.pubkey) throw new Error("Signer returned the wrong account")

    onStage?.(publishStage)
    assertIdentity()
    const accepted = await dependencies.publish(event, relays)
    assertIdentity()
    if (accepted < 1) throw new Error("Diagnostics manifest was not accepted by any relay")

    onStage?.(verifyStage)
    assertIdentity()
    const verified = await dependencies.verify(event, relays)
    assertIdentity()
    if (!verified) throw new Error("Diagnostics manifest was acknowledged but not found on relay")
    return event
  }

  const runEvent = await publishManifest(runDTag, "signing-run", "publishing-run", "verifying-run")
  const latestEvent = await publishManifest(
    latestDTag,
    "signing-latest",
    "publishing-latest",
    "verifying-latest",
  )
  onStage?.("complete")

  return {uploaded, runEvent, latestEvent, pubkey: initial.pubkey}
}
