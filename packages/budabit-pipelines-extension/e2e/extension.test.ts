import { test, expect } from '@playwright/test';

test.describe('Extension', () => {
  test('should render Smart Widget UI', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Smart Widget');
    await expect(page.locator('.status')).toContainText('Ready');

    await expect(page.locator('button:has-text("Publish")')).toBeVisible();
    await expect(page.locator('button:has-text("Show Toast")')).toBeVisible();
    await expect(page.locator('input[type="text"]')).toBeVisible();
  });

  test('should handle context:update event from host (optional demo)', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'event',
          action: 'context:update',
          payload: {
            contextId: 'test-room-123',
            userPubkey: 'test-pubkey-abc123',
            relays: ['wss://relay.damus.io'],
          },
        },
        '*'
      );
    });

    await expect(page.locator('.status')).toContainText('Connected');
    await expect(page.locator('.context')).toBeVisible();
    await expect(page.locator('.context')).toContainText('test-room-123');
    await expect(page.locator('.context')).toContainText('test-pubkey-abc123');
    await expect(page.locator('.context')).toContainText('wss://relay.damus.io');
  });

  test('should send nostr:publish request and handle host response', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      (window as any).__sentRequests = [];

      window.addEventListener('message', (event) => {
        const data = event.data as any;
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'request') return;
        if (typeof data.action !== 'string') return;
        if (typeof data.id !== 'string') return;

        (window as any).__sentRequests.push(data);
      });
    });

    await page.locator('input[type="text"]').fill('Hello from e2e!');
    await page.locator('button:has-text("Publish")').click();

    await page.waitForFunction(() => {
      const reqs = (window as any).__sentRequests;
      return Array.isArray(reqs) && reqs.some((m: any) => m.action === 'nostr:publish');
    });

    const requestMsg = await page.evaluate(() => {
      const reqs = (window as any).__sentRequests as any[];
      return reqs.find((m) => m.action === 'nostr:publish') ?? null;
    });

    expect(requestMsg).not.toBeNull();
    expect(requestMsg.action).toBe('nostr:publish');
    expect(typeof requestMsg.id).toBe('string');

    await page.evaluate((id: string) => {
      window.postMessage(
        {
          type: 'response',
          id,
          action: 'nostr:publish',
          payload: { status: 'ok' },
        },
        '*'
      );
    }, requestMsg.id);

    await expect(page.locator('.status')).toContainText('Published successfully');
    await expect(page.locator('input[type="text"]')).toHaveValue('');
    await expect(page.locator('.result')).toContainText('ok');
  });

  test('should send ui:toast request and handle host response', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      (window as any).__sentRequests = [];

      window.addEventListener('message', (event) => {
        const data = event.data as any;
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'request') return;
        if (typeof data.action !== 'string') return;
        if (typeof data.id !== 'string') return;

        (window as any).__sentRequests.push(data);
      });
    });

    await page.locator('button:has-text("Show Toast")').click();

    await page.waitForFunction(() => {
      const reqs = (window as any).__sentRequests;
      return Array.isArray(reqs) && reqs.some((m: any) => m.action === 'ui:toast');
    });

    const requestMsg = await page.evaluate(() => {
      const reqs = (window as any).__sentRequests as any[];
      return reqs.find((m) => m.action === 'ui:toast') ?? null;
    });

    expect(requestMsg).not.toBeNull();
    expect(requestMsg.action).toBe('ui:toast');
    expect(typeof requestMsg.id).toBe('string');

    await page.evaluate((id: string) => {
      window.postMessage(
        {
          type: 'response',
          id,
          action: 'ui:toast',
          payload: { status: 'ok' },
        },
        '*'
      );
    }, requestMsg.id);

    await expect(page.locator('.status')).toContainText('Toast requested');
  });
});
