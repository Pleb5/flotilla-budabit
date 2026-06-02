import {describe, it, expect, vi} from "vitest"

import {cloneRemoteRepoUtil} from "../../src/worker/workers/repos.js"
import type {GitProvider} from "../../src/git/provider.js"

function makeGitMock(partial: Record<string, unknown> = {}): GitProvider {
  return {
    listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "abcd"}]),
    clone: vi.fn(async () => undefined),
    checkout: vi.fn(async () => undefined),
    resolveRef: vi.fn(async () => "abcdef1234567890abcdef1234567890abcdef12"),
    listBranches: vi.fn(async () => ["main"]),
    addRemote: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    ...partial,
  } as unknown as GitProvider
}

function makeCacheMock() {
  return {
    init: vi.fn(async () => undefined),
    setRepoCache: vi.fn(async () => undefined),
  }
}

const GRASP_URL =
  "https://relay.ngit.dev/npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/gitworkshop.git"

describe("cloneRemoteRepoUtil GRASP transport selection", () => {
  it("uses direct transport first for GRASP clone URLs", async () => {
    const listServerRefs = vi.fn(async () => [{ref: "refs/heads/main", oid: "abcd"}])
    const clone = vi.fn(async () => undefined)
    const git = makeGitMock({listServerRefs, clone})
    const cache = makeCacheMock()

    await cloneRemoteRepoUtil(git as any, cache as any, {
      url: GRASP_URL,
      dir: "/tmp/root/grasp-direct-first",
    })

    expect(listServerRefs).toHaveBeenCalled()
    expect((listServerRefs as any).mock.calls[0][0].corsProxy).toBeNull()
    expect(clone).toHaveBeenCalled()
    expect((clone as any).mock.calls[0][0].corsProxy).toBeNull()
  })

  it("falls back to proxy transport after direct timeout", async () => {
    const listServerRefs = vi.fn(async () => [{ref: "refs/heads/main", oid: "abcd"}])
    const clone = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("Timeout: clone operation took longer than 90s")
      })
      .mockImplementationOnce(async () => undefined)
    const git = makeGitMock({listServerRefs, clone})
    const cache = makeCacheMock()

    await cloneRemoteRepoUtil(git as any, cache as any, {
      url: GRASP_URL,
      dir: "/tmp/root/grasp-proxy-fallback",
    })

    expect(clone).toHaveBeenCalledTimes(2)
    expect((clone as any).mock.calls[0][0].corsProxy).toBeNull()
    expect((clone as any).mock.calls[1][0].corsProxy).not.toBeNull()
  })

  it("keeps clone direct-first even when ref discovery needed proxy fallback", async () => {
    const listServerRefs = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("Failed to fetch")
      })
      .mockImplementationOnce(async () => [{ref: "refs/heads/main", oid: "abcd"}])
    const clone = vi.fn(async () => undefined)
    const git = makeGitMock({listServerRefs, clone})
    const cache = makeCacheMock()

    await cloneRemoteRepoUtil(git as any, cache as any, {
      url: GRASP_URL,
      dir: "/tmp/root/grasp-discovery-proxy-clone-direct",
    })

    expect(listServerRefs).toHaveBeenCalledTimes(2)
    expect((clone as any).mock.calls[0][0].corsProxy).toBeNull()
  })
})
