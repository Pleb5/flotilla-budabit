import {expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: {width: viewport.width, height: viewport.height},
      hasTouch: viewport.name === "mobile",
      isMobile: viewport.name === "mobile",
    })
    for (const {threadType, editorType} of [
      {threadType: "issue", editorType: "rich"},
      {threadType: "pr", editorType: "rich"},
      {threadType: "commit", editorType: "rich"},
      {threadType: "issue", editorType: "plain"},
    ] as const) {
      test(`reveals and focuses the ${threadType} reply composer (${editorType}, ${viewport.name})`, async ({
        page,
      }) => {
        const errors: Error[] = []
        page.on("pageerror", error => errors.push(error))
        await page.setViewportSize(viewport)
        // Cover normal smooth scrolling and reduced-motion scrolling without timers.
        await page.emulateMedia({
          reducedMotion: viewport.name === "mobile" ? "reduce" : "no-preference",
        })
        const relay = new MockRelay()
        await relay.setup(page)
        await page.goto("/git")
        await expect(
          page.getByRole("button", {name: "Community Curated", exact: true}),
        ).toBeVisible()
        await page.evaluate(
          props => {
            const fixturePath = "/tests/e2e/fixtures/reply-composer-browser.ts"
            // Keep the import promise reachable while Vite loads the fixture's component graph.
            const mounted = import(/* @vite-ignore */ fixturePath).then(
              ({mountReplyComposerFixture}) => {
                ;(window as any).__unmountReplyComposerFixture = mountReplyComposerFixture(props)
              },
            )
            ;(window as any).__replyComposerMount = mounted
            return mounted
          },
          {threadType, editorType},
        )

        const fixture = page.getByTestId("reply-composer-fixture")
        const editor = fixture.locator(
          editorType === "rich" ? '[contenteditable="true"]' : "textarea",
        )
        await expect(editor).toHaveCount(1)
        // The thread expands with a slide intro. Its final scroll range must exist before
        // testing a user action in an already-open discussion (especially reduced motion).
        await fixture.evaluate(async element => {
          await Promise.all(
            element
              .getAnimations({subtree: true})
              .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
              .map(animation => animation.finished),
          )
        })
        await expect(editor).not.toBeInViewport()
        await expect(editor).not.toBeFocused()

        for (const {commentNumber, activation} of [
          {commentNumber: 1, activation: "inline"},
          {commentNumber: 2, activation: "menu"},
          // Selecting the same nested target again must focus it even without a keyed remount.
          {commentNumber: 2, activation: "keyboard"},
        ]) {
          await test.step(`${activation} reply to comment ${commentNumber}`, async () => {
            const commentId = commentNumber.toString(16).padStart(64, "0")
            const card = fixture.locator(`#comment-${commentId}`)
            await card.scrollIntoViewIfNeeded()
            await expect(editor).not.toBeInViewport()
            const before = page.url()
            if (activation === "menu") {
              await card.getByRole("button", {name: "Open comment actions", exact: true}).click()
              await page
                .locator(".tippy-content:visible")
                .getByRole("button", {name: "Send Reply", exact: true})
                .click()
              await expect(page.locator(".tippy-content:visible")).toHaveCount(0)
            } else {
              const reply = card.getByRole("button", {name: "Reply to comment", exact: true})
              if (activation === "keyboard") {
                await reply.focus()
                await page.keyboard.press("Space")
              } else {
                await reply.click()
              }
            }

            const preview = fixture
              .getByRole("group", {name: "Comment composer", exact: true})
              .getByRole("button", {
                name: `Replying to Repository comment ${commentNumber}.`,
                exact: true,
              })
              .last()
            await expect(preview).toBeInViewport({ratio: 1})
            await expect(editor).toBeInViewport({ratio: 1})
            await expect(editor).toBeFocused()
            await page.keyboard.type("Reply draft")
            if (editorType === "rich") {
              await expect(editor).toContainText("Reply draft")
            } else {
              await expect(editor).toHaveValue("Reply draft")
            }
            await expect(page).toHaveURL(before)
            await expect(page.getByTestId("modal-root")).toBeEmpty()
          })
        }

        // Edit uses the same explicitly activated composer; don't regress its previous autofocus.
        const firstComment = fixture.locator(`#comment-${"1".padStart(64, "0")}`)
        await firstComment.scrollIntoViewIfNeeded()
        await expect(editor).not.toBeInViewport()
        await firstComment.getByRole("button", {name: "Open comment actions", exact: true}).click()
        await page
          .locator(".tippy-content:visible")
          .getByRole("button", {name: "Edit comment", exact: true})
          .click()
        await expect(fixture.getByText("Editing comment", {exact: true})).toBeInViewport({ratio: 1})
        await expect(editor).toBeInViewport({ratio: 1})
        await expect(editor).toBeFocused()
        if (editorType === "rich") {
          await expect(editor).toHaveText("Repository comment 1.")
        } else {
          await expect(editor).toHaveValue("Repository comment 1.")
        }

        await expect(fixture.getByTestId("submissions")).toHaveText("0")
        await page.evaluate(() => (window as any).__unmountReplyComposerFixture())
        expect(relay.getPublishedEvents()).toEqual([])
        expect(errors).toEqual([])
      })
    }
  })
}
