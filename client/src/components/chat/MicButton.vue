<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Mic } from 'lucide-vue-next';
import { useAudioProviderStore } from '@/stores/audioProvider';

const emit = defineEmits<{
  activate: [];
}>();

const audioStore = useAudioProviderStore();

const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

const isSupported = computed(() => {
  return !!SpeechRecognitionApi || audioStore.providers.length > 0;
});

const providerLabel = computed(() => {
  const p = audioStore.activeProvider;
  if (!p) return 'Browser';
  return p.name;
});

onMounted(() => {
  audioStore.fetchProviders();
});
</script>

<template>
  <div v-if="isSupported">
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="relative h-10 w-10 sm:h-8 sm:w-8 rounded-lg p-0 text-muted-foreground hover:text-foreground"
            @click="emit('activate')"
          >
            <Mic class="h-5 w-5 sm:h-4 sm:w-4" />
            <span
              v-if="audioStore.wakeWordEnabled"
              class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]"
            >
              <span class="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div class="text-xs">
            <div>Voice input</div>
            <div class="text-muted-foreground">{{ providerLabel }}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
