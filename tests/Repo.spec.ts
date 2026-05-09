/*
  Repo.spec.ts
  Unit tests for Repo class helpers. This file uses Vitest-style APIs.
  If the workspace does not yet include Vitest, add it as a devDependency and run with `vitest`.
*/

import { describe, it, expect } from "vitest";
import {
  type RepoAnnouncementEvent,
  type RepoStateEvent,
  type IssueEvent,
  type PullRequestEvent,
  type NostrEvent,
  parseRepoAnnouncementEvent,
} from "@nostr-git/core/events";
import { canonicalRepoKey } from "@nostr-git/core/utils";
import {
  RepoCore,
  type RepoContext,
} from "@nostr-git/core/git";

// Build a minimal RepoContext for tests
const mkCtx = (over: Partial<RepoContext> = {}): RepoContext => ({
  repoEvent: over.repoEvent,
  repoStateEvent: over.repoStateEvent,
  repo: over.repo,
  issues: over.issues || [],
  pullRequests: over.pullRequests || [],
  repoStateEventsArr: over.repoStateEventsArr || [],
  statusEventsArr: over.statusEventsArr || [],
  commentEventsArr: over.commentEventsArr || [],
  labelEventsArr: over.labelEventsArr || [],
});

// Minimal factory for a repo announcement
function mkRepoAnnouncement(overrides: any = {}): RepoAnnouncementEvent {
  const obj: any = {
    id: overrides.id || "ev-id-30617",
    kind: 30617,
    pubkey: overrides.pubkey || "owner-pubkey",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: (overrides as any).tags || [
      ["d", "repo-name"],
      ["a", "30617:owner-pubkey:repo-name"],
    ],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  };
  return obj as unknown as RepoAnnouncementEvent;
}

function mkRepoState(overrides: any = {}): RepoStateEvent {
  const obj: any = {
    id: overrides.id || "ev-id-30618",
    kind: 30618,
    pubkey: overrides.pubkey || "owner-pubkey",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: (overrides as any).tags || [
      // refs/heads/main pointing at a commit
      ["r", "refs/heads/main", "ref"],
      ["r", "0000000000000000000000000000000000000001", "commit"],
    ],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  };
  return obj as unknown as RepoStateEvent;
}

function mkPullRequest(overrides: any = {}): PullRequestEvent {
  const obj: any = {
    id: overrides.id || "pr-1",
    kind: 1618,
    pubkey: overrides.pubkey || "author-pubkey",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: (overrides as any).tags || [["t", "root"]],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  };
  return obj as unknown as PullRequestEvent;
}

function mkIssue(overrides: any = {}): IssueEvent {
  const obj: any = {
    id: overrides.id || "issue-1",
    kind: 1621,
    pubkey: overrides.pubkey || "author-pubkey",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  };
  return obj as unknown as IssueEvent;
}

function mkStatus(
  overrides: any & { kind: 1630 | 1631 | 1632 | 1633; rootId: string }
): NostrEvent {
  return {
    id: overrides.id || `status-${overrides.kind}`,
    kind: overrides.kind,
    pubkey: overrides.pubkey || "maintainer-1",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: (overrides as any).tags || ([["e", overrides.rootId]] as any),
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  } as unknown as NostrEvent;
}

function mkComment(rootId: string, overrides: any = {}): NostrEvent {
  return {
    id: overrides.id || `cmt-${Math.random().toString(36).slice(2)}`,
    kind: overrides.kind || 1111,
    pubkey: overrides.pubkey || "user-1",
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: (overrides as any).tags || ([["e", rootId]] as any),
    content: overrides.content || "comment",
    sig: overrides.sig || "sig",
  } as unknown as NostrEvent;
}

