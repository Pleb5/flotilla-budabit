/**
 * Global Teardown for Playwright E2E Tests
 *
 * This file runs once after all tests complete. It:
 * - Cleans up test artifacts if needed
 * - Generates a summary report
 * - Logs final test run statistics
 *
 * @see https://playwright.dev/docs/test-global-setup-teardown
 */
import * as fs from "fs"
import * as path from "path"

// Test artifact directories
const TEST_RESULTS_DIR = "./test-results"

interface TestRunMetadata {
  startedAt: string
  nodeVersion: string
  platform: string
  cwd: string
  env: {
    CI: string
    NODE_ENV: string
  }
}

interface TestRunSummary extends TestRunMetadata {
  completedAt: string
  durationMs: number
  status: "completed"
}

/**
 * Read the test run metadata written during setup
 */
function readTestRunMetadata(): TestRunMetadata | null {
  const metadataPath = path.resolve(TEST_RESULTS_DIR, "test-run-metadata.json")

  try {
    if (fs.existsSync(metadataPath)) {
      const content = fs.readFileSync(metadataPath, "utf-8")
      return JSON.parse(content)
    }
  } catch {
    console.log("[global-teardown] Could not read test run metadata")
  }

  return null
}

/**
 * Generate a summary report of the test run
 */
function generateSummaryReport(metadata: TestRunMetadata | null): TestRunSummary | null {
  if (!metadata) {
    return null
  }

  const completedAt = new Date().toISOString()
  const startTime = new Date(metadata.startedAt).getTime()
  const endTime = new Date(completedAt).getTime()
  const durationMs = endTime - startTime

  const summary: TestRunSummary = {
    ...metadata,
    completedAt,
    durationMs,
    status: "completed",
  }

  const summaryPath = path.resolve(TEST_RESULTS_DIR, "test-run-summary.json")
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

  return summary
}

/**
 * Clean up temporary test artifacts that should not persist
 * Preserves:
 * - .auth directory (auth state)
 * - playwright directory (test results)
 * - Summary files
 */
function cleanupTemporaryArtifacts(): void {
  const absolutePath = path.resolve(TEST_RESULTS_DIR)
  if (!fs.existsSync(absolutePath)) {
    return
  }

  // List of patterns to preserve
  const preservePatterns = [".auth", "playwright", "test-run-", ".gitkeep"]

  const entries = fs.readdirSync(absolutePath, {withFileTypes: true})

  for (const entry of entries) {
    // Check if this entry should be preserved
    const shouldPreserve = preservePatterns.some((pattern) => entry.name.includes(pattern))

    if (!shouldPreserve) {
      const entryPath = path.join(absolutePath, entry.name)
      try {
        if (entry.isDirectory()) {
          // Only clean up empty temporary directories
          const contents = fs.readdirSync(entryPath)
          if (contents.length === 0) {
            fs.rmdirSync(entryPath)
            console.log(`[global-teardown] Removed empty directory: ${entry.name}`)
          }
        }
        // Don't remove files that aren't in our preserve list - let them be cleaned up by age in setup
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Log test run statistics
 */
function logTestRunStats(summary: TestRunSummary | null): void {
  if (!summary) {
    console.log("[global-teardown] No test run metadata available")
    return
  }

  const durationSec = (summary.durationMs / 1000).toFixed(2)
  console.log("\n========================================")
  console.log("        E2E Test Run Summary")
  console.log("========================================")
  console.log(`Started:    ${summary.startedAt}`)
  console.log(`Completed:  ${summary.completedAt}`)
  console.log(`Duration:   ${durationSec}s`)
  console.log(`Platform:   ${summary.platform}`)
  console.log(`Node:       ${summary.nodeVersion}`)
  console.log(`CI:         ${summary.env.CI}`)
  console.log("========================================\n")
}

/**
 * Global teardown function - runs once after all tests
 */
async function globalTeardown(): Promise<void> {
  console.log("[global-teardown] Starting global teardown...")

  // 1. Read test run metadata
  const metadata = readTestRunMetadata()

  // 2. Generate summary report
  const summary = generateSummaryReport(metadata)

  // 3. Clean up temporary artifacts
  cleanupTemporaryArtifacts()

  // 4. Log test run statistics
  logTestRunStats(summary)

  console.log("[global-teardown] Global teardown completed")
}

export default globalTeardown
