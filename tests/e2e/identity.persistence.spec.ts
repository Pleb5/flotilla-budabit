import {expect, test} from "@playwright/test"

import {
  classifyConsoleMessages,
  type ConsoleMessageRecord,
} from "./console-classification"
import {
  loginAndAssertIdentity,
  PHASE_A_LOGIN_SCREEN,
  PHASE_B_LOGIN_SUBMIT,
  PHASE_C_IDENTITY_VISIBLE,
} from "./helpers/auth"

const PHASE_A_INITIAL_LOGIN = "PHASE_A_INITIAL_LOGIN"
const PHASE_B_RELOAD = "PHASE_B_RELOAD"
const PHASE_C_POST_RELOAD = "PHASE_C_POST_RELOAD"

test.describe("identity persistence (contract)", () => {
  test("survives reload without re-login", async ({page}) => {
    const consoleMessages: ConsoleMessageRecord[] = []
    const phaseErrorSnapshots: Record<string, ConsoleMessageRecord[]> = {}

    let currentPhase = "INIT"

    const recordPhaseSnapshot = (phase: string) => {
      phaseErrorSnapshots[phase] = consoleMessages
        .filter(message => message.type === "error")
        .map(message => ({...message}))
    }

    const changePhase = (phase: string) => {
      currentPhase = phase
    }

    page.on("console", message => {
      const location = message.location()
      const normalizedLocation =
        location && (location.url || location.lineNumber || location.columnNumber)
          ? {
              url: location.url,
              line: location.lineNumber,
              column: location.columnNumber,
            }
          : undefined

      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        phase: currentPhase,
        location: normalizedLocation,
      })
    })

    changePhase(PHASE_A_INITIAL_LOGIN)
    await page.goto("http://localhost:1847/")

    await loginAndAssertIdentity(page, {
      phaseHooks: {
        changePhase,
        recordPhaseSnapshot,
      },
    })

    // Verify nav is visible (indicates successful login)
    const navElement = page.locator("nav, [class*='nav'], [class*='sidebar']").first()
    await expect(navElement).toBeVisible({timeout: 10000})

    recordPhaseSnapshot(PHASE_A_INITIAL_LOGIN)

    changePhase(PHASE_B_RELOAD)
    const hashBeforeReload = await page.evaluate(() => window.location.hash)
    await page.reload()
    await page.waitForFunction(previous => window.location.hash === previous, hashBeforeReload)
    await page.waitForLoadState("networkidle")
    recordPhaseSnapshot(PHASE_B_RELOAD)

    changePhase(PHASE_C_POST_RELOAD)
    // After reload, verify we're still logged in (nav still visible, not landing page)
    await expect(navElement).toBeVisible({timeout: 10000})
    recordPhaseSnapshot(PHASE_C_POST_RELOAD)

    const loginScreenAfterReload = page.getByTestId("login-screen")
    await expect(loginScreenAfterReload).toHaveCount(0)

    const classifiedMessages = classifyConsoleMessages(consoleMessages)

    const summaryCounts = {
      blocking: 0,
      suspicious: 0,
      ignorable: 0,
    }

    const firstSeen: Partial<Record<"blocking" | "suspicious" | "ignorable", string>> = {}
    const uniqueTexts: Record<"blocking" | "suspicious" | "ignorable", string[]> = {
      blocking: [],
      suspicious: [],
      ignorable: [],
    }

    const uniqueTextSets: Record<"blocking" | "suspicious" | "ignorable", Set<string>> = {
      blocking: new Set(),
      suspicious: new Set(),
      ignorable: new Set(),
    }

    const blockingAggregates = new Map<
      string,
      {
        count: number
        firstPhase: string
      }
    >()

    for (const message of classifiedMessages) {
      summaryCounts[message.classification] += 1

      if (!firstSeen[message.classification]) {
        firstSeen[message.classification] = message.phase
      }

      const texts = uniqueTextSets[message.classification]
      if (!texts.has(message.text)) {
        texts.add(message.text)
        uniqueTexts[message.classification].push(message.text)
      }

      if (message.classification === "blocking") {
        const existing = blockingAggregates.get(message.text)
        if (existing) {
          existing.count += 1
        } else {
          blockingAggregates.set(message.text, {
            count: 1,
            firstPhase: message.phase,
          })
        }
      }
    }

    const phaseSnapshotCounts = Object.fromEntries(
      Object.entries(phaseErrorSnapshots).map(([phase, entries]) => [phase, entries.length]),
    )

    const structuredSummary = {
      consoleSummary: summaryCounts,
      firstSeen,
      uniqueTexts,
      phaseSnapshots: phaseSnapshotCounts,
    }

    console.info(JSON.stringify(structuredSummary))

    const blockingMessages = classifiedMessages.filter(
      message => message.classification === "blocking",
    )

    const blockingDetails = Array.from(blockingAggregates.entries()).map(
      ([text, {count, firstPhase}]) => `• ${text} (phase: ${firstPhase}, count: ${count})`,
    )

    expect(
      blockingMessages,
      blockingDetails.length
        ? `Blocking console errors detected:\n${blockingDetails.join("\n")}`
        : "Blocking console errors detected",
    ).toHaveLength(0)
  })
})
