import {afterEach, describe, expect, it, vi} from "vitest"

import {discoverAdvertisedRefs, listAdvertisedServerRefs} from "../../src/utils/advertised-refs.js"

const GRASP_URL =
  "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git"

const pkt = (payload: string) => (payload.length + 4).toString(16).padStart(4, "0") + payload

const buildAdvertisement = () =>
  [
    pkt("# service=git-upload-pack\n"),
    "0000",
    pkt(`${"1".repeat(40)} HEAD\0multi_ack symref=HEAD:refs/heads/main agent=git/2.0\n`),
    pkt(`${"1".repeat(40)} refs/heads/main\n`),
    pkt(`${"2".repeat(40)} refs/tags/v1.0.0\n`),
    "0000",
  ].join("")

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("advertised-refs utilities", () => {
  it("uses direct fetch for grasp-like remotes without calling git.listServerRefs", async () => {
    const fetchMock = vi.fn(async () => ({ok: true, text: async () => buildAdvertisement()}))
    vi.stubGlobal("fetch", fetchMock)

    const git = {
      listServerRefs: vi.fn(async () => []),
    }

    const refs = await listAdvertisedServerRefs(git, {
      url: GRASP_URL,
      prefix: "refs/heads/",
      symrefs: true,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${GRASP_URL}/info/refs?service=git-upload-pack`,
      expect.objectContaining({method: "GET"}),
    )
    expect(git.listServerRefs).not.toHaveBeenCalled()
    expect(refs).toEqual([
      {
        ref: "HEAD",
        oid: "1".repeat(40),
        symref: "refs/heads/main",
        target: "refs/heads/main",
        value: "ref: refs/heads/main",
      },
      {
        ref: "refs/heads/main",
        oid: "1".repeat(40),
      },
    ])
  })

  it("summarizes grasp refs correctly from the direct fetch path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ok: true, text: async () => buildAdvertisement()})),
    )

    const advertised = await discoverAdvertisedRefs({}, {url: GRASP_URL})

    expect(advertised.headBranch).toBe("main")
    expect(advertised.branches).toEqual(["main"])
    expect(advertised.tags).toEqual(["v1.0.0"])
    expect(advertised.hasRemoteHead).toBe(true)
  })

  it("falls back to the configured proxy when direct GRASP refs fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ok: true, text: async () => buildAdvertisement()})
    vi.stubGlobal("fetch", fetchMock)

    const refs = await listAdvertisedServerRefs(
      {},
      {
        url: GRASP_URL,
        prefix: "refs/heads/",
        symrefs: true,
        corsProxy: "https://corsproxy.budabit.club",
      },
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${GRASP_URL}/info/refs?service=git-upload-pack`,
      expect.objectContaining({method: "GET"}),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://corsproxy.budabit.club/${GRASP_URL.replace(/^https?:\/\//, "")}/info/refs?service=git-upload-pack`,
      expect.objectContaining({method: "GET"}),
    )
    expect(refs.map(ref => ref.ref)).toEqual(["HEAD", "refs/heads/main"])
  })

  it("falls back to git.listServerRefs for non-grasp remotes", async () => {
    const git = {
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "abc"}]),
    }

    const refs = await listAdvertisedServerRefs(git, {
      url: "https://github.com/Pleb5/flotilla-budabit.git",
      prefix: "refs/heads/",
      symrefs: true,
      corsProxy: "https://cors.isomorphic-git.org",
    })

    expect(git.listServerRefs).toHaveBeenCalledWith({
      url: "https://github.com/Pleb5/flotilla-budabit.git",
      prefix: "refs/heads/",
      symrefs: true,
      corsProxy: "https://cors.isomorphic-git.org",
    })
    expect(refs).toEqual([{ref: "refs/heads/main", oid: "abc"}])
  })

  it("does not use the GRASP fast path for host-only lookalikes", async () => {
    const git = {
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "abc"}]),
    }

    const refs = await listAdvertisedServerRefs(git, {
      url: "https://gitnostr.com/owner/repo.git",
      prefix: "refs/heads/",
      symrefs: true,
    })

    expect(git.listServerRefs).toHaveBeenCalledTimes(1)
    expect(refs).toEqual([{ref: "refs/heads/main", oid: "abc"}])
  })
})