describe("Repo core helpers", () => {
  it("computes canonical key and trusted maintainers", async () => {
    const repoEv = mkRepoAnnouncement({ pubkey: "owner-abc", tags: [["d", "my-repo"]] });
    const repo = parseRepoAnnouncementEvent(repoEv as any);
    const ctx = mkCtx({ repoEvent: repoEv, repo });
    // canonicalRepoKey currently formats as owner/name
    expect(canonicalRepoKey(`owner-abc:my-repo`)).toContain("owner-abc/my-repo");
    expect(RepoCore.trustedMaintainers(ctx)).toContain("owner-abc");
  });

  it("labels merge across namespaces with legacy t", async () => {
    const evt = mkPullRequest({
      id: "p4",
      tags: [
        ["t", "bug"],
        ["l", "org.nostr.git.type:feature"],
        ["l", "org.nostr.git.area:ui"],
      ],
    });
    const external: NostrEvent = {
      id: "lbl-ex-1",
      kind: 1985,
      pubkey: "maint-9",
      created_at: 999,
      tags: [
        ["L", "p4", "e"],
        ["l", "org.nostr.git.status:triaged"],
        ["l", "ugc/custom:needs-review"],
      ],
      content: "",
      sig: "sig",
    } as any;
    const ctx = mkCtx({ pullRequests: [evt] as any, labelEventsArr: [external] as any });
    const eff = RepoCore.getPullRequestLabels(ctx, "p4");
    // Namespaced labels should be in `flat`, legacy `t` values should be in `legacyT`
    const flat = Array.from(eff.flat);
    const legacyT = Array.from(eff.legacyT);
    const has = (...needles: string[]) =>
      flat.some((s) => needles.some((n) => s === n || s.includes(n)));
    expect(legacyT).toContain("bug");
    expect(has("org.nostr.git.type/feature", "org.nostr.git.type:feature", "type:feature")).toBe(
      true
    );
    expect(has("org.nostr.git.area/ui", "org.nostr.git.area:ui", "area:ui")).toBe(true);
    expect(
      has("org.nostr.git.status/triaged", "org.nostr.git.status:triaged", "status:triaged")
    ).toBe(true);
    expect(has("ugc/custom/needs-review", "ugc/custom:needs-review", "custom:needs-review")).toBe(
      true
    );
  });

  it("status precedence: author later overrides earlier maintainer (PR merged)", async () => {
    const pr = mkPullRequest({ id: "p5", pubkey: "author-z" });
    const maintClose = mkStatus({ kind: 1632, rootId: "p5", pubkey: "maint-x", created_at: 1200 });
    const authorMerge = mkStatus({
      kind: 1631,
      rootId: "p5",
      pubkey: "author-z",
      created_at: 1300,
    });
    const ctx = mkCtx({
      repoEvent: mkRepoAnnouncement({ pubkey: "owner-yy" }),
      repo: { owner: "owner-yy", name: "r", maintainers: ["maint-x"] } as any,
      pullRequests: [pr] as any,
      statusEventsArr: [maintClose, authorMerge] as any,
    });
    const status = RepoCore.resolveStatusFor(ctx, "p5");
    expect(status?.state).toBe("merged");
    expect(status?.by).toBe("author-z");
  });

  it("merges refs from multiple 30618 events", async () => {
    const repoEv = mkRepoAnnouncement({ pubkey: "owner-abc", tags: [["d", "repo"]] });
    const state1 = mkRepoState({
      pubkey: "owner-abc",
      created_at: 1000,
      tags: [
        ["r", "refs/heads/main", "ref"],
        ["r", "1111111111111111111111111111111111111111", "commit"],
      ],
    });
    const state2 = mkRepoState({
      pubkey: "maint-1",
      created_at: 2000,
      tags: [
        ["r", "refs/heads/main", "ref"],
        ["r", "2222222222222222222222222222222222222222", "commit"],
      ],
    });
    const ctx = mkCtx({
      repoEvent: repoEv,
      repo: { ...parseRepoAnnouncementEvent(repoEv as any), maintainers: ["maint-1"] } as any,
    });
    const merged = RepoCore.mergeRepoStateByMaintainers(ctx, [state1, state2] as any);
    const main = merged.get("heads:main");
    expect(main?.commitId).toBe("2222222222222222222222222222222222222222");
  });

  it("resolves status with precedence and author/trust policy", async () => {
    const issue = mkIssue({ id: "i1", pubkey: "author-x" });
    const s1 = mkStatus({ kind: 1630, rootId: "i1", pubkey: "author-x", created_at: 1000 }); // open by author
    const s2 = mkStatus({ kind: 1632, rootId: "i1", pubkey: "maintainer-1", created_at: 2000 }); // closed by trusted
    const ctx = mkCtx({
      repoEvent: mkRepoAnnouncement({ pubkey: "owner-abc" }),
      repo: { owner: "owner-abc", name: "r", maintainers: ["maintainer-1"] } as any,
      issues: [issue] as any,
      statusEventsArr: [s1, s2] as any,
    });
    const status = RepoCore.resolveStatusFor(ctx, "i1");
    expect(status?.state).toBe("closed");
  });

  it("returns NIP-22 scoped comments for a root", async () => {
    const issue = mkIssue({ id: "i2" });
    const c1 = mkComment("i2", { created_at: 1000 });
    const c2 = mkComment("i2", { created_at: 2000 });
    const ctx = mkCtx({ issues: [issue] as any, commentEventsArr: [c2, c1] as any });
    const thread = RepoCore.getIssueThread(ctx, "i2");
    expect(thread.comments[0].created_at).toBe(1000);
    expect(thread.comments[1].created_at).toBe(2000);
  });

  it("merges labels (self + external + legacy t)", async () => {
    const pr = mkPullRequest({ id: "p3", tags: [["t", "bug"]] });
    const externalLabel: NostrEvent = {
      id: "lbl-1",
      kind: 1985,
      pubkey: "maint-1",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["L", "p3", "e"],
        ["l", "type:feature"],
      ],
      content: "",
      sig: "sig",
    } as unknown as NostrEvent;
    const ctx = mkCtx({ pullRequests: [pr] as any, labelEventsArr: [externalLabel] as any });
    const labels = RepoCore.getPullRequestLabels(ctx, "p3");
    expect(Array.from(labels.flat)).toContain("ugc/type:feature");
  });

  it("applies status precedence: ignores non-trusted, latest trusted/author wins (issue resolved)", async () => {
    const issue = mkIssue({ id: "i3", pubkey: "author-y" });
    // author opens at t=1000
    const s1 = mkStatus({ kind: 1630, rootId: "i3", pubkey: "author-y", created_at: 1000 });
    // non-trusted attempts to close later (should be ignored)
    const sIgnored = mkStatus({ kind: 1632, rootId: "i3", pubkey: "random", created_at: 1500 });
    // trusted maintainer sets draft (older than final)
    const s2 = mkStatus({ kind: 1633, rootId: "i3", pubkey: "maint-2", created_at: 1200 });
    // author closes even later
    const s3 = mkStatus({ kind: 1632, rootId: "i3", pubkey: "author-y", created_at: 2000 });
    // maintainer finally resolves (for issues, kind 1631 → resolved) at t=2500
    const s4 = mkStatus({ kind: 1631, rootId: "i3", pubkey: "maint-2", created_at: 2500 });

    const ctx = mkCtx({
      repoEvent: mkRepoAnnouncement({ pubkey: "owner-zz" }),
      repo: { owner: "owner-zz", name: "r", maintainers: ["maint-2"] } as any,
      issues: [issue] as any,
      statusEventsArr: [s1, sIgnored, s2, s3, s4] as any,
    });
    const status = RepoCore.resolveStatusFor(ctx, "i3");
    expect(status?.state).toBe("resolved");
  });
});
