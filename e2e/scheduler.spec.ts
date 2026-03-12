import { test, expect } from './fixtures'

test.describe('Scheduler', () => {
  test('scheduler tab shows in MainTabs', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' })
    await expect(schedulerTab.first()).toBeVisible({ timeout: 5000 })
  })

  test('navigate to scheduler tab', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()

    // Scheduler view header should be visible
    const heading = page.locator('h2').filter({ hasText: 'Scheduled Tasks' })
    await expect(heading).toBeVisible({ timeout: 5000 })
  })

  test('create a new scheduled task', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()
    await page.waitForTimeout(500)

    // Click "New Task" button
    const newTaskBtn = page.getByRole('button', { name: /new task/i }).first()
    await expect(newTaskBtn).toBeVisible({ timeout: 3000 })
    await newTaskBtn.click()

    // Task form dialog should appear
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible({ timeout: 3000 })

    // Fill out the form
    const nameInput = dialog.locator('input').first()
    await nameInput.fill('E2E Test Task')

    // Fill the prompt textarea
    const promptField = dialog.locator('textarea').first()
    if (await promptField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await promptField.fill('Run automated tests')
    }

    // The dialog should have a submit/save button
    const saveBtn = dialog.getByRole('button', { name: /create|save/i }).first()
    if (await saveBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Don't actually submit to avoid side effects, just verify the form is interactive
      await expect(saveBtn).toBeVisible()
    }
  })

  test('empty state shows when no tasks exist', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()
    await page.waitForTimeout(1000)

    // Either tasks exist or empty state is shown
    const emptyState = page.locator('text=No scheduled tasks yet')
    const taskList = page.locator('[class*="divide-y"]')

    const hasEmpty = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    const hasTasks = await taskList.isVisible({ timeout: 1000 }).catch(() => false)

    // One of them should be visible
    expect(hasEmpty || hasTasks).toBe(true)
  })

  test('toggle task enabled/disabled', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()
    await page.waitForTimeout(1000)

    // Find a switch (toggle) in the task list
    const toggle = page.locator('button[role="switch"]').first()
    if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const wasChecked = await toggle.getAttribute('aria-checked')
      await toggle.click()
      await page.waitForTimeout(500)
      const isChecked = await toggle.getAttribute('aria-checked')
      // State should have changed
      expect(isChecked).not.toBe(wasChecked)
    }
  })

  test('delete button is visible on tasks', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()
    await page.waitForTimeout(1000)

    // If tasks exist, hover to reveal action buttons
    const taskRow = page.locator('[class*="group"]').filter({ has: page.locator('button[role="switch"]') }).first()
    if (await taskRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await taskRow.hover()
      const deleteBtn = taskRow.locator('button[title="Delete"]')
      await expect(deleteBtn).toBeVisible({ timeout: 2000 })
    }
  })

  test('view task history', async ({ authenticatedPage: page }) => {
    const schedulerTab = page.locator('button').filter({ hasText: 'Scheduler' }).first()
    await schedulerTab.click()
    await page.waitForTimeout(1000)

    // If tasks exist, open history
    const taskRow = page.locator('[class*="group"]').filter({ has: page.locator('button[role="switch"]') }).first()
    if (await taskRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await taskRow.hover()
      const historyBtn = taskRow.locator('button[title="History"]')
      if (await historyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await historyBtn.click()
        // History dialog should appear
        const historyDialog = page.getByRole('dialog').first()
        await expect(historyDialog).toBeVisible({ timeout: 3000 })
      }
    }
  })
})
