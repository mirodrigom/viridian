<script setup lang="ts">
import { GripVertical, Maximize2, Minimize2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import type { WidgetConfig } from '@/stores/management';
import { useManagementStore } from '@/stores/management';

const props = defineProps<{
  widget: WidgetConfig;
  title: string;
  icon?: string;
}>();

const store = useManagementStore();

function toggleSize() {
  store.updateWidgetSize(props.widget.id, props.widget.size === 'half' ? 'full' : 'half');
}
</script>

<template>
  <div class="widget-shell flex h-full flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden">
    <!-- Drag handle header -->
    <div
      class="widget-header flex items-center gap-2 border-b border-border/60 px-3 py-2 bg-muted/20 cursor-grab active:cursor-grabbing select-none shrink-0"
      data-drag-handle
    >
      <GripVertical class="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      <slot name="icon" />
      <span class="flex-1 text-xs font-semibold text-foreground">{{ title }}</span>
      <slot name="actions" />
      <Button
        data-testid="widget-size-toggle"
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        @click="toggleSize"
      >
        <Maximize2 v-if="widget.size === 'half'" class="h-3 w-3" />
        <Minimize2 v-else class="h-3 w-3" />
      </Button>
    </div>

    <!-- Widget body -->
    <div class="flex-1 overflow-hidden min-h-0">
      <slot />
    </div>
  </div>
</template>
