<script setup lang="ts">
defineProps<{ class?: string; size?: number }>();
</script>

<template>
  <svg
    :width="size || 24"
    :height="size || 24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :class="$props.class"
  >
    <!-- Viridian V logo -->
    <path d="M5 4 L12 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" />
    <path d="M19 4 L12 20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" />
    <path d="M3 9 L1 12 L3 15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.5" />
    <path d="M21 9 L23 12 L21 15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.5" />
    <circle cx="12" cy="20" r="1.3" fill="currentColor" opacity="0.9" />
  </svg>
</template>
