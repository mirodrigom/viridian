import { test, expect } from './fixtures'

test.describe('Git Operations', () => {
  /**
   * Helper: navigate to the Git tab and wait for it to render.
   * Works by clicking the Git tab button in MainTabs or navigating directly.
   */
  async function navigateToGit(page: import('@playwright/test').Page) {
    await page.goto('/git')
    await page.waitForLoadState('networkidle')
    // Wait for the Source Control header that GitView renders
    await page.locator('text=Source Control').first().waitFor({ timeout: 10_000 })
  }

  // ── 1. Navigation — Git tab appears in MainTabs ──────────────────────

  test('Git tab appears in MainTabs and navigates to git view', async ({ authenticatedPage: page }) => {
    // Start on the project page so MainTabs renders
    await page.goto('/project')
    await page.waitForLoadState('networkidle')

    // The Git tab button should be visible (contains GitBranch icon + "Git" label)
    const gitTab = page.locator('button').filter({ hasText: 'Git' }).first()
    await expect(gitTab).toBeVisible({ timeout: 10_000 })

    // Click the Git tab
    await gitTab.click()

    // The Source Control header from GitView should appear
    await expect(page.locator('text=Source Control').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── 2. Git Status — Status panel renders with file sections ──────────

  test('Git status panel renders showing file change sections', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // GitStatus component renders inside GitView. It should show one of:
    // - "Staged Changes" heading (if staged files exist)
    // - "Changes" heading (if modified/untracked files exist)
    // - "No changes" text (if working tree is clean)
    const stagedSection = page.locator('text=Staged Changes')
    const changesSection = page.locator('h4:has-text("Changes")')
    const noChanges = page.locator('text=No changes')

    // At least one of these states should be visible
    const anyVisible = await stagedSection.isVisible()
      || await changesSection.isVisible()
      || await noChanges.isVisible()

    expect(anyVisible).toBe(true)
  })

  // ── 3. Branch Display — Current branch name is shown ─────────────────

  test('current branch name is displayed', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The branch badge is rendered next to "Source Control" with a GitBranch icon
    // It uses a Badge component with the branch name text
    const branchBadge = page.locator('.lucide-git-branch').first()
    await expect(branchBadge).toBeVisible({ timeout: 10_000 })

    // The badge's parent should contain a branch name (non-empty text)
    const badgeContainer = branchBadge.locator('..')
    const branchText = await badgeContainer.textContent()
    expect(branchText?.trim().length).toBeGreaterThan(0)
  })

  // ── 4. File Diff View — Diff panel area is present ───────────────────

  test('diff viewer area is present with Working Changes and Staged Changes toggle', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The right panel has "Working Changes" and "Staged Changes" toggle buttons
    const workingBtn = page.locator('button').filter({ hasText: 'Working Changes' }).first()
    const stagedBtn = page.locator('button').filter({ hasText: 'Staged Changes' }).first()

    await expect(workingBtn).toBeVisible({ timeout: 10_000 })
    await expect(stagedBtn).toBeVisible({ timeout: 10_000 })
  })

  // ── 5. Commit Form — Commit message input and commit button ──────────

  test('commit message input and commit button are present', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // Commit message textarea with placeholder "Commit message..."
    const commitInput = page.locator('textarea[placeholder*="Commit message"]').first()
    await expect(commitInput).toBeVisible({ timeout: 10_000 })

    // Commit button
    const commitBtn = page.locator('button').filter({ hasText: 'Commit' }).first()
    await expect(commitBtn).toBeVisible({ timeout: 5_000 })

    // Typing in the commit message input should work
    await commitInput.fill('Test commit message')
    await expect(commitInput).toHaveValue('Test commit message')
  })

  // ── 6. Stage/Unstage — Stage and unstage buttons are visible ─────────

  test('stage and unstage buttons are visible for changed files', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // If there are unstaged changes, "Stage All" button should be visible
    const stageAllBtn = page.locator('button').filter({ hasText: 'Stage All' }).first()
    // If there are staged changes, "Unstage All" button should be visible
    const unstageAllBtn = page.locator('button').filter({ hasText: 'Unstage All' }).first()
    // If no changes at all, "No changes" text shows
    const noChanges = page.locator('text=No changes')

    const hasStageAll = await stageAllBtn.isVisible()
    const hasUnstageAll = await unstageAllBtn.isVisible()
    const hasNoChanges = await noChanges.isVisible()

    // At least one state must be true — either there are changes (with buttons) or no changes
    expect(hasStageAll || hasUnstageAll || hasNoChanges).toBe(true)
  })

  // ── 7. Branch Switching — Branch selector/dropdown is accessible ─────

  test('branches collapsible section is accessible and can be expanded', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The "Branches" collapsible trigger should be visible
    const branchesTrigger = page.locator('button, [role="button"]').filter({ hasText: 'Branches' }).first()
    await expect(branchesTrigger).toBeVisible({ timeout: 10_000 })

    // Click to expand the Branches section
    await branchesTrigger.click()

    // After expanding, the "New branch name..." input should appear
    const newBranchInput = page.locator('input[placeholder*="New branch name"]').first()
    await expect(newBranchInput).toBeVisible({ timeout: 5_000 })

    // Branch list items should appear (each with a GitBranch icon)
    // At least the current branch should be listed
    const branchItems = page.locator('.lucide-git-branch')
    const count = await branchItems.count()
    // Header + trigger icons + at least 1 branch in the list
    expect(count).toBeGreaterThanOrEqual(1)
  })

  // ── 8. Commit History — History section shows recent commits ─────────

  test('commit history section is accessible and shows commits', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The "History" collapsible trigger should be visible
    const historyTrigger = page.locator('button, [role="button"]').filter({ hasText: 'History' }).first()
    await expect(historyTrigger).toBeVisible({ timeout: 10_000 })

    // Click to expand the History section
    await historyTrigger.click()

    // After expanding, either commit entries or "No commits yet" should appear
    const commitEntry = page.locator('code').first() // short hash rendered in <code>
    const noCommits = page.locator('text=No commits yet')

    // Wait for one of the two states
    await expect(commitEntry.or(noCommits)).toBeVisible({ timeout: 5_000 })
  })

  // ── 9. Refresh — Refresh button triggers status reload ───────────────

  test('refresh button is present and clickable', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The refresh button has a RefreshCw icon inside a ghost button
    const refreshBtn = page.locator('.lucide-refresh-cw').first().locator('..')
    await expect(refreshBtn).toBeVisible({ timeout: 10_000 })

    // Click the refresh button — should not throw
    await refreshBtn.click()

    // After clicking, the icon may briefly spin (animate-spin class).
    // Just verify the page is still functional and Source Control is visible.
    await expect(page.locator('text=Source Control').first()).toBeVisible({ timeout: 5_000 })
  })

  // ── 10. AI Commit Message — Button to generate AI commit message ─────

  test('AI commit message generation button exists', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    // The AI generate button has a Sparkles icon (lucide-sparkles) and is an outline button
    const aiBtn = page.locator('.lucide-sparkles').first().locator('..')
    await expect(aiBtn).toBeVisible({ timeout: 10_000 })

    // The button should be near the commit area
    // Verify it is a button element
    const tagName = await aiBtn.evaluate(el => el.tagName.toLowerCase())
    expect(tagName).toBe('button')
  })

  // ── Bonus: Remote operations buttons ─────────────────────────────────

  test('remote operation buttons (Fetch, Pull, Push) are visible', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    const fetchBtn = page.locator('button').filter({ hasText: 'Fetch' }).first()
    const pullBtn = page.locator('button').filter({ hasText: 'Pull' }).first()
    const pushBtn = page.locator('button').filter({ hasText: 'Push' }).first()

    await expect(fetchBtn).toBeVisible({ timeout: 10_000 })
    await expect(pullBtn).toBeVisible({ timeout: 5_000 })
    await expect(pushBtn).toBeVisible({ timeout: 5_000 })
  })

  // ── Bonus: Diff toggle between Working and Staged ────────────────────

  test('clicking Working Changes and Staged Changes toggles diff mode', async ({ authenticatedPage: page }) => {
    await navigateToGit(page)

    const workingBtn = page.locator('button').filter({ hasText: 'Working Changes' }).first()
    const stagedBtn = page.locator('button').filter({ hasText: 'Staged Changes' }).first()

    // Click "Staged Changes"
    await stagedBtn.click()
    // The Staged button should now have the active indicator (bg-muted class)
    await expect(stagedBtn).toHaveClass(/bg-muted/, { timeout: 3_000 })

    // Click "Working Changes"
    await workingBtn.click()
    await expect(workingBtn).toHaveClass(/bg-muted/, { timeout: 3_000 })
  })

  // ── Bonus: Git badge in tab bar shows change count ───────────────────

  test('Git tab badge shows change count when there are changes', async ({ authenticatedPage: page }) => {
    await page.goto('/project')
    await page.waitForLoadState('networkidle')

    // Find the Git tab button
    const gitTab = page.locator('button').filter({ hasText: 'Git' }).first()
    await expect(gitTab).toBeVisible({ timeout: 10_000 })

    // If there are changes, a badge with a number should appear within the Git tab button
    // The badge is a span with rounded-full class containing a number
    const badge = gitTab.locator('span.rounded-full')
    if (await badge.isVisible()) {
      const badgeText = await badge.textContent()
      const count = parseInt(badgeText?.trim() || '0', 10)
      expect(count).toBeGreaterThan(0)
    }
    // If no badge, it just means no changes — that is also valid
  })
})
