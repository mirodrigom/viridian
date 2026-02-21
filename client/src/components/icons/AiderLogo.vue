<script setup lang="ts">
defineProps<{ class?: string; size?: number }>();
</script>

<template>
  <svg
    :width="size || 24"
    :height="size || 24"
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    :class="$props.class"
  >
    <!-- Aider: pixel-art lowercase 'a' inspired by their favicon -->
    <rect x="8" y="4" width="3" height="3" />
    <rect x="11" y="4" width="3" height="3" />
    <rect x="14" y="7" width="3" height="3" />
    <rect x="8" y="10" width="3" height="3" />
    <rect x="11" y="10" width="3" height="3" />
    <rect x="14" y="10" width="3" height="3" />
    <rect x="5" y="7" width="3" height="3" />
    <rect x="5" y="13" width="3" height="3" />
    <rect x="14" y="13" width="3" height="3" />
    <rect x="8" y="16" width="3" height="3" />
    <rect x="11" y="16" width="3" height="3" />
    <rect x="14" y="16" width="3" height="3" />
  </svg>
</template>
