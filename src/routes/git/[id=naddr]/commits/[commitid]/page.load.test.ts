import {readFileSync} from "node:fs"
import {describe, expect, it, vi} from "vitest"

const pageSource = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8")

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

  it("keys cancellable reads across component instances and waits for clone URL context", () => {
    expect(pageSource).toContain("commitLoadInstanceId")
    expect(pageSource).toContain(
      'const operationId = `commit:${commitLoadInstanceId}:${repoClass.key || "pending"}:${commitid}:${generation}`',
    )
    expect(pageSource).toContain(
      "if (!commitid || !cloneUrlKey || routeKey === commitLoadRouteKey) return",
    )
  })
})
