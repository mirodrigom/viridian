<script setup lang="ts">
import TerminalComponent from '@/components/terminal/Terminal.vue';
</script>

<template>
  <div data-testid="terminal-panel" class="flex h-full flex-col border-t border-border bg-background">
    <div class="flex h-8 items-center border-b border-border px-3">
      <span class="text-xs font-medium uppercase text-muted-foreground">Terminal</span>
    </div>
    <TerminalComponent class="flex-1" />
  </div>
</template>
