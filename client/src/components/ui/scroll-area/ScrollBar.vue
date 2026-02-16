<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ScrollAreaScrollbar, ScrollAreaThumb } from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(defineProps<ScrollAreaScrollbarProps & { class?: HTMLAttributes["class"] }>(), {
  orientation: "vertical",
})

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    v-bind="delegatedProps"
    :class="
      cn('scrollbar-auto-hide flex touch-none select-none',
         orientation === 'vertical'
           && 'h-full w-1.5 border-l border-l-transparent p-px',
         orientation === 'horizontal'
           && 'h-1.5 flex-col border-t border-t-transparent p-px',
         props.class)"
  >
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      class="bg-muted-foreground/20 hover:bg-muted-foreground/40 relative flex-1 rounded-full transition-colors"
    />
  </ScrollAreaScrollbar>
</template>
