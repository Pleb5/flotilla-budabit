import {describe, expect, it} from "vitest"
import {
  getNotificationRowDisplay,
  getNotificationRowVisibleText,
  sanitizeNotificationText,
  type NotificationRow,
} from "./notification-display"

const longId = "a".repeat(64)
const shareEntity = ["ne", "vent1"].join("")

describe("notification display", () => {
  it("sanitizes raw event links, paths, and long ids from visible text", () => {
    const display = getNotificationRowDisplay({
      id: `event:${longId}`,
      eventId: longId,
      source: "git",
      sourceLabel: "Git",
      type: "repo",
      title: `New issue ${longId}`,
      action: "commented",
      contextLabel: `/git/repo/issues/${longId}`,
      preview: `See nostr:${shareEntity}qqqqqq and /git/repo/issues/${longId}`,
      path: `/git/repo/issues/${longId}`,
      readPath: "/git/repo/issues",
      navigationEventId: longId,
      target: {
        label: "Issue context",
        preview: `target ${longId}`,
        path: `/git/repo/issues/${longId}`,
        eventId: longId,
        actionLabel: "Open git item",
      },
      createdAt: 100,
      searchText: "git issue",
    })
    const visibleText = getNotificationRowVisibleText(display)

    expect(visibleText).not.toMatch(new RegExp(shareEntity, "i"))
    expect(visibleText).not.toContain("quoted event")
    expect(visibleText).not.toContain("nostr:")
    expect(visibleText).not.toContain("/git/")
    expect(visibleText).not.toContain(longId)
    expect(visibleText).not.toMatch(new RegExp(["re", "post"].join(""), "i"))
    expect(display.primaryAction).toEqual({
      label: "Open git item",
      path: `/git/repo/issues/${longId}`,
      eventId: longId,
    })
    expect(display.sections[0]).toEqual(
      expect.objectContaining({
        label: "Issue context",
        path: `/git/repo/issues/${longId}`,
        eventId: longId,
      }),
    )
  })

  it("builds compact row text and expansion sections", () => {
    const row: NotificationRow = {
      id: "event:reply",
      eventId: "reply",
      source: "community",
      sourceLabel: "Communities",
      type: "reply",
      title: "New reply",
      action: "replied",
      contextLabel: "to your comment",
      preview: "reply body",
      path: `/${shareEntity}reply`,
      readPath: `/${shareEntity}reply`,
      target: {
        label: "Your comment",
        preview: "original body",
        path: `/${shareEntity}target`,
        eventId: "target",
        actionLabel: "Open context",
      },
      detail: {
        label: "New reply",
        preview: "reply body",
        path: `/${shareEntity}reply`,
        eventId: "reply",
        actionLabel: "Open reply",
      },
      createdAt: 100,
      searchText: "reply",
    }

    expect(getNotificationRowDisplay(row)).toEqual(
      expect.objectContaining({
        type: "reply",
        action: "replied",
        context: "to your comment",
        sections: [
          expect.objectContaining({label: "Your comment", preview: "original body"}),
          expect.objectContaining({label: "New reply", preview: "reply body"}),
        ],
      }),
    )
    expect(sanitizeNotificationText("Open /chat/alice")).toBe("Open activity")
    expect(sanitizeNotificationText(`nostr:${shareEntity}qqqq reply body`)).toBe("reply body")
    expect(sanitizeNotificationText("nostr:nprofile1qqqq body")).toBe("body")
  })
})
