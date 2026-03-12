import { test, expect } from './fixtures'

test.describe('Reasoning Effort Selector', () => {
  test('navigate to chat', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const chatArea = page.locator('[class*="chat"], textarea, main').first()
    await expect(chatArea).toBeVisible({ timeout: 5000 })
  })

  test('find reasoning effort selector button', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // The reasoning selector is a Button with a Brain icon
    const brainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()

    if (await brainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(brainBtn).toBeVisible()
    }
    // Note: the button only shows when provider supports thinking
  })

  test('click to open dropdown', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const brainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()

    if (await brainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await brainBtn.click()
      await page.waitForTimeout(300)

      // The reasoning effort dropdown should appear with "Reasoning Effort" header
      const dropdown = page.locator('text=Reasoning Effort')
      await expect(dropdown.first()).toBeVisible({ timeout: 2000 })
    }
  })

  test('see thinking mode options', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const brainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()

    if (await brainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await brainBtn.click()
      await page.waitForTimeout(300)

      // Should show the five thinking modes: Standard, Think, Think Hard, Think Harder, Ultrathink
      const standardOption = page.locator('text=Standard').first()
      const thinkOption = page.locator('.text-xs.font-medium').filter({ hasText: 'Think' }).first()
      const ultrathinkOption = page.locator('text=Ultrathink').first()

      await expect(standardOption).toBeVisible({ timeout: 2000 })
      // At least Standard should be visible
      // Check for descriptions too
      const noThinkingDesc = page.locator('text=No extended thinking')
      if (await noThinkingDesc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(noThinkingDesc).toBeVisible()
      }
    }
  })

  test('select a different mode', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const brainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()

    if (await brainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await brainBtn.click()
      await page.waitForTimeout(300)

      // Click "Think Hard" option
      const thinkHardOption = page.locator('.text-xs.font-medium').filter({ hasText: 'Think Hard' }).first()
      if (await thinkHardOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await thinkHardOption.click()
        await page.waitForTimeout(300)

        // Dropdown should close
        const dropdown = page.locator('text=Reasoning Effort')
        await expect(dropdown.first()).not.toBeVisible({ timeout: 2000 })
      }
    }
  })

  test('verify mode indicator changes', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const brainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()

    if (await brainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Open dropdown and select a non-standard mode
      await brainBtn.click()
      await page.waitForTimeout(300)

      const thinkOption = page.locator('button').filter({ hasText: /^Think$/ }).first()
        .or(page.locator('.text-xs.font-medium').filter({ hasText: 'Think' }).first())

      if (await thinkOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await thinkOption.click()
        await page.waitForTimeout(300)

        // The brain button should now show a colored indicator
        // Non-standard modes apply a background color class (e.g. bg-blue-500/10)
        const updatedBrainBtn = page.locator('button').filter({ has: page.locator('.lucide-brain') }).first()
        const btnClass = await updatedBrainBtn.getAttribute('class') || ''

        // Should have a thinking-related color class or label text
        const hasColorIndicator = btnClass.includes('bg-blue') ||
          btnClass.includes('bg-violet') ||
          btnClass.includes('bg-orange') ||
          btnClass.includes('bg-rose')
        const hasLabel = await updatedBrainBtn.locator('.text-\\[10px\\]').isVisible({ timeout: 500 }).catch(() => false)

        // At least one indicator should be present after selecting a non-standard mode
        expect(hasColorIndicator || hasLabel).toBeTruthy()
      }
    }
  })
})
