<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';

const chat = useChatStore();
const route = useRoute();

onMounted(() => {
  const path = (route.query.path as string) || process.cwd?.() || '/home';
  chat.setProjectPath(path);
});
</script>

<template>
  <AppLayout />
</template>
