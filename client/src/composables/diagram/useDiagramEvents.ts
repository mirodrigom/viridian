import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import type { Connection, NodeDragEvent, GraphNode, GraphEdge } from '@vue-flow/core';
import type { useDiagramsStore } from '@/stores/diagrams';

interface UseDiagramEventsOptions {
  diagrams: ReturnType<typeof useDiagramsStore>;
  flowContainer: Ref<HTMLDivElement | undefined>;
  hoveredGroupId: Ref<string | null>;
  inlineEdgeEdit: Ref<{ edgeId: string; x: number; y: number; label: string } | null>;
  // VueFlow methods
  onConnect: (handler: (connection: Connection) => void) => void;
  onNodeDragStop: (handler: (event: NodeDragEvent) => void) => void;
  onNodeDragStart: (handler: (event: NodeDragEvent) => void) => void;
  onPaneClick: (handler: () => void) => void;
  onNodeClick: (handler: (event: { node: GraphNode; event: Event }) => void) => void;
  onNodeDoubleClick: (handler: (event: { node: GraphNode; event: Event }) => void) => void;
  onEdgeClick: (handler: (event: { edge: GraphEdge; event: Event }) => void) => void;
  onEdgeDoubleClick: (handler: (event: { edge: GraphEdge; event: Event }) => void) => void;
  addNodes: (nodes: any[]) => void;
  addEdges: (edges: any[]) => void;
  removeNodes: (nodes: any[]) => void;
  removeEdges: (edges: any[]) => void;
  screenToFlowCoordinate: (pos: { x: number; y: number }) => { x: number; y: number };
  getNodes: { value: GraphNode[] };
  getEdges: { value: GraphEdge[] };
  getSelectedNodes: { value: GraphNode[] };
  findNode: (id: string) => GraphNode | undefined;
  findEdge: (id: string) => GraphEdge | undefined;
}

/** Scan elementsFromPoint for service nodes and edges (keeps looking past groups). */
function hitTestAtPoint(clientX: number, clientY: number) {
  const elements = document.elementsFromPoint(clientX, clientY);
  let serviceNodeId: string | null = null;
  let firstNodeId: string | null = null;
  let edgeId: string | null = null;

  for (const el of elements) {
    if (!serviceNodeId) {
      const nodeEl = (el as HTMLElement).closest?.('.vue-flow__node');
      if (nodeEl) {
        const id = nodeEl.getAttribute('data-id');
        if (id) {
          if (!firstNodeId) firstNodeId = id;
          if (!nodeEl.classList.contains('vue-flow__node-aws-group')) {
            serviceNodeId = id;
          }
        }
      }
    }
    if (!edgeId) {
      const edgeEl = (el as Element).closest?.('.vue-flow__edge');
      if (edgeEl) {
        edgeId = edgeEl.getAttribute('data-id');
      }
    }
    if (serviceNodeId && edgeId) break;
  }

  return { serviceNodeId, firstNodeId, edgeId };
}

