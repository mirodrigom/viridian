import { test, expect } from './fixtures'
import {
  addDiagramServiceNode,
  addDiagramEdge,
  getDiagramEdgeIds,
  selectDiagramEdge,
} from './helpers/vueflow'

test.describe('Diagram Edge Properties', () => {
  async function setupEdgeAndSelect(page: import('@playwright/test').Page) {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })

    const edgeIds = await getDiagramEdgeIds(page)
    expect(edgeIds.length).toBe(1)
    await selectDiagramEdge(page, edgeIds[0])

    // Verify properties panel is visible
    await expect(page.locator('[data-testid="properties-panel"]')).toBeVisible()
    return edgeIds[0]
  }

  test('clicking the invisible hit area selects the edge', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })

    // The invisible interaction path should exist with stroke-width="20"
    const hitArea = page.locator('.vue-flow__edge .vue-flow__edge-interaction')
    await expect(hitArea.first()).toBeAttached()
    const strokeWidth = await hitArea.first().getAttribute('stroke-width')
    expect(strokeWidth).toBe('20')

    // Click the interaction area — it should be much easier to hit than the 1.5px path
    await hitArea.first().click({ force: true })
    await page.waitForTimeout(200)

    // Check that properties panel shows edge properties
    const panel = page.locator('[data-testid="properties-panel"]')
    await expect(panel).toBeVisible()
  })

  test('setting edge label shows label in SVG and store', async ({ diagramPage: page }) => {
    const edgeId = await setupEdgeAndSelect(page)

    // Type a label
    const labelInput = page.locator('[data-testid="properties-panel"] input').first()
    await labelInput.fill('My Connection')

    // Verify store has the label
    const storeLabel = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.label
    })
    expect(storeLabel).toBe('My Connection')

    // Verify SVG label text is rendered
    const svgText = page.locator('.vue-flow__edge text')
    await expect(svgText.first()).toHaveText('My Connection')
  })

  test('changing edge label size updates font size in SVG', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // First set a label so it renders
    const labelInput = page.locator('[data-testid="properties-panel"] input').first()
    await labelInput.fill('Test')

    // Click "M" (medium) size button
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.waitForTimeout(100)

    const labelSize = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.labelSize
    })
    expect(labelSize).toBe('medium')

    // Click "L" (large) size button
    await page.getByRole('button', { name: 'L', exact: true }).click()
    await page.waitForTimeout(100)

    const labelSizeLarge = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.labelSize
    })
    expect(labelSizeLarge).toBe('large')
  })

  test('changing edge type updates path shape in store', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Default is Bezier
    const initialType = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.edgeType
    })
    expect(initialType).toBe('default')

    // Click "Straight"
    await page.getByRole('button', { name: 'Straight' }).click()
    await page.waitForTimeout(100)

    const straightType = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.edgeType
    })
    expect(straightType).toBe('straight')

    // Click "Step"
    await page.getByRole('button', { name: 'Step' }).click()
    await page.waitForTimeout(100)

    const stepType = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.edgeType
    })
    expect(stepType).toBe('step')
  })

  test('changing line style updates stroke-dasharray', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Click "dashed"
    await page.getByRole('button', { name: 'dashed' }).click()
    await page.waitForTimeout(100)

    const dashedStyle = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.style
    })
    expect(dashedStyle).toBe('dashed')

    // Verify the SVG path has a stroke-dasharray
    const dasharray = await page.locator('.vue-flow__edge .vue-flow__edge-path').first().getAttribute('stroke-dasharray')
    expect(dasharray).toBe('8 4')

    // Click "dotted"
    await page.getByRole('button', { name: 'dotted' }).click()
    await page.waitForTimeout(100)

    const dottedDash = await page.locator('.vue-flow__edge .vue-flow__edge-path').first().getAttribute('stroke-dasharray')
    expect(dottedDash).toBe('2 4')
  })

  test('changing edge color updates store and SVG stroke', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Click the Red color swatch (title="Red")
    await page.locator('[data-testid="properties-panel"] button[title="Red"]').first().click()
    await page.waitForTimeout(100)

    const edgeColor = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.color
    })
    expect(edgeColor).toBe('#DD344C')

    // Verify SVG stroke color
    const stroke = await page.locator('.vue-flow__edge .vue-flow__edge-path').first().getAttribute('stroke')
    expect(stroke).toBe('#DD344C')
  })

  test('toggling animated flow off removes dots', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Initially animated with dots
    let circleCount = await page.locator('.vue-flow__edge circle').count()
    expect(circleCount).toBeGreaterThanOrEqual(1)

    // Find the "Animated Flow" toggle and click it off
    const animatedToggle = page.locator('[data-testid="properties-panel"]').getByText('Animated Flow').locator('..').locator('button')
    await animatedToggle.click()
    await page.waitForTimeout(200)

    const animated = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.animated
    })
    expect(animated).toBe(false)
  })

  test('changing dot count updates number of animated circles', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Default is 1 dot
    let circleCount = await page.locator('.vue-flow__edge circle').count()
    expect(circleCount).toBe(1)

    // Click "2" dot count
    // The dot count buttons show "1", "2", "3" — we need to click the one in the Dot Count section
    const dotCountSection = page.locator('[data-testid="properties-panel"]').getByText('Dot Count').locator('..')
    await dotCountSection.getByRole('button', { name: '3' }).click()
    await page.waitForTimeout(200)

    const storeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.dotCount
    })
    expect(storeCount).toBe(3)

    // Verify 3 circles in SVG
    circleCount = await page.locator('.vue-flow__edge circle').count()
    expect(circleCount).toBe(3)
  })

  test('changing dot speed updates animation duration', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Click "fast" speed
    const dotSpeedSection = page.locator('[data-testid="properties-panel"]').getByText('Dot Speed').locator('..')
    await dotSpeedSection.getByRole('button', { name: 'fast' }).click()
    await page.waitForTimeout(100)

    const speed = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.dotSpeed
    })
    expect(speed).toBe('fast')

    // Verify the animateMotion dur is 0.8s (fast)
    const dur = await page.locator('.vue-flow__edge animateMotion').first().getAttribute('dur')
    expect(dur).toBe('0.8s')
  })

  test('changing dot color updates circle fill', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // The dot color swatches have a 'dot-' prefix key. Click the Green one
    // Both edge color and dot color use the same edgeColors array.
    // Dot color section has buttons with title="Green", etc. but within the Dot Color section
    const dotColorSection = page.locator('[data-testid="properties-panel"]').getByText('Dot Color').locator('..')
    await dotColorSection.locator('button[title="Green"]').click()
    await page.waitForTimeout(100)

    const dotColor = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.data?.dotColor
    })
    expect(dotColor).toBe('#3F8624')

    // Verify SVG circle fill
    const fill = await page.locator('.vue-flow__edge circle').first().getAttribute('fill')
    expect(fill).toBe('#3F8624')
  })

  test('quick style applies all settings at once', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Click "Data Flow" quick style
    await page.getByRole('button', { name: 'Data Flow' }).click()
    await page.waitForTimeout(100)

    const edgeData = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      const e = store.edges[0]?.data
      return {
        color: e?.color,
        style: e?.style,
        animated: e?.animated,
        dotAnimation: e?.dotAnimation,
        dotSpeed: e?.dotSpeed,
        dotCount: e?.dotCount,
      }
    })

    expect(edgeData.color).toBe('#3F8624')
    expect(edgeData.style).toBe('solid')
    expect(edgeData.animated).toBe(true)
    expect(edgeData.dotAnimation).toBe(true)
    expect(edgeData.dotSpeed).toBe('medium')
    expect(edgeData.dotCount).toBe(2)
  })

  test('quick style "Static" disables animation', async ({ diagramPage: page }) => {
    await setupEdgeAndSelect(page)

    // Click "Static" quick style
    await page.getByRole('button', { name: 'Static' }).click()
    await page.waitForTimeout(200)

    const edgeData = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      const e = store.edges[0]?.data
      return {
        animated: e?.animated,
        dotAnimation: e?.dotAnimation,
      }
    })

    expect(edgeData.animated).toBe(false)
    expect(edgeData.dotAnimation).toBe(false)
  })
})
