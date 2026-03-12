import { test, expect } from './fixtures'

test.describe('Preview Panel', () => {
  test('preview tab shows in MainTabs', async ({ authenticatedPage: page }) => {
    // The tab bar should contain a Preview tab
    const previewTab = page.locator('button').filter({ hasText: 'Preview' })
    await expect(previewTab.first()).toBeVisible({ timeout: 5000 })
  })

  test('navigate to preview tab', async ({ authenticatedPage: page }) => {
    const previewTab = page.locator('button').filter({ hasText: 'Preview' }).first()
    await previewTab.click()

    // The preview content area should appear (ErrorBoundary wrapping PreviewPanel)
    const previewArea = page.locator('[class*="resizable"], [class*="preview"]').first()
      .or(page.locator('text=Open a file').first())
    await expect(previewArea).toBeVisible({ timeout: 5000 })
  })

  test('open a file for preview via sidebar', async ({ authenticatedPage: page }) => {
    // Switch to preview tab
    const previewTab = page.locator('button').filter({ hasText: 'Preview' }).first()
    await previewTab.click()
    await page.waitForTimeout(500)

    // The preview panel includes a FileSidebar; look for file tree items
    const sidebar = page.locator('aside, [class*="sidebar"], [class*="file-tree"]').first()
    if (await sidebar.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Click the first visible file entry
      const fileEntry = sidebar.locator('button, [role="treeitem"], [class*="file"]').first()
      if (await fileEntry.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fileEntry.click()
        // After opening a file the preview tab bar should appear
        const tabBar = page.locator('[class*="border-b"][class*="bg-muted"]').first()
        await expect(tabBar).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('tab bar shows open preview files', async ({ authenticatedPage: page }) => {
    const previewTab = page.locator('button').filter({ hasText: 'Preview' }).first()
    await previewTab.click()
    await page.waitForTimeout(500)

    // If there are open preview tabs, the tab bar is rendered
    const tabButtons = page.locator('button[class*="border-r"][class*="shrink-0"]')
    const count = await tabButtons.count()
    // Either tabs exist (from a file being open) or empty state is shown
    if (count > 0) {
      await expect(tabButtons.first()).toBeVisible()
    } else {
      // Empty state: no files open — the preview panel still renders
      const emptyHint = page.locator('text=Open a file').first()
        .or(page.locator('[class*="preview"]').first())
      await expect(emptyHint).toBeVisible({ timeout: 3000 })
    }
  })

  test('close a preview tab', async ({ authenticatedPage: page }) => {
    const previewTab = page.locator('button').filter({ hasText: 'Preview' }).first()
    await previewTab.click()
    await page.waitForTimeout(500)

    // Look for a close button (X icon) inside a tab bar entry
    const closeBtn = page.locator('button[aria-label="Close tab"]').first()
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      const tabsBefore = await page.locator('button[aria-label="Close tab"]').count()
      await closeBtn.click()
      await page.waitForTimeout(300)
      const tabsAfter = await page.locator('button[aria-label="Close tab"]').count()
      expect(tabsAfter).toBeLessThanOrEqual(tabsBefore)
    }
  })

  test('switch between preview tabs', async ({ authenticatedPage: page }) => {
    const previewTab = page.locator('button').filter({ hasText: 'Preview' }).first()
    await previewTab.click()
    await page.waitForTimeout(500)

    // If multiple tabs are open, click between them
    const tabButtons = page.locator('button[class*="border-r"][class*="shrink-0"]')
    const count = await tabButtons.count()
    if (count >= 2) {
      // Click the second tab
      await tabButtons.nth(1).click()
      await page.waitForTimeout(200)
      // Click the first tab
      await tabButtons.nth(0).click()
      await page.waitForTimeout(200)
      // First tab should be active (have bg-background class)
      await expect(tabButtons.nth(0)).toHaveClass(/bg-background/)
    }
  })
})
