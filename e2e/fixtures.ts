import { test as base, expect, type Page } from '@playwright/test'

/**
 * Login helper — registers or logs in a test user.
 * Stores auth state so subsequent calls skip the login flow.
 */
async function loginAsTestUser(page: Page) {
  await page.goto('/')

  // Wait for the auth page to load
  await page.waitForLoadState('networkidle')

  // Check if we're already on the dashboard (already authenticated)
  if (page.url().includes('/chat') || page.url().includes('/dashboard')) {
    return
  }

  // Try to register first; if user exists, login
  const usernameInput = page.getByPlaceholder(/username/i).first()
  const passwordInput = page.getByPlaceholder(/password/i).first()

  await usernameInput.fill('testuser')
  await passwordInput.fill('testpassword123')

  // Look for a register or login button
  const registerBtn = page.getByRole('button', { name: /register|sign up|create/i })
  const loginBtn = page.getByRole('button', { name: /login|sign in/i })

  if (await registerBtn.isVisible()) {
    await registerBtn.click()
  } else if (await loginBtn.isVisible()) {
    await loginBtn.click()
  }

  // Wait for navigation away from auth page
  await page.waitForURL(/\/(chat|dashboard|autopilot)/, { timeout: 10_000 })
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await use(page)
  },
})

export { expect }
