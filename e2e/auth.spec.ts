import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/')
    // Should show some form of auth UI
    await expect(page.getByPlaceholder(/username/i).first()).toBeVisible()
    await expect(page.getByPlaceholder(/password/i).first()).toBeVisible()
  })

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder(/username/i).first().fill('nonexistent')
    await page.getByPlaceholder(/password/i).first().fill('wrongpassword')

    const loginBtn = page.getByRole('button', { name: /login|sign in/i })
    if (await loginBtn.isVisible()) {
      await loginBtn.click()
      // Should show an error message
      await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('successful login redirects to main app', async ({ page }) => {
    await page.goto('/')

    // First register a user (may already exist)
    await page.getByPlaceholder(/username/i).first().fill('e2euser')
    await page.getByPlaceholder(/password/i).first().fill('e2epassword123')

    const registerBtn = page.getByRole('button', { name: /register|sign up|create/i })
    const loginBtn = page.getByRole('button', { name: /login|sign in/i })

    if (await registerBtn.isVisible()) {
      await registerBtn.click()
    } else if (await loginBtn.isVisible()) {
      await loginBtn.click()
    }

    // Should navigate to the main app
    await page.waitForURL(/\/(chat|dashboard|autopilot)/, { timeout: 10_000 })
  })
})
