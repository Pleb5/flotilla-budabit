import {createRequire} from "node:module"
import path from "node:path"
import {fileURLToPath} from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const budabitRequire = createRequire(path.join(repoRoot, "package.json"))
const {chromium} = budabitRequire("@playwright/test")
const {generateSecretKey} = budabitRequire("nostr-tools")
const {nsecEncode} = budabitRequire("nostr-tools/nip19")

const baseUrl = process.env.BUDABIT_BASE_URL || "http://localhost:1847"
const outputDir =
  process.env.SCREENSHOT_OUTPUT_DIR ||
  path.resolve(repoRoot, "../budabit-landing/src/assets/screenshots")
const community = "npub1p28vhfyx3sf7r6zvch943spvrlggsrv7tgj62pgwa94d3gtx6lyqqkhpp3"
const repoPath =
  "/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqyxhwumn8ghj7mn0wvhxcmmvqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9nhwden5te0wfjkccte9ec8y6tdv9kzumn9wsq3gamnwvaz7tmjv4kxz7fwdenkjapwv3jhvqgjwaehxw309ankjarwdaehgu3wvdhk6qqsvekx7arfd3kxzttzw4jxzcnfwsaq3duy"

const routes = [
  {
    name: "community-home",
    path: `/c/${community}`,
    readyText: /Home|BudaBit|Git|Threads|Access Requests/i,
    waitForText: /Test|Introduction|Showcase|Onboarding/i,
    waitForNoText: /Looking for rooms/i,
    finalDelayMs: 3_500,
  },
  {
    name: "community-curation",
    path: "/git",
    preloadPath: `/c/${community}`,
    localStorage: {
      "git:selected-mode": '"community"',
      "git:selected-tab": '"my-repos"',
    },
    readyText:
      /Git Repositories|Community Curated|Repos|Looking for community Git repos|No repositories are bound/i,
    waitForText: /flotilla-budabit|nostropus|nostr-git/i,
    waitForNoText: /Looking for community Git repos|Discovering new Repos/i,
    finalDelayMs: 4_000,
  },
  {
    name: "moderation-access",
    path: `/c/${community}/access`,
    readyText: /Access Requests|Publishing access requests|Your community permissions/i,
    waitForNoText: /Loading community permissions/i,
    waitForText: /General|Rooms|Threads|Calendar|8 sections/i,
    finalDelayMs: 3_500,
  },
  {
    name: "community-network",
    path: repoPath,
    preloadPath: `/c/${community}`,
    readyText: /flotilla-budabit|Overview|Activity|Code|Issues|PRs|Community/i,
    waitForText: /Budabit is a community-first|Recent Activity|Owner/i,
    waitForNoText: /Loading repository|Cloning repository/i,
    finalDelayMs: 5_000,
  },
]

const profiles = [
  {suffix: "desktop", width: 1280, height: 800, deviceScaleFactor: 2, isMobile: false},
  {suffix: "mobile", width: 390, height: 800, deviceScaleFactor: 2, isMobile: true},
]

const themes = [
  {name: "light", fileSegment: "", colorScheme: "light"},
  {name: "dark", fileSegment: "dark", colorScheme: "dark"},
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForAppReady(page, readyText) {
  await page.waitForLoadState("domcontentloaded")
  await page.waitForFunction(() => document.body && document.body.innerText.length > 40, null, {
    timeout: 45_000,
  })
  await page
    .getByText(readyText)
    .first()
    .waitFor({state: "visible", timeout: 45_000})
    .catch(() => undefined)
  await page.waitForLoadState("networkidle", {timeout: 8_000}).catch(() => undefined)
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined)
  await sleep(1_500)
}

async function waitForVisibleImages(page) {
  await page
    .evaluate(async () => {
      const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))
      const images = Array.from(document.images).filter(img => {
        const rect = img.getBoundingClientRect()
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= window.innerHeight &&
          rect.left <= window.innerWidth
        )
      })

      await Promise.all(
        images.map(async img => {
          if (img.complete && img.naturalWidth > 0) {
            if (typeof img.decode === "function") {
              await img.decode().catch(() => undefined)
            }
            return
          }

          await Promise.race([
            new Promise(resolve => {
              img.addEventListener("load", resolve, {once: true})
              img.addEventListener("error", resolve, {once: true})
            }),
            timeout(10_000),
          ])

          if (typeof img.decode === "function") {
            await img.decode().catch(() => undefined)
          }
        }),
      )
    })
    .catch(() => undefined)
}

async function waitForLayoutQuiet(page) {
  await page
    .evaluate(async () => {
      const getSignature = () => {
        const scrolling = document.scrollingElement || document.documentElement
        return [
          document.body?.innerText?.length || 0,
          scrolling.scrollWidth,
          scrolling.scrollHeight,
          document.querySelectorAll("img").length,
          document.querySelectorAll('[aria-busy="true"], .loading, .loading-spinner').length,
        ].join(":")
      }

      let stableFrames = 0
      let last = getSignature()
      const deadline = performance.now() + 6_000

      while (performance.now() < deadline && stableFrames < 8) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const next = getSignature()
        if (next === last) stableFrames += 1
        else stableFrames = 0
        last = next
      }
    })
    .catch(() => undefined)
}

