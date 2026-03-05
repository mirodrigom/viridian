import { test, expect } from './fixtures'

test.describe('Split View', () => {
  test('split view toggle button exists in top bar', async ({ authenticatedPage: page }) => {
    const splitBtn = page.getByRole('button', { name: /split view/i })
    await expect(splitBtn).toBeVisible()
  })

  test('split view activates on click', async ({ authenticatedPage: page }) => {
    const splitBtn = page.getByRole('button', { name: /split view/i })
    await splitBtn.click()

    // The button should have active styling (bg-primary/15)
    await expect(splitBtn).toHaveClass(/bg-primary/)

    // The chat tab should now contain the editor panel alongside chat
    // Look for "Open a file to see it here" placeholder in the split editor panel
    await expect(page.locator('text=Open a file to see it here')).toBeVisible({ timeout: 3_000 })
  })

  test('split view deactivates on second click', async ({ authenticatedPage: page }) => {
    const splitBtn = page.getByRole('button', { name: /split view/i })

    // Activate
    await splitBtn.click()
    await expect(page.locator('text=Open a file to see it here')).toBeVisible({ timeout: 3_000 })

    // Deactivate
    await splitBtn.click()
    await expect(page.locator('text=Open a file to see it here')).not.toBeVisible({ timeout: 3_000 })
  })

  test('split view toggle via keyboard shortcut', async ({ authenticatedPage: page }) => {
    // Press Ctrl+\ to toggle split view
    await page.keyboard.press('Control+\\')

    // Should show split editor placeholder
    await expect(page.locator('text=Open a file to see it here')).toBeVisible({ timeout: 3_000 })

    // Press again to close
    await page.keyboard.press('Control+\\')
    await expect(page.locator('text=Open a file to see it here')).not.toBeVisible({ timeout: 3_000 })
  })
})
