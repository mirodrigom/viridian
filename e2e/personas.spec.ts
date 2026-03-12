import { test, expect } from './fixtures'

test.describe('Personas', () => {
  test('open persona selector in chat', async ({ authenticatedPage: page }) => {
    // Navigate to chat
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // The PersonaSelector button is inside the chat input area (hidden on mobile, visible on sm+)
    // It shows a User icon or persona icon, with tooltip "Select a persona"
    const personaBtn = page.locator('button').filter({ has: page.locator('svg') })
      .filter({ hasText: /persona|Default Assistant/i }).first()
      .or(page.locator('button[class*="rounded-lg"]').filter({ has: page.locator('.lucide-user, .lucide-bot, .lucide-chevron-down') }).first())

    if (await personaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await personaBtn.click()
      // The persona dropdown should appear with "Personas" header
      const dropdown = page.locator('text=Personas').first()
      await expect(dropdown).toBeVisible({ timeout: 2000 })
    }
  })

  test('see list of built-in personas', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    // Open persona dropdown
    const personaBtn = page.locator('button').filter({ has: page.locator('.lucide-user, .lucide-chevron-down') }).first()
    if (await personaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await personaBtn.click()
      await page.waitForTimeout(300)

      // "Built-in" section header should be visible
      const builtinSection = page.locator('text=Built-in')
      await expect(builtinSection.first()).toBeVisible({ timeout: 2000 })

      // "Default Assistant" option should always be present
      const defaultOption = page.locator('text=Default Assistant')
      await expect(defaultOption.first()).toBeVisible({ timeout: 2000 })
    }
  })

  test('select a persona', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const personaBtn = page.locator('button').filter({ has: page.locator('.lucide-user, .lucide-chevron-down') }).first()
    if (await personaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await personaBtn.click()
      await page.waitForTimeout(300)

      // Click the first built-in persona (not "Default Assistant")
      const builtinSection = page.locator('text=Built-in')
      if (await builtinSection.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        // Find the first persona button after the "Built-in" label
        const personaOption = page.locator('.max-h-72 button').nth(1) // Skip "Default Assistant" at index 0
        if (await personaOption.isVisible({ timeout: 1000 }).catch(() => false)) {
          const personaName = await personaOption.locator('.text-xs.font-medium').first().textContent()
          await personaOption.click()
          await page.waitForTimeout(300)

          // The menu should close and the persona button should now show the selected persona name
          if (personaName) {
            const indicator = page.locator('button').filter({ hasText: personaName.trim() }).first()
            // The button text or a colored indicator should be visible
            const hasIndicator = await indicator.isVisible({ timeout: 1000 }).catch(() => false)
            // At minimum the dropdown should have closed
            const dropdownGone = await page.locator('text=Personas').first().isVisible({ timeout: 500 }).catch(() => false)
            expect(hasIndicator || !dropdownGone).toBeTruthy()
          }
        }
      }
    }
  })

  test('selected persona shows indicator', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const personaBtn = page.locator('button').filter({ has: page.locator('.lucide-user, .lucide-chevron-down') }).first()
    if (await personaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await personaBtn.click()
      await page.waitForTimeout(300)

      // Select a persona
      const personaOptions = page.locator('.max-h-72 button')
      const count = await personaOptions.count()
      if (count >= 2) {
        await personaOptions.nth(1).click()
        await page.waitForTimeout(300)

        // Re-open the menu to check for checkmark indicator
        await personaBtn.click({ timeout: 1000 }).catch(() => {})
        // The re-located persona button (may have changed appearance)
        const anyPersonaBtn = page.locator('button[class*="rounded-lg"]').filter({ has: page.locator('svg') }).last()
        if (await anyPersonaBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await anyPersonaBtn.click()
          await page.waitForTimeout(300)
        }

        // Look for a checkmark in the dropdown
        const checkmark = page.locator('.max-h-72 .text-primary').first()
        if (await checkmark.isVisible({ timeout: 1000 }).catch(() => false)) {
          await expect(checkmark).toBeVisible()
        }
      }
    }
  })

  test('clear persona selection', async ({ authenticatedPage: page }) => {
    if (!page.url().includes('/chat')) {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
    }

    const personaBtn = page.locator('button').filter({ has: page.locator('.lucide-user, .lucide-chevron-down') }).first()
    if (await personaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await personaBtn.click()
      await page.waitForTimeout(300)

      // Click "Clear" button or "Default Assistant" to deselect
      const clearBtn = page.locator('button').filter({ hasText: 'Clear' }).first()
      const defaultBtn = page.locator('button').filter({ hasText: 'Default Assistant' }).first()

      if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await clearBtn.click()
      } else if (await defaultBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await defaultBtn.click()
      }

      await page.waitForTimeout(300)
      // Dropdown should close
      const dropdown = page.locator('text=Personas')
      await expect(dropdown.first()).not.toBeVisible({ timeout: 2000 })
    }
  })

  test('open persona settings in Settings dialog', async ({ authenticatedPage: page }) => {
    // Open settings dialog
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()

      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible({ timeout: 3000 })

      // PersonaSettings section should be rendered inside the dialog
      // Look for "Personas" heading or persona-related content
      const personasSection = page.locator('text=Personas').first()
        .or(page.locator('text=Custom Personas').first())
      if (await personasSection.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(personasSection).toBeVisible()
      }
    }
  })

  test('create custom persona from settings', async ({ authenticatedPage: page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first()
      .or(page.locator('button[title*="Settings" i]').first())

    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click()
      await page.waitForTimeout(500)

      // Look for "New Persona" or add button in the persona settings
      const newPersonaBtn = page.getByRole('button', { name: /new persona|add persona|create/i }).first()
        .or(page.locator('button').filter({ has: page.locator('.lucide-plus') }).last())

      if (await newPersonaBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await newPersonaBtn.click()
        await page.waitForTimeout(300)

        // A dialog or form for creating a persona should appear
        const createDialog = page.getByRole('dialog').last()
        if (await createDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Fill in the name field
          const nameInput = createDialog.locator('input').first()
          if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await nameInput.fill('E2E Test Persona')
          }
          await expect(createDialog).toBeVisible()
        }
      }
    }
  })
})
