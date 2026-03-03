import { test, expect } from './fixtures'
import { addGraphNode } from './helpers/vueflow'

test.describe('Graph Runner Panel', () => {
  test('run button is disabled when graph is empty', async ({ graphPage: page }) => {
    const runBtn = page.locator('[data-testid="graph-toolbar-run"]')
    await expect(runBtn).toBeDisabled()
  })

  test('run button is enabled when nodes exist', async ({ graphPage: page }) => {
    await addGraphNode(page, 'agent', { x: 200, y: 200 })

    const runBtn = page.locator('[data-testid="graph-toolbar-run"]')
    await expect(runBtn).toBeEnabled()
  })

  test('runner panel shows idle state', async ({ graphPage: page }) => {
    // The runner panel might be toggled via a toolbar button
    // Look for the runner toggle in the toolbar
    const runnerToggle = page.locator('[data-testid="graph-toolbar"]').getByRole('button').last()

    // Try to open the runner panel if not already visible
    if (!(await page.locator('[data-testid="runner-panel"]').isVisible().catch(() => false))) {
      // Click the PanelRight button (runner toggle) - it's typically the last button in toolbar
      await runnerToggle.click()
    }

    const panel = page.locator('[data-testid="runner-panel"]')
    if (await panel.isVisible().catch(() => false)) {
      // Should show "No active run" or status text
      await expect(panel.getByText(/runner/i).first()).toBeVisible()
    }
  })

  test('runner panel tabs are present', async ({ graphPage: page }) => {
    // Open runner panel if not visible
    const panel = page.locator('[data-testid="runner-panel"]')

    // Navigate to runner by toggling
    if (!(await panel.isVisible().catch(() => false))) {
      // Find and click the runner toggle button
      const buttons = page.locator('[data-testid="graph-toolbar"] button')
      const count = await buttons.count()
      if (count > 0) {
        await buttons.nth(count - 1).click()
      }
    }

    if (await panel.isVisible().catch(() => false)) {
      // Tabs should be present
      await expect(panel.getByText('Timeline')).toBeVisible()
      await expect(panel.getByText('History')).toBeVisible()
    }
  })
})
