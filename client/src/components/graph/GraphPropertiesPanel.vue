<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { NODE_CONFIG } from '@/types/graph';
import type { NodeData, AgentNodeData, SubagentNodeData, ExpertNodeData, SkillNodeData, McpNodeData, RuleNodeData, GraphEdgeData } from '@/types/graph';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck, X, Loader2, ChevronRight,
  Tags, ArrowDownToLine, ArrowUpFromLine, Plus, Globe,
} from 'lucide-vue-next';
import type { AgentMetadata, AgentDomain } from '@/types/agent-metadata';
import { DEFAULT_AGENT_METADATA } from '@/types/agent-metadata';

const graph = useGraphStore();

const node = computed(() => graph.selectedNode);
const data = computed(() => node.value?.data as NodeData | null);
const config = computed(() => data.value ? NODE_CONFIG[data.value.nodeType] : null);

const icons = { agent: Bot, subagent: GitBranch, expert: Sparkles, skill: Zap, mcp: Server, rule: ShieldCheck };

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

const DOMAIN_OPTIONS: { value: AgentDomain; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'devops', label: 'DevOps' },
  { value: 'data', label: 'Data' },
  { value: 'security', label: 'Security' },
  { value: 'testing', label: 'Testing' },
  { value: 'docs', label: 'Docs' },
];

const advancedOpen = ref(false);
const tagInput = ref('');
const tagInputEl = ref<HTMLInputElement | null>(null);

const isExecutableNode = computed(() =>
  data.value?.nodeType === 'agent' || data.value?.nodeType === 'subagent' || data.value?.nodeType === 'expert',
);

const metadata = computed<AgentMetadata>(() =>
  (data.value as { metadata?: AgentMetadata })?.metadata || { ...DEFAULT_AGENT_METADATA },
);

// ─── From / To derived from graph edges ─────────────────────────────
const fromNodes = computed(() => {
  if (!node.value) return [];
  return graph.edges
    .filter(e => e.target === node.value!.id && (e.data as GraphEdgeData)?.edgeType === 'delegation')
    .map(e => {
      const n = graph.nodes.find(n => n.id === e.source);
      return n ? (n.data as NodeData).label : null;
    })
    .filter(Boolean) as string[];
});

const toNodes = computed(() => {
  if (!node.value) return [];
  return graph.edges
    .filter(e => e.source === node.value!.id && (e.data as GraphEdgeData)?.edgeType === 'delegation')
    .map(e => {
      const n = graph.nodes.find(n => n.id === e.target);
      return n ? (n.data as NodeData).label : null;
    })
    .filter(Boolean) as string[];
});

// ─── Tag management ─────────────────────────────────────────────────
function updateMeta(partial: Partial<AgentMetadata>) {
  if (!node.value) return;
  const updated = { ...metadata.value, ...partial };
  graph.updateNodeData(node.value.id, { metadata: updated } as Partial<NodeData>);
}

function addTag() {
  const raw = tagInput.value.trim().toLowerCase();
  if (!raw) return;
  // Support comma-separated input
  const newTags = raw.split(',').map(t => t.trim()).filter(Boolean);
  const existing = new Set(metadata.value.tags);
  const toAdd = newTags.filter(t => !existing.has(t));
  if (toAdd.length > 0) {
    updateMeta({ tags: [...metadata.value.tags, ...toAdd] });
  }
  tagInput.value = '';
}

function removeTag(tag: string) {
  updateMeta({ tags: metadata.value.tags.filter(t => t !== tag) });
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag();
  }
  if (e.key === 'Backspace' && tagInput.value === '' && metadata.value.tags.length > 0) {
    removeTag(metadata.value.tags[metadata.value.tags.length - 1]!);
  }
}

const nodeId = computed(() => node.value?.id || null);

function update(field: string, value: unknown) {
  if (!node.value) return;
  graph.updateNodeData(node.value.id, { [field]: value } as Partial<NodeData>);
}
</script>

