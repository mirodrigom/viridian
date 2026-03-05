<script setup lang="ts">
defineProps<{ class?: string; size?: number }>();
</script>

<template>
  <picture>
    <source srcset="/icons/logo-192.webp" type="image/webp" />
    <img
      src="/icons/logo-192.png"
      :width="size || 24"
      :height="size || 24"
      :class="$props.class"
      alt="Viridian"
      style="object-fit: contain;"
    />
  </picture>
</template>
