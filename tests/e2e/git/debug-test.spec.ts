import { test, expect } from "@playwright/test"
import { TestSeeder, seedTestRepo, encodeRepoNaddr } from "../helpers"

const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

test("debug page structure", async ({ page }) => {
  const seeder = await seedTestRepo(page, {
    name: "debug-repo",
    description: "Debug repository",
    withPatches: 2,
  })

  const repos = seeder.getRepos()
  const repo = repos[0]
  const repoIdentifier = repo.tags.find((t) => t[0] === "d")?.[1] || "debug-repo"
  const naddr = encodeRepoNaddr(repo.pubkey, repoIdentifier)
  
  // Navigate to the repository
  const url = `/spaces/${ENCODED_RELAY}/git/${naddr}/`
  console.log("Navigating to:", url)
  await page.goto(url)
  
  // Wait for page to load
  await page.waitForTimeout(5000)
  
  // Log the current URL
  console.log("Current URL:", page.url())
  
  // Check what links exist on the page
  const allLinks = await page.locator("a").all()
  console.log(`Found ${allLinks.length} links`)
  
  for (const link of allLinks) {
    const href = await link.getAttribute("href")
    const text = await link.textContent()
    if (href && (href.includes("patches") || href.includes("issues") || href.includes("code"))) {
      console.log(`Link: href="${href}" text="${text?.trim()}"`)
    }
  }
  
  // Check for any element containing "Patches" text
  const patchesElements = await page.getByText("Patches").all()
  console.log(`Found ${patchesElements.length} elements with 'Patches' text`)
  
  // Check for RepoTab-like elements
  const tabElements = await page.locator("a[href*='/git/']").all()
  console.log(`Found ${tabElements.length} links containing '/git/'`)
  
  for (const tab of tabElements.slice(0, 10)) {
    const href = await tab.getAttribute("href")
    const text = await tab.textContent()
    console.log(`Tab link: href="${href}" text="${text?.trim()}"`)
  }
  
  // Take a screenshot for debugging
  await page.screenshot({ path: "test-results/debug-page.png", fullPage: true })
})
