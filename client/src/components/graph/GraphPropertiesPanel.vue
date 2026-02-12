<script setup lang="ts">
import { computed } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { NODE_CONFIG } from '@/types/graph';
import type { NodeData, AgentNodeData, SubagentNodeData, ExpertNodeData, SkillNodeData, McpNodeData, RuleNodeData } from '@/types/graph';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck, X, Loader2 } from 'lucide-vue-next';

const graph = useGraphStore();

const node = computed(() => graph.selectedNode);
const data = computed(() => node.value?.data as NodeData | null);
const config = computed(() => data.value ? NODE_CONFIG[data.value.nodeType] : null);

const icons = { agent: Bot, subagent: GitBranch, expert: Sparkles, skill: Zap, mcp: Server, rule: ShieldCheck };

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

const PERMISSION_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'bypassPermissions', label: 'Full Auto' },
];

const nodeId = computed(() => node.value?.id || null);

function update(field: string, value: unknown) {
  if (!node.value) return;
  graph.updateNodeData(node.value.id, { [field]: value } as Partial<NodeData>);
}
</script>

<template>
  <div class="flex h-full flex-col border-l border-border bg-muted/20">
    <!-- Empty state -->
    <div v-if="!node" class="flex flex-1 flex-col items-center justify-center p-4 text-center text-sm text-muted-foreground">
      <p>Select a node to edit its properties</p>
    </div>

    <!-- Properties form -->
    <template v-else-if="data && config">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2" :class="config.accentClass">
        <component :is="icons[data.nodeType]" class="h-4 w-4 shrink-0" />
        <span class="flex-1 text-xs font-semibold uppercase tracking-wider">{{ config.label }} Properties</span>
        <button class="rounded p-0.5 hover:bg-background/50" @click="graph.selectNode(null)">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea class="flex-1">
        <div class="space-y-4 p-3">
          <!-- Common: Label -->
          <div class="space-y-1.5">
            <Label class="text-xs">Label</Label>
            <Input :model-value="data.label" class="h-8 text-sm" @update:model-value="update('label', $event)" />
          </div>

          <!-- Common: Description -->
          <div class="space-y-1.5">
            <Label class="text-xs">Description</Label>
            <Input :model-value="data.description || ''" class="h-8 text-sm" placeholder="Optional..." @update:model-value="update('description', $event)" />
          </div>

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

          <!-- Agent / Subagent: Permission Mode -->
          <template v-if="data.nodeType === 'agent' || data.nodeType === 'subagent'">
            <div class="space-y-1.5">
              <Label class="text-xs">Permission Mode</Label>
              <Select :model-value="(data as AgentNodeData | SubagentNodeData).permissionMode" @update:model-value="update('permissionMode', $event)">
                <SelectTrigger class="h-8 text-sm">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in PERMISSION_OPTIONS" :key="opt.value" :value="opt.value">
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
              <p v-if="graph.generatingPrompt" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 class="h-3 w-3 animate-spin" /> Generating prompt...
              </p>
            </div>
          </template>

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
              <p v-if="graph.generatingPrompt" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 class="h-3 w-3 animate-spin" /> Generating prompt...
              </p>
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
              <p v-if="graph.generatingPrompt" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 class="h-3 w-3 animate-spin" /> Generating prompt...
              </p>
            </div>
          </template>
        </div>
      </ScrollArea>
    </template>
  </div>
</template>
