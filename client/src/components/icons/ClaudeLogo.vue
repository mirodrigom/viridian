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
    <!-- Anthropic Claude sparkle/star logo approximation -->
    <path
      d="M12 2L14.5 8.5L21 6L16.5 11.5L22 14L14.5 14.5L12 22L9.5 14.5L2 14L7.5 11.5L3 6L9.5 8.5L12 2Z"
      fill="currentColor"
      opacity="0.9"
    />
  </svg>
</template>