<template>
  <div data-testid="graph-properties-panel" class="flex h-full flex-col overflow-hidden border-l border-border bg-background">
    <!-- Properties form -->
    <template v-if="data && config">
      <!-- Section header (matches left sidebar style) -->
      <div class="flex h-7 shrink-0 items-center border-b border-border px-3">
        <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Properties</span>
        <div class="flex-1" />
        <button class="rounded p-0.5 hover:bg-accent" @click="graph.selectNode(null)">
          <X class="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      <!-- Node type header -->
      <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3" :class="config.accentClass">
        <component :is="icons[data.nodeType]" class="h-3.5 w-3.5 shrink-0" />
        <span class="text-xs font-medium">{{ config.label }}</span>
      </div>

      <ScrollArea class="relative min-h-0 flex-1">
        <!-- Blocking overlay while generating -->
        <div
          v-if="graph.generatingPrompt"
          class="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
        >
          <div class="flex flex-col items-center gap-2">
            <Loader2 class="h-5 w-5 animate-spin text-primary" />
            <span class="text-xs text-muted-foreground">Generating...</span>
          </div>
        </div>

        <div class="space-y-4 p-3">
          <!-- Common: Label -->
          <div class="space-y-1.5">
            <Label class="text-xs">Label</Label>
            <Input :model-value="data.label" class="h-8 text-sm" @update:model-value="update('label', $event)" />
          </div>

          <!-- Common: Description (auto-generated from system prompt, read-only) -->
          <div class="space-y-1.5">
            <Label class="text-xs">Description</Label>
            <p v-if="data.description" class="rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {{ data.description }}
            </p>
            <p v-else class="text-[10px] italic text-muted-foreground/40">
              Generate a system prompt to see description
            </p>
          </div>

          <!-- ─── Tags (agent/subagent/expert only, always visible) ──── -->
          <template v-if="isExecutableNode">
            <div class="space-y-1.5">
              <Label class="flex items-center gap-1.5 text-xs">
                <Tags class="h-3 w-3 text-muted-foreground" />
                Tags
              </Label>
              <div
                class="flex min-h-[32px] flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-within:ring-1 focus-within:ring-ring"
                @click="tagInputEl?.focus()"
              >
                <Badge
                  v-for="tag in metadata.tags"
                  :key="tag"
                  variant="secondary"
                  class="gap-0.5 px-1.5 py-0 text-[10px]"
                >
                  {{ tag }}
                  <button
                    class="ml-0.5 rounded-full p-0 hover:bg-muted-foreground/20"
                    @click.stop="removeTag(tag)"
                  >
                    <X class="h-2.5 w-2.5" />
                  </button>
                </Badge>
                <input
                  ref="tagInputEl"
                  v-model="tagInput"
                  class="min-w-[60px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                  placeholder="Add tag..."
                  @keydown="onTagKeydown"
                  @blur="addTag()"
                />
              </div>
              <p class="text-[10px] text-muted-foreground/60">Press Enter or comma to add</p>
            </div>

            <!-- Domain -->
            <div class="space-y-1.5">
              <Label class="flex items-center gap-1.5 text-xs">
                <Globe class="h-3 w-3 text-muted-foreground" />
                Domain
              </Label>
              <Select :model-value="metadata.domain" @update:model-value="updateMeta({ domain: $event as AgentDomain })">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue placeholder="Select domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in DOMAIN_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- From (read-only, derived from edges) -->
            <div class="space-y-1.5">
              <Label class="flex items-center gap-1.5 text-xs">
                <ArrowDownToLine class="h-3 w-3 text-muted-foreground" />
                From
                <span class="text-[10px] text-muted-foreground/50">(incoming delegations)</span>
              </Label>
              <div v-if="fromNodes.length" class="flex flex-wrap gap-1">
                <Badge
                  v-for="lbl in fromNodes"
                  :key="lbl"
                  variant="outline"
                  class="gap-1 px-1.5 py-0 text-[10px] text-primary"
                >
                  <ArrowDownToLine class="h-2.5 w-2.5" />
                  {{ lbl }}
                </Badge>
              </div>
              <p v-else class="text-[10px] italic text-muted-foreground/40">No incoming delegations</p>
            </div>

            <!-- To (read-only, derived from edges) -->
            <div class="space-y-1.5">
              <Label class="flex items-center gap-1.5 text-xs">
                <ArrowUpFromLine class="h-3 w-3 text-muted-foreground" />
                To
                <span class="text-[10px] text-muted-foreground/50">(outgoing delegations)</span>
              </Label>
              <div v-if="toNodes.length" class="flex flex-wrap gap-1">
                <Badge
                  v-for="lbl in toNodes"
                  :key="lbl"
                  variant="outline"
                  class="gap-1 px-1.5 py-0 text-[10px] text-chart-2"
                >
                  <ArrowUpFromLine class="h-2.5 w-2.5" />
                  {{ lbl }}
                </Badge>
              </div>
              <p v-else class="text-[10px] italic text-muted-foreground/40">No outgoing delegations</p>
            </div>
          </template>

          <Separator />

          <!-- Agent / Subagent / Expert: Model -->
          <template v-if="data.nodeType === 'agent' || data.nodeType === 'subagent' || data.nodeType === 'expert'">
            <div class="space-y-1.5">
              <Label class="text-xs">Model</Label>
              <Select :model-value="(data as AgentNodeData | SubagentNodeData | ExpertNodeData).model" @update:model-value="update('model', $event)">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in MODEL_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </template>

          <!-- Agent / Subagent / Expert: System Prompt -->
          <template v-if="data.nodeType === 'agent' || data.nodeType === 'subagent' || data.nodeType === 'expert'">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <Label class="text-xs">System Prompt</Label>
                <Button
                  variant="ghost" size="sm" class="h-6 w-6 p-0"
                  :disabled="graph.generatingPrompt"
                  title="Generate system prompt with AI"
                  @click="nodeId && graph.generatePrompt(nodeId)"
                >
                  <Loader2 v-if="graph.generatingPrompt" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <Sparkles v-else class="h-3.5 w-3.5 text-yellow-500 hover:text-yellow-400" />
                </Button>
              </div>
              <Textarea
                :model-value="(data as AgentNodeData | SubagentNodeData | ExpertNodeData).systemPrompt"
                class="min-h-[100px] max-h-[150px] overflow-y-auto !field-sizing-normal text-xs"
                placeholder="Enter system prompt..."
                :disabled="graph.generatingPrompt"
                @update:model-value="update('systemPrompt', $event)"
              />
            </div>
          </template>

          <!-- Subagent: Task Description -->
          <template v-if="data.nodeType === 'subagent'">
            <div class="space-y-1.5">
              <Label class="text-xs">Task Description</Label>
              <Textarea
                :model-value="(data as SubagentNodeData).taskDescription"
                class="min-h-[80px] max-h-[100px] overflow-y-auto !field-sizing-normal text-xs"
                placeholder="What this subagent is delegated to do..."
                @update:model-value="update('taskDescription', $event)"
              />
            </div>
          </template>

          <!-- Expert: Specialty -->
          <template v-if="data.nodeType === 'expert'">
            <div class="space-y-1.5">
              <Label class="text-xs">Specialty</Label>
              <Input
                :model-value="(data as ExpertNodeData).specialty"
                class="h-8 text-sm"
                placeholder="e.g. security-review"
                @update:model-value="update('specialty', $event)"
              />
            </div>
          </template>

          <!-- Skill: Command & Prompt Template -->
          <template v-if="data.nodeType === 'skill'">
            <div class="space-y-1.5">
              <Label class="text-xs">Command</Label>
              <Input
                :model-value="(data as SkillNodeData).command"
                class="h-8 font-mono text-sm"
                placeholder="/commit"
                @update:model-value="update('command', $event)"
              />
            </div>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <Label class="text-xs">Prompt Template</Label>
                <Button
                  variant="ghost" size="sm" class="h-6 w-6 p-0"
                  :disabled="graph.generatingPrompt"
                  title="Generate prompt template with AI"
                  @click="nodeId && graph.generatePrompt(nodeId)"
                >
                  <Loader2 v-if="graph.generatingPrompt" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <Sparkles v-else class="h-3.5 w-3.5 text-yellow-500 hover:text-yellow-400" />
                </Button>
              </div>
              <Textarea
                :model-value="(data as SkillNodeData).promptTemplate"
                class="min-h-[100px] max-h-[150px] overflow-y-auto !field-sizing-normal font-mono text-xs"
                placeholder="Skill prompt template..."
                :disabled="graph.generatingPrompt"
                @update:model-value="update('promptTemplate', $event)"
              />
            </div>
          </template>

          <!-- MCP: Server config -->
          <template v-if="data.nodeType === 'mcp'">
            <div class="space-y-1.5">
              <Label class="text-xs">Server Type</Label>
              <Select :model-value="(data as McpNodeData).serverType" @update:model-value="update('serverType', $event)">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <template v-if="(data as McpNodeData).serverType === 'stdio'">
              <div class="space-y-1.5">
                <Label class="text-xs">Command</Label>
                <Input
                  :model-value="(data as McpNodeData).command || ''"
                  class="h-8 font-mono text-sm"
                  placeholder="npx @mcp/server"
                  @update:model-value="update('command', $event)"
                />
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Arguments</Label>
                <Input
                  :model-value="(data as McpNodeData).args?.join(' ') || ''"
                  class="h-8 font-mono text-sm"
                  placeholder="--port 3000"
                  @update:model-value="update('args', ($event as string).split(' ').filter(Boolean))"
                />
              </div>
            </template>

            <template v-else>
              <div class="space-y-1.5">
                <Label class="text-xs">URL</Label>
                <Input
                  :model-value="(data as McpNodeData).url || ''"
                  class="h-8 font-mono text-sm"
                  placeholder="http://localhost:3000"
                  @update:model-value="update('url', $event)"
                />
              </div>
            </template>
          </template>

          <!-- Rule: Type, Scope, Text -->
          <template v-if="data.nodeType === 'rule'">
            <div class="space-y-1.5">
              <Label class="text-xs">Rule Type</Label>
              <Select :model-value="(data as RuleNodeData).ruleType" @update:model-value="update('ruleType', $event)">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                  <SelectItem value="guideline">Guideline</SelectItem>
                  <SelectItem value="constraint">Constraint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs">Scope</Label>
              <Select :model-value="(data as RuleNodeData).scope" @update:model-value="update('scope', $event)">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <Label class="text-xs">Rule Text</Label>
                <Button
                  variant="ghost" size="sm" class="h-6 w-6 p-0"
                  :disabled="graph.generatingPrompt"
                  title="Generate rule text with AI"
                  @click="nodeId && graph.generatePrompt(nodeId)"
                >
                  <Loader2 v-if="graph.generatingPrompt" class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <Sparkles v-else class="h-3.5 w-3.5 text-yellow-500 hover:text-yellow-400" />
                </Button>
              </div>
              <Textarea
                :model-value="(data as RuleNodeData).ruleText"
                class="min-h-[100px] max-h-[150px] overflow-y-auto !field-sizing-normal text-xs"
                placeholder="Describe the rule..."
                :disabled="graph.generatingPrompt"
                @update:model-value="update('ruleText', $event)"
              />
            </div>
          </template>

          <!-- Advanced Settings (collapsible) -->
          <Separator />
          <Collapsible v-model:open="advancedOpen">
            <CollapsibleTrigger
              class="flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                class="h-3 w-3 shrink-0 transition-transform duration-200"
                :class="{ 'rotate-90': advancedOpen }"
              />
              <span>Advanced</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="mt-3 space-y-4">
                <!-- Agent: Max Tokens -->
                <template v-if="data.nodeType === 'agent'">
                  <div class="space-y-1.5">
                    <Label class="text-xs">Max Tokens</Label>
                    <Input
                      type="number"
                      :model-value="(data as AgentNodeData).maxTokens"
                      class="h-8 text-sm"
                      @update:model-value="update('maxTokens', Number($event))"
                    />
                    <p class="text-[10px] text-muted-foreground">Default: 200,000</p>
                  </div>
                </template>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </template>
  </div>
</template>
