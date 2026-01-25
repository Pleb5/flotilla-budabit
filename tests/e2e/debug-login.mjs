import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));

await page.goto('http://localhost:1847');
await page.waitForTimeout(3000);

// Clear storage and reload
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload();
await page.waitForTimeout(3000);

console.log('Looking for login-screen...');
const loginScreen = page.getByTestId('login-screen');
console.log('Login screen visible:', await loginScreen.isVisible());

console.log('Clicking login button...');
await page.getByTestId('identity-cta-login').click();
await page.waitForTimeout(1000);

console.log('Looking for login-modal...');
const modal = page.getByTestId('login-modal');
console.log('Modal visible:', await modal.isVisible());

console.log('Clicking bunker option...');
await page.getByTestId('login-option-bunker').click();
await page.waitForTimeout(1000);

console.log('Looking for bunker input...');
const input = page.getByTestId('login-bunker-url');
console.log('Input visible:', await input.isVisible());

console.log('Typing reviewkey...');
await input.type('reviewkey', {delay: 100});

console.log('Waiting for effect...');
await page.waitForTimeout(5000);

// Check if pubkey is set in localStorage
const pubkey = await page.evaluate(() => localStorage.getItem('pubkey') || localStorage.getItem('welshman:sessions'));
console.log('localStorage pubkey/sessions:', pubkey?.substring(0, 100));

// Check if nav appeared
const nav = page.locator('nav').first();
console.log('Nav visible:', await nav.isVisible().catch(() => false));

// Get page content
const bodyText = await page.evaluate(() => document.body.innerText);
console.log('Current page text (first 500):', bodyText.substring(0, 500));

await browser.close();
