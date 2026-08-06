// @vitest-environment jsdom

import {readable} from "svelte/store"
import {nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_CLOSED,
} from "@nostr-git/core/events"
import {COMMUNITY_SECTION_REPO_CURATOR, PROFILE_LIST_KIND} from "@app/core/community"
import {defaultRepoWatchOptions, type RepoWatchOptions} from "@app/core/repo-watch"
import {ROLE_NS} from "@app/util/labels"

vi.mock("@welshman/net", async importOriginal => ({
  ...(await importOriginal<typeof import("@welshman/net")>()),
  load: vi.fn(() => Promise.resolve([])),
  request: vi.fn(() => Promise.resolve([])),
}))

vi.mock("@welshman/app", () => ({
  pubkey: readable(undefined),
  repository: {
    query: vi.fn(() => []),
    getEvent: vi.fn(),
    publish: vi.fn(),
  },
  tracker: {hasRelay: vi.fn(() => false), addRelay: vi.fn()},
  userRelayList: readable(undefined),
  makeUserData: vi.fn(() => readable(undefined)),
  makeUserLoader: vi.fn(() => vi.fn()),
  ensurePlaintext: vi.fn(async (event: TrustedEvent) => event.content),
  makeOutboxLoader: vi.fn(() => vi.fn()),
  publishThunk: vi.fn(),
  signer: {get: vi.fn()},
}))

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
  fromCsv: (value: string) => (value || "").split(",").filter(Boolean),
  deriveEvent: vi.fn(() => readable(undefined)),
}))

vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: [],
  repoAnnouncements: readable([]),
  getRepoMaintainers: (event: TrustedEvent) =>
    Array.from(
      new Set([
        event.pubkey,
        ...event.tags.filter(tag => tag[0] === "maintainers").flatMap(tag => tag.slice(1)),
      ]),
    ),
  getStatusRootId: (event: TrustedEvent) =>
    event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
    event.tags.find(tag => tag[0] === "e")?.[1] ||
    "",
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityDefinition: readable(undefined),
  activeCommunityModeratorRequestStates: readable([]),
  activeCommunityProfileListEvents: readable([]),
  activeCommunityRelays: readable([]),
  activeCommunityReportState: readable(undefined),
  activeCommunityUserModeratorRequestStates: readable([]),
  activeUserCommunityRefs: readable([]),
  makeCommunityProfileListFilters: vi.fn(() => []),
  selectLatestCommunityDefinition: vi.fn(() => undefined),
}))

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const communityMember = "c".repeat(64)
const outsider = "d".repeat(64)
const viewer = "e".repeat(64)
const communityPubkey = "f".repeat(64)
const listPubkey = "1".repeat(64)
const repoIdentifier = "watched-repo"
const repoAddress = `30617:${owner}:${repoIdentifier}`
const naddr = nip19.naddrEncode({kind: 30617, pubkey: owner, identifier: repoIdentifier})
const repoPath = `/git/${naddr}`

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: outsider,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const watchOptions = (overrides: Partial<RepoWatchOptions> = {}): RepoWatchOptions => ({
  issues: {...defaultRepoWatchOptions.issues, ...overrides.issues},
  prs: {...defaultRepoWatchOptions.prs, ...overrides.prs},
  status: {...defaultRepoWatchOptions.status, ...overrides.status},
  assignments: overrides.assignments ?? defaultRepoWatchOptions.assignments,
  reviews: overrides.reviews ?? false,
  activityFilter: overrides.activityFilter ?? "all",
})

const makeRepo = (options = watchOptions()) => ({
  address: repoAddress,
  pubkey: owner,
  identifier: repoIdentifier,
  naddr,
  options,
})

