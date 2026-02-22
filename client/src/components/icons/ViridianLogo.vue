<script setup lang="ts">
defineProps<{ class?: string; size?: number }>();
</script>

<template>
  <img
    src="/icons/logo.png"
    :width="size || 24"
    :height="size || 24"
    :class="$props.class"
    alt="Viridian"
    style="object-fit: contain;"
  />
</template>
