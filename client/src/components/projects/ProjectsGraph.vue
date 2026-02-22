<script setup lang="ts">
import { computed, watch, nextTick } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import type { Node, Edge } from '@vue-flow/core';
import { useProjectsStore } from '@/stores/projects';
import type { Project } from '@/types/projects';
import ProjectNode from './nodes/ProjectNode.vue';
import ServiceNode from './nodes/ServiceNode.vue';
import AgentNode from './nodes/AgentNode.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const store = useProjectsStore();
const { fitView, setNodes, setEdges } = useVueFlow('projects-graph');

// ─── Graph layout computation ────────────────────────────────────────────────

const PROJECT_X_SPACING = 680;
const SERVICE_X_SPACING = 220;
const SERVICE_Y = 240;
const AGENT_Y = 0;
const PROJECT_Y = 0;

function buildGraph(projects: Project[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  projects.forEach((project, pi) => {
    const baseX = pi * PROJECT_X_SPACING;

    // Project node (left side of each column)
    nodes.push({
      id: `project-${project.id}`,
      type: 'project',
      position: { x: baseX, y: PROJECT_Y },
      draggable: false,
      connectable: false,
      data: { project },
    });

    // Service nodes (below project)
    const svcCount = project.services.length;
    project.services.forEach((service, si) => {
      const offsetX = (si - (svcCount - 1) / 2) * SERVICE_X_SPACING;
      const sx = baseX + 110 + offsetX;
      nodes.push({
        id: `service-${service.id}`,
        type: 'service',
        position: { x: sx, y: SERVICE_Y },
        draggable: false,
        connectable: false,
        data: { service, projectId: project.id },
      });
      edges.push({
        id: `e-proj-${project.id}-svc-${service.id}`,
        source: `project-${project.id}`,
        target: `service-${service.id}`,
        animated: service.status === 'running',
        style: {
          stroke: service.status === 'running' ? 'var(--primary)' : 'var(--border)',
          strokeWidth: service.status === 'running' ? 2 : 1,
        },
      });
    });

    // Agent node (right of project)
    nodes.push({
      id: `agent-${project.id}`,
      type: 'agent',
      position: { x: baseX + 320, y: AGENT_Y },
      draggable: false,
      connectable: false,
      data: { project },
    });
    edges.push({
      id: `e-proj-${project.id}-agent`,
      source: `project-${project.id}`,
      target: `agent-${project.id}`,
      animated: project.agentStatus === 'active',
      style: {
        stroke: project.agentStatus === 'active' ? 'oklch(0.6 0.2 290)' : 'var(--border)',
        strokeDasharray: project.agentStatus === 'active' ? undefined : '5 4',
        strokeWidth: project.agentStatus === 'active' ? 2 : 1,
        opacity: project.agentStatus === 'active' ? 1 : 0.5,
      },
    });
  });

  return { nodes, edges };
}

// ─── Reactivity: rebuild graph whenever projects or their statuses change ─────

// Use a deep-ish computed to detect status changes
const graphKey = computed(() =>
  store.projects.map(p => [
    p.id,
    p.agentStatus,
    ...p.services.map(s => `${s.id}:${s.status}`),
  ].join('|')).join(';'),
);

watch(graphKey, async () => {
  const { nodes, edges } = buildGraph(store.projects);
  setNodes(nodes);
  setEdges(edges);
  await nextTick();
}, { immediate: false });

// Initial render when component mounts (after projects are loaded)
watch(() => store.projects.length, async (len) => {
  if (len === 0) return;
  const { nodes, edges } = buildGraph(store.projects);
  setNodes(nodes);
  setEdges(edges);
  await nextTick();
  setTimeout(() => fitView({ padding: 0.15 }), 80);
}, { immediate: true });
</script>

<template>
  <VueFlow
    id="projects-graph"
    :fit-view-on-init="true"
    :zoom-on-scroll="true"
    :pan-on-scroll="false"
    :nodes-draggable="false"
    :nodes-connectable="false"
    :elements-selectable="false"
    class="projects-graph-canvas"
  >
    <template #node-project="nodeProps">
      <ProjectNode v-bind="nodeProps" />
    </template>
    <template #node-service="nodeProps">
      <ServiceNode v-bind="nodeProps" />
    </template>
    <template #node-agent="nodeProps">
      <AgentNode v-bind="nodeProps" />
    </template>

    <template #default>
      <Background :gap="15" :size="1" pattern-color="var(--border)" />
      <MiniMap class="!bottom-4 !right-4" />
      <Controls class="!bottom-4 !left-4" />

      <!-- Empty state -->
      <div
        v-if="store.projects.length === 0 && !store.loading"
        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"
      >
        <p class="text-sm">No projects yet.</p>
        <p class="text-xs opacity-60">Click "Add Project" to register your first project.</p>
      </div>
    </template>
  </VueFlow>
</template>

<style>
.projects-graph-canvas {
  --vf-node-bg: var(--card);
  --vf-node-text: var(--card-foreground);
  --vf-edge-stroke: var(--border);
  --vf-handle: var(--primary);
  background: var(--background);
  height: 100%;
  width: 100%;
}

/* Remove default VueFlow selection outlines (read-only graph) */
.projects-graph-canvas .vue-flow__node:focus,
.projects-graph-canvas .vue-flow__node:focus-visible {
  outline: none;
}
</style>
