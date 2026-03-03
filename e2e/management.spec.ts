import { test, expect } from './fixtures'

test.describe('Management View', () => {
  test('navigates to /management and shows widget grid', async ({ managementPage: page }) => {
    await expect(page.locator('[data-testid="management-view"]')).toBeVisible()
    await expect(page.getByText('Management')).toBeVisible()
  })

  test('all four widgets are present', async ({ managementPage: page }) => {
    await expect(page.locator('[data-testid="widget-services"]')).toBeVisible()
    await expect(page.locator('[data-testid="widget-scripts"]')).toBeVisible()
    await expect(page.locator('[data-testid="widget-processes"]')).toBeVisible()
    await expect(page.locator('[data-testid="widget-env"]')).toBeVisible()
  })

  test('widget titles are displayed', async ({ managementPage: page }) => {
    await expect(page.getByText('Services').first()).toBeVisible()
    await expect(page.getByText('Scripts').first()).toBeVisible()
    await expect(page.getByText('Processes').first()).toBeVisible()
    await expect(page.getByText('Environment').first()).toBeVisible()
  })

  test('widget size toggle works', async ({ managementPage: page }) => {
    const sizeToggle = page.locator('[data-testid="widget-services"]').locator('[data-testid="widget-size-toggle"]')
    await sizeToggle.click()

    // Widget should now span full width (md:col-span-2)
    const widgetWrapper = page.locator('[data-testid="widget-services"]').locator('..')
    await expect(widgetWrapper).toHaveClass(/col-span-2/)

    // Click again to go back to half
    await sizeToggle.click()
    await expect(widgetWrapper).not.toHaveClass(/col-span-2/)
  })

  test('services widget: add button toggles form', async ({ managementPage: page }) => {
    const addBtn = page.locator('[data-testid="services-add-btn"]')
    await addBtn.click()

    // Form should appear
    await expect(page.locator('[data-testid="services-add-form"]')).toBeVisible()

    // Click again to hide
    await addBtn.click()
    await expect(page.locator('[data-testid="services-add-form"]')).not.toBeVisible()
  })

  test('services widget: add form has name and command inputs', async ({ managementPage: page }) => {
    await page.locator('[data-testid="services-add-btn"]').click()

    const form = page.locator('[data-testid="services-add-form"]')
    await expect(form.getByPlaceholder('Name')).toBeVisible()
    await expect(form.getByPlaceholder('pnpm dev')).toBeVisible()
  })

  test('scripts widget: add button toggles form', async ({ managementPage: page }) => {
    const addBtn = page.locator('[data-testid="scripts-add-btn"]')
    await addBtn.click()

    await expect(page.locator('[data-testid="scripts-add-form"]')).toBeVisible()

    await addBtn.click()
    await expect(page.locator('[data-testid="scripts-add-form"]')).not.toBeVisible()
  })

  test('processes widget: shows empty state or list', async ({ managementPage: page }) => {
    // Refresh button should be present
    await expect(page.locator('[data-testid="processes-refresh"]')).toBeVisible()

    // Should show either process list or "No running processes" message
    const widget = page.locator('[data-testid="widget-processes"]')
    const hasProcesses = await widget.locator('table').isVisible().catch(() => false)
    if (!hasProcesses) {
      await expect(widget.getByText('No running processes')).toBeVisible()
    }
  })

  test('environment widget: path input and load button', async ({ managementPage: page }) => {
    await expect(page.locator('[data-testid="env-path-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="env-load-btn"]')).toBeVisible()
  })

  test('environment widget: can type a path', async ({ managementPage: page }) => {
    const pathInput = page.locator('[data-testid="env-path-input"]')
    await pathInput.fill('/tmp/test/.env')
    await expect(pathInput).toHaveValue('/tmp/test/.env')
  })
})
