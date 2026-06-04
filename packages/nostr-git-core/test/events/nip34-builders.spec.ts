import {describe, it, expect} from "vitest"
import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  createIssueEvent,
  createCoverLetterEvent,
  createStatusEvent,
  createPullRequestEvent,
  createPullRequestUpdateEvent,
  createUserGraspListEvent,
  createStackEvent,
  createMergeMetadataEvent,
  createConflictMetadataEvent,
  getTag,
  getTags,
  getTagValue,
} from "../../src/events/nip34/nip34-utils.js"
import type {CoverLetterTag, IssueTag, PullRequestTag} from "../../src/events/nip34/nip34.js"

describe("NIP-34 builders", () => {
  it("createRepoAnnouncementEvent encodes all tag variants and sanitizes relays", () => {
    const evt = createRepoAnnouncementEvent({
      repoId: "owner/name",
      name: "My Repo",
      description: "A description",
      web: ["https://example.com", "https://example.com/docs"],
      clone: ["https://github.com/owner/name.git", "https://gitlab.com/owner/name.git"],
      relays: ["wss://relay.example.com/", "wss://relay.example.com", "wss://relay.two/"],
      maintainers: ["npub1maintainer"],
      hashtags: ["bug", "feature"],
      earliestUniqueCommit: "euc-123",
      created_at: 1700000000,
    })

    expect(evt.kind).toBe(30617)

    // d tag uses repo name segment only per builder
    expect(getTagValue(evt as any, "d")).toBe("name")

    const web = getTag(evt as any, "web")
    expect(web).toBeTruthy()
    expect((web as any).slice(1)).toEqual(["https://example.com", "https://example.com/docs"])

    const clone = getTag(evt as any, "clone")
    expect(clone).toBeTruthy()
    expect((clone as any).slice(1)).toEqual([
      "https://github.com/owner/name.git",
      "https://gitlab.com/owner/name.git",
    ])

    const relays = getTag(evt as any, "relays")
    expect(relays).toBeTruthy()
    const relayVals = (relays as any).slice(1) as string[]
    expect(relayVals.length).toBeGreaterThan(0)
    expect(relayVals.every(r => !r.endsWith("/"))).toBe(true)
    expect(new Set(relayVals).size).toBe(relayVals.length)

    const maint = getTag(evt as any, "maintainers")
    expect(maint).toBeTruthy()
    expect((maint as any).slice(1)).toEqual(["npub1maintainer"])

    const tTags = getTags(evt as any, "t")
    expect(tTags.map((t: any) => t[1]).sort()).toEqual(["bug", "feature"].sort())

    // EUC tag: ["r", <euc>, "euc"]
    expect(evt.tags).toContainEqual(["r", "euc-123", "euc"])
  })

  it("createRepoStateEvent encodes refs and HEAD (including ancestry)", () => {
    const evt = createRepoStateEvent({
      repoId: "owner/name",
      refs: [
        {type: "heads", name: "main", commit: "c1"},
        {type: "heads", name: "dev", commit: "c2", ancestry: ["a1", "a2"]},
        {type: "tags", name: "v1.0.0", commit: "t1"},
      ],
      head: "main",
      created_at: 1700000001,
    })

    expect(evt.kind).toBe(30618)
    expect(getTagValue(evt as any, "d")).toBe("name")

    const mainRef = getTag(evt as any, "refs/heads/main")
    expect(mainRef).toEqual(["refs/heads/main", "c1"])

    const devRef = getTag(evt as any, "refs/heads/dev")
    expect(devRef).toEqual(["refs/heads/dev", "c2", "a1", "a2"])

    const tagRef = getTag(evt as any, "refs/tags/v1.0.0")
    expect(tagRef).toEqual(["refs/tags/v1.0.0", "t1"])

    const head = getTag(evt as any, "HEAD")
    expect(head).toEqual(["HEAD", "ref: refs/heads/main"])
  })

  it("createIssueEvent encodes recipients, subject, labels", () => {
    const evt = createIssueEvent({
      content: "issue body",
      repoAddr: "30617:pubkey:repo",
      recipients: ["pk1"],
      subject: "Issue subject",
      labels: ["bug", "ui"],
      created_at: 1700000003,
    })

    expect(evt.kind).toBe(1621)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "subject")).toBe("Issue subject")
    expect(getTags(evt as any, "p").map((t: any) => t[1])).toEqual(["pk1"])
    expect(
      getTags(evt as any, "t")
        .map((t: any) => t[1])
        .sort(),
    ).toEqual(["bug", "ui"].sort())
  })

  it("createIssueEvent emits primary and additional repo addresses", () => {
    const evt = createIssueEvent({
      content: "issue body",
      repoAddr: "30617:root:repo",
      repoAddrs: ["30617:root:repo", "30617:maintainer:repo"],
    })

    expect(getTags(evt as any, "a")).toEqual([
      ["a", "30617:root:repo"],
      ["a", "30617:maintainer:repo"],
    ])
  })

  it("createIssueEvent preserves rich editor tags", () => {
    const richTags: IssueTag[] = [
      ["p", "mentioned-pubkey", "wss://relay.mention"],
      ["q", "quoted-event-id", "wss://relay.quote"],
      ["a", "30023:pubkey:article", "wss://relay.addr"],
      ["imeta", "url https://cdn.example/issue.png", "m image/png"],
    ]

    const evt = createIssueEvent({
      content: "issue body\nhttps://cdn.example/issue.png",
      repoAddr: "30617:pubkey:repo",
      subject: "Issue subject",
      tags: richTags,
    })

    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "subject")).toBe("Issue subject")
    for (const tag of richTags) expect(evt.tags).toContainEqual(tag)
  })

  it("createCoverLetterEvent encodes root, references, and recipients", () => {
    const evt = createCoverLetterEvent({
      rootId: "issue-id-1",
      repoAddr: "30617:pubkey:repo",
      content: "Updated issue body",
      references: [
        {eventId: "ref-1"},
        {eventId: "ref-2", relay: "wss://relay.example"},
        {eventId: "ref-3", relay: "wss://relay.example", pubkey: "pk-ref"},
      ],
      recipients: ["pk1", "pk2"],
      created_at: 1700000004,
    })

    expect(evt.kind).toBe(1624)
    expect(evt.content).toBe("Updated issue body")
    expect(getTagValue(evt as any, "e")).toBe("issue-id-1")
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(evt.tags).toEqual(
      expect.arrayContaining([
        ["q", "ref-1"],
        ["q", "ref-2", "wss://relay.example"],
        ["q", "ref-3", "wss://relay.example", "pk-ref"],
        ["p", "pk1"],
        ["p", "pk2"],
      ]),
    )
  })

  it("createCoverLetterEvent preserves rich editor tags", () => {
    const richTags: CoverLetterTag[] = [
      ["p", "mentioned-pubkey", "wss://relay.mention"],
      ["q", "quoted-event-id", "wss://relay.quote"],
      ["a", "30023:pubkey:article", "wss://relay.addr"],
      ["imeta", "url https://cdn.example/edit.png", "m image/png"],
      ["t", "release-notes"],
    ]

    const evt = createCoverLetterEvent({
      rootId: "issue-id-1",
      repoAddr: "30617:pubkey:repo",
      content: "updated body\nhttps://cdn.example/edit.png",
      tags: richTags,
    })

    expect(getTagValue(evt as any, "e")).toBe("issue-id-1")
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    for (const tag of richTags) expect(evt.tags).toContainEqual(tag)
  })

  it("createStatusEvent encodes root/reply, recipients, repo, relay, merged/applied commit metadata", () => {
    const evt = createStatusEvent({
      kind: 1631,
      content: "merged",
      rootId: "root-id",
      replyId: "reply-id",
      recipients: ["pk1", "pk2"],
      repoAddr: "30617:pubkey:repo",
      relays: ["wss://relay.one", "wss://relay.two"],
      appliedCommits: ["c1", "c2"],
      mergedCommit: "mc1",
      created_at: 1700000004,
    })

    expect(evt.kind).toBe(1631)

    const eTags = getTags(evt as any, "e")
    expect(eTags).toEqual(
      expect.arrayContaining([
        ["e", "root-id", "", "root"],
        ["e", "reply-id", "", "reply"],
      ]),
    )

    expect(
      getTags(evt as any, "p")
        .map((t: any) => t[1])
        .sort(),
    ).toEqual(["pk1", "pk2"].sort())
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(
      getTags(
        createStatusEvent({
          kind: 1631,
          content: "merged",
          rootId: "root-id",
          repoAddr: "30617:pubkey:repo",
          repoAddrs: ["30617:pubkey:repo", "30617:maintainer:repo"],
        }) as any,
        "a",
      ),
    ).toEqual([
      ["a", "30617:pubkey:repo"],
      ["a", "30617:maintainer:repo"],
    ])

    // createStatusEvent uses only first relay in an 'r' tag
    expect(getTagValue(evt as any, "r")).toBe("wss://relay.one")

    expect(getTagValue(evt as any, "merge-commit")).toBe("mc1")

    const applied = getTag(evt as any, "applied-as-commits")
    expect(applied).toBeTruthy()
    expect((applied as any)[1]).toBe("c1")
    expect((applied as any)[2]).toBe("c2")
  })

  it("createPullRequestEvent encodes tip commit, clone URLs, branch name (target), merge base, recipients, labels", () => {
    const evt = createPullRequestEvent({
      content: "pr body",
      repoAddr: "30617:pubkey:repo",
      recipients: ["pk1"],
      subject: "PR subject",
      labels: ["enhancement"],
      tipCommitOid: "c2",
      clone: ["https://example.com/repo.git", "https://mirror.example.com/repo.git"],
      branchName: "main",
      mergeBase: "base-oid",
      created_at: 1700000005,
    })

    expect(evt.kind).toBe(1618)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "subject")).toBe("PR subject")
    expect(getTags(evt as any, "p").map((t: any) => t[1])).toEqual(["pk1"])
    expect(getTags(evt as any, "t").map((t: any) => t[1])).toEqual(["enhancement"])

    expect(getTags(evt as any, "c").map((t: any) => t[1])).toEqual(["c2"])

    const clone = getTag(evt as any, "clone")
    expect(clone).toBeTruthy()
    expect((clone as any).slice(1)).toEqual([
      "https://example.com/repo.git",
      "https://mirror.example.com/repo.git",
    ])

    expect(getTagValue(evt as any, "branch-name")).toBe("main")
    expect(getTagValue(evt as any, "merge-base")).toBe("base-oid")
  })

  it("createPullRequestEvent preserves rich editor tags", () => {
    const richTags: PullRequestTag[] = [
      ["p", "mentioned-pubkey", "wss://relay.mention"],
      ["q", "quoted-event-id", "wss://relay.quote"],
      ["a", "30023:pubkey:article", "wss://relay.addr"],
      ["imeta", "url https://cdn.example/pr.png", "m image/png"],
    ]

    const evt = createPullRequestEvent({
      content: "pr body\nhttps://cdn.example/pr.png",
      repoAddr: "30617:pubkey:repo",
      subject: "PR subject",
      tipCommitOid: "c2",
      branchName: "main",
      tags: richTags,
    })

    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "subject")).toBe("PR subject")
    expect(getTagValue(evt as any, "c")).toBe("c2")
    expect(getTagValue(evt as any, "branch-name")).toBe("main")
    for (const tag of richTags) expect(evt.tags).toContainEqual(tag)
  })

  it("createPullRequestUpdateEvent encodes E/P, tip commit, clone URLs, merge base, recipients", () => {
    const evt = createPullRequestUpdateEvent({
      repoAddr: "30617:pubkey:repo",
      pullRequestEventId: "pr-evt-id",
      pullRequestAuthorPubkey: "pr-author-pk",
      recipients: ["pk1", "pk2"],
      tipCommitOid: "c1",
      clone: ["https://example.com/repo.git"],
      mergeBase: "base-oid",
      created_at: 1700000006,
    })

    expect(evt.kind).toBe(1619)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "E")).toBe("pr-evt-id")
    expect(getTagValue(evt as any, "P")).toBe("pr-author-pk")
    expect(
      getTags(evt as any, "p")
        .map((t: any) => t[1])
        .sort(),
    ).toEqual(["pk1", "pk2"].sort())
    expect(getTags(evt as any, "c").map((t: any) => t[1])).toEqual(["c1"])

    const clone = getTag(evt as any, "clone")
    expect(clone).toBeTruthy()
    expect((clone as any).slice(1)).toEqual(["https://example.com/repo.git"])

    expect(getTagValue(evt as any, "merge-base")).toBe("base-oid")
  })

  it("createUserGraspListEvent creates g tags for services", () => {
    const evt = createUserGraspListEvent({
      services: ["github", "gitlab"],
      created_at: 1700000007,
    })

    expect(evt.kind).toBe(10317)
    expect(getTags(evt as any, "g")).toEqual([
      ["g", "github"],
      ["g", "gitlab"],
    ])
  })

  it("createStackEvent encodes stack membership and order", () => {
    const evt = createStackEvent({
      repoAddr: "30617:pubkey:repo",
      stackId: "stack-1",
      members: ["p1", "p2"],
      order: ["p2", "p1"],
      content: "stack content",
      created_at: 1700000008,
    })

    expect(evt.kind).toBe(30410)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTagValue(evt as any, "stack")).toBe("stack-1")
    expect(
      getTags(evt as any, "member")
        .map((t: any) => t[1])
        .sort(),
    ).toEqual(["p1", "p2"].sort())

    const orderTag = getTag(evt as any, "order")
    expect(orderTag).toBeTruthy()
    expect((orderTag as any).slice(1)).toEqual(["p2", "p1"])
  })

  it("createMergeMetadataEvent encodes base/target branch, result, merge commit, and root e tag", () => {
    const evt = createMergeMetadataEvent({
      repoAddr: "30617:pubkey:repo",
      rootId: "root-pr-id",
      baseBranch: "main",
      targetBranch: "main",
      result: "clean",
      mergeCommit: "merge-oid",
      content: '{"analysis":"clean"}',
      created_at: 1700000009,
    })

    expect(evt.kind).toBe(30411)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTags(evt as any, "e")).toEqual([["e", "root-pr-id", "", "root"]])
    expect(getTagValue(evt as any, "base-branch")).toBe("main")
    expect(getTagValue(evt as any, "target-branch")).toBe("main")
    expect(getTagValue(evt as any, "result")).toBe("clean")
    expect(getTagValue(evt as any, "merge-commit")).toBe("merge-oid")
  })

  it("createConflictMetadataEvent encodes conflict files and root e tag", () => {
    const evt = createConflictMetadataEvent({
      repoAddr: "30617:pubkey:repo",
      rootId: "root-pr-id",
      files: ["a.txt", "b.txt"],
      content: '{"conflicts":2}',
      created_at: 1700000010,
    })

    expect(evt.kind).toBe(30412)
    expect(getTagValue(evt as any, "a")).toBe("30617:pubkey:repo")
    expect(getTags(evt as any, "e")).toEqual([["e", "root-pr-id", "", "root"]])
    expect(
      getTags(evt as any, "file")
        .map((t: any) => t[1])
        .sort(),
    ).toEqual(["a.txt", "b.txt"].sort())
  })
})
