import { test, expect } from './fixtures'
import { addGraphNode, selectGraphNode } from './helpers/vueflow'

test.describe('Graph Editor', () => {
  test('navigates to /graph and shows editor layout', async ({ graphPage: page }) => {
    await expect(page.locator('[data-testid="graph-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-palette"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-toolbar"]')).toBeVisible()
  })

  test('palette shows all node types', async ({ graphPage: page }) => {
    // All 6 node types should be available
    await expect(page.locator('[data-testid="graph-node-type-agent"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-node-type-subagent"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-node-type-expert"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-node-type-skill"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-node-type-mcp"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-node-type-rule"]')).toBeVisible()
  })

  test('graph name is editable', async ({ graphPage: page }) => {
    const nameInput = page.locator('[data-testid="graph-palette"]').getByPlaceholder('Graph name...')
    await nameInput.clear()
    await nameInput.fill('My Agent Graph')
    await expect(nameInput).toHaveValue('My Agent Graph')
  })

  test('toolbar shows node and edge counts', async ({ graphPage: page }) => {
    const stats = page.locator('[data-testid="graph-stats"]')
    await expect(stats).toContainText('0 nodes')
    await expect(stats).toContainText('0 edges')
  })

  test('toolbar buttons are present', async ({ graphPage: page }) => {
    await expect(page.locator('[data-testid="graph-toolbar-new"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-toolbar-save"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-toolbar-load"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-toolbar-run"]')).toBeVisible()
    await expect(page.locator('[data-testid="graph-toolbar-delete"]')).toBeVisible()
  })

  test('adding agent node via store renders on canvas', async ({ graphPage: page }) => {
    await addGraphNode(page, 'agent', { x: 200, y: 200 })

    await expect(page.locator('.vue-flow__node')).toHaveCount(1)
    await expect(page.locator('[data-testid="graph-stats"]')).toContainText('1 nodes')
  })

  test('selecting a node shows properties panel', async ({ graphPage: page }) => {
    const nodeId = await addGraphNode(page, 'agent', { x: 200, y: 200 })
    await selectGraphNode(page, nodeId)

    const panel = page.locator('[data-testid="graph-properties-panel"]')
    await expect(panel).toBeVisible()
  })

  test('save dialog opens and closes', async ({ graphPage: page }) => {
    await page.locator('[data-testid="graph-toolbar-save"]').click()
    await expect(page.getByText('Save Graph')).toBeVisible()

    // Cancel or close
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText('Save Graph')).not.toBeVisible()
  })

  test('load dialog opens', async ({ graphPage: page }) => {
    await page.locator('[data-testid="graph-toolbar-load"]').click()
    await expect(page.getByText('Load Graph')).toBeVisible()
  })

  test('new graph clears canvas', async ({ graphPage: page }) => {
    await addGraphNode(page, 'agent', { x: 200, y: 200 })
    await expect(page.locator('[data-testid="graph-stats"]')).toContainText('1 nodes')

    await page.locator('[data-testid="graph-toolbar-new"]').click()

    // May show a confirm dialog; handle it
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|new/i })
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    await expect(page.locator('[data-testid="graph-stats"]')).toContainText('0 nodes')
  })

  test('delete selected node via toolbar', async ({ graphPage: page }) => {
    const nodeId = await addGraphNode(page, 'agent', { x: 200, y: 200 })
    await selectGraphNode(page, nodeId)

    await page.locator('[data-testid="graph-toolbar-delete"]').click()
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="graph-stats"]')).toContainText('0 nodes')
  })
})
