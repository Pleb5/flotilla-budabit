import {describe, expect, it, vi} from "vitest"
import {gzipSync} from "node:zlib"
import type {TrustedEvent} from "@welshman/util"
import type {PreparedDebugDiagnosticsArtifact} from "./debug-diagnostics"
import {
  buildDebugDiagnosticsManifest,
  DEBUG_DIAGNOSTICS_LATEST_D_TAG,
  DEBUG_DIAGNOSTICS_RUN_D_TAG_PREFIX,
  publishDebugDiagnosticsArtifact,
  verifyDebugDiagnosticsArtifactUpload,
} from "./debug-diagnostics-publish"

const artifact: PreparedDebugDiagnosticsArtifact = {
  schemaVersion: 3,
  filename: "budabit-debug-run-1.json.gz",
  encoding: "gzip",
  contentType: "application/gzip",
  bytes: new Uint8Array(gzipSync('{"public":"fixture"}')),
  sha256: "a".repeat(64),
  uncompressedBytes: 20,
}

const signedEvent = (template: Record<string, unknown>, pubkey = "b".repeat(64)) =>
  ({...template, id: "c".repeat(64), pubkey, sig: "d".repeat(128)}) as TrustedEvent

const makeDependencies = (overrides: Record<string, unknown> = {}) => {
  const account = {pubkey: "b".repeat(64)}
  const signer = {sign: vi.fn(async template => signedEvent(template, account.pubkey))}
  return {
    account,
    signer,
    dependencies: {
      getIdentity: () => ({...account, signer}),
      upload: vi.fn(async () => ({
        url: "https://blossom.example/blob",
        sha256: artifact.sha256,
      })),
      verifyUpload: vi.fn(async () => true),
      publish: vi.fn(async () => 1),
      verify: vi.fn(async () => true),
      ...overrides,
    },
  }
}

describe("debug diagnostics publication", () => {
  it("builds the distinct immutable manifest contract", () => {
    const manifest = buildDebugDiagnosticsManifest({
      artifact,
      artifactUrl: `https://blossom.example/${artifact.sha256}`,
      runId: "run-1",
      categories: ["relay-scheduler", "relay-scheduler", "publication-lifecycle"],
      recordCount: 12,
      observationCount: 1_234,
      dTag: `${DEBUG_DIAGNOSTICS_RUN_D_TAG_PREFIX}run-1`,
      createdAt: 123,
    })

    expect(manifest).toMatchObject({kind: 30078, created_at: 123})
    expect(manifest.tags).toContainEqual(["d", "budabit-debug-run:run-1"])
    expect(manifest.tags).toContainEqual(["observations", "1234"])
    expect(manifest.tags.filter(tag => tag[0] === "category")).toEqual([
      ["category", "relay-scheduler"],
      ["category", "publication-lifecycle"],
    ])
    expect(JSON.parse(manifest.content)).toMatchObject({
      schema: "budabit-debug-manifest-v1",
      runId: "run-1",
      recordCount: 12,
      observationCount: 1_234,
      artifact: {sha256: artifact.sha256, bytes: artifact.bytes.length},
    })
  })

  it("verifies uploaded bytes exactly", async () => {
    await expect(
      verifyDebugDiagnosticsArtifactUpload(
        artifact,
        "https://blossom.example/blob",
        async () => new Response(new Blob([artifact.bytes as BlobPart])),
      ),
    ).resolves.toBe(true)
    await expect(
      verifyDebugDiagnosticsArtifactUpload(
        artifact,
        "https://blossom.example/blob",
        async () => new Response(new Blob([new Uint8Array([1, 2, 4]) as BlobPart])),
      ),
    ).resolves.toBe(false)
  })

  it("uploads, reads back, and publishes verified run and latest manifests", async () => {
    const {signer, dependencies} = makeDependencies()
    const stages: string[] = []
    await publishDebugDiagnosticsArtifact({
      artifact,
      runId: "run-1",
      categories: ["relay-normalization"],
      recordCount: 4,
      observationCount: 400,
      onStage: stage => stages.push(stage),
      dependencies,
    })

    expect(signer.sign).toHaveBeenCalledTimes(3)
    expect(dependencies.verifyUpload).toHaveBeenCalledWith(artifact, "https://blossom.example/blob")
    expect(dependencies.publish).toHaveBeenCalledTimes(2)
    expect(dependencies.verify).toHaveBeenCalledTimes(2)
    expect(signer.sign.mock.calls.map(call => call[0].tags[0])).toEqual([
      ["t", "upload"],
      ["d", "budabit-debug-run:run-1"],
      ["d", DEBUG_DIAGNOSTICS_LATEST_D_TAG],
    ])
    expect(stages.at(-1)).toBe("complete")
  })

  it("rejects identity changes and zero relay acknowledgements", async () => {
    const pubkey = "b".repeat(64)
    const signer = {sign: vi.fn(async template => signedEvent(template, pubkey))}
    let currentPubkey = pubkey
    await expect(
      publishDebugDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        categories: [],
        recordCount: 0,
        observationCount: 0,
        dependencies: {
          getIdentity: () => ({pubkey: currentPubkey, signer}),
          upload: async () => {
            currentPubkey = "f".repeat(64)
            return {url: "https://blossom.example/blob", sha256: artifact.sha256}
          },
          verifyUpload: async () => true,
          publish: async () => 1,
          verify: async () => true,
        },
      }),
    ).rejects.toThrow("account changed")

    const {dependencies} = makeDependencies({publish: async () => 0})
    await expect(
      publishDebugDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        categories: [],
        recordCount: 0,
        observationCount: 0,
        dependencies,
      }),
    ).rejects.toThrow("not accepted")
  })

  it("rejects failed Blossom and relay readback", async () => {
    const failedUpload = makeDependencies({verifyUpload: async () => false}).dependencies
    await expect(
      publishDebugDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        categories: [],
        recordCount: 0,
        observationCount: 0,
        dependencies: failedUpload,
      }),
    ).rejects.toThrow("could not be read back exactly")

    const failedManifest = makeDependencies({verify: async () => false}).dependencies
    await expect(
      publishDebugDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        categories: [],
        recordCount: 0,
        observationCount: 0,
        dependencies: failedManifest,
      }),
    ).rejects.toThrow("acknowledged but not found")
  })
})
