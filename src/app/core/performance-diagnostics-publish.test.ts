import {describe, expect, it, vi} from "vitest"
import {gzipSync} from "node:zlib"
import type {TrustedEvent} from "@welshman/util"
import {
  buildPerformanceDiagnosticsManifest,
  PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG,
  PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX,
  publishPerformanceDiagnosticsArtifact,
  uploadPerformanceDiagnosticsArtifact,
  verifyPerformanceDiagnosticsArtifactUpload,
} from "./performance-diagnostics-publish"
import type {PreparedPerformanceDiagnosticsArtifact} from "./performance-diagnostics"

const artifact: PreparedPerformanceDiagnosticsArtifact = {
  schemaVersion: 2,
  filename: "diagnostics.json.gz",
  encoding: "gzip",
  contentType: "application/gzip",
  bytes: new Uint8Array(gzipSync('{"public":"fixture"}')),
  sha256: "a".repeat(64),
  uncompressedBytes: 20,
}

const signedEvent = (template: Record<string, unknown>, pubkey = "b".repeat(64)) =>
  ({...template, id: "c".repeat(64), pubkey, sig: "d".repeat(128)}) as TrustedEvent

describe("performance diagnostics publication", () => {
  it("builds immutable and latest manifest contracts", () => {
    const manifest = buildPerformanceDiagnosticsManifest({
      artifact,
      artifactUrl: `https://blossom.example/${artifact.sha256}`,
      runId: "run-1",
      routes: ["/git", "/c/example", "/git"],
      dTag: `${PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX}run-1`,
      createdAt: 123,
    })

    expect(manifest).toMatchObject({kind: 30078, created_at: 123})
    expect(manifest.tags).toContainEqual(["d", "budabit-performance-run:run-1"])
    expect(manifest.tags).toContainEqual(["x", artifact.sha256])
    expect(manifest.tags?.filter(tag => tag[0] === "route")).toEqual([
      ["route", "/git"],
      ["route", "/c/example"],
    ])
    expect(JSON.parse(manifest.content)).toMatchObject({
      schema: "budabit-performance-manifest-v1",
      runId: "run-1",
      artifact: {sha256: artifact.sha256, encoding: "gzip", bytes: artifact.bytes.length},
    })
  })

  it("uploads exact bytes and rejects a mismatched hash", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT")
      expect(init?.body).toEqual(artifact.bytes)
      expect(new Headers(init?.headers).get("x-sha-256")).toBe(artifact.sha256)
      expect(new Headers(init?.headers).get("authorization")).toBe("Nostr signed-upload")
      return new Response(
        JSON.stringify({url: "https://blossom.example/blob", sha256: "e".repeat(64)}),
        {status: 200},
      )
    })

    await expect(
      uploadPerformanceDiagnosticsArtifact(
        artifact,
        "https://blossom.example/",
        fetcher,
        "Nostr signed-upload",
      ),
    ).rejects.toThrow("hash mismatch")
  })

  it("reports upload failures", async () => {
    await expect(
      uploadPerformanceDiagnosticsArtifact(
        artifact,
        "https://blossom.example",
        async () => new Response("no", {status: 500}),
      ),
    ).rejects.toThrow("Blossom upload failed (500)")
  })

  it("requires uploaded artifact readback to match the prepared bytes", async () => {
    await expect(
      verifyPerformanceDiagnosticsArtifactUpload(
        artifact,
        "https://blossom.example/blob",
        async () => new Response(new Blob([artifact.bytes as BlobPart])),
      ),
    ).resolves.toBe(true)
    await expect(
      verifyPerformanceDiagnosticsArtifactUpload(
        artifact,
        "https://blossom.example/blob",
        async () => new Response(new Blob([new Uint8Array([1, 2, 4]) as BlobPart])),
      ),
    ).resolves.toBe(false)
  })

  it("signs and publishes both manifests with relay acknowledgement", async () => {
    const account = {pubkey: "b".repeat(64)}
    const signer = {sign: vi.fn(async template => signedEvent(template, account.pubkey))}
    const publish = vi.fn(async (_event: TrustedEvent, _relays: string[]) => 1)
    const verify = vi.fn(async (_event: TrustedEvent, _relays: string[]) => true)
    const verifyUpload = vi.fn(async () => true)
    const upload = vi.fn(
      async (
        _artifact: PreparedPerformanceDiagnosticsArtifact,
        _server: string,
        _authorization: string,
      ) => ({
        url: "https://blossom.example/blob",
        sha256: artifact.sha256,
      }),
    )
    const stages: string[] = []
    const result = await publishPerformanceDiagnosticsArtifact({
      artifact,
      runId: "run-1",
      routes: ["/git"],
      onStage: stage => stages.push(stage),
      dependencies: {
        getIdentity: () => ({...account, signer}),
        upload,
        verifyUpload,
        publish,
        verify,
      },
    })

    expect(signer.sign).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls[0][2]).toMatch(/^Nostr /)
    expect(verifyUpload).toHaveBeenCalledWith(artifact, "https://blossom.example/blob")
    expect(publish).toHaveBeenCalledTimes(2)
    expect(verify).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls.map(call => call[1])).toEqual([
      ["wss://relay.budabit.club"],
      ["wss://relay.budabit.club"],
    ])
    expect(result.pubkey).toBe(account.pubkey)
    expect(signer.sign.mock.calls.map(call => call[0].tags?.[0])).toEqual([
      ["t", "upload"],
      ["d", "budabit-performance-run:run-1"],
      ["d", PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG],
    ])
    expect(stages).toEqual([
      "signing-upload",
      "uploading",
      "verifying-upload",
      "signing-run",
      "publishing-run",
      "verifying-run",
      "signing-latest",
      "publishing-latest",
      "verifying-latest",
      "complete",
    ])
  })

  it("rejects missing signers, account switches, and zero acknowledgements", async () => {
    const pubkey = "b".repeat(64)
    const signer = {sign: vi.fn(async template => signedEvent(template, pubkey))}
    const upload = async () => ({url: "https://blossom.example/blob", sha256: artifact.sha256})
    const base = {artifact, runId: "run-1", routes: ["/git"]}

    await expect(
      publishPerformanceDiagnosticsArtifact({
        ...base,
        dependencies: {
          getIdentity: () => ({pubkey, signer: undefined}),
          upload,
          verifyUpload: async () => true,
          publish: async () => 1,
          verify: async () => true,
        },
      }),
    ).rejects.toThrow("No active signer")

    let currentPubkey = pubkey
    await expect(
      publishPerformanceDiagnosticsArtifact({
        ...base,
        dependencies: {
          getIdentity: () => ({pubkey: currentPubkey, signer}),
          upload: async () => {
            const result = await upload()
            currentPubkey = "f".repeat(64)
            return result
          },
          verifyUpload: async () => true,
          publish: async () => 1,
          verify: async () => true,
        },
      }),
    ).rejects.toThrow("account changed")

    await expect(
      publishPerformanceDiagnosticsArtifact({
        ...base,
        dependencies: {
          getIdentity: () => ({pubkey, signer}),
          upload,
          verifyUpload: async () => true,
          publish: async () => 0,
          verify: async () => true,
        },
      }),
    ).rejects.toThrow("not accepted")
  })

  it("rejects an acknowledged manifest that cannot be read back", async () => {
    const pubkey = "b".repeat(64)
    const signer = {sign: vi.fn(async template => signedEvent(template, pubkey))}

    await expect(
      publishPerformanceDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        routes: ["/git"],
        dependencies: {
          getIdentity: () => ({pubkey, signer}),
          upload: async () => ({
            url: "https://blossom.example/blob",
            sha256: artifact.sha256,
          }),
          verifyUpload: async () => true,
          publish: async () => 1,
          verify: async () => false,
        },
      }),
    ).rejects.toThrow("acknowledged but not found")
  })

  it("rejects an uploaded artifact that cannot be read back exactly", async () => {
    const pubkey = "b".repeat(64)
    const signer = {sign: vi.fn(async template => signedEvent(template, pubkey))}

    await expect(
      publishPerformanceDiagnosticsArtifact({
        artifact,
        runId: "run-1",
        routes: ["/git"],
        dependencies: {
          getIdentity: () => ({pubkey, signer}),
          upload: async () => ({
            url: "https://blossom.example/blob",
            sha256: artifact.sha256,
          }),
          verifyUpload: async () => false,
          publish: async () => 1,
          verify: async () => true,
        },
      }),
    ).rejects.toThrow("could not be read back exactly")
  })
})
