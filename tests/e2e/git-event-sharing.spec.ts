import {expect, test, type Locator, type Page} from "@playwright/test"
import {decode} from "nostr-tools/nip19"
import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createIssue,
  createPullRequest,
  createPullRequestUpdate,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {seedDevSession} from "./helpers/dev-session"
import {MockRelay, type NostrEvent} from "./helpers/mock-relay"

const repoRelays = ["wss://git-share-primary.test", "wss://git-share-secondary.test"]
const identifier = "event-sharing-fixture"
const repoAddress = getRepoAddress(TEST_PUBKEYS.devUser, identifier)
// Discovering the repo on a different relay must not leak that relay into event shares.
const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, ["wss://git-share-discovery.test"])
const repoPath = `/git/${naddr}`
const announcement = signTestEvent(
  createRepoAnnouncement({
    identifier,
    name: "Event sharing fixture",
    relays: [...repoRelays, `${repoRelays[0]}/`],
    pubkey: TEST_PUBKEYS.devUser,
    created_at: BASE_TIMESTAMP,
  }),
)
const issue = signTestEvent(
  createIssue({
    repoAddress,
    subject: "Share this issue without leaving the list",
    content: "Issue sharing regression fixture.",
    labels: ["sharing", "regression"],
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 1,
  }),
)
const pullRequest = signTestEvent(
  createPullRequest({
    repoAddress,
    subject: "Share this pull request without leaving the list",
    content: "Pull request sharing regression fixture.",
    tipCommitOid: TEST_COMMITS.second,
    labels: ["sharing", "regression"],
    branchName: "share-actions",
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 2,
  }),
)
const update = signTestEvent(
  createPullRequestUpdate({
    repoAddress,
    prEventId: pullRequest.id,
    tipCommitOid: TEST_COMMITS.third,
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 3,
  }),
)

const setupSharing = async (page: Page, extraEvents: NostrEvent[] = []) => {
  await page.addInitScript(() => {
    localStorage.clear()
    // Capture only this test's copy requests, without reading/writing the system clipboard.
    const copied: string[] = []
    ;(window as any).__sharedEventPointers = copied
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value)
        },
      },
    })
    const execCommand = document.execCommand.bind(document)
    document.execCommand = (command, ...args) => {
      if (command !== "copy") return execCommand(command, ...args)
      const input = document.activeElement
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing share copy input")
      copied.push(input.value)
      return true
    }
  })
  const relay = new MockRelay({
    seedEvents: [announcement, issue, pullRequest, update, ...extraEvents],
  })
  await relay.setup(page)
  return relay
}

const expectSharedEvent = async (page: Page, event: NostrEvent, count: number) => {
  await expect(
    page.getByRole("alert").filter({hasText: "Nostr Event Link Copied"}).last(),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).__sharedEventPointers.length))
    .toBe(count)
  const pointer = await page.evaluate(() => (window as any).__sharedEventPointers.at(-1))
  expect(decode(pointer)).toEqual({
    type: "nevent",
    data: {
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
      relays: repoRelays.map(relay => `${relay}/`),
    },
  })
}

