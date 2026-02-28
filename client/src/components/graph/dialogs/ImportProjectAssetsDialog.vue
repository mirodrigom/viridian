<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Bot, Zap, Server, ShieldCheck, FolderSearch, Check } from 'lucide-vue-next';
import type { GraphNodeType, NodeData } from '@/types/graph';
import { useMetadataGenerator } from '@/composables/useMetadataGenerator';
import { DEFAULT_AGENT_METADATA, type AgentMetadata } from '@/types/agent-metadata';

interface AgentAsset {
  label: string;
  description: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: string;
  metadata?: AgentMetadata;
}

interface SkillAsset {
  label: string;
  description: string;
  command: string;
  promptTemplate: string;
  allowedTools: string[];
}

interface McpAsset {
  label: string;
  serverType: string;
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  headers: Record<string, string>;
}

interface RuleAsset {
  label: string;
  ruleText: string;
  ruleType: string;
  scope: string;
}

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ cwd: string }>();

const graph = useGraphStore();
const { generating, generateForGraph } = useMetadataGenerator();
const loading = ref(false);
const agents = ref<AgentAsset[]>([]);
const skills = ref<SkillAsset[]>([]);
const mcps = ref<McpAsset[]>([]);
const rules = ref<RuleAsset[]>([]);
const hasClaudeMd = ref(false);

const selectedAgents = ref(new Set<number>());
const selectedSkills = ref(new Set<number>());
const selectedMcps = ref(new Set<number>());
const selectedRules = ref(new Set<number>());

const totalSelected = computed(() =>
  selectedAgents.value.size + selectedSkills.value.size +
  selectedMcps.value.size + selectedRules.value.size,
);

const hasAssets = computed(() =>
  agents.value.length + skills.value.length + mcps.value.length + rules.value.length > 0,
);

