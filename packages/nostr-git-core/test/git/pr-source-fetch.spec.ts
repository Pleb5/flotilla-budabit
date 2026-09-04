import {describe, expect, it, vi} from "vitest"

import {fetchPrSourceTip} from "../../src/git/pr-source-fetch.js"

const TIP = "a".repeat(40)

describe("fetchPrSourceTip strict provenance", () => {
  it("does not accept a pre-existing local object after an unrelated ref fetch", async () => {
    const git = {
      readCommit: vi.fn().mockResolvedValue({oid: TIP}),
      fetch: vi
        .fn()
        .mockRejectedValueOnce(new Error("exact OID fetch rejected"))
        .mockResolvedValueOnce(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      listBranches: vi.fn().mockResolvedValue(["main"]),
      log: vi.fn().mockResolvedValue([{oid: "b".repeat(40)}]),
    } as any

    await expect(
      fetchPrSourceTip(git, {
        dir: "/repo",
        remote: "pr-source",
        url: "https://source.example/repo.git",
        tipCommitOid: TIP,
        requireRemoteEvidence: true,
      }),
    ).rejects.toThrow(`commit ${TIP} is still unavailable`)

    expect(git.fetch).toHaveBeenCalledTimes(2)
  })

  it("accepts an exact-OID fetch that proves the requested tip", async () => {
    const git = {
      readCommit: vi.fn().mockResolvedValue({oid: TIP}),
      fetch: vi.fn().mockResolvedValue({fetchHead: TIP}),
    } as any

    await expect(
      fetchPrSourceTip(git, {
        dir: "/repo",
        remote: "pr-source",
        url: "https://source.example/repo.git",
        tipCommitOid: TIP,
        requireRemoteEvidence: true,
      }),
    ).resolves.toEqual({tipOid: TIP, strategy: "tip-oid"})

    expect(git.fetch).toHaveBeenCalledWith(expect.objectContaining({ref: TIP}))
  })

  it("rejects an exact-OID fetch without matching fetch evidence", async () => {
    const git = {
      readCommit: vi.fn().mockResolvedValue({oid: TIP}),
      fetch: vi.fn().mockResolvedValue({fetchHead: "b".repeat(40)}),
      setConfig: vi.fn().mockResolvedValue(undefined),
      listBranches: vi.fn().mockResolvedValue([]),
    } as any

    await expect(
      fetchPrSourceTip(git, {
        dir: "/repo",
        remote: "pr-source",
        url: "https://source.example/repo.git",
        tipCommitOid: TIP,
        requireRemoteEvidence: true,
      }),
    ).rejects.toThrow(`expected ${TIP}`)
  })

  it("accepts equivalent uppercase requested OIDs", async () => {
    const git = {
      readCommit: vi.fn().mockResolvedValue({oid: TIP}),
      fetch: vi.fn().mockResolvedValue({fetchHead: TIP}),
    } as any

    await expect(
      fetchPrSourceTip(git, {
        dir: "/repo",
        remote: "pr-source",
        url: "https://source.example/repo.git",
        tipCommitOid: TIP.toUpperCase(),
        requireRemoteEvidence: true,
      }),
    ).resolves.toEqual({tipOid: TIP, strategy: "tip-oid"})
    expect(git.fetch).toHaveBeenCalledWith(expect.objectContaining({ref: TIP}))
  })
})
