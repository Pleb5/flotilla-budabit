import {describe, expect, it} from "vitest"

import {isCurrentCodeRead, shouldRestartCodeSnapshot} from "./code-read-state"

describe("Code page read state", () => {
  const read = {
    requestId: 4,
    repoEventId: "repo-event",
    cloneUrlKey: "primary\0secondary",
    branch: "main",
  }

  it("rejects stale completions after a branch, repository, or remote-list change", () => {
    expect(isCurrentCodeRead(read, read)).toBe(true)
    expect(isCurrentCodeRead(read, {...read, requestId: 5})).toBe(false)
    expect(isCurrentCodeRead(read, {...read, branch: "dev"})).toBe(false)
    expect(isCurrentCodeRead(read, {...read, branch: ""})).toBe(false)
    expect(isCurrentCodeRead(read, {...read, repoEventId: "replacement"})).toBe(false)
    expect(isCurrentCodeRead(read, {...read, cloneUrlKey: "secondary"})).toBe(false)
  })

  it("restarts only for an explicitly unavailable immutable snapshot", () => {
    expect(shouldRestartCodeSnapshot({code: "repository-snapshot-unavailable"})).toBe(true)
    expect(shouldRestartCodeSnapshot({code: "network-error"})).toBe(false)
    expect(shouldRestartCodeSnapshot(new DOMException("Aborted", "AbortError"))).toBe(false)
  })
})