export function useDiagramEvents({
  diagrams,
  flowContainer,
  hoveredGroupId,
  inlineEdgeEdit,
  onConnect,
  onNodeDragStop,
  onNodeDragStart: _onNodeDragStart,
  onPaneClick,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onEdgeDoubleClick,
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  screenToFlowCoordinate,
  getNodes,
  getEdges,
  getSelectedNodes,
  findNode,
  findEdge,
}: UseDiagramEventsOptions) {
  // --- Inline edge label editing ---

  function commitInlineEdgeLabel() {
    if (!inlineEdgeEdit.value) return;
    diagrams.updateEdgeData(inlineEdgeEdit.value.edgeId, { label: inlineEdgeEdit.value.label });
    inlineEdgeEdit.value = null;
  }

  function cancelInlineEdgeLabel() {
    inlineEdgeEdit.value = null;
  }

  // --- VueFlow event handlers ---

  onConnect(async (connection: Connection) => {
    const prevCount = diagrams.edges.length;
    diagrams.addEdge(connection);
    if (diagrams.edges.length > prevCount) {
      const lastEdge = diagrams.edges[diagrams.edges.length - 1];
      addEdges([{ ...lastEdge }]);
      await nextTick();
    }
  });

  onNodeDragStop((event: NodeDragEvent) => {
    for (const node of event.nodes) {
      diagrams.updateNodePosition(node.id, node.position);

      if (!node.parentNode && node.type !== 'aws-group') {
        const absPos = diagrams.getAbsolutePosition(node.id);
        const groupId = diagrams.findGroupAtPosition(absPos, node.id);
        if (groupId) {
          diagrams.setNodeParent(node.id, groupId);
          const storeNode = diagrams.nodes.find(n => n.id === node.id);
          if (storeNode) {
            const vfNode = findNode(node.id);
            if (vfNode) {
              vfNode.parentNode = storeNode.parentNode;
              vfNode.extent = storeNode.extent as 'parent' | undefined;
              vfNode.position = { ...storeNode.position };
            }
          }
        }
      }
    }
    hoveredGroupId.value = null;
  });

  onPaneClick(() => {
    diagrams.selectNode(null);
    diagrams.selectEdge(null);
    inlineEdgeEdit.value = null;
  });

  onNodeClick(({ node, event }) => {
    const mouseEvent = event as MouseEvent;
    const target = mouseEvent.target as HTMLElement;

    const targetNode = target.closest?.('.vue-flow__node');
    if (targetNode) {
      const targetId = targetNode.getAttribute('data-id');
      if (targetId && !targetNode.classList.contains('vue-flow__node-aws-group')) {
        diagrams.selectNode(targetId);
        return;
      }
    }

    if (node.type === 'aws-group') {
      const { serviceNodeId, edgeId } = hitTestAtPoint(mouseEvent.clientX, mouseEvent.clientY);
      if (serviceNodeId) {
        diagrams.selectNode(serviceNodeId);
        return;
      }
      if (edgeId) {
        diagrams.selectNode(null);
        diagrams.selectEdge(edgeId);
        return;
      }
    }

    const { firstNodeId } = hitTestAtPoint(mouseEvent.clientX, mouseEvent.clientY);
    diagrams.selectNode(firstNodeId || node.id);
  });

  onNodeDoubleClick(({ node, event }) => {
    const mouseEvent = event as MouseEvent;
    const target = mouseEvent.target as HTMLElement;

    const targetNode = target.closest?.('.vue-flow__node');
    if (targetNode && !targetNode.classList.contains('vue-flow__node-aws-group')) return;

    if (node.type === 'aws-group') {
      const { serviceNodeId, edgeId } = hitTestAtPoint(mouseEvent.clientX, mouseEvent.clientY);
      if (serviceNodeId) return;
      if (edgeId) {
        const container = flowContainer.value;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const edge = findEdge(edgeId);
        inlineEdgeEdit.value = {
          edgeId,
          x: mouseEvent.clientX - rect.left,
          y: mouseEvent.clientY - rect.top,
          label: (edge?.data as any)?.label || '',
        };
        diagrams.selectNode(null);
        diagrams.selectEdge(edgeId);
        nextTick(() => {
          const input = container.querySelector('.inline-edge-input') as HTMLInputElement;
          input?.focus();
          input?.select();
        });
      }
    }
  });

  onEdgeClick(({ edge }) => {
    diagrams.selectEdge(edge.id);
  });

  onEdgeDoubleClick(({ edge, event }) => {
    const container = flowContainer.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseEvent = event as MouseEvent;
    inlineEdgeEdit.value = {
      edgeId: edge.id,
      x: mouseEvent.clientX - rect.left,
      y: mouseEvent.clientY - rect.top,
      label: (edge.data as any)?.label || '',
    };
    diagrams.selectEdge(edge.id);
    nextTick(() => {
      const input = container.querySelector('.inline-edge-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  });

  // --- Drop handler ---

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onDrop(event: DragEvent) {
    if (!event.dataTransfer) return;
    const type = event.dataTransfer.getData('application/diagram-type') as string;
    const itemId = event.dataTransfer.getData('application/diagram-id');
    if (!type || !itemId) return;

    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    });

    let nodeId: string;
    if (type === 'service') {
      nodeId = diagrams.addServiceNode(itemId, position);
    } else if (type === 'group') {
      nodeId = diagrams.addGroupNode(itemId, position);
    } else {
      return;
    }

    if (type === 'service') {
      const groupId = diagrams.findGroupAtPosition(position, nodeId);
      if (groupId) {
        diagrams.setNodeParent(nodeId, groupId);
      }
    }

    const node = diagrams.nodes.find(n => n.id === nodeId);
    if (node) {
      addNodes([{ ...node }]);
    }
    hoveredGroupId.value = null;
  }

  // --- Keyboard shortcuts ---

  function onKeyDown(event: KeyboardEvent) {
    const tag = (event.target as HTMLElement).tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Ctrl+Z: Undo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey && !isInput) {
      event.preventDefault();
      diagrams.undo();
      return;
    }
    // Ctrl+Shift+Z / Ctrl+Y: Redo
    if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z' || event.shiftKey && event.key === 'Z')) && !isInput) {
      event.preventDefault();
      diagrams.redo();
      return;
    }

    // Ctrl+A / Cmd+A: select all nodes
    if ((event.ctrlKey || event.metaKey) && event.key === 'a' && !isInput) {
      event.preventDefault();
      for (const node of getNodes.value) {
        node.selected = true;
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (isInput) return;

      const selected = getSelectedNodes.value;
      if (selected.length > 0) {
        for (const node of selected) {
          const connectedEdges = diagrams.edges.filter(e => e.source === node.id || e.target === node.id);
          if (connectedEdges.length) removeEdges(connectedEdges);
        }
        removeNodes(selected);
        diagrams.removeSelectedNodes(selected.map(n => n.id));
        diagrams.selectNode(null);
      } else if (diagrams.selectedNodeId) {
        const id = diagrams.selectedNodeId;
        const connectedEdges = diagrams.edges.filter(e => e.source === id || e.target === id);
        if (connectedEdges.length) removeEdges(connectedEdges);
        const vfNode = getNodes.value.find(n => n.id === id);
        if (vfNode) removeNodes([vfNode]);
        diagrams.removeNode(id);
      } else if (diagrams.selectedEdgeId) {
        const id = diagrams.selectedEdgeId;
        const edge = diagrams.edges.find(e => e.id === id);
        if (edge) removeEdges([edge]);
        diagrams.removeEdge(id);
      }
    }

    // Ctrl+C: Copy selected nodes
    if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !isInput) {
      const selected = getSelectedNodes.value;
      const ids = selected.length > 0
        ? selected.map(n => n.id)
        : diagrams.selectedNodeId ? [diagrams.selectedNodeId] : [];
      if (ids.length > 0) {
        event.preventDefault();
        diagrams.copyNodes(ids);
      }
      return;
    }

    // Ctrl+V: Paste copied nodes
    if ((event.ctrlKey || event.metaKey) && event.key === 'v' && !isInput) {
      if (diagrams.clipboard) {
        event.preventDefault();
        const newIds = diagrams.pasteNodes(40, 40);
        if (newIds.length > 0) {
          // Deselect old, select new nodes in VueFlow
          for (const node of getNodes.value) {
            node.selected = false;
          }
          // Add pasted nodes to VueFlow
          const newVfNodes = newIds
            .map(id => diagrams.nodes.find(n => n.id === id))
            .filter(Boolean)
            .map(n => ({ ...n! }));
          addNodes(newVfNodes);
          const newEdges = diagrams.edges
            .filter(e => newIds.includes(e.source) && newIds.includes(e.target))
            .map(e => ({ ...e }));
          if (newEdges.length) addEdges(newEdges);
          // Select the pasted nodes
          nextTick(() => {
            for (const id of newIds) {
              const vfNode = findNode(id);
              if (vfNode) vfNode.selected = true;
            }
          });
        }
      }
      return;
    }

    // Ctrl+D: Duplicate selected nodes in place
    if ((event.ctrlKey || event.metaKey) && event.key === 'd' && !isInput) {
      event.preventDefault();
      const selected = getSelectedNodes.value;
      const ids = selected.length > 0
        ? selected.map(n => n.id)
        : diagrams.selectedNodeId ? [diagrams.selectedNodeId] : [];
      if (ids.length > 0) {
        const newIds = diagrams.duplicateNodes(ids, 40, 40);
        if (newIds.length > 0) {
          for (const node of getNodes.value) {
            node.selected = false;
          }
          const newVfNodes = newIds
            .map(id => diagrams.nodes.find(n => n.id === id))
            .filter(Boolean)
            .map(n => ({ ...n! }));
          addNodes(newVfNodes);
          const newEdges = diagrams.edges
            .filter(e => newIds.includes(e.source) && newIds.includes(e.target))
            .map(e => ({ ...e }));
          if (newEdges.length) addEdges(newEdges);
          nextTick(() => {
            for (const id of newIds) {
              const vfNode = findNode(id);
              if (vfNode) vfNode.selected = true;
            }
          });
        }
      }
      return;
    }

    if (event.key === 'Escape') {
      diagrams.selectNode(null);
      diagrams.selectEdge(null);
      for (const node of getNodes.value) {
        node.selected = false;
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown);
  });

  return {
    commitInlineEdgeLabel,
    cancelInlineEdgeLabel,
    onDragOver,
    onDrop,
  };
}
