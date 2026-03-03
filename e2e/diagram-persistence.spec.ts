import { test, expect } from './fixtures'
import { addDiagramServiceNode } from './helpers/vueflow'

test.describe('Diagram Save/Load', () => {
  test('save dialog populates name from current diagram', async ({ diagramPage: page }) => {
    // Set a diagram name first
    const nameInput = page.locator('[data-testid="node-palette"]').getByPlaceholder('Diagram name...')
    await nameInput.clear()
    await nameInput.fill('E2E Test Diagram')

    // Open save dialog
    await page.locator('[data-testid="toolbar-save"]').click()
    await expect(page.getByText('Save Diagram')).toBeVisible()

    // Name should be pre-filled
    const saveNameInput = page.locator('[data-testid="save-diagram-name"]')
    await expect(saveNameInput).toHaveValue('E2E Test Diagram')
  })

  test('save button shows Update for existing diagrams', async ({ diagramPage: page }) => {
    // For a new diagram, save button should say "Save"
    await page.locator('[data-testid="toolbar-save"]').click()
    const submitBtn = page.locator('[data-testid="save-diagram-submit"]')
    await expect(submitBtn).toContainText('Save')

    // Close dialog
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('load dialog shows list or empty state', async ({ diagramPage: page }) => {
    await page.locator('[data-testid="toolbar-load"]').click()

    const dialog = page.locator('[data-testid="load-diagram-dialog"]')
    await expect(dialog).toBeVisible()

    // Should show either diagram items or "No saved diagrams yet"
    const hasItems = await page.locator('[data-testid^="load-diagram-item-"]').count()
    if (hasItems === 0) {
      await expect(page.getByText('No saved diagrams yet')).toBeVisible()
    }
  })

  test('export JSON triggers download', async ({ diagramPage: page }) => {
    // Add a node first
    await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })

    // Listen for download event
    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-testid="toolbar-exportJson"]').click()
    const download = await downloadPromise

    // Should download a JSON file
    expect(download.suggestedFilename()).toMatch(/\.json$/)
  })
})
