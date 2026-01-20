/**
 * Global Setup for Playwright E2E Tests
 *
 * This file runs once before all tests begin. It:
 * - Ensures test directories exist
 * - Cleans up stale test artifacts
 * - Verifies the dev server is accessible
 *
 * @see https://playwright.dev/docs/test-global-setup-teardown
 */
import * as fs from "fs"
import * as path from "path"

// Test artifact directories
const TEST_RESULTS_DIR = "./test-results"
const AUTH_STATE_DIR = "./test-results/.auth"
const PLAYWRIGHT_OUTPUT_DIR = "./test-results/playwright"

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDirectoryExists(dirPath: string): void {
  const absolutePath = path.resolve(dirPath)
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, {recursive: true})
    console.log(`[global-setup] Created directory: ${absolutePath}`)
  }
}

/**
 * Clean up stale test artifacts from previous runs
 * Only cleans artifacts older than the specified max age
 */
function cleanupStaleArtifacts(dirPath: string, maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  const absolutePath = path.resolve(dirPath)
  if (!fs.existsSync(absolutePath)) {
    return
  }

  const now = Date.now()
  const entries = fs.readdirSync(absolutePath, {withFileTypes: true})

  for (const entry of entries) {
    // Skip .auth directory - we want to preserve auth state
    if (entry.name === ".auth") {
      continue
    }

    const entryPath = path.join(absolutePath, entry.name)
    try {
      const stats = fs.statSync(entryPath)
      const age = now - stats.mtimeMs

      if (age > maxAgeMs) {
        if (entry.isDirectory()) {
          fs.rmSync(entryPath, {recursive: true, force: true})
          console.log(`[global-setup] Cleaned up stale directory: ${entry.name}`)
        } else {
          fs.unlinkSync(entryPath)
          console.log(`[global-setup] Cleaned up stale file: ${entry.name}`)
        }
      }
    } catch {
      // Ignore errors when cleaning up
    }
  }
}

/**
 * Verify the dev server is accessible
 * Returns true if server responds, false otherwise
 */
async function verifyDevServer(baseURL: string, maxRetries: number = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(baseURL, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok || response.status < 500) {
        console.log(`[global-setup] Dev server is accessible at ${baseURL}`)
        return true
      }
    } catch {
      if (attempt < maxRetries) {
        console.log(`[global-setup] Waiting for dev server (attempt ${attempt}/${maxRetries})...`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  // Don't fail if server isn't accessible - Playwright's webServer config will handle starting it
  console.log(`[global-setup] Dev server not yet accessible at ${baseURL} - webServer config will start it`)
  return false
}

/**
 * Write test run metadata for debugging
 */
function writeTestRunMetadata(): void {
  const metadata = {
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    env: {
      CI: process.env.CI || "false",
      NODE_ENV: process.env.NODE_ENV || "test",
    },
  }

  const metadataPath = path.resolve(TEST_RESULTS_DIR, "test-run-metadata.json")
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
  console.log(`[global-setup] Wrote test run metadata`)
}

/**
 * Global setup function - runs once before all tests
 */
async function globalSetup(): Promise<void> {
  console.log("[global-setup] Starting global setup...")
  const startTime = Date.now()

  // 1. Ensure test directories exist
  ensureDirectoryExists(TEST_RESULTS_DIR)
  ensureDirectoryExists(AUTH_STATE_DIR)
  ensureDirectoryExists(PLAYWRIGHT_OUTPUT_DIR)

  // 2. Clean up stale test artifacts (older than 24 hours)
  cleanupStaleArtifacts(TEST_RESULTS_DIR)
  cleanupStaleArtifacts(PLAYWRIGHT_OUTPUT_DIR)

  // 3. Verify dev server is accessible (informational only)
  const baseURL = process.env.BASE_URL || "http://localhost:1847"
  await verifyDevServer(baseURL)

  // 4. Write test run metadata
  writeTestRunMetadata()

  const duration = Date.now() - startTime
  console.log(`[global-setup] Global setup completed in ${duration}ms`)
}

export default globalSetup