describe("repo watch notifications", () => {
  it("creates candidates for supplied notification repos", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo()],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: issue}])
  })

  it("carries only announcement-declared relays with real repository triggers", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "scoped-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      tags: [["a", repoAddress]],
    })
    const repoEvent = makeEvent({
      id: "repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [
        ["d", repoIdentifier],
        ["relays", "wss://REPO.example/", "wss://second.example"],
      ],
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [{...makeRepo(), repoEvent}],
        issues: [issue],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {
        path: `${repoPath}/issues`,
        latestEvent: issue,
        repoRelayHints: ["wss://repo.example/", "wss://second.example/"],
      },
    ])
  })

  it("adds owned and maintained repos as baseline notification repos", async () => {
    const {defaultOwnedRepoNotificationOptions, getRepoNotificationRepos} =
      await import("./repo-watch-notifications")
    const watchedOptions = watchOptions({
      issues: {...defaultRepoWatchOptions.issues, comments: false},
    })
    const watchedRepoEvent = makeEvent({
      id: "watched-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [["d", repoIdentifier]],
    })
    const ownedRepoEvent = makeEvent({
      id: "owned-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: viewer,
      tags: [["d", "owned-repo"]],
    })
    const maintainedRepoEvent = makeEvent({
      id: "maintained-repo-event",
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: owner,
      tags: [
        ["d", "maintained-repo"],
        ["maintainers", viewer],
      ],
    })

    const repos = getRepoNotificationRepos({
      watchedRepos: [makeRepo(watchedOptions)],
      repoEvents: [watchedRepoEvent, ownedRepoEvent, maintainedRepoEvent],
      currentPubkey: viewer,
    })
    const watched = repos.find(repo => repo.address === repoAddress)
    const owned = repos.find(
      repo => repo.address === `${GIT_REPO_ANNOUNCEMENT}:${viewer}:owned-repo`,
    )
    const maintained = repos.find(
      repo => repo.address === `${GIT_REPO_ANNOUNCEMENT}:${owner}:maintained-repo`,
    )

    expect(watched).toEqual(
      expect.objectContaining({
        address: repoAddress,
        options: watchedOptions,
        repoEvent: watchedRepoEvent,
      }),
    )
    expect(owned?.options).toEqual(defaultOwnedRepoNotificationOptions)
    expect(maintained?.options).toEqual(defaultOwnedRepoNotificationOptions)
    expect(defaultOwnedRepoNotificationOptions.issues.comments).toBe(true)
    expect(defaultOwnedRepoNotificationOptions.prs.comments).toBe(true)
  })

  it("respects issue, PR, status, and assignment watch options", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const issue = makeEvent({
      id: "issue",
      kind: GIT_ISSUE,
      created_at: 10,
      tags: [["a", repoAddress]],
    })
    const issueComment = makeEvent({
      id: "issue-comment",
      kind: 1111,
      created_at: 20,
      tags: [
        ["E", issue.id],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const pullRequest = makeEvent({
      id: "pr",
      kind: GIT_PULL_REQUEST,
      created_at: 10,
      tags: [["a", repoAddress]],
    })
    const prStatus = makeEvent({
      id: "pr-closed",
      kind: GIT_STATUS_CLOSED,
      created_at: 30,
      tags: [
        ["a", repoAddress],
        ["e", pullRequest.id, "", "root"],
      ],
    })
    const assignment = makeEvent({
      id: "assignment",
      kind: GIT_LABEL,
      created_at: 40,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "assignee", ROLE_NS],
        ["a", repoAddress],
        ["e", issue.id],
        ["p", viewer],
      ],
    })
    const reviewerLabel = makeEvent({
      id: "reviewer",
      kind: GIT_LABEL,
      created_at: 50,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "reviewer", ROLE_NS],
        ["a", repoAddress],
        ["e", pullRequest.id],
        ["p", viewer],
      ],
    })
    const options = watchOptions({
      issues: {new: false, comments: true},
      prs: {new: false, comments: false, updates: false},
      status: {open: false, draft: false, applied: false, closed: true},
      assignments: true,
      reviews: false,
    })

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo(options)],
        issues: [issue],
        pullRequests: [pullRequest],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment, reviewerLabel],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: assignment},
      {path: `${repoPath}/prs`, latestEvent: prStatus},
    ])

    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo({...options, reviews: true})],
        issues: [issue],
        pullRequests: [pullRequest],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment, reviewerLabel],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: assignment},
      {path: `${repoPath}/prs`, latestEvent: reviewerLabel},
    ])
  })

  it("handles scoped repo events when the root event is absent", async () => {
    const {getRepoWatchNotificationCandidates, getRepoWatchRootIdsForEvents} =
      await import("./repo-watch-notifications")
    const issueComment = makeEvent({
      id: "old-issue-comment",
      kind: GIT_COMMENT,
      created_at: 20,
      tags: [
        ["a", repoAddress],
        ["E", "old-issue"],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const prStatus = makeEvent({
      id: "old-pr-status",
      kind: GIT_STATUS_CLOSED,
      created_at: 30,
      tags: [
        ["a", repoAddress],
        ["e", "old-pr", "", "root"],
        ["K", String(GIT_PULL_REQUEST)],
      ],
    })
    const assignment = makeEvent({
      id: "old-issue-assignment",
      kind: GIT_LABEL,
      created_at: 40,
      pubkey: maintainer,
      tags: [
        ["L", ROLE_NS],
        ["l", "assignee", ROLE_NS],
        ["a", repoAddress],
        ["e", "old-issue"],
        ["K", String(GIT_ISSUE)],
        ["p", viewer],
      ],
    })
    const options = watchOptions({
      issues: {new: false, comments: true},
      prs: {new: false, comments: false, updates: false},
      status: {open: false, draft: false, applied: false, closed: true},
      assignments: true,
    })

    expect(getRepoWatchRootIdsForEvents([issueComment, prStatus, assignment])).toEqual([
      "old-issue",
      "old-pr",
    ])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [makeRepo(options)],
        statuses: [prStatus],
        comments: [issueComment],
        labels: [assignment],
        currentPubkey: viewer,
      }),
    ).toEqual([
      {path: `${repoPath}/issues`, latestEvent: assignment},
      {path: `${repoPath}/prs`, latestEvent: prStatus},
    ])
  })

  it("applies maintainer and community activity filters by author", async () => {
    const {getRepoWatchNotificationCandidates} = await import("./repo-watch-notifications")
    const repoEvent = makeEvent({
      id: "repo-event",
      kind: 30617,
      pubkey: owner,
      tags: [
        ["d", repoIdentifier],
        ["maintainers", maintainer],
        ["h", communityPubkey],
      ],
    })
    const communityDefinition = {
      event: makeEvent({id: "community", kind: 10222, pubkey: communityPubkey}),
      pubkey: communityPubkey,
      relays: [],
      blossomServers: [],
      graspServers: [],
      mints: [],
      emailDigestServices: [],
      sections: [
        {
          name: COMMUNITY_SECTION_REPO_CURATOR,
          kinds: [{kind: 30617}],
          profileLists: [
            {
              kind: PROFILE_LIST_KIND,
              pubkey: listPubkey,
              identifier: COMMUNITY_SECTION_REPO_CURATOR,
              address: `${PROFILE_LIST_KIND}:${listPubkey}:${COMMUNITY_SECTION_REPO_CURATOR}`,
            },
          ],
          badges: [],
          retention: [],
        },
      ],
    }
    const communityProfileList = makeEvent({
      id: "profile-list",
      kind: PROFILE_LIST_KIND,
      pubkey: listPubkey,
      tags: [
        ["d", COMMUNITY_SECTION_REPO_CURATOR],
        ["p", communityMember],
      ],
    })
    const maintainerIssue = makeEvent({
      id: "maintainer-issue",
      kind: GIT_ISSUE,
      pubkey: maintainer,
      tags: [["a", repoAddress]],
    })
    const communityIssue = makeEvent({
      id: "community-issue",
      kind: GIT_ISSUE,
      pubkey: communityMember,
      tags: [["a", repoAddress]],
    })
    const outsiderIssue = makeEvent({
      id: "outsider-issue",
      kind: GIT_ISSUE,
      pubkey: outsider,
      created_at: 100,
      tags: [["a", repoAddress]],
    })

    const baseRepo = {
      ...makeRepo(),
      repoEvent,
      communityDefinition,
      communityProfileListEvents: [communityProfileList],
    }

    expect(
      getRepoWatchNotificationCandidates({
        repos: [{...baseRepo, options: watchOptions({activityFilter: "maintainers"})}],
        issues: [communityIssue, outsiderIssue, maintainerIssue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: maintainerIssue}])
    expect(
      getRepoWatchNotificationCandidates({
        repos: [{...baseRepo, options: watchOptions({activityFilter: "community"})}],
        issues: [maintainerIssue, outsiderIssue, communityIssue],
        currentPubkey: viewer,
      }),
    ).toEqual([{path: `${repoPath}/issues`, latestEvent: communityIssue}])
  })

  it("rolls Git badges up from repo notification paths", async () => {
    const {hasGitNotification} = await import("./repo-watch-notifications")

    expect(hasGitNotification(new Set([`${repoPath}/issues`]))).toBe(true)
    expect(hasGitNotification(new Set(["/git"]))).toBe(false)
    expect(hasGitNotification(new Set(["/chat/example"]))).toBe(false)
  })

  it("partitions watcher activity by actual repo relay and foreground ownership", async () => {
    const {buildRepoWatchActivityRelayGroups} = await import("./repo-watch-notifications")
    const {getRepoLiveOwnershipKey} = await import("@app/core/repo-live-ownership")
    const secondAddress = `30617:${maintainer}:second-repo`
    const sharedRelay = "wss://shared.example/"
    const targets = [
      {
        address: repoAddress,
        relays: ["wss://first.example", sharedRelay],
        since: 10,
        limit: 200,
      },
      {
        address: secondAddress,
        relays: ["wss://second.example", sharedRelay],
        since: 10,
        limit: 200,
      },
    ]
    const groups = buildRepoWatchActivityRelayGroups(
      targets,
      new Set([getRepoLiveOwnershipKey(repoAddress, sharedRelay)]),
    )

    expect(groups.map(group => group.relay)).toEqual([
      "wss://first.example/",
      "wss://second.example/",
      sharedRelay,
    ])
    expect(groups[0].filters[0]["#a"]).toEqual([repoAddress])
    expect(groups[1].filters[0]["#a"]).toEqual([secondAddress])
    expect(groups[2].filters[0]["#a"]).toEqual([repoAddress, secondAddress])
    expect(groups[2].liveFilters[0]["#a"]).toEqual([secondAddress])

    const restored = buildRepoWatchActivityRelayGroups(targets)
    expect(restored[2].liveFilters[0]["#a"]).toEqual([repoAddress, secondAddress])
  })

  it("chunks root-scoped watcher filters into one bounded relay group", async () => {
    const {buildRepoWatchRootRelayGroups} = await import("./repo-watch-notifications")
    const rootIds = Array.from({length: 201}, (_, index) => `root-${index}`)
    const [group] = buildRepoWatchRootRelayGroups([
      {
        address: repoAddress,
        relays: ["wss://repo.example"],
        since: 10,
        limit: 200,
        rootIds,
      },
    ])

    expect(group.relay).toBe("wss://repo.example/")
    expect(group.filters).toHaveLength(15)
    expect(
      group.filters.filter(filter => filter["#E"]).map(filter => filter["#E"]?.length),
    ).toEqual([100, 100, 1])
  })
})
