import { test, expect } from '@playwright/test'

test.describe('Huddle Multi-Participant', () => {
  test('two users joining same repo should get identical room URLs', async ({ browser }) => {
    // Create two separate browser contexts (simulating two different users/devices)
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Both navigate to the huddle extension dev server
    await page1.goto('http://localhost:5173')
    await page2.goto('http://localhost:5173')

    // Simulate the same repo context being sent to both
    const repoContext = {
      repo: {
        repoPubkey: 'cdee943cbb19c51ab847a66d5d774373aa9f63d287246bb59b0827fa5e637400',
        repoName: 'ngit-grasp-fork'
      }
    }

    // Send context:update event to both pages
    await page1.evaluate((ctx) => {
      window.postMessage({
        type: 'widget:event',
        event: 'context:update',
        payload: ctx
      }, '*')
    }, repoContext)

    await page2.evaluate((ctx) => {
      window.postMessage({
        type: 'widget:event',
        event: 'context:update',
        payload: ctx
      }, '*')
    }, repoContext)

    // Wait for huddle UI to render
    await page1.waitForSelector('text=Start a huddle', { timeout: 5000 })
    await page2.waitForSelector('text=Start a huddle', { timeout: 5000 })

    // Click "Start a huddle" on both
    await page1.click('text=Start a huddle')
    await page2.click('text=Start a huddle')

    // Wait for room info to appear
    await page1.waitForSelector('.room-id', { timeout: 5000 })
    await page2.waitForSelector('.room-id', { timeout: 5000 })

    // Get the room URLs from both pages
    const roomUrl1 = await page1.locator('.room-url-full').textContent()
    const roomUrl2 = await page2.locator('.room-url-full').textContent()

    // Verify they are identical
    expect(roomUrl1).toBe(roomUrl2)
    expect(roomUrl1).toBe('https://vanilla.hivetalk.org/join/cdee943c-ngit-grasp-fork')

    // Verify the "Open in Tab" link has the correct href
    const link1 = await page1.locator('.open-button').getAttribute('href')
    const link2 = await page2.locator('.open-button').getAttribute('href')

    expect(link1).toBe('https://vanilla.hivetalk.org/join/cdee943c-ngit-grasp-fork')
    expect(link2).toBe('https://vanilla.hivetalk.org/join/cdee943c-ngit-grasp-fork')
    expect(link1).toBe(link2)

    await context1.close()
    await context2.close()
  })

  test('room URL should use /join/ path not query parameter', async ({ page }) => {
    await page.goto('http://localhost:5173')

    const repoContext = {
      repo: {
        repoPubkey: 'test123',
        repoName: 'test-repo'
      }
    }

    await page.evaluate((ctx) => {
      window.postMessage({
        type: 'widget:event',
        event: 'context:update',
        payload: ctx
      }, '*')
    }, repoContext)

    await page.click('text=Start a huddle')
    await page.waitForSelector('.room-url-full')

    const roomUrl = await page.locator('.room-url-full').textContent()

    expect(roomUrl).toContain('/join/')
    expect(roomUrl).not.toContain('?room=')
  })

  test('debug info should show repo context', async ({ page }) => {
    await page.goto('http://localhost:5173')

    const repoContext = {
      repo: {
        repoPubkey: 'cdee943cbb19c51ab847a66d5d774373aa9f63d287246bb59b0827fa5e637400',
        repoName: 'ngit-grasp-fork'
      }
    }

    await page.evaluate((ctx) => {
      window.postMessage({
        type: 'widget:event',
        event: 'context:update',
        payload: ctx
      }, '*')
    }, repoContext)

    await page.click('text=Start a huddle')
    await page.waitForSelector('.debug-info')

    const debugInfo = await page.locator('.debug-info').textContent()

    expect(debugInfo).toContain('"hasRepo":true')
    expect(debugInfo).toContain('"repoPubkey":"cdee943c"')
    expect(debugInfo).toContain('"repoName":"ngit-grasp-fork"')
  })
})
