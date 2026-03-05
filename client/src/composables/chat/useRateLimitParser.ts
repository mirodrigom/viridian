import { ref, watch, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';

export function useRateLimitParser() {
  const chat = useChatStore();

  const rateLimitCountdown = ref('');
  let rateLimitInterval: ReturnType<typeof setInterval> | null = null;

  function updateRateLimitCountdown() {
    if (!(chat?.isRateLimited ?? false)) {
      rateLimitCountdown.value = '';
      if (rateLimitInterval) {
        clearInterval(rateLimitInterval);
        rateLimitInterval = null;
      }
      return;
    }
    const remaining = chat?.rateLimitRemainingMs ?? 0;
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    if (hours > 0) {
      rateLimitCountdown.value = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      rateLimitCountdown.value = `${minutes}m ${seconds}s`;
    } else {
      rateLimitCountdown.value = `${seconds}s`;
    }
  }

  watch(() => chat?.isRateLimited ?? false, (limited) => {
    if (limited) {
      updateRateLimitCountdown();
      rateLimitInterval = setInterval(updateRateLimitCountdown, 1000);
    } else {
      rateLimitCountdown.value = '';
      if (rateLimitInterval) {
        clearInterval(rateLimitInterval);
        rateLimitInterval = null;
      }
    }
  }, { immediate: true });

  onUnmounted(() => {
    if (rateLimitInterval) clearInterval(rateLimitInterval);
  });

  return {
    rateLimitCountdown,
  };
}
