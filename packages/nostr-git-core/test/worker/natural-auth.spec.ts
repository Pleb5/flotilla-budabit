import {Buffer} from "node:buffer"

import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

const {authorizations} = vi.hoisted(() => ({
  authorizations: [] as Array<{url: string; authorization?: string}>,
}))
let exposed: any

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({}),
}))

vi.mock("../../src/git/natural-read-provider.js", () => ({
  GitNaturalReadProvider: class {
    private readonly authorizationForUrl?: (url: string) => string | undefined

    constructor(config: {authorizationForUrl?: (url: string) => string | undefined}) {
      this.authorizationForUrl = config.authorizationForUrl
    }

    async listRefs({url, signal}: {url: string; signal?: AbortSignal}) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      authorizations.push({url, authorization: this.authorizationForUrl?.(url)})
      return {refs: [], source: {remoteUrl: url}}
    }
  },
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("worker Git-natural authentication", () => {
  it("adds configured credentials only for the matching remote host", async () => {
    await exposed.setAuthConfig({
      tokens: [{host: "private.example", token: "worker-test-token"}],
    })

    await exposed.gitNaturalListRefs({
      url: "https://private.example/owner/repo.git",
      enabled: true,
      timeoutMs: 0,
    })
    await exposed.gitNaturalListRefs({
      url: "https://other.example/owner/repo.git",
      enabled: true,
      timeoutMs: 0,
    })

    expect(authorizations).toEqual([
      {
        url: "https://private.example/owner/repo.git",
        authorization: `Basic ${Buffer.from("token:worker-test-token").toString("base64")}`,
      },
      {url: "https://other.example/owner/repo.git", authorization: undefined},
    ])
  })

  it("honors cancellation that reaches the worker before read registration", async () => {
    const operationId = "cancel-before-registration"
    expect(exposed.cancelGitNaturalRead({operationId})).toBe(true)

    const result = await exposed.gitNaturalListRefs({
      url: "https://private.example/owner/repo.git",
      enabled: true,
      timeoutMs: 0,
      operationId,
    })

    expect(result).toMatchObject({success: false, error: "Aborted"})
  })
})
