<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AgentMetadata, AgentDomain, AgentCapability } from '@/types/agent-metadata';
import { AGENT_DOMAINS, DEFAULT_AGENT_METADATA } from '@/types/agent-metadata';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { X, Plus } from 'lucide-vue-next';

const props = defineProps<{
  metadata: AgentMetadata;
}>();

const emit = defineEmits<{
  (e: 'update', value: AgentMetadata): void;
}>();

const meta = computed(() => props.metadata || { ...DEFAULT_AGENT_METADATA });

// ── Tag input ──
const tagInput = ref('');

function addTag() {
  const tag = tagInput.value.trim().toLowerCase();
  if (!tag || meta.value.tags.includes(tag)) return;
  emit('update', { ...meta.value, tags: [...meta.value.tags, tag] });
  tagInput.value = '';
}

function removeTag(tag: string) {
  emit('update', { ...meta.value, tags: meta.value.tags.filter(t => t !== tag) });
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag();
  }
}

// ── FROM/TO input ──
const fromInput = ref('');
const toInput = ref('');

function addRoutingRef(field: 'from' | 'to', inputRef: typeof fromInput) {
  const val = inputRef.value.trim();
  if (!val || meta.value[field].includes(val)) return;
  emit('update', { ...meta.value, [field]: [...meta.value[field], val] });
  inputRef.value = '';
}

function removeRoutingRef(field: 'from' | 'to', ref: string) {
  emit('update', { ...meta.value, [field]: meta.value[field].filter(r => r !== ref) });
}

function onRoutingKeydown(e: KeyboardEvent, field: 'from' | 'to', _inputValue: string) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addRoutingRef(field, field === 'from' ? fromInput : toInput);
  }
}

// ── Domain ──
function updateDomain(value: string) {
  emit('update', { ...meta.value, domain: value as AgentDomain });
}

// ── Capabilities ──
const capIdInput = ref('');
const capDescInput = ref('');

function addCapability() {
  const id = capIdInput.value.trim().toLowerCase().replace(/\s+/g, '-');
  const description = capDescInput.value.trim();
  if (!id || !description) return;
  if (meta.value.capabilities.some(c => c.id === id)) return;
  emit('update', {
    ...meta.value,
    capabilities: [...meta.value.capabilities, { id, description }],
  });
  capIdInput.value = '';
  capDescInput.value = '';
}

function removeCapability(id: string) {
  emit('update', {
    ...meta.value,
    capabilities: meta.value.capabilities.filter(c => c.id !== id),
  });
}
</script>

<template>
  <div class="space-y-4">
    <!-- Domain -->
    <div class="space-y-1.5">
      <Label class="text-xs">Domain</Label>
      <Select :model-value="meta.domain" @update:model-value="(v: any) => updateDomain(String(v ?? ''))">
        <SelectTrigger class="h-8 text-sm">
          <SelectValue placeholder="Select domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="d in AGENT_DOMAINS" :key="d" :value="d">
            {{ d }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Tags -->
    <div class="space-y-1.5">
      <Label class="text-xs">Tags</Label>
      <div v-if="meta.tags.length" class="flex flex-wrap gap-1">
        <Badge
          v-for="tag in meta.tags" :key="tag"
          variant="secondary" class="gap-1 text-[10px]"
        >
          {{ tag }}
          <button class="ml-0.5 rounded-full hover:bg-accent" @click="removeTag(tag)">
            <X class="h-2.5 w-2.5" />
          </button>
        </Badge>
      </div>
      <Input
        v-model="tagInput"
        class="h-7 text-xs"
        placeholder="Add tag (Enter to confirm)..."
        @keydown="onTagKeydown"
      />
    </div>

    <!-- FROM (who can call this agent) -->
    <div class="space-y-1.5">
      <Label class="text-xs">From <span class="text-muted-foreground">(who can call this)</span></Label>
      <div v-if="meta.from.length" class="flex flex-wrap gap-1">
        <Badge
          v-for="ref in meta.from" :key="ref"
          variant="outline" class="gap-1 text-[10px]"
        >
          {{ ref }}
          <button class="ml-0.5 rounded-full hover:bg-accent" @click="removeRoutingRef('from', ref)">
            <X class="h-2.5 w-2.5" />
          </button>
        </Badge>
      </div>
      <Input
        v-model="fromInput"
        class="h-7 text-xs"
        placeholder="agent-label or tag:xxx (Enter)..."
        @keydown="(e: KeyboardEvent) => onRoutingKeydown(e, 'from', fromInput)"
      />
      <p class="text-[10px] text-muted-foreground">Empty = unrestricted</p>
    </div>

    <!-- TO (who this agent can delegate to) -->
    <div class="space-y-1.5">
      <Label class="text-xs">To <span class="text-muted-foreground">(who this can delegate to)</span></Label>
      <div v-if="meta.to.length" class="flex flex-wrap gap-1">
        <Badge
          v-for="ref in meta.to" :key="ref"
          variant="outline" class="gap-1 text-[10px]"
        >
          {{ ref }}
          <button class="ml-0.5 rounded-full hover:bg-accent" @click="removeRoutingRef('to', ref)">
            <X class="h-2.5 w-2.5" />
          </button>
        </Badge>
      </div>
      <Input
        v-model="toInput"
        class="h-7 text-xs"
        placeholder="agent-label or tag:xxx (Enter)..."
        @keydown="(e: KeyboardEvent) => onRoutingKeydown(e, 'to', toInput)"
      />
      <p class="text-[10px] text-muted-foreground">Empty = leaf node (no delegation)</p>
    </div>

    <!-- Capabilities -->
    <div class="space-y-1.5">
      <Label class="text-xs">Capabilities</Label>
      <div v-if="meta.capabilities.length" class="space-y-1">
        <div
          v-for="cap in meta.capabilities" :key="cap.id"
          class="flex items-center gap-1.5 rounded border border-border px-2 py-1"
        >
          <span class="shrink-0 font-mono text-[10px] text-primary">{{ cap.id }}</span>
          <span class="flex-1 truncate text-[10px] text-muted-foreground">{{ cap.description }}</span>
          <button class="shrink-0 rounded-full hover:bg-accent" @click="removeCapability(cap.id)">
            <X class="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
      <div class="flex gap-1">
        <Input
          v-model="capIdInput"
          class="h-7 flex-1 text-xs"
          placeholder="ID (e.g. code-review)"
        />
        <Input
          v-model="capDescInput"
          class="h-7 flex-[2] text-xs"
          placeholder="Description"
          @keydown.enter="addCapability"
        />
        <Button variant="ghost" size="sm" class="h-7 w-7 shrink-0 p-0" @click="addCapability">
          <Plus class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>
