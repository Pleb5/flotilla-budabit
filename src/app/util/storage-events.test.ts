import {describe, expect, it} from "vitest"
import {COMMUNITY_REPORT_KIND} from "@app/core/community-reports"
import {isPersistedCommunityReportDeleteEvent, isPersistedGitDeleteEvent} from "./storage-events"

describe("storage git delete persistence", () => {
  it("persists repo-scoped git delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1618"],
          ["e", "target-1"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(true)
  })

  it("does not persist non-repo delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-2",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-2"],
        ],
      } as any),
    ).toBe(false)
  })

  it("does not persist delete events without a git target kind", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-3",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-3"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(false)
  })
})

describe("storage community report delete persistence", () => {
  it("persists community report delete events", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", String(COMMUNITY_REPORT_KIND)],
          ["e", "report-1"],
        ],
      } as any),
    ).toBe(true)
  })

  it("does not persist report delete events without a target", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-2",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [["k", String(COMMUNITY_REPORT_KIND)]],
      } as any),
    ).toBe(false)
  })

  it("does not persist unrelated delete events", () => {
    expect(
      isPersistedCommunityReportDeleteEvent({
        id: "delete-report-3",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "report-3"],
        ],
      } as any),
    ).toBe(false)
  })
})
