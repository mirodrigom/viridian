import { test, expect } from './fixtures'

test.describe('Diagram Editor', () => {
  test('navigates to /diagrams and shows editor layout', async ({ diagramPage: page }) => {
    await expect(page.locator('[data-testid="diagram-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="node-palette"]')).toBeVisible()
    await expect(page.locator('[data-testid="diagram-toolbar"]')).toBeVisible()
    await expect(page.locator('[data-testid="diagram-canvas"]')).toBeVisible()
  })

  test('palette shows categories and services', async ({ diagramPage: page }) => {
    // Containers section should be visible
    await expect(page.getByText('Containers')).toBeVisible()

    // Compute and Networking are expanded by default
    await expect(page.locator('[data-testid="palette-category-Compute"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-category-Networking"]')).toBeVisible()

    // EC2 should be visible under Compute (expanded by default)
    await expect(page.locator('[data-testid="palette-service-ec2"]')).toBeVisible()
  })

  test('palette search filters services', async ({ diagramPage: page }) => {
    const searchInput = page.locator('[data-testid="palette-search"]')
    await searchInput.fill('lambda')

    // Lambda should be visible
    await expect(page.locator('[data-testid="palette-service-lambda"]')).toBeVisible()

    // EC2 should be hidden
    await expect(page.locator('[data-testid="palette-service-ec2"]')).not.toBeVisible()

    // Clear search restores state
    await searchInput.clear()
    await expect(page.locator('[data-testid="palette-service-ec2"]')).toBeVisible()
  })

  test('palette search shows no results message', async ({ diagramPage: page }) => {
    await page.locator('[data-testid="palette-search"]').fill('xyznonexistent')
    await expect(page.locator('[data-testid="palette-no-results"]')).toBeVisible()
    await expect(page.getByText('No services matching')).toBeVisible()
  })

  test('palette category expand/collapse', async ({ diagramPage: page }) => {
    // Click Database category to expand it
    const dbCategory = page.locator('[data-testid="palette-category-Database"]')
    await dbCategory.click()

    // RDS should now be visible
    await expect(page.locator('[data-testid="palette-service-rds"]')).toBeVisible()

    // Click again to collapse
    await dbCategory.click()
    await expect(page.locator('[data-testid="palette-service-rds"]')).not.toBeVisible()
  })

  test('toolbar displays node and edge counts', async ({ diagramPage: page }) => {
    const stats = page.locator('[data-testid="diagram-stats"]')
    await expect(stats).toContainText('0 nodes')
    await expect(stats).toContainText('0 edges')
  })

  test('toolbar buttons are present', async ({ diagramPage: page }) => {
    await expect(page.locator('[data-testid="toolbar-new"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-save"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-load"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-fitView"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-toggleSnap"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-collapseAll"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-expandAll"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-exportPng"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-exportSvg"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-exportJson"]')).toBeVisible()
    await expect(page.locator('[data-testid="toolbar-exportGif"]')).toBeVisible()
  })

  test('save dialog opens and closes', async ({ diagramPage: page }) => {
    await page.locator('[data-testid="toolbar-save"]').click()
    await expect(page.getByText('Save Diagram')).toBeVisible()
    await expect(page.locator('[data-testid="save-diagram-name"]')).toBeVisible()

    // Cancel closes the dialog
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Save Diagram')).not.toBeVisible()
  })

  test('load dialog opens and shows empty state', async ({ diagramPage: page }) => {
    await page.locator('[data-testid="toolbar-load"]').click()
    await expect(page.getByText('Load Diagram')).toBeVisible()
    // Either shows a list or "No saved diagrams yet"
    const dialog = page.locator('[data-testid="load-diagram-dialog"]')
    await expect(dialog).toBeVisible()
  })

  test('diagram name is editable in palette', async ({ diagramPage: page }) => {
    const nameInput = page.locator('[data-testid="node-palette"]').getByPlaceholder('Diagram name...')
    await nameInput.clear()
    await nameInput.fill('My Architecture')
    await expect(nameInput).toHaveValue('My Architecture')
  })

  test('snap to grid toggle', async ({ diagramPage: page }) => {
    const snapBtn = page.locator('[data-testid="toolbar-toggleSnap"]')

    // Snap is on by default — button should have the active class
    await expect(snapBtn).toHaveClass(/bg-primary/)

    // Click to toggle off
    await snapBtn.click()
    await expect(snapBtn).not.toHaveClass(/bg-primary/)

    // Click again to toggle back on
    await snapBtn.click()
    await expect(snapBtn).toHaveClass(/bg-primary/)
  })

  test('new diagram clears canvas', async ({ diagramPage: page }) => {
    // Add a node via store
    await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.addServiceNode('ec2', { x: 200, y: 200 })
    })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    const stats = page.locator('[data-testid="diagram-stats"]')
    await expect(stats).toContainText('1 nodes')

    // Click New
    await page.locator('[data-testid="toolbar-new"]').click()
    await expect(stats).toContainText('0 nodes')
  })

  test('keyboard Escape deselects', async ({ diagramPage: page }) => {
    // Add and select a node
    await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      const id = store.addServiceNode('ec2', { x: 200, y: 200 })
      store.selectNode(id)
    })
    await page.waitForTimeout(200)

    // Properties panel should be visible
    await expect(page.locator('[data-testid="properties-panel"]')).toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // Properties panel should be hidden (no selection)
    await expect(page.locator('[data-testid="properties-panel"]')).not.toBeVisible()
  })
})
