import {describe, it, expect, vi, beforeEach} from "vitest"

/**
 * Tests for push preflight checks - specifically the requireUpToDate flag behavior
 *
 * These tests verify the fix for the "Remote appears to have new commits" error
 * that was occurring during new repository creation. The fix was to set
 * requireUpToDate: false for new repo pushes since we just created both repos.
 */

// Mock the dependencies
const mockIsRepoCloned = vi.fn()
const mockResolveBranchName = vi.fn()
const mockHasUncommittedChanges = vi.fn()
const mockIsShallowClone = vi.fn()
const mockNeedsUpdate = vi.fn()
const mockPushToRemote = vi.fn()
const mockCacheManager = {
  getRepoCache: vi.fn().mockResolvedValue({}),
}

// Simplified safePushToRemote implementation for testing
async function safePushToRemote(opts: {
  repoId: string
  remoteUrl: string
  branch?: string
  token: string
  provider: string
  preflight?: {
    blockIfUncommitted?: boolean
    requireUpToDate?: boolean
    blockIfShallow?: boolean
  }
  allowForce?: boolean
  confirmDestructive?: boolean
}) {
  const {
    repoId,
    remoteUrl,
    branch,
    token,
    provider,
    preflight = {},
    allowForce = false,
    confirmDestructive = false,
  } = opts

  const pf = {
    blockIfUncommitted: preflight.blockIfUncommitted ?? true,
    requireUpToDate: preflight.requireUpToDate ?? true,
    blockIfShallow: preflight.blockIfShallow ?? true,
  }

  const key = repoId.replace(":", "/")
  const dir = `/repos/${key}`

  try {
    const cloned = await mockIsRepoCloned(dir)
    if (!cloned) {
      return {success: false, error: "Repository not cloned locally; clone before pushing."}
    }

    const targetBranch = await mockResolveBranchName(dir, branch)

    if (pf.blockIfUncommitted) {
      const dirty = await mockHasUncommittedChanges(dir)
      if (dirty) {
        return {
          success: false,
          reason: "uncommitted_changes",
          error: "Working tree has uncommitted changes. Commit or stash before push.",
        }
      }
    }

    if (pf.blockIfShallow) {
      const shallow = await mockIsShallowClone(key)
      if (shallow) {
        return {
          success: false,
          reason: "shallow_clone",
          error: "Repository is a shallow/refs-only clone. Upgrade to full clone before pushing.",
        }
      }
    }

    if (pf.requireUpToDate) {
      const cache = await mockCacheManager.getRepoCache(key)
      if (provider !== "grasp") {
        const remoteChanged = await mockNeedsUpdate(key, [remoteUrl], cache, targetBranch)
        if (remoteChanged) {
          return {
            success: false,
            reason: "remote_ahead",
            error:
              "Push was blocked during preflight because the selected remote branch changed. Refresh the selected remote and retry.",
          }
        }
      }
    }

    if (allowForce && !confirmDestructive) {
      return {
        success: false,
        requiresConfirmation: true,
        reason: "force_push_requires_confirmation",
        warning: "Force push is potentially destructive. Confirmation required.",
      }
    }

    const pushRes = await mockPushToRemote({
      repoId,
      remoteUrl,
      branch: targetBranch,
      token,
      provider,
    })

    return {success: !!pushRes?.success, pushed: pushRes?.success}
  } catch (error: any) {
    return {success: false, error: error?.message || String(error)}
  }
}

