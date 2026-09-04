import {describe, expect, it, vi} from "vitest"

const mkLoadEvent = (params: {commitid: string}, parentData: {repoId?: string}) =>
  ({
    params,
    data: null,
    route: {},
    url: new URL("https://example.com"),
    fetch: () => Promise.resolve(new Response()),
    setHeaders: () => {},
    parent: () => Promise.resolve(parentData),
    depends: () => {},
    untrack: (fn: () => void) => fn(),
    tracing: {},
  }) as any

describe("commits [commitid] page load", () => {
  it("returns only commitid without consulting parent repository state", async () => {
    const parent = vi.fn().mockRejectedValue(new Error("parent should not be called"))
    const {load} = await import("./+page")
    const event = mkLoadEvent({commitid: "abc123"}, {})
    event.parent = parent
    const result = await load(event)

    expect(result).toEqual({commitid: "abc123"})
    expect(parent).not.toHaveBeenCalled()
  })
})
