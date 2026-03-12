import { test, expect } from './fixtures'

test.describe('Command Palette', () => {
  test('opens via Ctrl+K keyboard shortcut', async ({ authenticatedPage: page }) => {
    // Palette should not be visible initially
    const backdrop = page.locator('.fixed.inset-0.z-50')
    await expect(backdrop).not.toBeVisible()

    // Press Ctrl+K to open
    await page.keyboard.press('Control+k')

    // Palette overlay and input should appear
    await expect(backdrop).toBeVisible({ timeout: 3000 })
    const input = backdrop.locator('input[placeholder*="Search"]')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  test('dialog renders with input field and command list', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    // Search input is present
    const input = palette.locator('input[placeholder*="Search"]')
    await expect(input).toBeVisible()

    // Results list container is present
    const resultsList = palette.locator('.max-h-80')
    await expect(resultsList).toBeVisible()

    // Footer with keyboard hints is present
    const footer = palette.locator('text=navigate')
    await expect(footer).toBeVisible()
  })

  test('search filtering narrows the command list', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    const input = palette.locator('input[placeholder*="Search"]')

    // Count initial results (all commands visible)
    const allButtons = palette.locator('.max-h-80 button')
    const initialCount = await allButtons.count()
    expect(initialCount).toBeGreaterThan(0)

    // Type a filter query that should match only a subset
    await input.fill('Terminal')
    await page.waitForTimeout(200)

    const filteredButtons = palette.locator('.max-h-80 button')
    const filteredCount = await filteredButtons.count()
    expect(filteredCount).toBeLessThan(initialCount)
    expect(filteredCount).toBeGreaterThan(0)

    // The visible result should contain "Terminal"
    const match = filteredButtons.first()
    await expect(match).toContainText('Terminal')
  })

  test('common command items are visible', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    const results = palette.locator('.max-h-80')

    // Tab navigation items
    await expect(results.locator('text=Chat')).toBeVisible()
    await expect(results.locator('text=Editor')).toBeVisible()
    await expect(results.locator('text=Git')).toBeVisible()

    // Action items
    await expect(results.locator('text=New Session')).toBeVisible()
    await expect(results.locator('text=Export Session')).toBeVisible()
    await expect(results.locator('text=Toggle Terminal')).toBeVisible()
    await expect(results.locator('text=Toggle Split View')).toBeVisible()

    // Group headers
    await expect(results.locator('text=Navigate to')).toBeVisible()
    await expect(results.locator('text=Actions')).toBeVisible()
  })

  test('closes on Escape key', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 3000 })
  })

  test('closes on outside click', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    // Click the backdrop (outside the dialog content)
    // The backdrop uses @mousedown.self="close", so click the overlay area
    await palette.click({ position: { x: 10, y: 10 } })
    await expect(palette).not.toBeVisible({ timeout: 3000 })
  })

  test('executing a command closes palette and performs action', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    // Filter to "Editor" tab command and click it
    const input = palette.locator('input[placeholder*="Search"]')
    await input.fill('Editor')
    await page.waitForTimeout(200)

    const editorBtn = palette.locator('.max-h-80 button', { hasText: 'Editor' }).first()
    await expect(editorBtn).toBeVisible()
    await editorBtn.click()

    // Palette should close
    await expect(palette).not.toBeVisible({ timeout: 3000 })

    // URL should reflect the editor route
    await expect(page).toHaveURL(/editor/, { timeout: 5000 })
  })

  test('shows all commands when search is empty', async ({ authenticatedPage: page }) => {
    await page.keyboard.press('Control+k')

    const palette = page.locator('.fixed.inset-0.z-50')
    await expect(palette).toBeVisible({ timeout: 3000 })

    const input = palette.locator('input[placeholder*="Search"]')

    // Input should be empty by default
    await expect(input).toHaveValue('')

    // All tab and action items should be visible (at least 13: 9 tabs + 4 actions)
    const allButtons = palette.locator('.max-h-80 button')
    const count = await allButtons.count()
    expect(count).toBeGreaterThanOrEqual(13)

    // Type something then clear — should restore all results
    await input.fill('zzzzz_no_match')
    await page.waitForTimeout(200)

    const noResults = palette.locator('text=No results for')
    await expect(noResults).toBeVisible()

    await input.fill('')
    await page.waitForTimeout(200)

    const restoredCount = await allButtons.count()
    expect(restoredCount).toBeGreaterThanOrEqual(13)
  })
})