async function fetchAssets() {
  if (!props.cwd) return;
  loading.value = true;
  agents.value = [];
  skills.value = [];
  mcps.value = [];
  rules.value = [];
  selectedAgents.value = new Set();
  selectedSkills.value = new Set();
  selectedMcps.value = new Set();
  selectedRules.value = new Set();

  try {
    const res = await apiFetch(`/api/graphs/project-assets?cwd=${encodeURIComponent(props.cwd)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    agents.value = data.agents || [];
    skills.value = data.skills || [];
    mcps.value = data.mcps || [];
    rules.value = data.rules || [];
    hasClaudeMd.value = data.hasClaudeMd || false;

    // Auto-select all by default
    agents.value.forEach((_, i) => selectedAgents.value.add(i));
    skills.value.forEach((_, i) => selectedSkills.value.add(i));
    mcps.value.forEach((_, i) => selectedMcps.value.add(i));
    rules.value.forEach((_, i) => selectedRules.value.add(i));
  } catch {
    toast.error('Failed to read project assets');
  } finally {
    loading.value = false;
  }
}

watch(open, (v) => { if (v) fetchAssets(); });

function toggle(set: Set<number>, i: number) {
  if (set.has(i)) set.delete(i);
  else set.add(i);
}

function toggleAll(set: Set<number>, count: number) {
  if (set.size === count) {
    set.clear();
  } else {
    for (let i = 0; i < count; i++) set.add(i);
  }
}

// Edge handle map for creating edges programmatically
const EDGE_HANDLE_MAP: Record<string, { sourceHandle: string; targetHandle: string }> = {
  'delegation':      { sourceHandle: 'delegation-out', targetHandle: 'delegation-in' },
  'skill-usage':     { sourceHandle: 'skill-out',      targetHandle: 'skill-in' },
  'tool-access':     { sourceHandle: 'tool-out',       targetHandle: 'tool-in' },
  'rule-constraint': { sourceHandle: 'rule-out',       targetHandle: 'rule-in' },
};

function onImport() {
  const selectedAgentList = [...selectedAgents.value].sort((a, b) => a - b).map(i => agents.value[i]);
  const selectedSkillList = [...selectedSkills.value].sort((a, b) => a - b).map(i => skills.value[i]);
  const selectedMcpList = [...selectedMcps.value].sort((a, b) => a - b).map(i => mcps.value[i]);
  const selectedRuleList = [...selectedRules.value].sort((a, b) => a - b).map(i => rules.value[i]);

  const totalCount = selectedAgentList.length + selectedSkillList.length + selectedMcpList.length + selectedRuleList.length;
  if (totalCount === 0) {
    toast.error('No assets selected');
    return;
  }

  // 1. Clear canvas — fresh start
  graph.newGraph();

  // 2. Determine if orchestrator is needed
  const needsOrchestrator = selectedAgentList.length >= 2;
  const nodesToAdd: Array<{ type: GraphNodeType; position: { x: number; y: number }; data: Record<string, unknown> }> = [];

  // 3a. Check if any imported agent IS an orchestrator (by label or metadata)
  const orchestratorIndex = needsOrchestrator
    ? selectedAgentList.findIndex(a =>
        /orchestrator/i.test(a.label) ||
        (a.metadata as AgentMetadata)?.domain === 'orchestrator')
    : -1;
  const importedOrchestrator = orchestratorIndex >= 0 ? selectedAgentList[orchestratorIndex] : null;

  // 3b. Create synthetic orchestrator only if needed AND none was found in imports
  if (needsOrchestrator && !importedOrchestrator) {
    nodesToAdd.push({
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'Orchestrator Agent',
        description: '',
        model: 'claude-opus-4-6',
        systemPrompt: '',
        permissionMode: 'bypassPermissions',
        maxTokens: 200000,
        allowedTools: [],
        disallowedTools: [],
        metadata: { ...DEFAULT_AGENT_METADATA },
      },
    });
  }

  // 3c. Add agents — promote imported orchestrator to top-level agent, rest as subagents
  for (const a of selectedAgentList) {
    const isTheOrchestrator = importedOrchestrator && a === importedOrchestrator;
    const nodeType: GraphNodeType = isTheOrchestrator ? 'agent' : (needsOrchestrator ? 'subagent' : 'agent');
    nodesToAdd.push({
      type: nodeType,
      position: { x: 0, y: 0 },
      data: {
        label: a.label,
        description: a.description,
        model: a.model,
        systemPrompt: a.systemPrompt,
        ...(nodeType === 'subagent'
          ? { taskDescription: a.description || '' }
          : { allowedTools: a.allowedTools, disallowedTools: a.disallowedTools, maxTokens: 200000 }),
        permissionMode: a.permissionMode,
        metadata: a.metadata || { ...DEFAULT_AGENT_METADATA },
      },
    });
  }

  // 3c. Skills, MCPs, Rules
  for (const s of selectedSkillList) {
    nodesToAdd.push({
      type: 'skill',
      position: { x: 0, y: 0 },
      data: { label: s.label, description: s.description, command: s.command, promptTemplate: s.promptTemplate, allowedTools: s.allowedTools },
    });
  }
  for (const m of selectedMcpList) {
    nodesToAdd.push({
      type: 'mcp',
      position: { x: 0, y: 0 },
      data: { label: m.label, serverType: m.serverType, command: m.command, args: m.args, url: m.url, env: m.env, headers: m.headers },
    });
  }
  for (const r of selectedRuleList) {
    nodesToAdd.push({
      type: 'rule',
      position: { x: 0, y: 0 },
      data: { label: r.label, ruleText: r.ruleText, ruleType: r.ruleType, scope: r.scope },
    });
  }

  // 4. Import all nodes (positions will be overridden by autoLayout)
  graph.importNodes(nodesToAdd);

  // 5. Create edges — map labels to node IDs
  const nodesByLabel = new Map<string, string>();
  const executableNodeIds: string[] = []; // agents, subagents, experts (non-orchestrator)
  const skillNodeIds: string[] = [];
  const mcpNodeIds: string[] = [];
  const ruleNodeIds: string[] = [];
  let orchestratorId: string | null = null;

  const executableTypes = new Set(['agent', 'subagent', 'expert']);
  for (const n of graph.nodes) {
    const d = n.data as NodeData;
    nodesByLabel.set(d.label, n.id);
    if (d.nodeType === 'agent') {
      const orchestratorLabel = importedOrchestrator ? importedOrchestrator.label : 'Orchestrator Agent';
      if (needsOrchestrator && d.label === orchestratorLabel) {
        orchestratorId = n.id;
        continue;
      }
    }
    if (executableTypes.has(d.nodeType)) executableNodeIds.push(n.id);
    if (d.nodeType === 'skill') skillNodeIds.push(n.id);
    if (d.nodeType === 'mcp') mcpNodeIds.push(n.id);
    if (d.nodeType === 'rule') ruleNodeIds.push(n.id);
  }

  // Orchestrator → each subagent/expert (delegation)
  if (orchestratorId) {
    for (const subId of executableNodeIds) {
      const handles = EDGE_HANDLE_MAP['delegation'];
      graph.addEdge({ source: orchestratorId, target: subId, sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle });
    }
  }

  // Each executable node → skills (skill-usage), mcps (tool-access)
  for (const nodeId of executableNodeIds) {
    for (const skillId of skillNodeIds) {
      const handles = EDGE_HANDLE_MAP['skill-usage'];
      graph.addEdge({ source: nodeId, target: skillId, sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle });
    }
    for (const mcpId of mcpNodeIds) {
      const handles = EDGE_HANDLE_MAP['tool-access'];
      graph.addEdge({ source: nodeId, target: mcpId, sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle });
    }
  }

  // Rules → ALL executable nodes (orchestrator + agents + subagents + experts)
  // Rules are global constraints that apply to every executable node
  const allExecutableIds = orchestratorId
    ? [orchestratorId, ...executableNodeIds]
    : executableNodeIds;
  for (const nodeId of allExecutableIds) {
    for (const ruleId of ruleNodeIds) {
      const handles = EDGE_HANDLE_MAP['rule-constraint'];
      graph.addEdge({ source: nodeId, target: ruleId, sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle });
    }
  }

  // 6. Auto-layout
  graph.autoLayout();

  open.value = false;
  toast.success(`Imported ${totalCount} node${totalCount !== 1 ? 's' : ''} from project`);

  // 7. Inform about missing CLAUDE.md (only if the file doesn't exist at all)
  if (!hasClaudeMd.value) {
    toast.info('No CLAUDE.md found. Consider creating one to define project rules.', { duration: 6000 });
  }

  // 8. Auto-generate metadata for agent nodes that lack metadata
  const nodesNeedingMeta = graph.nodes.filter(n => {
    const d = n.data as NodeData;
    return executableTypes.has(d.nodeType) && (!d.metadata || (d.metadata as AgentMetadata).tags?.length === 0);
  });
  if (nodesNeedingMeta.length > 0) {
    toast.info('Generating agent metadata...', { duration: 10000, id: 'meta-gen' });
    const graphData = {
      nodes: graph.nodes.map(n => ({ id: n.id, type: (n.data as NodeData).nodeType, data: n.data })),
      edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, data: e.data })),
    };
    generateForGraph(graphData, props.cwd).then((results) => {
      for (const r of results) {
        graph.updateNodeData(r.nodeId, { metadata: r.metadata } as Partial<NodeData>);
      }
      if (results.length > 0) {
        toast.success(`Generated metadata for ${results.length} agent(s)`, { id: 'meta-gen' });
      } else {
        toast.dismiss('meta-gen');
      }
    });
  }
}

const modelShort: Record<string, string> = {
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderSearch class="h-4 w-4 text-primary" />
          Import from Project
        </DialogTitle>
        <DialogDescription class="font-mono text-[11px] truncate">
          {{ cwd || 'No project selected' }}
        </DialogDescription>
      </DialogHeader>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        Scanning .claude/ directory…
      </div>

      <!-- Empty -->
      <div v-else-if="!hasAssets" class="py-10 text-center text-sm text-muted-foreground">
        <FolderSearch class="mx-auto mb-2 h-8 w-8 opacity-30" />
        No agents, skills, MCPs or rules found in this project.
        <p class="mt-1 text-xs opacity-60">Use "Export as .claude/" to create them first.</p>
      </div>

      <!-- Assets list -->
      <ScrollArea v-else class="max-h-[420px] w-full">
        <div class="space-y-4 pr-3">

          <!-- Agents -->
          <div v-if="agents.length > 0">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Bot class="h-3.5 w-3.5" /> Agents ({{ agents.length }})
              </span>
              <button
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="toggleAll(selectedAgents, agents.length)"
              >
                {{ selectedAgents.size === agents.length ? 'Deselect all' : 'Select all' }}
              </button>
            </div>
            <div class="space-y-1">
              <div
                v-for="(agent, i) in agents"
                :key="`agent-${i}`"
                class="flex cursor-pointer items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors"
                :class="selectedAgents.has(i) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'"
                @click="toggle(selectedAgents, i)"
              >
                <div
                  class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors"
                  :class="selectedAgents.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'"
                >
                  <Check v-if="selectedAgents.has(i)" class="h-3 w-3" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{{ agent.label }}</span>
                    <Badge variant="outline" class="flex-shrink-0 px-1 py-0 text-[10px]">
                      {{ modelShort[agent.model] || agent.model }}
                    </Badge>
                  </div>
                  <p v-if="agent.description" class="line-clamp-2 text-[11px] text-muted-foreground">{{ agent.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Skills -->
          <div v-if="skills.length > 0">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Zap class="h-3.5 w-3.5" /> Skills ({{ skills.length }})
              </span>
              <button
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="toggleAll(selectedSkills, skills.length)"
              >
                {{ selectedSkills.size === skills.length ? 'Deselect all' : 'Select all' }}
              </button>
            </div>
            <div class="space-y-1">
              <div
                v-for="(skill, i) in skills"
                :key="`skill-${i}`"
                class="flex cursor-pointer items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors"
                :class="selectedSkills.has(i) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'"
                @click="toggle(selectedSkills, i)"
              >
                <div
                  class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors"
                  :class="selectedSkills.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'"
                >
                  <Check v-if="selectedSkills.has(i)" class="h-3 w-3" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{{ skill.label }}</span>
                    <code class="flex-shrink-0 text-[10px] text-muted-foreground">{{ skill.command }}</code>
                  </div>
                  <p v-if="skill.description" class="line-clamp-2 text-[11px] text-muted-foreground">{{ skill.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- MCPs -->
          <div v-if="mcps.length > 0">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Server class="h-3.5 w-3.5" /> MCP Servers ({{ mcps.length }})
              </span>
              <button
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="toggleAll(selectedMcps, mcps.length)"
              >
                {{ selectedMcps.size === mcps.length ? 'Deselect all' : 'Select all' }}
              </button>
            </div>
            <div class="space-y-1">
              <div
                v-for="(mcp, i) in mcps"
                :key="`mcp-${i}`"
                class="flex cursor-pointer items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors"
                :class="selectedMcps.has(i) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'"
                @click="toggle(selectedMcps, i)"
              >
                <div
                  class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors"
                  :class="selectedMcps.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'"
                >
                  <Check v-if="selectedMcps.has(i)" class="h-3 w-3" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{{ mcp.label }}</span>
                    <Badge variant="outline" class="flex-shrink-0 px-1 py-0 text-[10px]">{{ mcp.serverType }}</Badge>
                  </div>
                  <code v-if="mcp.command" class="block truncate text-[10px] text-muted-foreground">{{ mcp.command }}</code>
                  <code v-else-if="mcp.url" class="block truncate text-[10px] text-muted-foreground">{{ mcp.url }}</code>
                </div>
              </div>
            </div>
          </div>

          <!-- Rules -->
          <div v-if="rules.length > 0">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <ShieldCheck class="h-3.5 w-3.5" /> Rules ({{ rules.length }})
              </span>
              <button
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="toggleAll(selectedRules, rules.length)"
              >
                {{ selectedRules.size === rules.length ? 'Deselect all' : 'Select all' }}
              </button>
            </div>
            <div class="space-y-1">
              <div
                v-for="(rule, i) in rules"
                :key="`rule-${i}`"
                class="flex cursor-pointer items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-sm transition-colors"
                :class="selectedRules.has(i) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'"
                @click="toggle(selectedRules, i)"
              >
                <div
                  class="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors"
                  :class="selectedRules.has(i) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'"
                >
                  <Check v-if="selectedRules.has(i)" class="h-3 w-3" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{{ rule.label }}</span>
                    <Badge variant="outline" class="flex-shrink-0 px-1 py-0 text-[10px]">{{ rule.ruleType }}</Badge>
                  </div>
                  <p class="line-clamp-2 text-[11px] text-muted-foreground">{{ rule.ruleText }}</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </ScrollArea>

      <DialogFooter v-if="!loading && hasAssets">
        <span class="mr-auto text-xs text-muted-foreground">{{ totalSelected }} selected</span>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="totalSelected === 0" @click="onImport">
          Import {{ totalSelected > 0 ? totalSelected : '' }} node{{ totalSelected !== 1 ? 's' : '' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
