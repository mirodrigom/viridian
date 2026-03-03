import { test, expect } from './fixtures'
import {
  addDiagramServiceNode,
  addDiagramEdge,
} from './helpers/vueflow'

test.describe('Diagram Edge Animation', () => {
  test('newly created edge uses animated-flow type and has animateMotion', async ({ diagramPage: page }) => {
    // Add two nodes
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })

    // Add an edge between them
    await addDiagramEdge(page, nodeA, nodeB)

    // Wait for VueFlow to render the edge
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })

    // Verify edge type in store is 'animated-flow'
    const edgeType = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.edges[0]?.type
    })
    expect(edgeType).toBe('animated-flow')

    // Verify the SVG edge path exists
    const edgePath = page.locator('.vue-flow__edge path[id^="edge-path-"]')
    await expect(edgePath.first()).toBeVisible()

    // Verify animateMotion elements are present (live animation)
    const animateMotions = page.locator('.vue-flow__edge animateMotion')
    const count = await animateMotions.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // Verify the mpath references a valid path
    const mpathHref = await page.locator('.vue-flow__edge mpath').first().getAttribute('href')
    expect(mpathHref).toMatch(/^#edge-path-/)

    // Verify the animated circle exists
    const circles = page.locator('.vue-flow__edge circle')
    await expect(circles.first()).toBeVisible()
  })

  test('animated dots have running animateMotion with valid mpath', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })
    await page.waitForTimeout(300)

    // Verify the animateMotion is properly configured and the referenced path exists
    const animationState = await page.evaluate(() => {
      const animMotion = document.querySelector('.vue-flow__edge animateMotion')
      if (!animMotion) return { found: false } as any

      const mpath = animMotion.querySelector('mpath')
      const href = mpath?.getAttribute('href')
      const referencedPath = href ? document.querySelector(href) : null

      return {
        found: true,
        dur: animMotion.getAttribute('dur'),
        repeatCount: animMotion.getAttribute('repeatCount'),
        mpathHref: href,
        pathExists: !!referencedPath,
        pathHasData: !!(referencedPath as SVGPathElement | null)?.getAttribute('d'),
      }
    })

    expect(animationState.found).toBe(true)
    expect(animationState.dur).toBeTruthy()
    expect(animationState.repeatCount).toBe('indefinite')
    expect(animationState.mpathHref).toMatch(/^#edge-path-/)
    expect(animationState.pathExists).toBe(true)
    expect(animationState.pathHasData).toBe(true)
  })

  test('edge data has dotAnimation=true and animated=true by default', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)

    const edgeData = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      const edge = store.edges[0]
      return {
        animated: edge?.data?.animated,
        dotAnimation: edge?.data?.dotAnimation,
        dotCount: edge?.data?.dotCount,
        type: edge?.type,
      }
    })

    expect(edgeData.animated).toBe(true)
    expect(edgeData.dotAnimation).toBe(true)
    expect(edgeData.dotCount).toBe(1)
    expect(edgeData.type).toBe('animated-flow')
  })

  test('save and reload preserves animation settings', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)

    // Serialize, then clear, then deserialize
    const edgeDataAfterReload = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')

      // Serialize current state
      const config = { id: 'test', name: 'Test', ...store.serialize() }

      // Clear
      store.newDiagram()

      // Deserialize
      store.deserialize(config)

      const edge = store.edges[0]
      return {
        animated: edge?.data?.animated,
        dotAnimation: edge?.data?.dotAnimation,
        type: edge?.type,
      }
    })

    expect(edgeDataAfterReload.animated).toBe(true)
    expect(edgeDataAfterReload.dotAnimation).toBe(true)
    expect(edgeDataAfterReload.type).toBe('animated-flow')
  })

  test('GIF export mode switches to programmatic dot positions', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })

    // Before export mode: animateMotion should be present
    let hasAnimateMotion = await page.locator('.vue-flow__edge animateMotion').count()
    expect(hasAnimateMotion).toBeGreaterThanOrEqual(1)

    // Enter export mode
    await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.gifExportProgress = 0.5
    })
    await page.waitForTimeout(100)

    // In export mode: animateMotion should be gone, circles should have cx/cy
    hasAnimateMotion = await page.locator('.vue-flow__edge animateMotion').count()
    expect(hasAnimateMotion).toBe(0)

    const circle = page.locator('.vue-flow__edge circle').first()
    await expect(circle).toBeVisible()
    const cx = await circle.getAttribute('cx')
    const cy = await circle.getAttribute('cy')
    expect(cx).not.toBeNull()
    expect(cy).not.toBeNull()

    // Different progress values should move dots
    await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.gifExportProgress = 0.0
    })
    await page.waitForTimeout(100)

    const cx2 = await page.locator('.vue-flow__edge circle').first().getAttribute('cx')
    const cy2 = await page.locator('.vue-flow__edge circle').first().getAttribute('cy')

    // Positions should differ between progress=0.5 and progress=0.0
    const dotMoved = cx !== cx2 || cy !== cy2
    expect(dotMoved).toBe(true)

    // Exit export mode
    await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.gifExportProgress = null
    })
    await page.waitForTimeout(100)

    // animateMotion should be back
    hasAnimateMotion = await page.locator('.vue-flow__edge animateMotion').count()
    expect(hasAnimateMotion).toBeGreaterThanOrEqual(1)
  })

  test('z-index changes are reflected in Vue Flow nodes', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 300 })

    // Get initial z-index of nodeA from VueFlow
    const getVueFlowZIndex = (nodeId: string) =>
      page.evaluate((id) => {
        // @ts-ignore
        const { useVueFlow } = window.__VUE_FLOW__ || {}
        // Try reading from the DOM style
        const el = document.querySelector(`[data-id="${id}"]`) as HTMLElement
        return el ? parseInt(el.style.zIndex || '0', 10) : null
      }, nodeId)

    // Bring nodeA to front via store
    await page.evaluate((id) => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.bringToFront(id)
    }, nodeA)
    await page.waitForTimeout(100)

    const zIndexA = await getVueFlowZIndex(nodeA)
    const zIndexB = await getVueFlowZIndex(nodeB)

    // nodeA should have a higher z-index than nodeB
    expect(zIndexA).not.toBeNull()
    expect(zIndexA!).toBeGreaterThan(zIndexB ?? 0)
  })

  test('flow cascade staggers animateMotion begin times by topological level', async ({ diagramPage: page }) => {
    // Build a 3-node chain: A → B → C (3 topological levels)
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 300 })
    const nodeC = await addDiagramServiceNode(page, 's3', { x: 200, y: 500 })
    await addDiagramEdge(page, nodeA, nodeB)
    await addDiagramEdge(page, nodeB, nodeC)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })
    await page.waitForTimeout(300)

    // Get the flow levels from the store
    const flowLevels = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      const levels: Record<string, number> = {}
      for (const [id, level] of store.edgeFlowLevels.entries()) {
        levels[id] = level
      }
      return levels
    })

    // Edge A→B should be level 0 (source), B→C should be level 1
    const edgeIds = Object.keys(flowLevels)
    expect(edgeIds.length).toBe(2)
    const levels = Object.values(flowLevels).sort()
    expect(levels).toEqual([0, 1])

    // Verify the SVG animateMotion elements have different begin values
    const beginTimes = await page.evaluate(() => {
      const motions = document.querySelectorAll('.vue-flow__edge animateMotion')
      return Array.from(motions).map(m => m.getAttribute('begin'))
    })

    expect(beginTimes.length).toBe(2)
    // Parse begin times and verify they differ
    const times = beginTimes.map(b => parseFloat(b || '0'))
    const [t0, t1] = times.sort((a, b) => a - b)
    // Level 0 edge has begin ≈ 0, level 1 edge has begin ≈ 0.4 (flowStagger)
    expect(t0).toBeCloseTo(0, 1)
    expect(t1).toBeGreaterThan(0.1) // stagger is 0.4s by default

    // Verify flow sequence badges are visible (since we have multiple levels)
    const badges = page.locator('.vue-flow__edge .flow-badge')
    expect(await badges.count()).toBe(2)
  })

  test('single-level graph shows no flow badges', async ({ diagramPage: page }) => {
    // Two edges from the same source → both level 0 → maxLevel is 0 → no badges
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 100, y: 400 })
    const nodeC = await addDiagramServiceNode(page, 's3', { x: 300, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await addDiagramEdge(page, nodeA, nodeC)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })
    await page.waitForTimeout(300)

    // Both edges should be level 0 (same source, no chain)
    const flowLevels = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return Array.from(store.edgeFlowLevels.values())
    })
    expect(flowLevels.every((l: number) => l === 0)).toBe(true)

    // No badges should be shown when maxLevel is 0 (all same level)
    const badges = page.locator('.vue-flow__edge .flow-badge')
    expect(await badges.count()).toBe(0)
  })

  test('GIF export produces a downloadable file', async ({ diagramPage: page }) => {
    const nodeA = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 100 })
    const nodeB = await addDiagramServiceNode(page, 'lambda', { x: 200, y: 400 })
    await addDiagramEdge(page, nodeA, nodeB)
    await page.waitForSelector('.vue-flow__edge', { timeout: 5_000 })

    // Open GIF export dialog
    await page.locator('[data-testid="toolbar-exportGif"]').click()
    await expect(page.getByText('Export GIF Animation')).toBeVisible()

    // Use viewport mode for simpler test (no content bounds issues)
    await page.getByText('Full Viewport').click()

    // Use fastest settings
    await page.getByText('2s').click()
    await page.getByText('6 fps').click()

    // Listen for download
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })

    // Click export
    await page.getByRole('button', { name: 'Export GIF' }).click()

    // Wait for the GIF to be downloaded
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.gif$/)

    // Verify file size is non-trivial (has actual frame data)
    const path = await download.path()
    if (path) {
      const fs = await import('fs')
      const stat = fs.statSync(path)
      // A multi-frame GIF should be at least a few KB
      expect(stat.size).toBeGreaterThan(1000)
    }
  })
})
