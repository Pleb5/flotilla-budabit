import "dotenv/config"
import {test, expect} from "@playwright/test"
import {writeFileSync} from "node:fs"
import {GitHubPage} from "../pages/git-hub.page"
import {RepoPage} from "../pages/repo.page"

/**
 * E2E benchmark mode: measures repo navigation and tab-switch timings.
 *
 * Records results to bench-e2e.json for regression tracking. Does not assert
 * thresholds—use navigation.spec.ts for pass/fail performance gates.
 *
 * Run: pnpm test:e2e:bench
 * Output: bench-e2e.json
 *
 * Optional: BENCH_REPO_NADDR=<naddr> to benchmark a specific repo directly
 * (avoids needing repos in Git Hub, useful for CI)
 */

const TEST_RELAY = "localhost:7777"
const OUTPUT_FILE = "bench-e2e.json"

/** When set, navigate directly to this repo naddr (skips Git Hub, works with no user repos) */
const BENCH_REPO_NADDR = process.env.BENCH_REPO_NADDR?.trim()

type TabName = "issues" | "patches" | "code" | "commits"

interface BenchmarkResult {
  timestamp: string
  scenario: string
  ms: number
}

interface BenchmarkReport {
  runAt: string
  results: BenchmarkResult[]
  summary: {
    repoLoad: {min: number; avg: number; max: number}
    tabSwitch: Record<TabName, {min: number; avg: number; max: number}>
  }
}

test.describe("e2e benchmark", () => {
  const results: BenchmarkResult[] = []

  test("benchmark repo load + tab switches", async ({page}) => {
    let repoPath: string

    if (BENCH_REPO_NADDR) {
      repoPath = BENCH_REPO_NADDR
    } else {
      // Navigate via Git Hub and click first repo
      const gitHubPage = new GitHubPage(page, TEST_RELAY)
      await gitHubPage.goto()

      const repoCount = await gitHubPage.getRepoCount()
      if (repoCount === 0) {
        test.skip(true, "No repos available. Set BENCH_REPO_NADDR to use a specific repo, or create/bookmark one.")
        return
      }

      await gitHubPage.clickRepoByIndex(0)
      await page.waitForURL(/\/git\/[^/]+/)

      const url = new URL(page.url())
      const pathParts = url.pathname.split("/")
      const gitIdx = pathParts.indexOf("git")
      repoPath = gitIdx >= 0 ? decodeURIComponent(pathParts[gitIdx + 1] ?? "") : ""
      if (!repoPath) {
        test.skip(true, "Could not extract repo path")
        return
      }
    }

    const repoPage = new RepoPage(page, TEST_RELAY, repoPath)

    const repoLoadStart = Date.now()
    if (BENCH_REPO_NADDR) {
      await page.goto(repoPage.baseUrl, {waitUntil: "load"})
      await page.waitForTimeout(2000)
    } else {
      await repoPage.goto()
    }
    // Wait for repo to load (tabs indicate RepoHeader has rendered)
    await expect(repoPage.issuesTab).toBeVisible({timeout: 30000})
    results.push({
      timestamp: new Date().toISOString(),
      scenario: "repo-load",
      ms: Date.now() - repoLoadStart,
    })

    // Measure each tab switch (from repo overview)
    const tabs: TabName[] = ["issues", "patches", "code", "commits"]
    for (const tab of tabs) {
      const start = Date.now()
      await repoPage.gotoTab(tab)
      await repoPage.waitForTabContent(tab)
      const elapsed = Date.now() - start
      results.push({
        timestamp: new Date().toISOString(),
        scenario: `tab-switch:${tab}`,
        ms: elapsed,
      })
    }
  })

  test.afterAll(async () => {
    if (results.length === 0) {
      console.log("\nE2E benchmark skipped: no repos. Set BENCH_REPO_NADDR or create/bookmark a repo.")
      return
    }

    const byScenario = results.reduce(
      (acc, r) => {
        const key = r.scenario
        if (!acc[key]) acc[key] = []
        acc[key].push(r.ms)
        return acc
      },
      {} as Record<string, number[]>,
    )

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0)
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0)

    const report: BenchmarkReport = {
      runAt: new Date().toISOString(),
      results,
      summary: {
        repoLoad: {
          min: min(byScenario["repo-load"] ?? []),
          avg: avg(byScenario["repo-load"] ?? []),
          max: max(byScenario["repo-load"] ?? []),
        },
        tabSwitch: {
          issues: {
            min: min(byScenario["tab-switch:issues"] ?? []),
            avg: avg(byScenario["tab-switch:issues"] ?? []),
            max: max(byScenario["tab-switch:issues"] ?? []),
          },
          patches: {
            min: min(byScenario["tab-switch:patches"] ?? []),
            avg: avg(byScenario["tab-switch:patches"] ?? []),
            max: max(byScenario["tab-switch:patches"] ?? []),
          },
          code: {
            min: min(byScenario["tab-switch:code"] ?? []),
            avg: avg(byScenario["tab-switch:code"] ?? []),
            max: max(byScenario["tab-switch:code"] ?? []),
          },
          commits: {
            min: min(byScenario["tab-switch:commits"] ?? []),
            avg: avg(byScenario["tab-switch:commits"] ?? []),
            max: max(byScenario["tab-switch:commits"] ?? []),
          },
        },
      },
    }

    writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2))
    console.log(`\nE2E benchmark results written to ${OUTPUT_FILE}`)
    console.log(
      `  repo-load: ${report.summary.repoLoad.avg.toFixed(0)}ms (avg)`,
    )
    for (const [tab, s] of Object.entries(report.summary.tabSwitch)) {
      console.log(`  tab-switch:${tab}: ${s.avg.toFixed(0)}ms (avg)`)
    }
  })
})
