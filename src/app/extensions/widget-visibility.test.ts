import {describe, expect, it} from "vitest"
import {getWidgetVisibilityContextKey, validateWidgetVisibilityRequest} from "./widget-visibility"
import type {CommunityWidgetContext} from "./types"

const context = {
  definitionAddress: "32222:owner:community",
  contextSessionId: "session-a",
  contextVersion: 3,
  viewer: {pubkey: "viewer"},
} as CommunityWidgetContext

describe("widget visibility context isolation", () => {
  const request = {visibility: "visible", contextSessionId: "session-a", contextVersion: 3}
  it("accepts current decisions and rejects stale, missing, and malformed decisions", () => {
    expect(validateWidgetVisibilityRequest(request, context).visibility).toBe("visible")
    expect(() => validateWidgetVisibilityRequest(request)).toThrow(/stale or unavailable/)
    expect(() => validateWidgetVisibilityRequest({...request, contextVersion: 2}, context)).toThrow(
      /stale/,
    )
    expect(() =>
      validateWidgetVisibilityRequest({...request, contextSessionId: "old"}, context),
    ).toThrow(/stale/)
    expect(() => validateWidgetVisibilityRequest({...request, visibility: true}, context)).toThrow(
      /Invalid/,
    )
  })
  it("invalidates a decision for community, account, session, and version changes", () => {
    const key = getWidgetVisibilityContextKey(context)
    for (const changed of [
      {...context, definitionAddress: "another"},
      {...context, viewer: {...context.viewer, pubkey: "another"}},
      {...context, contextSessionId: "another"},
      {...context, contextVersion: 4},
    ])
      expect(getWidgetVisibilityContextKey(changed)).not.toBe(key)
    expect(getWidgetVisibilityContextKey()).toBe("")
  })
})
