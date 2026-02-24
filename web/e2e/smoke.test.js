import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5173';

test.describe('intentcity - Smoke Test', () => {
  test('frontend should be reachable and show campsites', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    
    // Check title
    const title = await page.title();
    expect(title).toBe('intentcity');
    
    // Check for map
    await expect(page.locator('.map-container')).toBeVisible();
    
    // Check for controls
    await expect(page.locator('.controls')).toBeVisible();
    
    // Check for at least one agency button
    await expect(page.getByRole('button', { name: /WA State Parks/i })).toBeVisible();
  });
});
