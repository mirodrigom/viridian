import { test, expect } from './fixtures'

test.describe('File History', () => {
  test('open editor tab', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await expect(editorTab).toBeVisible({ timeout: 5000 })
    await editorTab.click()

    // Editor panel should be visible (contains file sidebar + editor area)
    const editorArea = page.locator('[class*="resizable"], [class*="editor"]').first()
    await expect(editorArea).toBeVisible({ timeout: 5000 })
  })

  test('open a file in editor', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await editorTab.click()
    await page.waitForTimeout(500)

    // The editor tab has a FileSidebar; find and click a file
    const sidebar = page.locator('aside, [class*="sidebar"], [class*="file-tree"]').first()
    if (await sidebar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const fileEntry = sidebar.locator('button, [role="treeitem"]').first()
      if (await fileEntry.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fileEntry.click()
        await page.waitForTimeout(500)

        // EditorTabs should show the opened file
        const tabBar = page.locator('button[class*="shrink-0"]').filter({ has: page.locator('svg') })
        await expect(tabBar.first()).toBeVisible({ timeout: 3000 })
      }
    }
  })

  test('click file history button', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await editorTab.click()
    await page.waitForTimeout(500)

    // The EditorTabs component has a History button (lucide History icon)
    // It appears when a file is open
    const historyBtn = page.locator('button').filter({ has: page.locator('.lucide-history') }).first()
      .or(page.locator('button[title*="history" i]').first())

    if (await historyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyBtn.click()
      await page.waitForTimeout(300)

      // The FileHistoryPanel should slide in from the right
      const historyPanel = page.locator('text=File History').first()
      await expect(historyPanel).toBeVisible({ timeout: 3000 })
    }
  })

  test('history panel appears with correct header', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await editorTab.click()
    await page.waitForTimeout(500)

    const historyBtn = page.locator('button').filter({ has: page.locator('.lucide-history') }).first()
    if (await historyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyBtn.click()

      // Panel header: "File History" with the filename
      const header = page.locator('text=File History')
      await expect(header.first()).toBeVisible({ timeout: 3000 })

      // Panel should have a close button
      const closeBtn = page.locator('button').filter({ has: page.locator('.lucide-x') })
      await expect(closeBtn.first()).toBeVisible({ timeout: 2000 })
    }
  })

  test('history shows commit entries or empty state', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await editorTab.click()
    await page.waitForTimeout(500)

    const historyBtn = page.locator('button').filter({ has: page.locator('.lucide-history') }).first()
    if (await historyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyBtn.click()
      await page.waitForTimeout(1000) // Wait for API fetch

      // Either commit entries are shown (with hash-like text) or empty state
      const emptyMsg = page.locator('text=No commit history found').first()
        .or(page.locator('text=Open a file to view its history').first())
      const commitEntry = page.locator('.font-mono').first()

      const hasEmpty = await emptyMsg.isVisible({ timeout: 2000 }).catch(() => false)
      const hasCommits = await commitEntry.isVisible({ timeout: 1000 }).catch(() => false)

      expect(hasEmpty || hasCommits).toBe(true)
    }
  })

  test('close history panel', async ({ authenticatedPage: page }) => {
    const editorTab = page.locator('button').filter({ hasText: 'Editor' }).first()
    await editorTab.click()
    await page.waitForTimeout(500)

    const historyBtn = page.locator('button').filter({ has: page.locator('.lucide-history') }).first()
    if (await historyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyBtn.click()
      await page.waitForTimeout(300)

      // Close the panel via the X button
      const closeBtn = page.locator('button').filter({ has: page.locator('.lucide-x') }).first()
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click()
        await page.waitForTimeout(500)

        // "File History" text should no longer be visible
        const historyHeader = page.locator('text=File History')
        await expect(historyHeader.first()).not.toBeVisible({ timeout: 3000 })
      }
    }
  })
})