const expectShareFirst = async (button: Locator) => {
  await expect(button).toBeVisible()
  expect(
    await button.evaluate(element => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity === "0") return false
      }
      return true
    }),
  ).toBe(true)
  expect(
    await button.evaluate(element => element.parentElement?.querySelector("button") === element),
  ).toBe(true)
  expect(
    await button.evaluate(element => element.closest(".tippy-content, [data-testid='modal-root']")),
  ).toBeNull()
}

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`shares issue and PR cards and details as a guest (${viewport.name})`, async ({page}) => {
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    await page.setViewportSize(viewport)
    const relay = await setupSharing(page)

    for (const item of [
      {section: "issues", noun: "issue", event: issue},
      {section: "prs", noun: "pull request", event: pullRequest},
    ]) {
      const listPath = `${repoPath}/${item.section}`
      await page.goto(listPath)
      const card = page.locator(
        `[data-${item.section === "issues" ? "issue" : "pr"}-id="${item.event.id}"]`,
      )
      const shareButton = card.getByRole("button", {name: `Share ${item.noun}`, exact: true})
      // A fresh dev server must compile the route before the fixture can render.
      await expect(shareButton).toBeVisible({timeout: 15_000})
      await expectShareFirst(shareButton)
      expect(
        await shareButton.evaluate(element => element.parentElement?.firstElementChild === element),
      ).toBe(true)
      const shareIcon = await shareButton
        .locator('[style*="mask-image"]')
        .evaluate(element => getComputedStyle(element).maskImage)
      const shareBounds = (await shareButton.boundingBox())!
      expect(shareBounds.x).toBeGreaterThanOrEqual(0)
      expect(shareBounds.x + shareBounds.width).toBeLessThanOrEqual(viewport.width)

      await shareButton.click()
      await expectSharedEvent(page, item.event, 1)
      await expect(page).toHaveURL(listPath)

      await shareButton.focus()
      await page.keyboard.press("Enter")
      await expectSharedEvent(page, item.event, 2)
      await page.keyboard.press("Space")
      await expectSharedEvent(page, item.event, 3)
      await expect(page).toHaveURL(listPath)

      await card.getByRole("heading").click()
      await expect(page).toHaveURL(`${listPath}/${item.event.id}`)
      const actions = page.getByRole("button", {name: `Open ${item.noun} actions`, exact: true})
      await expect(actions).toBeVisible()
      const detailShare = page.getByRole("button", {name: `Share ${item.noun}`, exact: true})
      await expectShareFirst(detailShare)
      await expect(detailShare.locator('[style*="mask-image"]')).toHaveCSS("mask-image", shareIcon)
      await expect(
        page.getByRole("button", {name: `${item.noun} Details`, exact: true}),
      ).toHaveCount(0)
      await detailShare.click()
      await expectSharedEvent(page, item.event, 4)
      await expect(page).toHaveURL(`${listPath}/${item.event.id}`)
      await expect(
        page.getByRole("button", {name: "Add reaction", exact: true}).first(),
      ).toBeVisible()
      await actions.click()
      await expect(
        page.getByRole("button", {name: `${item.noun} Details`, exact: true}),
      ).toBeVisible()
      await expect(
        page.getByRole("button", {name: `Delete ${item.noun}`, exact: true}),
      ).toHaveCount(0)
      await expect(page.getByRole("button", {name: "Report Content", exact: true})).toBeVisible()
      await expect(
        page.locator(".tippy-content").getByRole("button", {name: /^Share/}),
      ).toHaveCount(0)
      await expect(detailShare).toBeVisible()
      await page.getByRole("button", {name: `${item.noun} Details`, exact: true}).click()
      const details = page.getByTestId("modal-root")
      await expect(details.getByText("Event Details", {exact: true})).toBeVisible()
      await expect(details.locator("code")).toContainText(item.event.id)
      await details.getByRole("button", {name: "Copy author public key", exact: true}).click()
      await expect(
        page.getByRole("alert").filter({hasText: "Nostr Event Link Copied"}).last(),
      ).toBeVisible()
      expect(
        decode(await page.evaluate(() => (window as any).__sharedEventPointers.at(-1))),
      ).toEqual({
        type: "npub",
        data: item.event.pubkey,
      })
      await details.getByRole("button", {name: "Got it", exact: true}).click()
      await expect(actions).toBeVisible()
    }

    expect(relay.getPublishedEvents()).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test("a non-author repo owner can share the PR root from an update deep link", async ({page}) => {
  const relay = await setupSharing(page)
  await seedDevSession(page)
  await page.goto(`${repoPath}/prs/${update.id}`)

  const share = page.getByRole("button", {name: "Share pull request", exact: true})
  await expectShareFirst(share)
  await share.click()
  await expectSharedEvent(page, pullRequest, 1)
  await page.getByRole("button", {name: "Open pull request actions", exact: true}).click()
  await expect(page.getByRole("button", {name: "Hide spam", exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Delete pull request", exact: true})).toHaveCount(0)
  await expect(page.locator(".tippy-content").getByRole("button", {name: /^Share/})).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("the PR author retains deletion alongside the full action pill", async ({page}) => {
  const ownPullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Author action permissions",
      content: "The author can still access the deletion confirmation.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP + 4,
    }),
  )
  const relay = await setupSharing(page, [ownPullRequest])
  await seedDevSession(page)
  await page.goto(`${repoPath}/prs/${ownPullRequest.id}`)

  await expect(page.getByRole("button", {name: "Add reaction", exact: true}).first()).toBeVisible()
  const share = page.getByRole("button", {name: "Share pull request", exact: true})
  await expectShareFirst(share)
  await share.click()
  await expectSharedEvent(page, ownPullRequest, 1)
  await page.getByRole("button", {name: "Open pull request actions", exact: true}).click()
  await expect(page.getByRole("button", {name: "Delete pull request", exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Hide spam", exact: true})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Report Content", exact: true})).toHaveCount(0)
  await expect(page.locator(".tippy-content").getByRole("button", {name: /^Share/})).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("Git comment shares use the same Nostr copy confirmation", async ({page}) => {
  const comment = signTestEvent({
    kind: 1111,
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 5,
    content: "Shareable comment fixture",
    tags: [
      ["E", issue.id, repoRelays[0], issue.pubkey],
      ["K", "1621"],
      ["P", issue.pubkey],
      ["e", issue.id, repoRelays[0], issue.pubkey],
      ["k", "1621"],
      ["p", issue.pubkey],
      ["a", repoAddress],
    ],
  })
  const relay = await setupSharing(page, [comment])
  await page.goto(`${repoPath}/issues/${issue.id}`)

  const share = page.getByRole("button", {name: "Share comment", exact: true})
  await expect(share).toHaveCount(1)
  await expectShareFirst(share)
  await share.click()
  await expectSharedEvent(page, comment, 1)
  expect(relay.getPublishedEvents()).toEqual([])
})

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`Git comments put Reply before Share and move secondary actions into the menu (${viewport.name})`, async ({
    page,
  }) => {
    const comments = [TEST_PUBKEYS.devUser, TEST_PUBKEYS.charlie].map((pubkey, index) =>
      signTestEvent({
        kind: 1111,
        pubkey,
        // Editing eligibility is time-limited; this comment must be recent.
        created_at: Math.floor(Date.now() / 1000) - index,
        content: `Compact comment actions ${index}`,
        tags: [
          ["E", issue.id, repoRelays[0], issue.pubkey],
          ["K", "1621"],
          ["P", issue.pubkey],
          ["e", issue.id, repoRelays[0], issue.pubkey],
          ["k", "1621"],
          ["p", issue.pubkey],
          ["a", repoAddress],
        ],
      }),
    )
    const errors: Error[] = []
    page.on("pageerror", error => errors.push(error))
    const relay = await setupSharing(page, comments)
    await seedDevSession(page)
    await page.setViewportSize(viewport)
    await page.goto(`${repoPath}/issues/${issue.id}`)
    const modal = page.getByTestId("modal-root")
    const composer = page.getByRole("group", {name: "Comment composer", exact: true})
    const editor = composer.locator('[contenteditable="true"]')
    let copies = 0

    for (const comment of comments) {
      const own = comment.pubkey === TEST_PUBKEYS.devUser
      const card = page.locator(`#comment-${comment.id}`)
      const share = card.getByRole("button", {name: "Share comment", exact: true})
      await expect(share).toBeVisible({timeout: 15_000})
      const actions = share.locator("..")
      await expect(actions.getByRole("button")).toHaveCount(3)
      expect(
        await actions
          .getByRole("button")
          .evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label"))),
      ).toEqual(["Reply to comment", "Share comment", "Open comment actions"])
      await share.click()
      await share.focus()
      await page.keyboard.press("Enter")
      await page.keyboard.press("Space")
      copies += 3
      await expectSharedEvent(page, comment, copies)
      await expect(page).toHaveURL(`${repoPath}/issues/${issue.id}`)
      await expect(modal).toBeEmpty()

      await card.getByRole("button", {name: "Reply to comment", exact: true}).click()
      await expect(
        page.getByRole("button", {name: `Replying to ${comment.content}`, exact: true}),
      ).toBeVisible()
      await expect(editor).toBeInViewport({ratio: 1})
      await expect(editor).toBeFocused()
      await page.getByRole("button", {name: "Cancel", exact: true}).first().click()

      const open = card.getByRole("button", {name: "Open comment actions", exact: true})
      const menu = page.locator(".tippy-content:visible ul.menu")
      await open.click()
      await expect(menu.getByRole("button")).toHaveText([
        "Send Reply",
        "Send Zap",
        "Send Reaction",
        "Message Info",
        ...(own ? ["Edit comment", "Delete comment"] : ["Hide spam"]),
      ])
      await menu.getByRole("button", {name: "Send Reply", exact: true}).click()
      await expect(menu).not.toBeVisible()
      await expect(
        page.getByRole("button", {name: `Replying to ${comment.content}`, exact: true}),
      ).toBeVisible()
      await expect(editor).toBeInViewport({ratio: 1})
      await expect(editor).toBeFocused()
      await page.getByRole("button", {name: "Cancel", exact: true}).first().click()
      await open.click()
      await menu.getByRole("button", {name: "Send Reaction", exact: true}).click()
      await expect(modal.locator("emoji-picker")).toBeVisible()
      await modal
        .getByRole("button", {name: "Close dialog", exact: true})
        .click({position: {x: 1, y: 1}})
      await expect(modal).toBeEmpty()
      await open.click()
      await menu.getByRole("button", {name: "Message Info", exact: true}).click()
      await expect(modal.getByText("Event Details", {exact: true})).toBeVisible()
      await expect(modal.locator("code")).toContainText(comment.id)
      await modal.getByRole("button", {name: "Got it", exact: true}).click()

      if (own) {
        await open.click()
        await menu.getByRole("button", {name: "Edit comment", exact: true}).click()
        await expect(page.getByText("Editing comment", {exact: true})).toBeVisible()
        await page.getByRole("button", {name: "Cancel", exact: true}).first().click()
        await open.click()
        await menu.getByRole("button", {name: "Send Zap", exact: true}).click()
        // This synthetic identity has no receiver. Verify the existing entry point, never pay.
        await expect(modal.getByText("Unable to Zap", {exact: true})).toBeVisible()
        await modal.getByRole("button", {name: "Go back", exact: true}).click()
      }
    }
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })

  test(`matches comment button styling and keeps quoted-comment sharing in the top-right (${viewport.name})`, async ({
    page,
  }) => {
    const comment = signTestEvent({
      kind: 1111,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 7,
      content: "New deploy seems to have fixed this on my end",
      tags: [
        ["E", issue.id, repoRelays[0], issue.pubkey],
        ["K", "1621"],
        ["P", issue.pubkey],
        ["e", issue.id, repoRelays[0], issue.pubkey],
        ["k", "1621"],
        ["p", issue.pubkey],
        ["a", repoAddress],
      ],
    })
    const errors: Error[] = []
    page.on("pageerror", error => errors.push(error))
    const relay = await setupSharing(page, [comment])
    await page.setViewportSize(viewport)
    await page.goto(`${repoPath}/issues`)
    await expect(page.getByRole("button", {name: "Share issue", exact: true})).toBeVisible({
      timeout: 15_000,
    })
    await page.evaluate(
      async props => {
        const fixturePath = "/tests/e2e/fixtures/comment-share-layout-browser.ts"
        const {mountCommentShareLayoutFixture} = await import(/* @vite-ignore */ fixturePath)
        ;(window as any).__unmountCommentShareLayoutFixture = mountCommentShareLayoutFixture(props)
      },
      {comment, issue, repoAddress, relays: repoRelays},
    )
    const fixture = page.getByTestId("comment-share-layout")
    const card = fixture.locator(`#comment-${comment.id}`)
    const share = card.getByRole("button", {name: "Share comment", exact: true})
    const reply = card.getByRole("button", {name: "Reply to comment", exact: true})
    const menu = card.getByRole("button", {name: "Open comment actions", exact: true})
    const quote = fixture.getByTestId("quoted-comment").locator('[role="link"]')
    const quoteShare = quote.getByRole("button", {name: "Share", exact: true})
    let copies = 0
    const settledBackground = (button: Locator) =>
      button.evaluate(async element => {
        getComputedStyle(element).backgroundColor
        await Promise.all(element.getAnimations().map(animation => animation.finished))
        return getComputedStyle(element).backgroundColor
      })

    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.body.setAttribute("data-theme", theme), theme)
      await share.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      const background = await settledBackground(reply)
      expect(background).not.toBe("rgba(0, 0, 0, 0)")
      await expect(share).toHaveCSS("background-color", background)
      await expect(menu).toHaveCSS("background-color", background)
      const replyBounds = (await reply.boundingBox())!
      const shareBounds = (await share.boundingBox())!
      const menuBounds = (await menu.boundingBox())!
      expect(shareBounds.height).toBe(replyBounds.height)
      expect(shareBounds.y).toBe(replyBounds.y)
      expect(shareBounds.width).toBe(replyBounds.width)
      expect(Math.abs(shareBounds.x - replyBounds.x - replyBounds.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(menuBounds.x - shareBounds.x - shareBounds.width)).toBeLessThanOrEqual(1)
      await reply.hover()
      const hoverBackground = await settledBackground(reply)
      await share.hover()
      await expect(share).toHaveCSS("background-color", hoverBackground)

      await quoteShare.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      // A quote is a preview: Share and Open belong here, not another event action menu.
      await expect(quote.getByRole("button")).toHaveCount(1)
      await expect(quoteShare).toBeVisible()
      const quoteBounds = (await quote.boundingBox())!
      const quoteShareBounds = (await quoteShare.boundingBox())!
      const openBounds = (await quote.getByRole("link", {name: "Open", exact: true}).boundingBox())!
      expect(quoteShareBounds.y - quoteBounds.y).toBeGreaterThanOrEqual(8)
      expect(quoteShareBounds.y - quoteBounds.y).toBeLessThanOrEqual(16)
      expect(
        quoteBounds.x + quoteBounds.width - quoteShareBounds.x - quoteShareBounds.width,
      ).toBeGreaterThanOrEqual(8)
      expect(
        quoteBounds.x + quoteBounds.width - quoteShareBounds.x - quoteShareBounds.width,
      ).toBeLessThanOrEqual(16)
      expect(openBounds.y).toBeGreaterThanOrEqual(quoteShareBounds.y + quoteShareBounds.height)
      expect(quoteBounds.x + quoteBounds.width).toBeLessThanOrEqual(viewport.width)
      await expect(quote.getByText("Comment on Issue", {exact: true})).toBeVisible()
      for (const button of [share, quoteShare]) {
        await button.click()
        await button.focus()
        await page.keyboard.press("Enter")
        await page.keyboard.press("Space")
        copies += 3
        await expectSharedEvent(page, comment, copies)
        await expect(page).toHaveURL(`${repoPath}/issues`)
        await expect(page.getByTestId("modal-root")).toBeEmpty()
      }
    }
    // Keep the comment's existing copy-error handling, without falling back to another copy.
    await page.evaluate(() => {
      ;(window as any).__commentCopyFailures = 0
      navigator.clipboard.writeText = async () => {
        ;(window as any).__commentCopyFailures++
        throw new Error("Clipboard intentionally unavailable in fixture")
      }
    })
    await share.click()
    await expect(
      page.getByRole("alert").filter({hasText: "Failed to copy to clipboard"}).last(),
    ).toBeVisible()
    expect(await page.evaluate(() => (window as any).__commentCopyFailures)).toBe(1)
    expect(await page.evaluate(() => (window as any).__sharedEventPointers.length)).toBe(copies)
    await expect(page).toHaveURL(`${repoPath}/issues`)
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    await page.evaluate(() => (window as any).__unmountCommentShareLayoutFixture())
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })

  test(`keeps sharing first and visible across action groups (${viewport.name})`, async ({
    page,
  }) => {
    const permalink = signTestEvent({
      kind: 1623,
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 6,
      content: "const shared = true",
      tags: [
        ["a", repoAddress],
        ["commit", TEST_COMMITS.second],
        ["file", "example.ts"],
      ],
    })
    const errors: Error[] = []
    page.on("pageerror", error => errors.push(error))
    const relay = await setupSharing(page, [permalink])
    await page.setViewportSize(viewport)
    await page.goto(`${repoPath}/issues`)
    await expect(page.getByRole("button", {name: "Share issue", exact: true})).toBeVisible({
      timeout: 15_000,
    })
    await page.evaluate(
      async props => {
        const fixturePath = "/tests/e2e/fixtures/share-actions-browser.ts"
        const {mountShareActionsFixture} = await import(/* @vite-ignore */ fixturePath)
        ;(window as any).__unmountShareActionsFixture = mountShareActionsFixture(props)
      },
      {event: issue, announcement, permalink, relays: repoRelays},
    )

    const fixture = page.getByTestId("share-action-fixture")
    let copies = 0
    for (const group of [
      "read-only",
      "menu-only",
      "no-menu",
      "repo",
      "activity",
      "quote",
      "permalink",
      "feed",
      "feed-no-actions",
      "community",
      "thread",
      "goal",
      "calendar",
      "comment",
    ]) {
      const section = fixture.getByTestId(group)
      const share = section.getByRole("button", {name: /^Share/})
      await expect(share).toHaveCount(1)
      await expectShareFirst(share)
      await share.scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      await expect(share).toBeVisible()
      const bounds = (await share.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
      await share.click()
      await share.focus()
      await page.keyboard.press("Enter")
      await page.keyboard.press("Space")
      copies += 3
      await expect
        .poll(() => page.evaluate(() => (window as any).__sharedEventPointers.length))
        .toBe(copies)
      const pointer = await page.evaluate(() => (window as any).__sharedEventPointers.at(-1))
      const decoded = decode(pointer)
      if (group === "repo" || group === "community") {
        expect(decoded.type).toBe("naddr")
      } else {
        expect(decoded).toMatchObject({
          type: "nevent",
          data: {id: group === "permalink" ? permalink.id : issue.id},
        })
      }
      await expect(page).toHaveURL(`${repoPath}/issues`)
      await expect(page.getByTestId("modal-root")).toBeEmpty()
    }
    await expect(
      fixture.getByTestId("read-only").getByRole("button", {name: "Add reaction"}),
    ).toHaveCount(0)
    await expect(
      fixture.getByTestId("menu-only").getByRole("button", {name: "Add reaction"}),
    ).toHaveCount(0)
    await expect(
      fixture.getByTestId("no-menu").getByRole("button", {name: "Open issue actions"}),
    ).toHaveCount(0)
    await page.evaluate(() => (window as any).__unmountShareActionsFixture())
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })
}
