<script setup lang="ts">
defineProps<{ class?: string; size?: number }>();
</script>

<template>
  <svg
    :width="size || 24"
    :height="size || 24"
    viewBox="0 0 240 300"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    :class="$props.class"
  >
    <!-- Official OpenCode editor frame from dashboard-icons -->
    <path
      d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
      fill-rule="evenodd"
    />
    <path
      d="M180 240H60V120H180V240Z"
      opacity="0.35"
    />
  </svg>
</template>
