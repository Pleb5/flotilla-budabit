import {describe, expect, it, vi} from "vitest"
import {postRepoTabContext, postRepoTabInit} from "./repo-tab-context"
import {buildRepoExtensionContext} from "./repo-context"
import type {LoadedWidgetExtension} from "./types"

describe("repo-tab lifecycle payloads", () => {
  it("sends canonical context, capabilities, viewer updates and explicit clears on the actual surface", () => {
    const bridge = {post: vi.fn()}
    const owner = "a".repeat(64),
      viewer = "b".repeat(64)
    const repo = buildRepoExtensionContext(
      {repoEvent: {pubkey: owner, tags: [["d", "Legacy:Repo"]]}, name: "Display"},
      "naddr",
      ["wss://relay.example/"],
    )!
    const ext = {widget: {permissions: ["nostr:query"]}} as LoadedWidgetExtension
    postRepoTabContext(bridge, ext, repo, owner)
    expect(ext.repoContext).toBe(repo)
    expect(bridge.post).toHaveBeenLastCalledWith(
      "context:repoUpdate",
      expect.objectContaining({
        repoAddress: `30617:${owner}:Legacy:Repo`,
        userPubkey: owner,
        maintainers: [owner],
      }),
    )
    postRepoTabInit(bridge, ext, owner, "dark", "#111")
    expect(bridge.post).toHaveBeenLastCalledWith(
      "widget:init",
      expect.objectContaining({
        pubkey: owner,
        repoContext: repo,
        capabilities: expect.objectContaining({
          surface: {kind: "widget", resize: false, slot: "repo-tab"},
          features: expect.objectContaining({"nostr.queryCompleteness": true}),
        }),
      }),
    )
    postRepoTabContext(bridge, ext, repo, viewer)
    expect(bridge.post).toHaveBeenLastCalledWith(
      "context:repoUpdate",
      expect.objectContaining({userPubkey: viewer}),
    )
    postRepoTabContext(bridge, ext, repo, null)
    expect(bridge.post).toHaveBeenLastCalledWith(
      "context:repoUpdate",
      expect.objectContaining({userPubkey: null}),
    )
    postRepoTabContext(bridge, ext, undefined, null)
    expect(ext.repoContext).toBeUndefined()
    expect(bridge.post).toHaveBeenLastCalledWith("context:repoUpdate", null)
  })
})
