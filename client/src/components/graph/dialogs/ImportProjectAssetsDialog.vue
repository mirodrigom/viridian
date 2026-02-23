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
import type { GraphNodeType } from '@/types/graph';

interface AgentAsset {
  label: string;
  description: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: string;
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
const loading = ref(false);
const agents = ref<AgentAsset[]>([]);
const skills = ref<SkillAsset[]>([]);
const mcps = ref<McpAsset[]>([]);
const rules = ref<RuleAsset[]>([]);

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

function computeStartPosition() {
  if (graph.nodes.length === 0) return { x: 100, y: 50 };
  const maxX = Math.max(...graph.nodes.map(n => n.position.x));
  return { x: maxX + 350, y: 50 };
}

function onImport() {
  const { x: startX, y: startY } = computeStartPosition();
  const COL = 250;
  const ROW = 170;
  const nodesToAdd: Array<{ type: GraphNodeType; position: { x: number; y: number }; data: Record<string, unknown> }> = [];

  // Column 0: agents
  let row = 0;
  for (const i of [...selectedAgents.value].sort((a, b) => a - b)) {
    const a = agents.value[i];
    nodesToAdd.push({
      type: 'agent',
      position: { x: startX, y: startY + row * ROW },
      data: {
        label: a.label,
        description: a.description,
        model: a.model,
        systemPrompt: a.systemPrompt,
        allowedTools: a.allowedTools,
        disallowedTools: a.disallowedTools,
        permissionMode: a.permissionMode,
      },
    });
    row++;
  }

  // Column 1: skills
  row = 0;
  for (const i of [...selectedSkills.value].sort((a, b) => a - b)) {
    const s = skills.value[i];
    nodesToAdd.push({
      type: 'skill',
      position: { x: startX + COL, y: startY + row * ROW },
      data: {
        label: s.label,
        description: s.description,
        command: s.command,
        promptTemplate: s.promptTemplate,
        allowedTools: s.allowedTools,
      },
    });
    row++;
  }

  // Column 2: MCPs
  row = 0;
  for (const i of [...selectedMcps.value].sort((a, b) => a - b)) {
    const m = mcps.value[i];
    nodesToAdd.push({
      type: 'mcp',
      position: { x: startX + COL * 2, y: startY + row * ROW },
      data: {
        label: m.label,
        serverType: m.serverType,
        command: m.command,
        args: m.args,
        url: m.url,
        env: m.env,
        headers: m.headers,
      },
    });
    row++;
  }

  // Column 3: rules
  row = 0;
  for (const i of [...selectedRules.value].sort((a, b) => a - b)) {
    const r = rules.value[i];
    nodesToAdd.push({
      type: 'rule',
      position: { x: startX + COL * 3, y: startY + row * ROW },
      data: {
        label: r.label,
        ruleText: r.ruleText,
        ruleType: r.ruleType,
        scope: r.scope,
      },
    });
    row++;
  }

  if (nodesToAdd.length === 0) {
    toast.error('No assets selected');
    return;
  }

  graph.importNodes(nodesToAdd);
  open.value = false;
  toast.success(`Imported ${nodesToAdd.length} node${nodesToAdd.length !== 1 ? 's' : ''} from project`);
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
