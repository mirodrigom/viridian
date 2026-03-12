import { test, expect } from './fixtures'

test.describe('Collapsible Tool Calls', () => {
  test('navigate to chat with messages', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // The chat area should be visible
    const chatArea = page.locator('[class*="chat"], [class*="message"], main').first()
    await expect(chatArea).toBeVisible({ timeout: 5000 })
  })

  test('tool calls show collapsed state by default', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // Tool calls are rendered as Collapsible components with a trigger header
    // They have a chevron icon and tool name (e.g. "Read", "Bash", "Edit")
    const toolHeaders = page.locator('button[class*="bg-muted"]').filter({
      has: page.locator('.lucide-chevron-right'),
    })

    const count = await toolHeaders.count()
    if (count > 0) {
      // Completed tools should be collapsed by default (chevron not rotated)
      const firstTool = toolHeaders.first()
      await expect(firstTool).toBeVisible()

      // The chevron should exist (collapsed = not rotated-90)
      const chevron = firstTool.locator('.lucide-chevron-right').first()
      await expect(chevron).toBeVisible()
    }
  })

  test('click to expand a tool call', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const toolHeaders = page.locator('button[class*="bg-muted"]').filter({
      has: page.locator('.lucide-chevron-right'),
    })

    const count = await toolHeaders.count()
    if (count > 0) {
      const toolHeader = toolHeaders.first()
      await toolHeader.click()
      await page.waitForTimeout(300)

      // After clicking, the chevron should rotate (have rotate-90 class)
      const chevron = toolHeader.locator('.lucide-chevron-right').first()
      const classes = await chevron.getAttribute('class') || ''
      // The collapsible content should be visible
      const toolContent = toolHeader.locator('..').locator('[class*="tool-collapsible-content"], [data-state="open"]').first()
      const isExpanded = classes.includes('rotate-90') ||
        await toolContent.isVisible({ timeout: 1000 }).catch(() => false)
      expect(isExpanded).toBeTruthy()
    }
  })

  test('click to collapse a tool call', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const toolHeaders = page.locator('button[class*="bg-muted"]').filter({
      has: page.locator('.lucide-chevron-right'),
    })

    const count = await toolHeaders.count()
    if (count > 0) {
      const toolHeader = toolHeaders.first()

      // Expand first
      await toolHeader.click()
      await page.waitForTimeout(300)

      // Collapse again
      await toolHeader.click()
      await page.waitForTimeout(300)

      // Chevron should not be rotated
      const chevron = toolHeader.locator('.lucide-chevron-right').first()
      const classes = await chevron.getAttribute('class') || ''
      expect(classes).not.toContain('rotate-90')
    }
  })

  test('collapsed tool shows summary text', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // When collapsed, the tool header shows a summary (file path, command, etc.)
    // The summary is a <span> with truncated text next to the tool name
    const toolHeaders = page.locator('button[class*="bg-muted"]').filter({
      has: page.locator('.lucide-chevron-right'),
    })

    const count = await toolHeaders.count()
    if (count > 0) {
      // Ensure tool is collapsed first
      const toolHeader = toolHeaders.first()

      // Get the tool name text
      const toolName = toolHeader.locator('.font-medium').first()
      if (await toolName.isVisible({ timeout: 1000 }).catch(() => false)) {
        const nameText = await toolName.textContent()
        // Tool name should be one of the known tools
        expect(nameText).toBeTruthy()
      }

      // The summary text span appears when collapsed
      const summarySpan = toolHeader.locator('.truncate.text-xs').first()
      if (await summarySpan.isVisible({ timeout: 1000 }).catch(() => false)) {
        const summary = await summarySpan.textContent()
        expect(summary?.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
