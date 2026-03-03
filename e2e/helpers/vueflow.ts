import type { Page } from '@playwright/test'

/**
 * VueFlow canvas interaction helpers for E2E tests.
 *
 * VueFlow renders nodes as HTML elements and edges as SVG paths.
 * Drag-drop from palette uses HTML5 dataTransfer with custom MIME types
 * that Playwright cannot set, so we use page.evaluate() to call Pinia stores.
 */

/** Add a service node via the diagrams Pinia store */
export async function addDiagramServiceNode(
  page: Page,
  serviceId: string,
  position = { x: 200, y: 200 },
): Promise<string> {
  const nodeId = await page.evaluate(
    ({ serviceId, position }) => {
      // @ts-ignore - accessing Pinia store from window
      const pinia = (window as any).__pinia
      if (!pinia) throw new Error('Pinia not found')
      const store = pinia._s.get('diagrams')
      if (!store) throw new Error('Diagrams store not found')
      const id = store.addServiceNode(serviceId, position)
      // Trigger VueFlow sync via diagramVersion watcher
      store.diagramVersion++
      return id
    },
    { serviceId, position },
  )
  // Wait for VueFlow to render the node
  await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })
  return nodeId
}

/** Add a group node via the diagrams Pinia store */
export async function addDiagramGroupNode(
  page: Page,
  groupTypeId: string,
  position = { x: 100, y: 100 },
): Promise<string> {
  const nodeId = await page.evaluate(
    ({ groupTypeId, position }) => {
      const pinia = (window as any).__pinia
      if (!pinia) throw new Error('Pinia not found')
      const store = pinia._s.get('diagrams')
      if (!store) throw new Error('Diagrams store not found')
      const id = store.addGroupNode(groupTypeId, position)
      // Trigger VueFlow sync via diagramVersion watcher
      store.diagramVersion++
      return id
    },
    { groupTypeId, position },
  )
  await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })
  return nodeId
}

/** Add an edge between two nodes via the diagrams store */
export async function addDiagramEdge(
  page: Page,
  sourceId: string,
  targetId: string,
): Promise<void> {
  await page.evaluate(
    ({ sourceId, targetId }) => {
      const pinia = (window as any).__pinia
      if (!pinia) throw new Error('Pinia not found')
      const store = pinia._s.get('diagrams')
      if (!store) throw new Error('Diagrams store not found')
      store.addEdge({
        source: sourceId,
        target: targetId,
        sourceHandle: 'bottom',
        targetHandle: 'top',
      })
      // Trigger VueFlow sync
      store.diagramVersion++
    },
    { sourceId, targetId },
  )
  await page.waitForTimeout(300) // Let VueFlow sync
}

/** Select a node in the diagrams store */
export async function selectDiagramNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(
    (id) => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.selectNode(id)
    },
    nodeId,
  )
  await page.waitForTimeout(100)
}

/** Select an edge in the diagrams store */
export async function selectDiagramEdge(page: Page, edgeId: string): Promise<void> {
  await page.evaluate(
    (id) => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      store.selectEdge(id)
    },
    edgeId,
  )
  await page.waitForTimeout(100)
}

/** Get edge IDs from the diagrams store */
export async function getDiagramEdgeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pinia = (window as any).__pinia
    const store = pinia._s.get('diagrams')
    return store.edges.map((e: any) => e.id)
  })
}

/** Get node count from diagrams store */
export async function getDiagramNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pinia = (window as any).__pinia
    const store = pinia._s.get('diagrams')
    return store.nodeCount
  })
}

/** Clear the diagram (new diagram) */
export async function newDiagram(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pinia = (window as any).__pinia
    const store = pinia._s.get('diagrams')
    store.newDiagram()
  })
  await page.waitForTimeout(100)
}

// ── Graph store helpers ──────────────────────────────────────────────

/** Add a graph node via the graph Pinia store */
export async function addGraphNode(
  page: Page,
  nodeType: string,
  position = { x: 200, y: 200 },
): Promise<string> {
  const nodeId = await page.evaluate(
    ({ nodeType, position }) => {
      const pinia = (window as any).__pinia
      if (!pinia) throw new Error('Pinia not found')
      const store = pinia._s.get('graph')
      if (!store) throw new Error('Graph store not found')
      return store.addNode(nodeType, position)
    },
    { nodeType, position },
  )
  await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })
  return nodeId
}

/** Select a graph node */
export async function selectGraphNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(
    (id) => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('graph')
      store.selectNode(id)
    },
    nodeId,
  )
  await page.waitForTimeout(100)
}

/** Clear the graph (new graph) */
export async function newGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pinia = (window as any).__pinia
    const store = pinia._s.get('graph')
    store.newGraph()
  })
  await page.waitForTimeout(100)
}

/** Get graph node count */
export async function getGraphNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pinia = (window as any).__pinia
    const store = pinia._s.get('graph')
    return store.nodeCount
  })
}
