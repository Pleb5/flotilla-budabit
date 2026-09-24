import { expect, test, type FrameLocator } from '@playwright/test';
import { readFileSync } from 'node:fs';

const productionBundle = readFileSync('packages/iframe-app/dist/index.html', 'utf8');

async function holdNextFileRead(widget: FrameLocator) {
  await widget.locator('body').evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      Blob.prototype.arrayBuffer = read;
      const bytes = await read.call(this);
      await new Promise<void>((resolve) =>
        Object.assign(window, { releasePendingFileRead: resolve })
      );
      return bytes;
    };
  });
}

async function finishFileRead(widget: FrameLocator) {
  await widget.locator('body').evaluate(async () => {
    (window as unknown as { releasePendingFileRead: () => void }).releasePendingFileRead();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

test.beforeEach(async ({ page, context }) => {
  // Test the self-contained production artifact, not Vite's development transform.
  await context.route('http://localhost:5179/', (route) =>
    route.fulfill({ contentType: 'text/html', body: productionBundle })
  );
  await context.route('https://**/*', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'test' })
  );
  await page.goto('/test-host/');
  await expect(
    page.frameLocator('iframe').getByRole('button', { name: 'New Release', exact: true })
  ).toBeEnabled();
});

test('ships a self-contained production artifact without the dev signing fixture', async ({
  page,
}) => {
  expect(productionBundle).not.toContain('releaseHarness');
  expect(productionBundle).not.toContain('fixture-publish-attempts');
  await expect(
    page.frameLocator('iframe').locator('script[src], link[rel=stylesheet][href]')
  ).toHaveCount(0);
});

test('ignores a delayed fallback response after a newer logout update', async ({ page }) => {
  await page.goto('/test-host/?holdFallback=1');
  const widget = page.frameLocator('iframe');
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { releaseHarness: { fallbackPending: boolean } }).releaseHarness
            .fallbackPending
      )
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { releaseHarness: { resolveFallback: () => void } }
    ).releaseHarness.resolveFallback()
  );
  // A subsequent round-trip proves the stale response has passed through the widget.
  await widget.locator('.release-card').click();
  await expect(
    widget.getByRole('heading', { name: 'Assets (1 resolved / 1 referenced)' })
  ).toBeVisible();
  await widget.getByRole('button', { name: '← Releases', exact: true }).click();
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toHaveCount(0);
});

test('shows only authorized releases, reconciles replacements and account/context changes', async ({
  page,
}) => {
  const widget = page.frameLocator('iframe');
  await expect(widget.locator('.release-card')).toHaveCount(1);
  await expect(widget.getByText('ATTACKER RELEASE')).toHaveCount(0);
  await page.getByRole('button', { name: 'Replace release', exact: true }).click();
  await expect(widget.locator('.release-card')).toHaveCount(1);
  await expect(widget.locator('.release-card')).toContainText('Replacement notes');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear repository', exact: true }).click();
  await expect(widget.getByText('Waiting for repository context…')).toBeVisible();
  await expect(page.locator('#metrics')).toContainText('Active subscriptions: 0');
});

test('sanitizes notes and allows a user-activated popup without navigating the widget', async ({
  page,
  context,
}) => {
  const widget = page.frameLocator('iframe');
  const unsolicited: string[] = [];
  const observe = (request: { url(): string }) => {
    if (request.url().startsWith('https://')) unsolicited.push(request.url());
  };
  context.on('request', observe);
  await widget.locator('.release-card').click();
  await expect(
    widget.getByRole('heading', { name: 'Assets (1 resolved / 1 referenced)' })
  ).toBeVisible();
  // Wait through layout/render and a message task so resource selection has run.
  await widget
    .locator('.release-notes')
    .evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    );
  expect(unsolicited).toEqual([]);
  await expect(
    widget.locator(
      '.release-notes img, .release-notes script, .release-notes video, .release-notes audio, .release-notes iframe, .release-notes object, .release-notes link, .release-notes svg'
    )
  ).toHaveCount(0);
  context.off('request', observe);
  const guidePopup = page.waitForEvent('popup');
  await widget.getByRole('link', { name: 'Release guide', exact: true }).click();
  const guide = await guidePopup;
  await expect(guide).toHaveURL('https://files.example.invalid/guide');
  await guide.close();
  const popup = page.waitForEvent('popup');
  await widget.getByRole('link', { name: 'Download', exact: true }).click();
  const opened = await popup;
  await expect(opened).toHaveURL('https://files.example.invalid/fixture.bin');
  await expect(
    widget.getByRole('heading', { name: 'Assets (1 resolved / 1 referenced)' })
  ).toBeVisible();
  await opened.close();
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect(widget.getByRole('status')).toHaveText('SHA-256 matches signed metadata');
});

