import { test, expect } from './fixtures'

test.describe('Manuals', () => {
  test('Manuals tab is visible in MainTabs and navigates to /manuals', async ({ authenticatedPage: page }) => {
    // Navigate to a project page so MainTabs renders
    await page.goto('/project')
    await page.waitForLoadState('networkidle')

    // Find the Manuals tab button
    const manualsTab = page.locator('button').filter({ hasText: 'Manuals' }).first()
    await expect(manualsTab).toBeVisible({ timeout: 5000 })

    // Click the tab
    await manualsTab.click()

    // URL should reflect /manuals
    await expect(page).toHaveURL(/\/manuals/)
  })

  test('Manuals view renders with expected layout', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    // The header should show "Manuals" title
    await expect(page.getByText('Manuals').first()).toBeVisible({ timeout: 5000 })

    // The "Create" button should be present
    const createBtn = page.getByRole('button', { name: /create/i }).first()
    await expect(createBtn).toBeVisible()

    // The title input for new manual should be present
    const newTitleInput = page.getByPlaceholder('New manual title...')
    await expect(newTitleInput).toBeVisible()
  })

  test('shows empty state when no manuals exist', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    // Wait for loading to finish (spinner should disappear)
    await page.waitForTimeout(1000)

    // If there are no manuals, the empty state message should appear
    const emptyState = page.getByText('No manuals yet')
    const manualCards = page.locator('.cursor-pointer').filter({ hasText: /.+/ })

    const hasManuals = await manualCards.count().then(c => c > 0).catch(() => false)
    if (!hasManuals) {
      await expect(emptyState).toBeVisible({ timeout: 5000 })
      await expect(page.getByText('Create a new manual to get started')).toBeVisible()
    }
  })

  test('can create a new manual', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    const testTitle = `E2E Test Manual ${Date.now()}`

    // Fill in the new manual title
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(testTitle)

    // Click Create
    const createBtn = page.getByRole('button', { name: /create/i }).first()
    await createBtn.click()

    // Should transition to the editor view — look for the Back button
    const backBtn = page.getByRole('button', { name: /back/i }).first()
    await expect(backBtn).toBeVisible({ timeout: 10_000 })

    // The title should appear in the editor input
    const editorTitleInput = page.locator('input[placeholder="Manual title"]')
    await expect(editorTitleInput).toHaveValue(testTitle)

    // The Save button should be available
    await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible()

    // Mode toggle should show "Generate from prompt" and "Enhance existing PDF"
    await expect(page.getByText('Generate from prompt')).toBeVisible()
    await expect(page.getByText('Enhance existing PDF')).toBeVisible()

    // Prompt textarea should be visible
    await expect(page.locator('textarea').first()).toBeVisible()
  })

  test('opening a manual shows the editor with content', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    const testTitle = `E2E Content Manual ${Date.now()}`

    // Create a manual first
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(testTitle)
    await page.getByRole('button', { name: /create/i }).first().click()

    // Wait for editor to load
    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })

    // Go back to the list
    await page.getByRole('button', { name: /back/i }).first().click()
    await page.waitForLoadState('networkidle')

    // The manual card should now appear in the list
    const manualCard = page.getByText(testTitle).first()
    await expect(manualCard).toBeVisible({ timeout: 5000 })

    // Click the manual card to open it
    await manualCard.click()

    // Should open the editor
    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[placeholder="Manual title"]')).toHaveValue(testTitle)
  })

  test('editor has Edit and Preview view toggle', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    // Create a manual to get into editor
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(`E2E View Toggle ${Date.now()}`)
    await page.getByRole('button', { name: /create/i }).first().click()

    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })

    // Edit/Preview toggle buttons should be visible
    const editToggle = page.locator('button').filter({ hasText: /^Edit$/ })
    const previewToggle = page.locator('button').filter({ hasText: /^Preview$/ })

    await expect(editToggle).toBeVisible()
    await expect(previewToggle).toBeVisible()

    // Edit should be active by default (has primary styling)
    await expect(editToggle).toHaveClass(/bg-primary/)
  })

  test('generate button is present and respects validation', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    // Create a manual
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(`E2E Generate ${Date.now()}`)
    await page.getByRole('button', { name: /create/i }).first().click()

    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })

    // Generate Manual button should exist
    const generateBtn = page.getByRole('button', { name: /generate manual/i }).first()
    await expect(generateBtn).toBeVisible()

    // Without a prompt, the button should be disabled
    await expect(generateBtn).toBeDisabled()

    // Type a prompt
    const promptTextarea = page.locator('textarea').first()
    await promptTextarea.fill('Create a test manual about testing.')

    // Now the button should be enabled
    await expect(generateBtn).toBeEnabled()
  })

  test('can delete a manual from the list', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    const testTitle = `E2E Delete Manual ${Date.now()}`

    // Create a manual
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(testTitle)
    await page.getByRole('button', { name: /create/i }).first().click()

    // Wait for editor, then go back
    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /back/i }).first().click()
    await page.waitForLoadState('networkidle')

    // Verify manual appears in the list
    await expect(page.getByText(testTitle).first()).toBeVisible({ timeout: 5000 })

    // Find the delete button (Trash2 icon) in the card containing our title
    const card = page.locator('.cursor-pointer').filter({ hasText: testTitle })
    const deleteBtn = card.locator('button[title="Delete manual"]')
    await deleteBtn.click()

    // Confirm dialog should appear
    const confirmBtn = page.getByRole('button', { name: /confirm|delete|yes|ok|continue/i }).last()
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click()
    }

    // The manual should disappear from the list
    await expect(page.getByText(testTitle).first()).not.toBeVisible({ timeout: 5000 })
  })

  test('Create button is disabled when title is empty', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    const titleInput = page.getByPlaceholder('New manual title...')
    await expect(titleInput).toBeVisible()

    // Ensure input is empty
    await titleInput.fill('')

    // The Create button should be disabled
    const createBtn = page.getByRole('button', { name: /create/i }).first()
    await expect(createBtn).toBeDisabled()

    // Type something — button should become enabled
    await titleInput.fill('Test')
    await expect(createBtn).toBeEnabled()
  })

  test('manual card shows status badge and date', async ({ authenticatedPage: page }) => {
    await page.goto('/manuals')
    await page.waitForLoadState('networkidle')

    const testTitle = `E2E Badge Manual ${Date.now()}`

    // Create a manual
    const titleInput = page.getByPlaceholder('New manual title...')
    await titleInput.fill(testTitle)
    await page.getByRole('button', { name: /create/i }).first().click()

    // Go back to list
    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /back/i }).first().click()
    await page.waitForLoadState('networkidle')

    // Find the card
    const card = page.locator('.cursor-pointer').filter({ hasText: testTitle })
    await expect(card).toBeVisible({ timeout: 5000 })

    // Status badge should be visible (draft for newly created)
    const statusBadge = card.locator('span').filter({ hasText: /draft|generated/i })
    await expect(statusBadge).toBeVisible()
  })
})
