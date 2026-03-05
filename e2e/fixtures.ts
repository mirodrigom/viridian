import { test as base, expect, type Page } from '@playwright/test'

/**
 * Login helper — registers or logs in a test user.
 * Stores auth state so subsequent calls skip the login flow.
 */
// Unique test user per worker to avoid password conflicts from old test runs
const TEST_USER = `e2euser_${Date.now()}`
const TEST_PASS = 'testpassword123'

async function loginAsTestUser(page: Page) {
  // Register via API directly, then set token in localStorage before loading
  const baseURL = 'http://localhost:5174'

  const res = await page.request.post(`${baseURL}/api/auth/register`, {
    data: { username: TEST_USER, password: TEST_PASS },
  })

  let token: string
  if (res.ok()) {
    const data = await res.json()
    token = data.token
  } else {
    // User already exists — login instead
    const loginRes = await page.request.post(`${baseURL}/api/auth/login`, {
      data: { username: TEST_USER, password: TEST_PASS },
    })
    const data = await loginRes.json()
    token = data.token
  }

  // Set auth in localStorage before navigating
  await page.goto('/')
  await page.evaluate(({ token, username }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
  }, { token, username: TEST_USER })

  // Reload to pick up auth state
  await page.reload()
  await page.waitForLoadState('networkidle')
}

type TestFixtures = {
  authenticatedPage: Page
  diagramPage: Page
  graphPage: Page
  managementPage: Page
  autopilotPage: Page
}

export const test = base.extend<TestFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await use(page)
  },

  diagramPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await page.goto('/diagrams')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[data-testid="diagram-canvas"]', { timeout: 10_000 })
    await use(page)
  },

  graphPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await page.goto('/graph')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.vue-flow', { timeout: 10_000 })
    await use(page)
  },

  managementPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await page.goto('/management')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[data-testid="management-view"]', { timeout: 10_000 })
    await use(page)
  },

  autopilotPage: async ({ page }, use) => {
    await loginAsTestUser(page)
    await page.goto('/autopilot')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[data-testid="autopilot-view"]', { timeout: 10_000 })
    await use(page)
  },
})

export { expect }
