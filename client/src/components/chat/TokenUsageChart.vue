<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  inputTokens: number;
  outputTokens: number;
  maxContext?: number;
  size?: number;
}>();

const maxCtx = computed(() => props.maxContext || 200000);
const sz = computed(() => props.size || 28);
const radius = 10;
const circumference = 2 * Math.PI * radius;
const strokeWidth = 3;

const inputPct = computed(() => Math.min(props.inputTokens / maxCtx.value, 1));
const outputPct = computed(() => Math.min(props.outputTokens / maxCtx.value, 1));
const contextPercent = computed(() => Math.round(inputPct.value * 100));

const inputDash = computed(() => inputPct.value * circumference);
const outputDash = computed(() => outputPct.value * circumference);
</script>

<template>
  <svg
    :width="sz"
    :height="sz"
    viewBox="0 0 24 24"
    class="block"
  >
    <!-- Background ring -->
    <circle
      cx="12" cy="12"
      :r="radius"
      fill="none"
      :stroke-width="strokeWidth"
      class="stroke-muted/60"
    />
    <!-- Input tokens arc -->
    <circle
      v-if="inputTokens > 0"
      cx="12" cy="12"
      :r="radius"
      fill="none"
      :stroke-width="strokeWidth"
      class="stroke-primary transition-all duration-500"
      stroke-linecap="round"
      :stroke-dasharray="`${inputDash} ${circumference - inputDash}`"
      :stroke-dashoffset="0"
      :transform="`rotate(-90 12 12)`"
    />
    <!-- Output tokens arc -->
    <circle
      v-if="outputTokens > 0"
      cx="12" cy="12"
      :r="radius"
      fill="none"
      :stroke-width="strokeWidth"
      class="stroke-violet-500 transition-all duration-500"
      stroke-linecap="round"
      :stroke-dasharray="`${outputDash} ${circumference - outputDash}`"
      :stroke-dashoffset="-inputDash"
      :transform="`rotate(-90 12 12)`"
    />
    <!-- Center percentage text -->
    <text
      x="12" y="12"
      text-anchor="middle"
      dominant-baseline="central"
      class="fill-foreground text-[6px] font-medium"
    >
      {{ contextPercent }}
    </text>
  </svg>
</template>