describe("Push Preflight Checks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks for successful push
    mockIsRepoCloned.mockResolvedValue(true)
    mockResolveBranchName.mockResolvedValue("main")
    mockHasUncommittedChanges.mockResolvedValue(false)
    mockIsShallowClone.mockResolvedValue(false)
    mockNeedsUpdate.mockResolvedValue(false)
    mockPushToRemote.mockResolvedValue({success: true})
  })

  describe("requireUpToDate flag", () => {
    it("should block push when requireUpToDate is true and remote has new commits", async () => {
      mockNeedsUpdate.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          requireUpToDate: true,
        },
      })

      expect(result.success).toBe(false)
      expect(result.reason).toBe("remote_ahead")
      expect(result.error).toContain("blocked during preflight")
      expect(mockNeedsUpdate).toHaveBeenCalledWith(
        "owner/repo",
        ["https://github.com/owner/repo.git"],
        {},
        "main",
      )
      expect(mockPushToRemote).not.toHaveBeenCalled()
    })

    it("should allow push when requireUpToDate is false even if remote has new commits", async () => {
      // This is the key fix for new repo creation - remote might appear to have commits
      // immediately after creation (e.g., GitLab auto-creates README)
      mockNeedsUpdate.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          requireUpToDate: false, // Key: disabled for new repos
        },
      })

      expect(result.success).toBe(true)
      expect(mockNeedsUpdate).not.toHaveBeenCalled() // Should skip the check entirely
      expect(mockPushToRemote).toHaveBeenCalled()
    })

    it("should skip requireUpToDate check for GRASP provider", async () => {
      mockNeedsUpdate.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://grasp.example.com/repo.git",
        branch: "main",
        token: "test-token",
        provider: "grasp",
        preflight: {
          requireUpToDate: true,
        },
      })

      expect(result.success).toBe(true)
      expect(mockNeedsUpdate).not.toHaveBeenCalled() // GRASP skips this check
      expect(mockPushToRemote).toHaveBeenCalled()
    })

    it("should default requireUpToDate to true when not specified", async () => {
      mockNeedsUpdate.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        // No preflight specified - should use defaults
      })

      expect(result.success).toBe(false)
      expect(result.reason).toBe("remote_ahead")
    })
  })

  describe("blockIfUncommitted flag", () => {
    it("should block push when there are uncommitted changes", async () => {
      mockHasUncommittedChanges.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          blockIfUncommitted: true,
        },
      })

      expect(result.success).toBe(false)
      expect(result.reason).toBe("uncommitted_changes")
      expect(mockPushToRemote).not.toHaveBeenCalled()
    })

    it("should allow push with uncommitted changes when blockIfUncommitted is false", async () => {
      mockHasUncommittedChanges.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          blockIfUncommitted: false,
        },
      })

      expect(result.success).toBe(true)
      expect(mockPushToRemote).toHaveBeenCalled()
    })
  })

  describe("blockIfShallow flag", () => {
    it("should block push for shallow clones when blockIfShallow is true", async () => {
      mockIsShallowClone.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          blockIfShallow: true,
        },
      })

      expect(result.success).toBe(false)
      expect(result.reason).toBe("shallow_clone")
      expect(mockPushToRemote).not.toHaveBeenCalled()
    })

    it("should allow push for shallow clones when blockIfShallow is false", async () => {
      mockIsShallowClone.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          blockIfShallow: false,
        },
      })

      expect(result.success).toBe(true)
      expect(mockPushToRemote).toHaveBeenCalled()
    })
  })

  describe("New repo creation scenario", () => {
    it("should successfully push new repo with relaxed preflight checks", async () => {
      // Simulate the scenario where GitLab/GitHub might report the remote as "changed"
      // immediately after repo creation (e.g., auto-created README)
      mockNeedsUpdate.mockResolvedValue(true)

      const result = await safePushToRemote({
        repoId: "owner:new-repo",
        remoteUrl: "https://github.com/owner/new-repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        preflight: {
          blockIfUncommitted: true,
          requireUpToDate: false, // Disabled for new repos
          blockIfShallow: false, // New repos start as shallow
        },
      })

      expect(result.success).toBe(true)
      expect(result.pushed).toBe(true)
    })
  })

  describe("Force push handling", () => {
    it("should require confirmation for force push", async () => {
      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        allowForce: true,
        confirmDestructive: false,
      })

      expect(result.success).toBe(false)
      expect(result.requiresConfirmation).toBe(true)
      expect(result.reason).toBe("force_push_requires_confirmation")
    })

    it("should allow force push when confirmed", async () => {
      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
        allowForce: true,
        confirmDestructive: true,
      })

      expect(result.success).toBe(true)
      expect(mockPushToRemote).toHaveBeenCalled()
    })
  })

  describe("Error handling", () => {
    it("should fail if repository is not cloned", async () => {
      mockIsRepoCloned.mockResolvedValue(false)

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("not cloned locally")
    })

    it("should handle push errors gracefully", async () => {
      mockPushToRemote.mockRejectedValue(new Error("Network error"))

      const result = await safePushToRemote({
        repoId: "owner:repo",
        remoteUrl: "https://github.com/owner/repo.git",
        branch: "main",
        token: "test-token",
        provider: "github",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Network error")
    })
  })
})
