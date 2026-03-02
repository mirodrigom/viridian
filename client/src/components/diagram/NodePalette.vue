<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Circle, Search, X } from 'lucide-vue-next';
import { useDiagramsStore } from '@/stores/diagrams';
import {
  AWS_SERVICES, AWS_CATEGORIES, AWS_GROUP_TYPES,
  type AWSCategory,
} from '@/data/aws-services';

const diagrams = useDiagramsStore();
const search = ref('');
const expandedCategories = ref<Set<string>>(new Set(['Compute', 'Networking']));
const showGroups = ref(true);

// Track which categories were manually expanded before search
const preSearchExpanded = ref<Set<string> | null>(null);

const searchQuery = computed(() => search.value.toLowerCase().trim());

const filteredServices = computed(() => {
  const q = searchQuery.value;
  if (!q) return AWS_SERVICES;
  return AWS_SERVICES.filter(
    s => s.name.toLowerCase().includes(q) ||
      s.shortName.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
});

const servicesByCategory = computed(() => {
  const map = new Map<AWSCategory, typeof filteredServices.value>();
  for (const s of filteredServices.value) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return map;
});

// Filtered group types for search
const filteredGroups = computed(() => {
  const q = searchQuery.value;
  if (!q) return AWS_GROUP_TYPES;
  return AWS_GROUP_TYPES.filter(
    g => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q),
  );
});

// Auto-expand/collapse categories when searching
watch(searchQuery, (q) => {
  if (q) {
    // Save pre-search state on first search character
    if (!preSearchExpanded.value) {
      preSearchExpanded.value = new Set(expandedCategories.value);
    }
    // Expand all categories with results, collapse others
    const newExpanded = new Set<string>();
    for (const [cat] of servicesByCategory.value) {
      newExpanded.add(cat);
    }
    expandedCategories.value = newExpanded;
    // Auto-show groups if there are matching groups
    showGroups.value = filteredGroups.value.length > 0;
  } else {
    // Restore pre-search state
    if (preSearchExpanded.value) {
      expandedCategories.value = preSearchExpanded.value;
      preSearchExpanded.value = null;
    }
    showGroups.value = true;
  }
});

function toggleCategory(cat: string) {
  if (expandedCategories.value.has(cat)) {
    expandedCategories.value.delete(cat);
  } else {
    expandedCategories.value.add(cat);
  }
}

function getCategoryColor(cat: AWSCategory): string {
  return AWS_CATEGORIES.find(c => c.id === cat)?.color || '#8C8C8C';
}

function clearSearch() {
  search.value = '';
}

function onDragStart(event: DragEvent, type: 'service' | 'group', id: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData('application/diagram-type', type);
  event.dataTransfer.setData('application/diagram-id', id);
  event.dataTransfer.effectAllowed = 'move';
}

/** Highlight matched substring in text */
function highlightMatch(text: string): string {
  const q = searchQuery.value;
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return `${before}<mark class="bg-primary/25 text-primary rounded-sm px-0.5">${match}</mark>${after}`;
}
</script>

<template>
  <div class="flex h-full shrink-0 flex-col bg-background" style="min-height: 0;">
    <!-- Diagram name -->
    <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Input
        v-model="diagrams.currentDiagramName"
        class="h-6 flex-1 border-transparent bg-transparent px-1 text-xs font-medium hover:border-border focus:border-border"
        placeholder="Diagram name..."
      />
      <Circle
        v-if="diagrams.isDirty"
        class="h-2 w-2 shrink-0 fill-primary text-primary"
      />
    </div>

    <!-- Search -->
    <div class="shrink-0 border-b border-border px-2 py-1.5">
      <div class="relative">
        <Search class="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="search"
          class="h-7 pl-7 pr-7 text-xs"
          placeholder="Search AWS services..."
        />
        <button
          v-if="search"
          class="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="clearSearch"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </div>

    <ScrollArea class="flex-1" style="min-height: 0;">
      <div class="space-y-0.5 p-1.5">
        <!-- Groups section -->
        <div v-if="filteredGroups.length > 0 || !searchQuery">
          <button
            class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted/50"
            @click="showGroups = !showGroups"
          >
            <component :is="showGroups ? ChevronDown : ChevronRight" class="h-3 w-3" />
            Containers
            <span v-if="searchQuery && filteredGroups.length > 0" class="ml-auto rounded-full bg-primary/15 px-1.5 text-[9px] tabular-nums text-primary">
              {{ filteredGroups.length }}
            </span>
            <span v-else class="ml-auto text-[9px] tabular-nums opacity-60">{{ AWS_GROUP_TYPES.length }}</span>
          </button>
          <div v-if="showGroups" class="space-y-0.5 pl-1">
            <div
              v-for="group in filteredGroups"
              :key="group.id"
              class="cursor-grab rounded border border-transparent bg-card px-2 py-1.5 transition-all hover:border-border hover:shadow-sm active:cursor-grabbing"
              draggable="true"
              @dragstart="(e) => onDragStart(e, 'group', group.id)"
            >
              <div class="flex items-center gap-2">
                <div
                  class="h-4 w-4 shrink-0 rounded border"
                  :style="{
                    borderColor: group.color + '80',
                    borderStyle: group.borderStyle,
                    backgroundColor: group.color + '15',
                  }"
                />
                <div class="min-w-0 flex-1">
                  <div class="text-[11px] font-medium" v-html="highlightMatch(group.name)" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Service categories -->
        <div v-for="[category, services] in servicesByCategory" :key="category">
          <button
            class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted/50"
            @click="toggleCategory(category)"
          >
            <component :is="expandedCategories.has(category) ? ChevronDown : ChevronRight" class="h-3 w-3" />
            <span
              class="h-2 w-2 rounded-full"
              :style="{ backgroundColor: getCategoryColor(category) }"
            />
            {{ category }}
            <span v-if="searchQuery" class="ml-auto rounded-full bg-primary/15 px-1.5 text-[9px] tabular-nums text-primary">
              {{ services.length }}
            </span>
            <span v-else class="ml-auto text-[9px] tabular-nums opacity-60">{{ services.length }}</span>
          </button>

          <div v-if="expandedCategories.has(category)" class="space-y-0.5 pl-1">
            <div
              v-for="service in services"
              :key="service.id"
              class="cursor-grab rounded border border-transparent bg-card px-2 py-1.5 transition-all hover:border-border hover:shadow-sm active:cursor-grabbing"
              draggable="true"
              @dragstart="(e) => onDragStart(e, 'service', service.id)"
            >
              <div class="flex items-center gap-2">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" :stroke="service.color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="service.iconPath" />
                </svg>
                <div class="min-w-0 flex-1">
                  <div class="text-[11px] font-medium" v-html="highlightMatch(service.shortName)" />
                  <div class="truncate text-[9px] text-muted-foreground/70">{{ service.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No results -->
        <div v-if="searchQuery && filteredServices.length === 0 && filteredGroups.length === 0" class="py-8 text-center text-xs text-muted-foreground">
          No services matching "{{ search }}"
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
