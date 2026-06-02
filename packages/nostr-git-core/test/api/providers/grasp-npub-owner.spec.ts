import {describe, it, expect, vi, beforeEach} from "vitest"
import {nip19} from "nostr-tools"
import * as git from "isomorphic-git"

import {GraspApiProvider} from "../../../src/api/providers/grasp.js"

function setPriv<T extends object>(obj: T, key: string, value: any) {
  ;(obj as any)[key] = value
}

describe("GraspApiProvider npub owner handling", () => {
  const relay = "wss://relay.example"
  const ownerHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  const ownerNpub = nip19.npubEncode(ownerHex)

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("getRepo accepts npub owner and queries announcement authors in hex", async () => {
    const api = new GraspApiProvider(relay, ownerHex as any)
    setPriv(api, "capabilities", {
      grasp01: true,
      grasp05: false,
      httpOrigins: ["https://relay.example"],
      nostrRelays: [relay],
    })
    setPriv(api, "httpBase", "https://relay.example")

    const querySpy = vi.spyOn(api as any, "queryEvents").mockResolvedValueOnce([])
    ;(vi.spyOn(api as any, "fetchLatestState") as any).mockResolvedValueOnce(null)

    const repo = await api.getRepo(ownerNpub, "myrepo")
    const firstFilter = querySpy.mock.calls[0]?.[0]?.[0]
    expect(firstFilter?.authors).toEqual([ownerHex])
    expect(repo.owner.login).toBe(ownerNpub)
    expect(repo.cloneUrl).toContain(`/${ownerNpub}/myrepo.git`)
  })

  it("listBranches accepts npub owner without throwing", async () => {
    const api = new GraspApiProvider(relay, ownerHex as any)
    setPriv(api, "capabilities", {
      grasp01: true,
      grasp05: false,
      httpOrigins: ["https://relay.example"],
      nostrRelays: [relay],
    })
    setPriv(api, "httpBase", "https://relay.example")
    vi.spyOn(git as any, "fetch").mockResolvedValue(undefined)
    vi.spyOn(git as any, "listBranches").mockResolvedValue(["main"])
    vi.spyOn(git as any, "resolveRef").mockResolvedValue("abc123")

    const out = await api.listBranches(ownerNpub, "repo")
    expect(out[0].name).toBe("main")
    expect(out[0].commit.url).toContain(`/${ownerNpub}/repo.git/commit/abc123`)
  })
})
