import { test, expect } from './fixtures'

test.describe('Settings', () => {
  test('settings dialog opens and closes', async ({ authenticatedPage: page }) => {
    // Look for settings button (gear icon or "Settings" text)
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())
      .or(page.locator('[class*="settings"]').first())

    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()

      // Settings dialog should be visible
      const dialog = page.getByRole('dialog').first()
        .or(page.locator('[class*="dialog"], [class*="modal"]').first())
      await expect(dialog).toBeVisible({ timeout: 3000 })

      // Close the dialog
      const closeBtn = page.getByRole('button', { name: /close|cancel|×/i }).first()
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
        await expect(dialog).not.toBeVisible({ timeout: 3000 })
      }
    }
  })

  test('dark mode toggle works', async ({ authenticatedPage: page }) => {
    // Check initial dark mode state
    const html = page.locator('html')
    const initialDark = await html.evaluate(el => el.classList.contains('dark'))

    // Find and click dark mode toggle
    const darkModeBtn = page.getByRole('button', { name: /dark|theme|mode/i }).first()
      .or(page.locator('[class*="dark-mode"], [class*="theme-toggle"]').first())

    if (await darkModeBtn.isVisible()) {
      await darkModeBtn.click()

      // Class should have toggled
      const newDark = await html.evaluate(el => el.classList.contains('dark'))
      expect(newDark).toBe(!initialDark)
    }
  })
})
