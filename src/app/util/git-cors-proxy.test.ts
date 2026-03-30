// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

const toastStore = {
  subscribe: (run: (items: Array<{message?: string}>) => void) => {
    run([])
    return () => {}
  },
}

vi.mock("$app/environment", () => ({browser: true}))
vi.mock("$app/navigation", () => ({goto: vi.fn()}))
vi.mock("@nostr-git/ui", () => ({
  WorkerManager: {
    setGlobalGitConfig: vi.fn(),
  },
}))
vi.mock("@app/util/toast", () => ({
  toast: toastStore,
  pushToast: vi.fn(),
}))
vi.mock("@lib/budabit/worker-singleton", () => ({
  setGitWorkerConfig: vi.fn(),
  terminateGitWorker: vi.fn(),
}))

describe("git-cors-proxy", () => {
  describe("normalizeGitCorsProxy", () => {
    it("returns empty string for empty or whitespace input", async () => {
      const {normalizeGitCorsProxy} = await import("./git-cors-proxy")
      expect(normalizeGitCorsProxy("")).toBe("")
      expect(normalizeGitCorsProxy("   ")).toBe("")
    })

    it("adds https when scheme is missing", async () => {
      const {normalizeGitCorsProxy} = await import("./git-cors-proxy")
      expect(normalizeGitCorsProxy("cors.example.com")).toMatch(/^https:\/\//)
    })

    it("preserves https URLs", async () => {
      const {normalizeGitCorsProxy} = await import("./git-cors-proxy")
      const url = "https://cors.example.com"
      expect(normalizeGitCorsProxy(url)).toBe(url)
    })

    it("preserves http URLs", async () => {
      const {normalizeGitCorsProxy} = await import("./git-cors-proxy")
      const url = "http://cors.example.com"
      expect(normalizeGitCorsProxy(url)).toBe(url)
    })

    it("strips trailing slashes", async () => {
      const {normalizeGitCorsProxy} = await import("./git-cors-proxy")
      expect(normalizeGitCorsProxy("https://cors.example.com/")).toBe("https://cors.example.com")
      expect(normalizeGitCorsProxy("https://cors.example.com///")).toBe("https://cors.example.com")
    })
  })

  describe("resolveGitCorsProxy", () => {
    it("returns DEFAULT_GIT_CORS_PROXY when value is empty", async () => {
      const {resolveGitCorsProxy, DEFAULT_GIT_CORS_PROXY} = await import("./git-cors-proxy")
      expect(resolveGitCorsProxy("")).toBe(DEFAULT_GIT_CORS_PROXY)
      expect(resolveGitCorsProxy(null)).toBe(DEFAULT_GIT_CORS_PROXY)
      expect(resolveGitCorsProxy(undefined)).toBe(DEFAULT_GIT_CORS_PROXY)
    })

    it("returns normalized URL when value is valid", async () => {
      const {resolveGitCorsProxy} = await import("./git-cors-proxy")
      expect(resolveGitCorsProxy("https://custom.proxy.com")).toBe("https://custom.proxy.com")
    })
  })

  describe("isCorsProxyIssue", () => {
    it("returns false for null/undefined", async () => {
      const {isCorsProxyIssue} = await import("./git-cors-proxy")
      expect(isCorsProxyIssue(null)).toBe(false)
      expect(isCorsProxyIssue(undefined)).toBe(false)
    })

    it("returns true when error has corsError property", async () => {
      const {isCorsProxyIssue} = await import("./git-cors-proxy")
      expect(isCorsProxyIssue({corsError: true})).toBe(true)
    })

    it("returns true when message contains CORS keywords", async () => {
      const {isCorsProxyIssue} = await import("./git-cors-proxy")
      expect(isCorsProxyIssue(new Error("CORS policy blocked"))).toBe(true)
      expect(isCorsProxyIssue(new Error("Access-Control-Allow-Origin"))).toBe(true)
      expect(isCorsProxyIssue(new Error("cross-origin request failed"))).toBe(true)
      expect(isCorsProxyIssue(new Error("Network error"))).toBe(true)
      expect(isCorsProxyIssue(new Error("Failed to fetch"))).toBe(true)
    })

    it("returns false when message has no CORS keywords", async () => {
      const {isCorsProxyIssue} = await import("./git-cors-proxy")
      expect(isCorsProxyIssue(new Error("Something else"))).toBe(false)
    })
  })
})
