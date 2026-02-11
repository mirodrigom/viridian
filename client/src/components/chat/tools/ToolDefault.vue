<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();
const showParams = ref(false);

const formatted = computed(() => JSON.stringify(props.toolUse.input, null, 2));
</script>

<template>
  <Collapsible v-model:open="showParams">
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
    >
      <ChevronRight
        class="h-3 w-3 shrink-0 transition-transform duration-200"
        :class="{ 'rotate-90': showParams }"
      />
      <span>View parameters</span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre class="m-0 max-h-64 overflow-auto border-t border-border bg-muted/10 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-foreground">{{ formatted }}</pre>
    </CollapsibleContent>
  </Collapsible>
  <div v-if="toolUse.isInputStreaming" class="px-3.5 py-1.5">
    <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
  </div>
</template>