test('selects one verified run, pins signatures and resumes identical publication IDs', async ({
  page,
}) => {
  const widget = page.frameLocator('iframe');
  await page.getByRole('button', { name: 'Fail next publication', exact: true }).click();
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await widget
    .getByRole('combobox', { name: 'Application', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Version', { exact: true }).fill('2');
  await widget
    .getByRole('combobox', { name: 'Authenticated pipeline run', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('evil'),
  });
  await expect(widget.getByRole('status')).toContainText('mismatch');
  await expect(widget.getByRole('checkbox', { name: 'Include fixture.bin' })).toBeDisabled();
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect(widget.getByRole('status')).toHaveText('SHA-256 matches');
  await widget.getByRole('checkbox', { name: 'Include fixture.bin' }).check();
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('evil'),
  });
  await expect(widget.getByRole('checkbox', { name: 'Include fixture.bin' })).not.toBeChecked();
  await expect(widget.getByRole('button', { name: 'Publish Release', exact: true })).toBeDisabled();
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect(widget.getByRole('status')).toHaveText('SHA-256 matches');
  await widget.getByRole('checkbox', { name: 'Include fixture.bin' }).check();
  await widget.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('Synthetic relay timeout');
  await expect(widget.getByRole('button', { name: 'Resume publication' })).toBeEnabled();
  await page.reload();
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await widget.getByRole('button', { name: 'Resume publication' }).click();
  await expect(widget.locator('.release-card')).toHaveCount(2);
  await expect(page.locator('#metrics')).toContainText('signatures: 0');
  expect(
    await page.evaluate(() => {
      const ids = (window as unknown as { releaseHarness: { published: string[] } }).releaseHarness
        .published;
      return ids.length === 3 && ids[0] === ids[1];
    })
  ).toBe(true);
});

test('marks incomplete discovery and recovers without leaking subscriptions', async ({ page }) => {
  const widget = page.frameLocator('iframe');
  await page.getByRole('button', { name: 'Toggle partial query', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.getByRole('button', { name: 'Test maintainer', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('incomplete');
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Toggle partial query', exact: true }).click();
  await widget.getByRole('button', { name: 'Retry discovery' }).click();
  await expect(widget.getByRole('button', { name: 'New Release', exact: true })).toBeEnabled();
  await expect(page.locator('#metrics')).toContainText('Active subscriptions: 1');
});

test('recovers a corrupt journal only after confirmed discard, preserving it on cancel or storage failure', async ({
  page,
}) => {
  const widget = page.frameLocator('iframe');
  await page.evaluate(() =>
    (
      window as unknown as { releaseHarness: { corruptJournal(): void } }
    ).releaseHarness.corruptJournal()
  );
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await expect(
    widget.getByRole('heading', { name: 'Saved publication could not be validated' })
  ).toBeVisible();
  await widget.getByRole('button', { name: 'Retry recovery', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('invalid');
  await widget.getByRole('button', { name: 'Discard local recovery data', exact: true }).click();
  await expect(
    widget.getByText('Discarding local recovery data does not undo', { exact: false })
  ).toBeVisible();
  await widget.getByRole('button', { name: 'Keep recovery data', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { releaseHarness: { hasJournal: boolean } }).releaseHarness.hasJournal
    )
  ).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { releaseHarness: { failDiscard(): void } }).releaseHarness.failDiscard()
  );
  await widget.getByRole('button', { name: 'Discard local recovery data', exact: true }).click();
  await widget.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(widget.getByRole('alert')).toHaveText('Synthetic storage failure');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { releaseHarness: { hasJournal: boolean } }).releaseHarness.hasJournal
    )
  ).toBe(true);
  await widget.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(
    widget
      .getByRole('combobox', { name: 'Authenticated pipeline run', exact: true })
      .locator('option')
  ).toHaveCount(2);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { releaseHarness: { hasJournal: boolean } }).releaseHarness.hasJournal
    )
  ).toBe(false);
  await expect(page.locator('#metrics')).toContainText('publish attempts: 0');
});

