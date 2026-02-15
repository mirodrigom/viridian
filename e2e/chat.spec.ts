import { test, expect } from './fixtures'

test.describe('Chat', () => {
  test('message input is visible and functional', async ({ authenticatedPage: page }) => {
    // Navigate to chat if not already there
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // Find the message input
    const input = page.locator('textarea, [contenteditable="true"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })

    // Type a message
    await input.fill('Hello, this is a test message')
    await expect(input).toHaveValue('Hello, this is a test message')
  })

  test('chat area shows message list container', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // The chat view should have a messages container
    const chatArea = page.locator('[class*="chat"], [class*="message"], main').first()
    await expect(chatArea).toBeVisible({ timeout: 5000 })
  })
})
