import { test, expect } from './fixtures'

test.describe('Terminal', () => {
  test('terminal panel opens via toggle button', async ({ authenticatedPage: page }) => {
    // Terminal should not be visible initially
    await expect(page.locator('[data-testid="terminal-panel"]')).not.toBeVisible()

    // Click terminal toggle in top bar
    const toggleBtn = page.getByRole('button', { name: /toggle terminal/i })
    await expect(toggleBtn).toBeVisible()
    await toggleBtn.click()

    // Terminal panel should now be visible
    const terminal = page.locator('[data-testid="terminal-panel"]')
    await expect(terminal).toBeVisible({ timeout: 5_000 })

    // Should show "Terminal" header
    await expect(terminal.locator('text=Terminal')).toBeVisible()

    // xterm container should be present
    await expect(terminal.locator('.xterm')).toBeVisible({ timeout: 5_000 })
  })

  test('terminal panel closes via toggle button', async ({ authenticatedPage: page }) => {
    // Open terminal
    const toggleBtn = page.getByRole('button', { name: /toggle terminal/i })
    await toggleBtn.click()
    await expect(page.locator('[data-testid="terminal-panel"]')).toBeVisible({ timeout: 5_000 })

    // Close terminal
    await toggleBtn.click()
    await expect(page.locator('[data-testid="terminal-panel"]')).not.toBeVisible({ timeout: 3_000 })
  })

  test('terminal has xterm canvas rendering', async ({ authenticatedPage: page }) => {
    const toggleBtn = page.getByRole('button', { name: /toggle terminal/i })
    await toggleBtn.click()

    const terminal = page.locator('[data-testid="terminal-panel"]')
    await expect(terminal).toBeVisible({ timeout: 5_000 })

    // xterm should have initialized with a canvas or screen element
    const xtermScreen = terminal.locator('.xterm-screen')
    await expect(xtermScreen).toBeVisible({ timeout: 5_000 })
  })
})
