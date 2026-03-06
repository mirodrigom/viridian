/**
 * Screenshot capture script for README
 * Run with: npx playwright test e2e/screenshots.ts --project=chromium
 */
import { test } from '@playwright/test'
import path from 'path'

const BASE = 'http://localhost:5174'
const OUT = path.resolve('docs/public/screenshots')
const USERNAME = 'screenshot_user'
const PASSWORD = 'screenshot123'

async function login(page: any) {
  // Try register, fall back to login
  const reg = await page.request.post(`${BASE}/api/auth/register`, {
    data: { username: USERNAME, password: PASSWORD },
  })
  let token: string
  if (reg.ok()) {
    token = (await reg.json()).token
  } else {
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { username: USERNAME, password: PASSWORD },
    })
    token = (await login.json()).token
  }
  await page.goto(BASE)
  await page.evaluate(({ token, username }: { token: string; username: string }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
  }, { token, username: USERNAME })
  await page.reload()
  await page.waitForLoadState('networkidle')
}

const VIEWPORT = { width: 1440, height: 900 }

test('capture all screenshots', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await login(page)

  // Dashboard / project list — dismiss welcome modal if present
  await page.goto(`${BASE}/`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  const skipBtn = page.locator('button:has-text("Skip")').first()
  if (await skipBtn.isVisible()) await skipBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/dashboard.png`, fullPage: false })

  // Chat
  await page.goto(`${BASE}/project`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/chat.png`, fullPage: false })

  // Editor
  await page.goto(`${BASE}/editor`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/editor.png`, fullPage: false })

  // Git
  await page.goto(`${BASE}/git`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/git.png`, fullPage: false })

  // Terminal
  await page.goto(`${BASE}/project`)
  await page.waitForLoadState('networkidle')
  // Click terminal tab
  const termTab = page.locator('[data-tab="terminal"], button:has-text("Terminal")').first()
  if (await termTab.isVisible()) {
    await termTab.click()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: `${OUT}/terminal.png`, fullPage: false })

  // Tasks
  await page.goto(`${BASE}/tasks`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/tasks.png`, fullPage: false })

  // Graph Runner
  await page.goto(`${BASE}/graph`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/graph.png`, fullPage: false })

  // Autopilot
  await page.goto(`${BASE}/autopilot`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/autopilot.png`, fullPage: false })

  // Management
  await page.goto(`${BASE}/management`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/management.png`, fullPage: false })
})
