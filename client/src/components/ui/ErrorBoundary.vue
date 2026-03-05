<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-vue-next';

const props = defineProps<{ name?: string }>();

const error = ref<Error | null>(null);
const errorInfo = ref('');

onErrorCaptured((err, _instance, info) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  errorInfo.value = info;
  console.error(`[ErrorBoundary${props.name ? `:${props.name}` : ''}]`, err, info);
  return false; // prevent propagation
});

function retry() {
  error.value = null;
  errorInfo.value = '';
}
</script>

<template>
  <div v-if="error" class="flex h-full items-center justify-center p-8">
    <div class="flex max-w-md flex-col items-center gap-4 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle class="h-6 w-6 text-destructive" />
      </div>
      <div>
        <h3 class="text-sm font-medium text-foreground">
          {{ name ? `${name} encountered an error` : 'Something went wrong' }}
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ error.message }}
        </p>
      </div>
      <Button variant="outline" size="sm" class="gap-2" @click="retry">
        <RefreshCw class="h-3.5 w-3.5" />
        Retry
      </Button>
      <details class="w-full text-left">
        <summary class="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
          Technical details
        </summary>
        <pre class="mt-2 max-h-32 overflow-auto rounded-md bg-muted p-2 text-[10px] text-muted-foreground">{{ error.stack }}</pre>
      </details>
    </div>
  </div>
  <slot v-else />
</template>
