import { test, expect } from './fixtures'
import {
  addDiagramServiceNode,
  addDiagramGroupNode,
  addDiagramEdge,
  selectDiagramNode,
  selectDiagramEdge,
  getDiagramEdgeIds,
} from './helpers/vueflow'

test.describe('Diagram Nodes and Properties', () => {
  test('adding a service node renders on canvas', async ({ diagramPage: page }) => {
    await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })

    // Node should be visible on the canvas
    await expect(page.locator('.vue-flow__node')).toHaveCount(1)

    // Stats should update
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 nodes')
  })

  test('adding a group node renders on canvas', async ({ diagramPage: page }) => {
    await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })

    await expect(page.locator('.vue-flow__node')).toHaveCount(1)
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 nodes')
  })

  test('dropping a group inside another group keeps them independent (no auto-nesting)', async ({ diagramPage: page }) => {
    // Create a VPC group first
    const vpcId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })

    // Create an Availability Zone group at a position inside the VPC bounds
    const azId = await addDiagramGroupNode(page, 'availability-zone', { x: 160, y: 180 })

    // The AZ group should NOT be parented to the VPC — they should be independent
    const parentNode = await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const node = store.nodes.find((n: any) => n.id === id)
        return node?.parentNode ?? null
      },
      azId,
    )
    expect(parentNode).toBeNull()

    // Both should be visible as separate root-level nodes
    await expect(page.locator('.vue-flow__node')).toHaveCount(2)
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('2 nodes')
  })

  test('selecting a service node shows properties panel', async ({ diagramPage: page }) => {
    const nodeId = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await selectDiagramNode(page, nodeId)

    // Properties panel should appear
    const panel = page.locator('[data-testid="properties-panel"]')
    await expect(panel).toBeVisible()

    // Should show the service name and custom label input
    await expect(panel.getByText('Custom Label')).toBeVisible()
    await expect(panel.locator('[data-testid="prop-custom-label"]')).toBeVisible()
  })

  test('editing custom label updates node', async ({ diagramPage: page }) => {
    const nodeId = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await selectDiagramNode(page, nodeId)

    const labelInput = page.locator('[data-testid="prop-custom-label"]')
    await labelInput.fill('My EC2 Instance')

    // The node should display the custom label
    await expect(page.locator('.vue-flow__node').getByText('My EC2 Instance')).toBeVisible()
  })

  test('adding an edge updates stats', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('2 nodes')
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 edges')
  })

  test('selecting an edge shows edge properties', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    const edgeIds = await getDiagramEdgeIds(page)
    expect(edgeIds.length).toBe(1)
    await selectDiagramEdge(page, edgeIds[0])

    // Properties panel should show edge sections
    const panel = page.locator('[data-testid="properties-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Quick Styles')).toBeVisible()
    await expect(panel.getByText('Markers')).toBeVisible()
  })

  test('delete node via keyboard', async ({ diagramPage: page }) => {
    const nodeId = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await selectDiagramNode(page, nodeId)

    // Press Delete key
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('0 nodes')
  })

  test('context menu on service node', async ({ diagramPage: page }) => {
    await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    // Right-click on the node
    await page.locator('.vue-flow__node').first().click({ button: 'right' })

    // Context menu should appear with z-index and delete options
    await expect(page.getByText('Bring to Front')).toBeVisible()
    await expect(page.getByText('Send to Back')).toBeVisible()
    await expect(page.getByText('Delete Node')).toBeVisible()
  })

  test('group node collapse/expand', async ({ diagramPage: page }) => {
    await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    // Click collapse toggle
    const collapseBtn = page.locator('[data-testid="group-collapse-toggle"]')
    await collapseBtn.click()

    // The inner area should be hidden (collapsed state)
    // Collapsed groups don't show the inner drop area
    await page.waitForTimeout(200)

    // Click again to expand
    await collapseBtn.click()
    await page.waitForTimeout(200)
  })

  test('group node rename via double-click', async ({ diagramPage: page }) => {
    await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    // Double-click the label
    const label = page.locator('[data-testid="group-label"]')
    await label.dblclick()

    // An input should appear for editing
    const editInput = page.locator('.vue-flow__node input')
    await expect(editInput).toBeVisible()

    // Type new name and press Enter
    await editInput.fill('Production VPC')
    await editInput.press('Enter')

    // Label should update
    await expect(page.locator('[data-testid="group-label"]')).toContainText('Production VPC')
  })

  // ─── Nested node selection and z-index tests ─────────────────────

  test('clicking service inside group selects the service, not the group', async ({ diagramPage: page }) => {
    // Create a group and place a service node inside it
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    // Parent the service to the group
    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    // Click on the service node element
    const serviceEl = page.locator(`[data-id="${serviceId}"]`)
    await expect(serviceEl).toBeVisible()
    await serviceEl.click({ force: true })
    await page.waitForTimeout(200)

    // Verify the service is selected (not the group)
    const selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      const store = pinia._s.get('diagrams')
      return store.selectedNodeId
    })
    expect(selectedId).toBe(serviceId)
  })

  test('after selecting a group, clicking a child service inside it selects the service', async ({ diagramPage: page }) => {
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    // First select the group
    await selectDiagramNode(page, groupId)
    await page.waitForTimeout(200)

    // Verify group is selected
    let selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(groupId)

    // Now click on the service node — the onNodeClick handler should redirect
    // to the deepest child at the click position
    const serviceEl = page.locator(`[data-id="${serviceId}"]`)
    await serviceEl.click({ force: true })
    await page.waitForTimeout(200)

    selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(serviceId)
  })

  test('child node z-index is always higher than parent group z-index', async ({ diagramPage: page }) => {
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    const zIndices = await page.evaluate(
      ({ groupId, serviceId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const groupNode = store.nodes.find((n: any) => n.id === groupId)
        const serviceNode = store.nodes.find((n: any) => n.id === serviceId)
        return {
          groupZ: groupNode?.zIndex ?? 0,
          serviceZ: serviceNode?.zIndex ?? 0,
        }
      },
      { groupId, serviceId },
    )

    expect(zIndices.serviceZ).toBeGreaterThan(zIndices.groupZ)
  })

  test('bringToFront on a group does not put it above its children', async ({ diagramPage: page }) => {
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    // Bring group to front
    await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        pinia._s.get('diagrams').bringToFront(id)
      },
      groupId,
    )
    await page.waitForTimeout(200)

    // Child's z-index should still be higher than the group's
    const zIndices = await page.evaluate(
      ({ groupId, serviceId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const groupNode = store.nodes.find((n: any) => n.id === groupId)
        const serviceNode = store.nodes.find((n: any) => n.id === serviceId)
        return {
          groupZ: groupNode?.zIndex ?? 0,
          serviceZ: serviceNode?.zIndex ?? 0,
        }
      },
      { groupId, serviceId },
    )

    // bringToFront operates on siblings only — child depth-based z is separate
    expect(zIndices.serviceZ).toBeGreaterThan(zIndices.groupZ)
  })

  test('z-index operations are scoped to siblings at the same nesting level', async ({ diagramPage: page }) => {
    // Create two root-level groups
    const group1 = await addDiagramGroupNode(page, 'vpc', { x: 50, y: 50 })
    const group2 = await addDiagramGroupNode(page, 'region', { x: 400, y: 50 })

    // Create a service inside group1
    const serviceInGroup1 = await addDiagramServiceNode(page, 'ec2', { x: 110, y: 130 })
    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId: serviceInGroup1, groupId: group1 },
    )
    await page.waitForTimeout(300)

    // bringToFront on group1 should only affect root-level siblings
    await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        pinia._s.get('diagrams').bringToFront(id)
      },
      group1,
    )
    await page.waitForTimeout(100)

    const result = await page.evaluate(
      ({ group1, group2, serviceInGroup1 }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const g1 = store.nodes.find((n: any) => n.id === group1)
        const g2 = store.nodes.find((n: any) => n.id === group2)
        const svc = store.nodes.find((n: any) => n.id === serviceInGroup1)
        return {
          group1Z: g1?.zIndex ?? 0,
          group2Z: g2?.zIndex ?? 0,
          serviceZ: svc?.zIndex ?? 0,
          // Check that the service's z-index was not affected by root-level operations
          serviceParent: svc?.parentNode,
        }
      },
      { group1, group2, serviceInGroup1 },
    )

    // group1 should be above group2 (brought to front)
    expect(result.group1Z).toBeGreaterThan(result.group2Z)
    // Service is still parented correctly
    expect(result.serviceParent).toBe(group1)
    // Service z-index still above its parent
    expect(result.serviceZ).toBeGreaterThan(result.group1Z)
  })

  test('deeply nested nodes (group > group > service) maintain proper z-index hierarchy', async ({ diagramPage: page }) => {
    // Create outer group (Region), inner group (Security Group), service (EC2)
    const outerGroup = await addDiagramGroupNode(page, 'region', { x: 50, y: 50 })
    const innerGroup = await addDiagramGroupNode(page, 'security-group', { x: 80, y: 100 })
    const service = await addDiagramServiceNode(page, 'ec2', { x: 120, y: 160 })

    // Parent inner group to outer, then service to inner
    await page.evaluate(
      ({ innerGroup, outerGroup, service }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(innerGroup, outerGroup)
        store.setNodeParent(service, innerGroup)
        store.diagramVersion++
      },
      { innerGroup, outerGroup, service },
    )
    await page.waitForTimeout(300)

    const zIndices = await page.evaluate(
      ({ outerGroup, innerGroup, service }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const outer = store.nodes.find((n: any) => n.id === outerGroup)
        const inner = store.nodes.find((n: any) => n.id === innerGroup)
        const svc = store.nodes.find((n: any) => n.id === service)
        return {
          outerZ: outer?.zIndex ?? 0,
          innerZ: inner?.zIndex ?? 0,
          serviceZ: svc?.zIndex ?? 0,
        }
      },
      { outerGroup, innerGroup, service },
    )

    // Depth hierarchy: service (depth 2) > inner group (depth 1) > outer group (depth 0)
    expect(zIndices.serviceZ).toBeGreaterThan(zIndices.innerZ)
    expect(zIndices.innerZ).toBeGreaterThan(zIndices.outerZ)
  })

  test('sendToBack does not set z-index below depth floor', async ({ diagramPage: page }) => {
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    // Send service to back — its z-index should not drop below its depth floor (10)
    await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        pinia._s.get('diagrams').sendToBack(id)
      },
      serviceId,
    )
    await page.waitForTimeout(100)

    const serviceZ = await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const node = store.nodes.find((n: any) => n.id === id)
        return node?.zIndex ?? 0
      },
      serviceId,
    )

    // Depth 1 node → floor is 10
    expect(serviceZ).toBeGreaterThanOrEqual(10)
  })

  test('clicking child inside already-selected group deselects group and selects child', async ({ diagramPage: page }) => {
    // Reproduce the exact user scenario: VPC selected → click EC2 inside
    const groupId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const serviceId = await addDiagramServiceNode(page, 'ec2', { x: 160, y: 180 })

    await page.evaluate(
      ({ serviceId, groupId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(serviceId, groupId)
        store.diagramVersion++
      },
      { serviceId, groupId },
    )
    await page.waitForTimeout(300)

    // Select the group (like the user clicking VPC)
    const groupEl = page.locator(`[data-id="${groupId}"]`)
    await groupEl.click()
    await page.waitForTimeout(300)

    // VPC should now be selected in VueFlow (has .selected class)
    await expect(groupEl).toHaveClass(/selected/)

    // Now click on the service node area — without force: true, like a real user
    const serviceEl = page.locator(`[data-id="${serviceId}"]`)
    const serviceBBox = await serviceEl.boundingBox()
    expect(serviceBBox).toBeTruthy()

    // Click in the center of the service node
    await page.mouse.click(
      serviceBBox!.x + serviceBBox!.width / 2,
      serviceBBox!.y + serviceBBox!.height / 2,
    )
    await page.waitForTimeout(300)

    // The service should now be selected in the store
    const selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(serviceId)

    // The service should be visually selected in VueFlow (has .selected class)
    await expect(serviceEl).toHaveClass(/selected/)

    // The group should NOT be visually selected anymore
    await expect(groupEl).not.toHaveClass(/selected/)
  })

  test('triple-nested: click deepest child through two selected parent groups', async ({ diagramPage: page }) => {
    const outer = await addDiagramGroupNode(page, 'region', { x: 50, y: 50 })
    const inner = await addDiagramGroupNode(page, 'vpc', { x: 80, y: 100 })
    const service = await addDiagramServiceNode(page, 'ec2', { x: 120, y: 160 })

    await page.evaluate(
      ({ inner, outer, service }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(inner, outer)
        store.setNodeParent(service, inner)
        store.diagramVersion++
      },
      { inner, outer, service },
    )
    await page.waitForTimeout(300)

    // Select the outer group first (via store + VueFlow sync)
    const outerEl = page.locator(`[data-id="${outer}"]`)
    await selectDiagramNode(page, outer)
    // Also set VueFlow's visual selection to match
    await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        // Trigger VueFlow selection sync via the watcher
        store.selectedNodeId = id
      },
      outer,
    )
    await page.waitForTimeout(300)

    // Click on the service inside
    const serviceEl = page.locator(`[data-id="${service}"]`)
    const bbox = await serviceEl.boundingBox()
    expect(bbox).toBeTruthy()
    await page.mouse.click(bbox!.x + bbox!.width / 2, bbox!.y + bbox!.height / 2)
    await page.waitForTimeout(300)

    const selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(service)

    // Service should be visually selected
    await expect(serviceEl).toHaveClass(/selected/)
    // Outer group should NOT be selected
    await expect(outerEl).not.toHaveClass(/selected/)
  })

  test('clicking child GROUP inside selected parent GROUP selects the child group', async ({ diagramPage: page }) => {
    // This is the exact user scenario: VPC selected → click Public Subnet group inside
    const vpcId = await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    const subnetId = await addDiagramGroupNode(page, 'subnet-public', { x: 140, y: 200 })

    // Parent the subnet to the VPC
    await page.evaluate(
      ({ subnetId, vpcId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(subnetId, vpcId)
        store.diagramVersion++
      },
      { subnetId, vpcId },
    )
    await page.waitForTimeout(300)

    // Select VPC programmatically (simulates user having already selected it)
    await selectDiagramNode(page, vpcId)
    await page.waitForTimeout(300)

    // Verify VPC is selected
    const vpcEl = page.locator(`[data-id="${vpcId}"]`)
    let selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(vpcId)

    // Now click on the child group (Public Subnet) — real user click via mouse
    const subnetEl = page.locator(`[data-id="${subnetId}"]`)
    const subnetBBox = await subnetEl.boundingBox()
    expect(subnetBBox).toBeTruthy()

    // Click the subnet's label bar area (top portion)
    await page.mouse.click(
      subnetBBox!.x + subnetBBox!.width / 2,
      subnetBBox!.y + 15,
    )
    await page.waitForTimeout(300)

    // The subnet should now be selected
    selectedId = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').selectedNodeId
    })
    expect(selectedId).toBe(subnetId)

    // VPC should NOT be selected anymore
    await expect(vpcEl).not.toHaveClass(/selected/)
    await expect(subnetEl).toHaveClass(/selected/)
  })

  // ─── Delete button and edge connection tests ─────────────────────

  test('trash icon on service node removes it from the canvas', async ({ diagramPage: page }) => {
    const nodeId = await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    // Hover over the node to reveal the trash icon, then click it
    const nodeEl = page.locator(`[data-id="${nodeId}"]`)
    await nodeEl.hover()
    await page.waitForTimeout(200)
    const trashBtn = nodeEl.locator('button').filter({ has: page.locator('.lucide-trash-2') })
    await trashBtn.click({ force: true })
    await page.waitForTimeout(300)

    // Node should be removed from both store and VueFlow canvas
    const nodeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').nodeCount
    })
    expect(nodeCount).toBe(0)

    // VueFlow should also have no nodes
    await expect(page.locator('.vue-flow__node')).toHaveCount(0)
  })

  test('trash icon on group node removes it from the canvas', async ({ diagramPage: page }) => {
    await addDiagramGroupNode(page, 'vpc', { x: 100, y: 100 })
    await page.waitForSelector('.vue-flow__node', { timeout: 5_000 })

    const nodeEl = page.locator('.vue-flow__node').first()
    await nodeEl.hover()
    await page.waitForTimeout(200)
    const trashBtn = nodeEl.locator('button').filter({ has: page.locator('.lucide-trash-2') })
    await trashBtn.click({ force: true })
    await page.waitForTimeout(300)

    const nodeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').nodeCount
    })
    expect(nodeCount).toBe(0)
    await expect(page.locator('.vue-flow__node')).toHaveCount(0)
  })

  test('deleting a node via trash also removes connected edges', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    // Verify edge exists
    let edgeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').edgeCount
    })
    expect(edgeCount).toBe(1)

    // Delete node1 via trash icon
    const nodeEl = page.locator(`[data-id="${node1}"]`)
    await nodeEl.hover()
    await page.waitForTimeout(200)
    const trashBtn = nodeEl.locator('button').filter({ has: page.locator('.lucide-trash-2') })
    await trashBtn.click({ force: true })
    await page.waitForTimeout(300)

    // Edge should also be removed
    edgeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').edgeCount
    })
    expect(edgeCount).toBe(0)
  })

  test('edge connection creates edge between nodes', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 100, y: 350 })

    // Drag from node1's bottom handle (source) to node2's top handle (target)
    const sourceHandle = page.locator(`[data-id="${node1}"] .vue-flow__handle[data-handlepos="bottom"]`)
    const targetHandle = page.locator(`[data-id="${node2}"] .vue-flow__handle[data-handlepos="top"]`)

    await sourceHandle.hover()
    const sourceBBox = await sourceHandle.boundingBox()
    const targetBBox = await targetHandle.boundingBox()

    if (sourceBBox && targetBBox) {
      await page.mouse.move(sourceBBox.x + sourceBBox.width / 2, sourceBBox.y + sourceBBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(targetBBox.x + targetBBox.width / 2, targetBBox.y + targetBBox.height / 2, { steps: 10 })
      await page.mouse.up()
    }

    await page.waitForTimeout(500)

    // Edge should exist in the store
    const edgeCount = await page.evaluate(() => {
      const pinia = (window as any).__pinia
      return pinia._s.get('diagrams').edgeCount
    })
    expect(edgeCount).toBe(1)

    // Edge should be visible in VueFlow
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)
  })

  // ─── Undo / Redo tests ─────────────────────────────────────────

  test('Ctrl+Z undoes node deletion', async ({ diagramPage: page }) => {
    await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await page.waitForTimeout(200)

    // Verify node exists
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 nodes')

    // Select and delete the node
    await page.locator('.vue-flow__node').first().click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    // Node should be gone
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('0 nodes')

    // Undo
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)

    // Node should be back
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 nodes')
    await expect(page.locator('.vue-flow__node')).toHaveCount(1)
  })

  test('Ctrl+Shift+Z redoes after undo', async ({ diagramPage: page }) => {
    await addDiagramServiceNode(page, 'ec2', { x: 200, y: 200 })
    await page.waitForTimeout(200)

    // Delete the node
    await page.locator('.vue-flow__node').first().click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('0 nodes')

    // Undo — node comes back
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 nodes')

    // Redo — node goes away again
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('0 nodes')
  })

  test('undo restores deleted edges along with node', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 edges')

    // Delete node1 (should also remove connected edge)
    await selectDiagramNode(page, node1)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('0 edges')

    // Undo — both node and edge should be restored
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)

    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('2 nodes')
    await expect(page.locator('[data-testid="diagram-stats"]')).toContainText('1 edges')
  })

  // ─── Edge dot direction and arrow marker tests ──────────────────────

  test('changing dot direction to reverse updates edge data', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    const edgeIds = await getDiagramEdgeIds(page)
    expect(edgeIds.length).toBe(1)
    await selectDiagramEdge(page, edgeIds[0])

    const panel = page.locator('[data-testid="properties-panel"]')
    await expect(panel).toBeVisible()

    // Open Animation collapsible
    await panel.getByText('Animation').click()
    await page.waitForTimeout(200)

    // Click reverse direction icon button
    await panel.locator('[data-testid="dot-direction-reverse"]').click()
    await page.waitForTimeout(200)

    // Verify store was updated
    const dotDirection = await page.evaluate(
      (edgeId) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const edge = store.edges.find((e: any) => e.id === edgeId)
        return edge?.data?.dotDirection
      },
      edgeIds[0],
    )
    expect(dotDirection).toBe('reverse')
  })

  test('changing dot direction to none hides animated dots', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    const edgeIds = await getDiagramEdgeIds(page)
    await selectDiagramEdge(page, edgeIds[0])

    const panel = page.locator('[data-testid="properties-panel"]')

    // Open Animation collapsible
    await panel.getByText('Animation').click()
    await page.waitForTimeout(200)

    // Click none direction icon button
    await panel.locator('[data-testid="dot-direction-none"]').click()
    await page.waitForTimeout(200)

    // Verify store was updated
    const dotDirection = await page.evaluate(
      (edgeId) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const edge = store.edges.find((e: any) => e.id === edgeId)
        return edge?.data?.dotDirection
      },
      edgeIds[0],
    )
    expect(dotDirection).toBe('none')
  })

  test('changing arrow markers updates edge data', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    const edgeIds = await getDiagramEdgeIds(page)
    await selectDiagramEdge(page, edgeIds[0])

    const panel = page.locator('[data-testid="properties-panel"]')
    await expect(panel).toBeVisible()

    // Markers collapsible is open by default — click arrow icon button for start marker
    await panel.locator('[data-testid="start-marker-arrowclosed"]').click()
    await page.waitForTimeout(200)

    // Verify store update
    const markers = await page.evaluate(
      (edgeId) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const edge = store.edges.find((e: any) => e.id === edgeId)
        return {
          markerStart: edge?.data?.markerStart,
          markerEnd: edge?.data?.markerEnd,
        }
      },
      edgeIds[0],
    )
    expect(markers.markerStart).toBe('arrowclosed')
    expect(markers.markerEnd).toBe('arrowclosed')
  })

  test('setting end marker to none removes arrow from edge', async ({ diagramPage: page }) => {
    const node1 = await addDiagramServiceNode(page, 'ec2', { x: 100, y: 100 })
    const node2 = await addDiagramServiceNode(page, 'lambda', { x: 300, y: 300 })
    await addDiagramEdge(page, node1, node2)

    const edgeIds = await getDiagramEdgeIds(page)
    await selectDiagramEdge(page, edgeIds[0])

    const panel = page.locator('[data-testid="properties-panel"]')

    // Click none icon button for end marker
    await panel.locator('[data-testid="end-marker-none"]').click()
    await page.waitForTimeout(200)

    // Verify store update
    const markerEnd = await page.evaluate(
      (edgeId) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const edge = store.edges.find((e: any) => e.id === edgeId)
        return edge?.data?.markerEnd
      },
      edgeIds[0],
    )
    expect(markerEnd).toBe('none')
  })

  // ─── Comprehensive click selection inside nested groups ──────────
  // Reproduces the user's exact diagram: Availability Zone > Public Subnet > services + edges

  test('click-select every element in nested groups: services, edges, groups', async ({ diagramPage: page }) => {
    // Build: Availability Zone (outer) > Public Subnet (inner) > EC2 + Lightsail + edge
    const azId = await addDiagramGroupNode(page, 'availability-zone', { x: 50, y: 50 })
    const subnetId = await addDiagramGroupNode(page, 'subnet-public', { x: 80, y: 120 })
    const ec2Id = await addDiagramServiceNode(page, 'ec2', { x: 350, y: 150 })
    const lightsailId = await addDiagramServiceNode(page, 'lightsail', { x: 120, y: 200 })

    // Parent subnet to AZ, then services to subnet
    await page.evaluate(
      ({ subnetId, azId, ec2Id, lightsailId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(subnetId, azId)
        store.setNodeParent(ec2Id, subnetId)
        store.setNodeParent(lightsailId, subnetId)
        store.diagramVersion++
      },
      { subnetId, azId, ec2Id, lightsailId },
    )
    await page.waitForTimeout(500)

    // Add edge between Lightsail and EC2
    await addDiagramEdge(page, lightsailId, ec2Id)
    await page.waitForTimeout(500)

    // Helper to get current selection from store
    const getSelection = () =>
      page.evaluate(() => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        return { nodeId: store.selectedNodeId, edgeId: store.selectedEdgeId }
      })

    // ── Test 1: Click on EC2 (service node inside nested group) ──
    const ec2El = page.locator(`[data-id="${ec2Id}"]`)
    await expect(ec2El).toBeVisible()
    const ec2Box = await ec2El.boundingBox()
    expect(ec2Box).toBeTruthy()
    await page.mouse.click(ec2Box!.x + ec2Box!.width / 2, ec2Box!.y + ec2Box!.height / 2)
    await page.waitForTimeout(300)

    let sel = await getSelection()
    expect(sel.nodeId).toBe(ec2Id)

    // ── Test 2: Click on Lightsail (another service in the same group) ──
    const lightsailEl = page.locator(`[data-id="${lightsailId}"]`)
    const lightsailBox = await lightsailEl.boundingBox()
    expect(lightsailBox).toBeTruthy()
    await page.mouse.click(lightsailBox!.x + lightsailBox!.width / 2, lightsailBox!.y + lightsailBox!.height / 2)
    await page.waitForTimeout(300)

    sel = await getSelection()
    expect(sel.nodeId).toBe(lightsailId)

    // ── Test 3: Click on the edge between them ──
    // The edge SVG path runs between the two nodes. Click its midpoint.
    const edgeIds = await getDiagramEdgeIds(page)
    expect(edgeIds.length).toBe(1)
    const edgePath = page.locator(`.vue-flow__edge[data-id="${edgeIds[0]}"] .vue-flow__edge-interaction`)
    const edgeBox = await edgePath.boundingBox()
    if (edgeBox) {
      // Click midpoint of the edge's bounding box
      await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
      await page.waitForTimeout(300)

      sel = await getSelection()
      // Either the edge should be selected, or at least a node near the edge.
      // Log what actually happened for diagnostics.
      console.log(`Edge click result: nodeId=${sel.nodeId}, edgeId=${sel.edgeId}`)
      // The edge should be selected (node should be null)
      expect(sel.edgeId).toBe(edgeIds[0])
    }

    // ── Test 4: Click on Availability Zone label bar (outer group) ──
    const azEl = page.locator(`[data-id="${azId}"]`)
    const azBox = await azEl.boundingBox()
    expect(azBox).toBeTruthy()
    // Click on label bar area (top of the group, y + 12px)
    await page.mouse.click(azBox!.x + 80, azBox!.y + 12)
    await page.waitForTimeout(300)

    sel = await getSelection()
    expect(sel.nodeId).toBe(azId)

    // ── Test 5: Click on Public Subnet label bar (inner group) ──
    const subnetEl = page.locator(`[data-id="${subnetId}"]`)
    const subnetBox = await subnetEl.boundingBox()
    expect(subnetBox).toBeTruthy()
    await page.mouse.click(subnetBox!.x + 80, subnetBox!.y + 12)
    await page.waitForTimeout(300)

    sel = await getSelection()
    expect(sel.nodeId).toBe(subnetId)

    // ── Test 6: After selecting a group, click EC2 again — should select EC2, not group ──
    await page.mouse.click(ec2Box!.x + ec2Box!.width / 2, ec2Box!.y + ec2Box!.height / 2)
    await page.waitForTimeout(300)

    sel = await getSelection()
    expect(sel.nodeId).toBe(ec2Id)
  })

  test('drag service node inside nested group moves the node', async ({ diagramPage: page }) => {
    // Build: AZ > Subnet > Lightsail (the exact user scenario)
    const azId = await addDiagramGroupNode(page, 'availability-zone', { x: 50, y: 50 })
    const subnetId = await addDiagramGroupNode(page, 'subnet-public', { x: 80, y: 120 })
    const lightsailId = await addDiagramServiceNode(page, 'lightsail', { x: 120, y: 200 })

    await page.evaluate(
      ({ subnetId, azId, lightsailId }) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        store.setNodeParent(subnetId, azId)
        store.setNodeParent(lightsailId, subnetId)
        store.diagramVersion++
      },
      { subnetId, azId, lightsailId },
    )
    await page.waitForTimeout(500)

    // Get the initial position of Lightsail
    const initialPos = await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const node = store.nodes.find((n: any) => n.id === id)
        return { x: node.position.x, y: node.position.y }
      },
      lightsailId,
    )

    // Get the Lightsail node bounding box
    const nodeEl = page.locator(`[data-id="${lightsailId}"]`)
    await expect(nodeEl).toBeVisible()
    const bbox = await nodeEl.boundingBox()
    expect(bbox).toBeTruthy()

    // Drag the node 80px to the right and 50px down
    const startX = bbox!.x + bbox!.width / 2
    const startY = bbox!.y + bbox!.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 80, startY + 50, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)

    // Check the node position changed
    const newPos = await page.evaluate(
      (id) => {
        const pinia = (window as any).__pinia
        const store = pinia._s.get('diagrams')
        const node = store.nodes.find((n: any) => n.id === id)
        return { x: node.position.x, y: node.position.y }
      },
      lightsailId,
    )

    console.log(`Drag test: initial=(${initialPos.x}, ${initialPos.y}), after=(${newPos.x}, ${newPos.y})`)

    // The position should have changed (moved right and down)
    expect(newPos.x).not.toBe(initialPos.x)
    expect(newPos.y).not.toBe(initialPos.y)
    // Rough check: moved approximately in the right direction
    expect(newPos.x).toBeGreaterThan(initialPos.x)
    expect(newPos.y).toBeGreaterThan(initialPos.y)
  })

})
