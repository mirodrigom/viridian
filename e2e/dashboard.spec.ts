import { test, expect } from './fixtures'

test.describe('Dashboard', () => {
  test('main layout loads after authentication', async ({ authenticatedPage: page }) => {
    // The main app should have rendered
    await expect(page.locator('body')).toBeVisible()

    // Should have a topbar or navigation area
    const topBar = page.locator('[class*="top-bar"], header, nav').first()
    await expect(topBar).toBeVisible({ timeout: 5000 })
  })

  test('sidebar with sessions is visible', async ({ authenticatedPage: page }) => {
    // Look for sidebar or session list
    const sidebar = page.locator('[class*="sidebar"], aside, [class*="session"]').first()
    await expect(sidebar).toBeVisible({ timeout: 5000 })
  })

  test('new chat can be initiated', async ({ authenticatedPage: page }) => {
    // Look for a "new chat" button or similar
    const newChatBtn = page.getByRole('button', { name: /new|chat|session/i }).first()
    if (await newChatBtn.isVisible()) {
      await newChatBtn.click()
      // Should have a message input area
      const input = page.locator('textarea, [contenteditable], input[type="text"]').first()
      await expect(input).toBeVisible({ timeout: 5000 })
    }
  })
})