async function waitForScreenshotReady(page, route) {
  await page.waitForLoadState("networkidle", {timeout: 12_000}).catch(() => undefined)
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined)
  await waitForVisibleImages(page)

  if (route.waitForText) {
    await page
      .getByText(route.waitForText)
      .first()
      .waitFor({state: "visible", timeout: 25_000})
      .catch(() => undefined)
  }
  if (route.waitForNoText) {
    await page
      .getByText(route.waitForNoText)
      .first()
      .waitFor({state: "hidden", timeout: 25_000})
      .catch(() => undefined)
  }

  await waitForLayoutQuiet(page)
  await waitForVisibleImages(page)
  await sleep(route.finalDelayMs ?? 3_000)
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined)
  await waitForVisibleImages(page)
}

async function openLogin(page) {
  const loginScreen = page.getByTestId("login-screen")
  if (await loginScreen.isVisible().catch(() => false)) return

  const visibleLogin = page.getByRole("button", {name: /^log in$/i}).first()
  if (await visibleLogin.isVisible().catch(() => false)) {
    await visibleLogin.click()
    return
  }

  const accessLogin = page.getByText(/log in/i).first()
  if (await accessLogin.isVisible().catch(() => false)) {
    await accessLogin.click()
  }
}

async function loginWithGeneratedNsec(page, nsec) {
  await page.goto(`${baseUrl}/`, {waitUntil: "domcontentloaded"})
  await waitForAppReady(page, /Log in with Nostr|BudaBit|Developer Community Network/i)
  await openLogin(page)

  const localKeyOption = page.getByTestId("login-option-local-key")
  await localKeyOption.waitFor({state: "visible", timeout: 15_000})
  await localKeyOption.click()

  const nsecInput = page.locator('input[placeholder="nsec1..."]').first()
  await nsecInput.waitFor({state: "visible", timeout: 15_000})
  await nsecInput.fill(nsec)
  await page
    .getByRole("button", {name: /^log in$/i})
    .last()
    .click()

  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem("pubkey") || localStorage.getItem("CapacitorStorage.pubkey")
      return Boolean(raw && raw.length > 10)
    },
    null,
    {timeout: 20_000},
  )
  await page.waitForLoadState("networkidle", {timeout: 8_000}).catch(() => undefined)
  await sleep(1_000)
}

async function dismissTransientUi(page) {
  await page.keyboard.press("Escape").catch(() => undefined)
  await page
    .locator('.toast, [role="status"], [data-testid="toast"]')
    .evaluateAll(nodes => {
      for (const node of nodes) node.remove()
    })
    .catch(() => undefined)
}

async function captureRoute(browser, storageState, route, profile, theme) {
  const context = await browser.newContext({
    viewport: {width: profile.width, height: profile.height},
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    storageState,
    reducedMotion: "reduce",
    colorScheme: theme.colorScheme,
  })
  const page = await context.newPage()

  const initialStorage = {
    ...(route.localStorage || {}),
    theme: JSON.stringify(theme.name),
  }

  await page.addInitScript(values => {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, value)
    }
  }, initialStorage)

  if (route.preloadPath) {
    await page.goto(`${baseUrl}${route.preloadPath}`, {waitUntil: "domcontentloaded"})
    await waitForAppReady(page, /Home|BudaBit|Git|Threads|Access Requests/i)
  }

  await page.goto(`${baseUrl}${route.path}`, {waitUntil: "domcontentloaded"})
  await page.addStyleTag({
    content: `
    *, *::before, *::after {
      animation-duration: 0.001s !important;
      animation-delay: 0s !important;
      transition-duration: 0.001s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }
  `,
  })
  await waitForAppReady(page, route.readyText)
  await waitForScreenshotReady(page, route)
  await page
    .evaluate(themeName => document.body.setAttribute("data-theme", themeName), theme.name)
    .catch(() => undefined)
  await dismissTransientUi(page)

  const themePart = theme.fileSegment ? `-${theme.fileSegment}` : ""
  const outputPath = path.join(outputDir, `${route.name}${themePart}-${profile.suffix}.png`)
  await page.screenshot({path: outputPath, scale: "device"})
  await context.close()
  console.log(`captured ${outputPath}`)
}

async function main() {
  const browser = await chromium.launch({headless: true})
  const setupContext = await browser.newContext({
    viewport: {width: 1280, height: 800},
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: "light",
  })
  const setupPage = await setupContext.newPage()
  const nsec = nsecEncode(generateSecretKey())
  console.log(`generated screenshot login key: ${nsec}`)
  await loginWithGeneratedNsec(setupPage, nsec)
  const storageState = await setupContext.storageState()
  await setupContext.close()

  for (const theme of themes) {
    for (const profile of profiles) {
      for (const route of routes) {
        await captureRoute(browser, storageState, route, profile, theme)
      }
    }
  }

  await browser.close()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