test('stops same-session resume after app revocation and exposes recovery when reopened', async ({
  page,
}) => {
  const widget = page.frameLocator('iframe');
  await page.getByRole('button', { name: 'Fail next publication', exact: true }).click();
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await widget
    .getByRole('combobox', { name: 'Application', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Version', { exact: true }).fill('2');
  await widget
    .getByRole('combobox', { name: 'Authenticated pipeline run', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await widget.getByRole('checkbox', { name: 'Include fixture.bin' }).check();
  await widget.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('Synthetic relay timeout');
  await page.getByRole('button', { name: 'Revoke application', exact: true }).click();
  await widget.getByRole('button', { name: 'Resume publication', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('application links');
  await expect(page.locator('#metrics')).toContainText('publish attempts: 1');
  await widget.getByRole('button', { name: '← Releases', exact: true }).click();
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await expect(
    widget.getByRole('heading', { name: 'Saved publication could not be validated' })
  ).toBeVisible();
  await widget.getByRole('button', { name: 'Discard local recovery data', exact: true }).click();
  await widget.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(
    widget
      .getByRole('combobox', { name: 'Authenticated pipeline run', exact: true })
      .locator('option')
  ).toHaveCount(2);
  await expect(page.locator('#metrics')).toContainText('publish attempts: 1');
});

async function fillReleaseDraft(widget: FrameLocator, version: string) {
  await widget.getByRole('button', { name: 'New Release', exact: true }).click();
  await widget
    .getByRole('combobox', { name: 'Application', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Version', { exact: true }).fill(version);
  await widget
    .getByRole('combobox', { name: 'Authenticated pipeline run', exact: true })
    .selectOption({ index: 1 });
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect(widget.getByRole('status')).toHaveText('SHA-256 matches');
  await widget.getByRole('checkbox', { name: 'Include fixture.bin' }).check();
}

test('refreshes a losing creator to the other tab’s saved batch without publishing it', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await other.goto('/test-host/');
  const a = page.frameLocator('iframe'),
    b = other.frameLocator('iframe');
  // Both sessions have observed an empty recovery slot and entered creation.
  await fillReleaseDraft(a, '2');
  await fillReleaseDraft(b, '3');
  await page.getByRole('button', { name: 'Fail next publication', exact: true }).click();
  await a.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(a.getByRole('alert')).toContainText('Synthetic relay timeout');
  const saved = await page.evaluate(
    () => (window as unknown as { releaseHarness: { journal: unknown } }).releaseHarness.journal
  );
  await b.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(b.getByRole('alert')).toContainText('Recovery changed in another session');
  await expect(b.getByRole('region', { name: 'Publication recovery' })).toContainText('app@2');
  await expect(b.getByRole('button', { name: 'Resume publication', exact: true })).toBeEnabled();
  await expect(other.locator('#metrics')).toContainText('signatures: 0; publish attempts: 0');
  expect(
    await other.evaluate(
      () => (window as unknown as { releaseHarness: { journal: unknown } }).releaseHarness.journal
    )
  ).toEqual(saved);
});

test('rejects a stale discard confirmation and refreshes to the later batch for new consent', async ({
  page,
  context,
}) => {
  const a = page.frameLocator('iframe');
  await fillReleaseDraft(a, '2');
  await page.getByRole('button', { name: 'Fail next publication', exact: true }).click();
  await a.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(a.getByRole('alert')).toContainText('Synthetic relay timeout');
  await a.getByRole('button', { name: 'Discard local recovery data', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Confirm discard', exact: true })).toBeVisible();

  const other = await context.newPage();
  await other.goto('/test-host/');
  const b = other.frameLocator('iframe');
  await b.getByRole('button', { name: 'New Release', exact: true }).click();
  await b.getByRole('button', { name: 'Resume publication', exact: true }).click();
  await expect(b.locator('.release-card')).toHaveCount(2);
  await fillReleaseDraft(b, '3');
  await other.getByRole('button', { name: 'Fail next publication', exact: true }).click();
  await b.getByRole('button', { name: 'Publish Release', exact: true }).click();
  await expect(b.getByRole('alert')).toContainText('Synthetic relay timeout');
  const saved = await other.evaluate(
    () => (window as unknown as { releaseHarness: { journal: unknown } }).releaseHarness.journal
  );

  await a.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(a.getByRole('alert')).toContainText('Recovery changed in another session');
  await expect(a.getByRole('region', { name: 'Publication recovery' })).toContainText('app@3');
  await expect(a.getByRole('button', { name: 'Confirm discard', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { releaseHarness: { journal: unknown } }).releaseHarness.journal
    )
  ).toEqual(saved);
  await expect(page.locator('#metrics')).toContainText('publish attempts: 1');
  await a.getByRole('button', { name: 'Discard local recovery data', exact: true }).click();
  await a.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Publish Release', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { releaseHarness: { hasJournal: boolean } }).releaseHarness.hasJournal
    )
  ).toBe(false);
});

test('keeps detail authority live through replacement and revocation, including delayed assets', async ({
  page,
}) => {
  const widget = page.frameLocator('iframe');
  await widget.locator('.release-card').click();
  await expect(widget.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  await expect(page.locator('#metrics')).toContainText('Active subscriptions: 1');
  await page.getByRole('button', { name: 'Replace release', exact: true }).click();
  await expect(widget.getByRole('heading', { name: 'Replacement notes' })).toBeVisible();
  await expect(widget.getByText('This release was replaced.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke application', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('no longer authorized');
  await expect(widget.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
  await expect(widget.getByText('Verified metadata publisher:', { exact: false })).toHaveCount(0);

  await page.reload();
  await page.evaluate(() =>
    (window as unknown as { releaseHarness: { holdAssets(): void } }).releaseHarness.holdAssets()
  );
  await widget.locator('.release-card').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { releaseHarness: { pendingAssets: number } }).releaseHarness
            .pendingAssets
      )
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Revoke application', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('no longer authorized');
  await page.evaluate(() =>
    (
      window as unknown as { releaseHarness: { resolveAssets(): void } }
    ).releaseHarness.resolveAssets()
  );
  await expect(widget.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
  await expect(widget.getByRole('alert')).toContainText('no longer authorized');
});

test('keeps filenames readable and confines mobile overflow to the asset table', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const widget = page.frameLocator('iframe');
  await widget.locator('.release-card').click();
  await expect(widget.locator('.col-filename')).toContainText('fixture.bin');
  const size = await widget.locator('.col-filename').boundingBox();
  expect(size?.width).toBeGreaterThan(140);
  expect(await widget.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  );
  expect(
    await widget
      .getByRole('region', { name: /Release assets/ })
      .evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true);
});

for (const kind of ['release', 'application'] as const) {
  test(`preserves an in-progress file check across an unrelated ${kind} update`, async ({
    page,
  }) => {
    const widget = page.frameLocator('iframe');
    await widget.locator('.release-card').click();
    const input = widget.getByLabel('Verify local file');
    await expect(input).toBeVisible();
    const originalInput = (await input.elementHandle())!;
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { releaseHarness: { cacheWrites: number } }).releaseHarness
              .cacheWrites
        )
      )
      .toBeGreaterThan(0);
    const before = await page.evaluate(() => {
      const h = (
        window as unknown as { releaseHarness: { assetQueries: number; cacheWrites: number } }
      ).releaseHarness;
      return { assetQueries: h.assetQueries, cacheWrites: h.cacheWrites };
    });
    expect(before.assetQueries).toBeGreaterThan(0);
    await holdNextFileRead(widget);
    await input.setInputFiles({
      name: 'fixture.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('test'),
    });
    await expect
      .poll(() => widget.locator('body').evaluate(() => 'releasePendingFileRead' in window))
      .toBe(true);
    await expect(widget.getByRole('status')).toHaveText('Checking…');
    await page.evaluate(
      (kind) =>
        (
          window as unknown as {
            releaseHarness: { addUnrelated(kind: 'release' | 'application'): void };
          }
        ).releaseHarness.addUnrelated(kind),
      kind
    );
    // The controller's debounced cache write acknowledges processing the live event;
    // don't assert absence of a reload before the coalesced emission has happened.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { releaseHarness: { cacheWrites: number } }).releaseHarness
              .cacheWrites
        )
      )
      .toBeGreaterThan(before.cacheWrites);
    expect
      .soft(
        await page.evaluate(
          () =>
            (window as unknown as { releaseHarness: { assetQueries: number } }).releaseHarness
              .assetQueries
        )
      )
      .toBe(before.assetQueries);
    expect.soft(await originalInput.evaluate((el) => el.isConnected)).toBe(true);
    await expect.soft(input).toHaveValue(/fixture\.bin$/);
    await finishFileRead(widget);
    await expect(widget.getByRole('status')).toHaveText('SHA-256 matches signed metadata');
    await expect(
      widget.getByRole('heading', { name: 'Verified release', exact: true })
    ).toBeVisible();

    // Relevant changes must still invalidate the input and its verification result.
    await page.getByRole('button', { name: 'Replace release', exact: true }).click();
    await expect(widget.getByRole('heading', { name: 'Replacement notes' })).toBeVisible();
    expect(await originalInput.evaluate((el) => el.isConnected)).toBe(false);
    await expect(input).toHaveValue('');
    await expect(widget.locator('.col-dl [role=status]')).toHaveText('');
    await page.getByRole('button', { name: 'Revoke application', exact: true }).click();
    await expect(widget.getByRole('alert')).toContainText('no longer authorized');
    await expect(input).toHaveCount(0);
    await expect(widget.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
  });
}

test('clears a canceled file-check status on explicit asset retry', async ({ page }) => {
  const widget = page.frameLocator('iframe');
  await page.getByRole('button', { name: 'Toggle partial query', exact: true }).click();
  await widget.locator('.release-card').click();
  await expect(widget.getByRole('button', { name: 'Retry assets', exact: true })).toBeVisible();
  await holdNextFileRead(widget);
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect
    .poll(() => widget.locator('body').evaluate(() => 'releasePendingFileRead' in window))
    .toBe(true);
  await expect(widget.getByRole('status')).toHaveText('Checking…');
  await widget.getByRole('button', { name: 'Retry assets', exact: true }).click();
  await expect(widget.getByLabel('Verify local file')).toHaveValue('');
  await expect.soft(widget.getByRole('status')).toHaveText('');
  await finishFileRead(widget);
  await expect(widget.getByRole('status')).toHaveText('');
});

test('does not reuse a stale file-check result after retrying asset metadata', async ({ page }) => {
  const widget = page.frameLocator('iframe');
  await page.getByRole('button', { name: 'Toggle partial query', exact: true }).click();
  await widget.locator('.release-card').click();
  await expect(widget.getByRole('button', { name: 'Retry assets', exact: true })).toBeVisible();
  await holdNextFileRead(widget);
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'fixture.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect
    .poll(() => widget.locator('body').evaluate(() => 'releasePendingFileRead' in window))
    .toBe(true);
  await widget.getByRole('button', { name: 'Retry assets', exact: true }).click();
  await expect(widget.getByRole('status')).toHaveText('');
  await widget.getByLabel('Verify local file').setInputFiles({
    name: 'other.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('evil'),
  });
  await expect(widget.getByRole('status')).toContainText('mismatch');
  await finishFileRead(widget);
  await expect(widget.getByRole('status')).toContainText('mismatch');
});
