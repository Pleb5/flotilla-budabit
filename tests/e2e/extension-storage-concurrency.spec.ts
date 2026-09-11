import {expect, test, type Page} from "@playwright/test"
import type {} from "./fixtures/extension-storage-browser"

async function openFixture(page: Page) {
  await page.route("**/__extension_storage_test__", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Isolated extension storage</title><script type="module" src="/tests/e2e/fixtures/extension-storage-browser.ts"></script>',
    }),
  )
  await page.goto("/__extension_storage_test__")
  await expect(page.getByText("Isolated extension storage ready", {exact: true})).toBeVisible()
}

test("uses real Web Locks across two tabs for conditional claim, progress and stale cleanup", async ({
  page,
  context,
}) => {
  const other = await context.newPage()
  await Promise.all([openFixture(page), openFixture(other)])
  for (const client of [page, other]) {
    expect(
      await client.evaluate(() =>
        window.extensionStorageHarness.run({action: "get", withRevision: true}),
      ),
    ).toEqual({status: "ok", data: null, revision: null, atomic: true})
  }
  const results = await Promise.all(
    [page, other].map((client, index) =>
      client.evaluate(
        batch =>
          window.extensionStorageHarness.run({
            action: "compareAndSet",
            expectedRevision: null,
            data: {batch},
          }),
        `batch-${index}`,
      ),
    ),
  )
  expect(results.map(r => r.status).sort()).toEqual(["conflict", "ok"])
  const initial = results.find(r => r.status === "ok")!
  const progress = await page.evaluate(
    expectedRevision =>
      window.extensionStorageHarness.run({
        action: "compareAndSet",
        expectedRevision,
        data: {batch: "winner", accepted: ["asset"]},
      }),
    initial.revision,
  )
  expect(progress.status).toBe("ok")
  expect(
    await other.evaluate(
      expectedRevision =>
        window.extensionStorageHarness.run({action: "compareAndSet", expectedRevision, data: null}),
      initial.revision,
    ),
  ).toEqual({status: "conflict"})
  expect(
    await page.evaluate(
      expectedRevision =>
        window.extensionStorageHarness.run({action: "compareAndSet", expectedRevision, data: null}),
      progress.revision,
    ),
  ).toEqual({status: "ok", revision: null})
  await other.evaluate(() =>
    window.extensionStorageHarness.run({
      action: "compareAndSet",
      expectedRevision: null,
      data: {batch: "next", accepted: ["asset"]},
    }),
  )
  for (const data of [null, {batch: "stale-progress"}]) {
    expect(
      await page.evaluate(
        ({expectedRevision, data}) =>
          window.extensionStorageHarness.run({action: "compareAndSet", expectedRevision, data}),
        {expectedRevision: progress.revision, data},
      ),
    ).toEqual({status: "conflict"})
  }
  expect(
    await page.evaluate(() =>
      window.extensionStorageHarness.run({action: "get", withRevision: true}),
    ),
  ).toMatchObject({data: {batch: "next", accepted: ["asset"]}})
})

test("normal writes, removal and legacy read migration wait for the same cross-tab lock", async ({
  page,
  context,
}) => {
  const other = await context.newPage()
  await Promise.all([openFixture(page), openFixture(other)])
  for (const action of ["get", "set", "remove"] as const) {
    await page.evaluate(legacy => window.extensionStorageHarness.seed(legacy), action === "get")
    const before = await page.evaluate(() => window.extensionStorageHarness.inspect())
    await page.evaluate(() => window.extensionStorageHarness.hold())
    const pending = other.evaluate(
      action => window.extensionStorageHarness.run({action, data: {batch: "updated"}}),
      action,
    )
    await expect
      .poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.length))
      .toBe(1)
    expect(await page.evaluate(() => window.extensionStorageHarness.inspect())).toEqual(before)
    await page.evaluate(() => window.extensionStorageHarness.release())
    expect(await pending).toMatchObject({status: "ok"})
    const after = await page.evaluate(() => window.extensionStorageHarness.inspect())
    expect(after).toEqual(
      action === "remove"
        ? [null, null]
        : [JSON.stringify({batch: action === "get" ? "seed" : "updated"}), null],
    )
  }
})
