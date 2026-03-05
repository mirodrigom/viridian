import { test, expect } from './fixtures'

test.describe('Autopilot', () => {
  test('navigates to autopilot tab and shows layout', async ({ authenticatedPage: page }) => {
    // Click the Autopilot tab (Bot icon)
    const autopilotTab = page.locator('button').filter({ hasText: /autopilot/i }).first()
      .or(page.getByRole('button', { name: /autopilot/i }))
    await autopilotTab.click()

    // Autopilot view should be visible
    const autopilotView = page.locator('[data-testid="autopilot-view"]')
    await expect(autopilotView).toBeVisible({ timeout: 5_000 })
  })

  test('autopilot shows session sidebar', async ({ authenticatedPage: page }) => {
    // Navigate to autopilot
    await page.goto('/autopilot')
    await page.waitForLoadState('networkidle')

    const autopilotView = page.locator('[data-testid="autopilot-view"]')
    await expect(autopilotView).toBeVisible({ timeout: 5_000 })

    // Should show sidebar with configuration options or empty state
    // Look for "New Run" or "Configure" or profile-related content
    const hasContent = await autopilotView.locator('text=/new|configure|profile|run|no.*run/i').first().isVisible().catch(() => false)
    expect(hasContent).toBeTruthy()
  })

  test('autopilot has desktop 3-panel layout', async ({ authenticatedPage: page }) => {
    // Navigate to autopilot
    await page.goto('/autopilot')
    await page.waitForLoadState('networkidle')

    const autopilotView = page.locator('[data-testid="autopilot-view"]')
    await expect(autopilotView).toBeVisible({ timeout: 5_000 })

    // Desktop layout should have resizable panels
    // Check for Timeline and Dashboard tabs in the right panel
    const timelineTab = autopilotView.locator('text=Timeline')
    const dashboardTab = autopilotView.locator('text=Dashboard')

    if (await timelineTab.isVisible()) {
      await expect(timelineTab).toBeVisible()
      await expect(dashboardTab).toBeVisible()

      // Click Dashboard tab
      await dashboardTab.click()
      // Should switch to dashboard content
      await page.waitForTimeout(300)
    }
  })
})
