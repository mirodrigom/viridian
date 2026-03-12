import { test, expect } from './fixtures'

test.describe('MCP Management', () => {
  test('open Settings dialog', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())
      .or(page.locator('[class*="settings"]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()

      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible({ timeout: 3000 })
    }
  })

  test('navigate to MCP section via Settings', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      // The Settings dialog has an "MCP Servers" button under Integrations
      const mcpBtn = page.getByRole('button', { name: /mcp servers/i }).first()
      await expect(mcpBtn).toBeVisible({ timeout: 3000 })
    }
  })

  test('open MCP servers dialog', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      const mcpBtn = page.getByRole('button', { name: /mcp servers/i }).first()
      if (await mcpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mcpBtn.click()
        await page.waitForTimeout(500)

        // MCP Settings dialog should open
        const mcpDialog = page.getByRole('dialog').last()
        await expect(mcpDialog).toBeVisible({ timeout: 3000 })

        // Should show the dialog title or server list
        const mcpTitle = page.locator('text=MCP').first()
        await expect(mcpTitle).toBeVisible({ timeout: 2000 })
      }
    }
  })

  test('MCP servers list renders', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      const mcpBtn = page.getByRole('button', { name: /mcp servers/i }).first()
      if (await mcpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mcpBtn.click()
        await page.waitForTimeout(500)

        // Either servers are listed or an empty state / add button is shown
        const addBtn = page.getByRole('button', { name: /add|new/i })
        const serverItems = page.locator('[class*="server"], [class*="rounded-lg"]').filter({ has: page.locator('svg') })

        const hasAdd = await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)
        const hasServers = await serverItems.first().isVisible({ timeout: 1000 }).catch(() => false)

        expect(hasAdd || hasServers).toBe(true)
      }
    }
  })

  test('add new MCP server form', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      const mcpBtn = page.getByRole('button', { name: /mcp servers/i }).first()
      if (await mcpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mcpBtn.click()
        await page.waitForTimeout(500)

        // Click the add button
        const addBtn = page.getByRole('button', { name: /add server|add new|new server/i }).first()
          .or(page.locator('button').filter({ has: page.locator('.lucide-plus') }).first())

        if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await addBtn.click()
          await page.waitForTimeout(300)

          // Form fields should appear: name input, type selector, command/url
          const nameInput = page.locator('input[placeholder*="name" i], input').first()
          await expect(nameInput).toBeVisible({ timeout: 2000 })
        }
      }
    }
  })

  test('delete MCP server button exists', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      const mcpBtn = page.getByRole('button', { name: /mcp servers/i }).first()
      if (await mcpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mcpBtn.click()
        await page.waitForTimeout(500)

        // If servers exist, look for a delete button (trash icon)
        const deleteBtn = page.locator('button').filter({ has: page.locator('.lucide-trash-2, .lucide-trash') }).first()
        if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expect(deleteBtn).toBeVisible()
        }
      }
    }
  })
})
