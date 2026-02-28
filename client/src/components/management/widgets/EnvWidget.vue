<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { useManagementStore } from '@/stores/management';
import { toast } from 'vue-sonner';
import { FileKey, RefreshCw, Save } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import WidgetShell from './WidgetShell.vue';
import type { WidgetConfig } from '@/stores/management';

defineProps<{ widget: WidgetConfig }>();

const management = useManagementStore();
const hasDiscoveredFiles = computed(() => management.envFiles.length > 0);
const showDropdown = ref(false);

function selectEnvFile(path: string) {
  envPath.value = path;
  showDropdown.value = false;
  loadEnv();
}

const ENV_PATH_KEY = 'management_env_path';

const envPath = ref(localStorage.getItem(ENV_PATH_KEY) || '');
const content = ref('');
const originalContent = ref('');
const loading = ref(false);
const saving = ref(false);
const isDirty = ref(false);

watch(content, (val) => { isDirty.value = val !== originalContent.value; });
watch(envPath, (val) => { try { localStorage.setItem(ENV_PATH_KEY, val); } catch { /* ignore */ } });

async function loadEnv() {
  if (!envPath.value.trim()) return;
  loading.value = true;
  try {
    const res = await apiFetch(`/api/management/env?path=${encodeURIComponent(envPath.value.trim())}`);
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json() as { content: string };
    content.value = data.content;
    originalContent.value = data.content;
    isDirty.value = false;
  } catch { toast.error('Failed to load .env file'); }
  finally { loading.value = false; }
}

async function saveEnv() {
  if (!envPath.value.trim()) return;
  saving.value = true;
  try {
    const res = await apiFetch('/api/management/env', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: envPath.value.trim(), content: content.value }),
    });
    if (!res.ok) throw new Error('Failed to save');
    originalContent.value = content.value;
    isDirty.value = false;
    toast.success('Saved');
  } catch { toast.error('Failed to save .env file'); }
  finally { saving.value = false; }
}

// Parse env vars for display
function parsedLines() {
  return content.value
    .split('\n')
    .map((line, i) => ({ line, i, isComment: line.startsWith('#'), isEmpty: !line.trim() }));
}
</script>

<template>
  <WidgetShell :widget="widget" title="Environment">
    <template #icon><FileKey class="h-3.5 w-3.5 text-yellow-500" /></template>
    <template #actions>
      <Button v-if="isDirty" size="sm" variant="default" class="h-6 px-2 text-[10px] gap-1"
        :disabled="saving" @click="saveEnv">
        <Save class="h-2.5 w-2.5" />
        Save
      </Button>
      <Button size="sm" variant="ghost" class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        :disabled="loading" @click="loadEnv">
        <RefreshCw class="h-3 w-3" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </template>

    <div class="flex h-full flex-col">
      <!-- Path input with discovered files dropdown -->
      <div class="relative border-b bg-muted/10 shrink-0">
        <div class="flex items-center gap-2 px-3 py-2">
          <div class="relative flex-1">
            <Input
              v-model="envPath"
              placeholder="/path/to/project/.env"
              class="h-7 text-xs font-mono w-full"
              :class="hasDiscoveredFiles ? 'pr-7' : ''"
              @keydown.enter="loadEnv"
            />
            <button
              v-if="hasDiscoveredFiles"
              class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
              @click="showDropdown = !showDropdown"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-muted-foreground transition-transform" :class="showDropdown ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <Button size="sm" variant="outline" class="h-7 px-2 text-xs shrink-0" @click="loadEnv">Load</Button>
        </div>
        <!-- Dropdown of discovered env files -->
        <div
          v-if="showDropdown && hasDiscoveredFiles"
          class="absolute left-3 right-3 top-full z-10 mt-0.5 rounded-md border bg-popover p-1 shadow-md"
        >
          <button
            v-for="file in management.envFiles"
            :key="file"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-mono hover:bg-accent text-left"
            @click="selectEnvFile(file)"
          >
            <FileKey class="h-3 w-3 text-yellow-500 shrink-0" />
            <span class="truncate">{{ file.split('/').pop() }}</span>
            <span class="ml-auto text-[10px] text-muted-foreground truncate max-w-32">{{ file }}</span>
          </button>
        </div>
      </div>

      <!-- Content: syntax-highlighted textarea -->
      <div v-if="content || envPath" class="flex-1 overflow-hidden relative">
        <textarea
          v-model="content"
          class="absolute inset-0 w-full h-full resize-none bg-transparent font-mono text-[11px] leading-5 p-3 outline-none text-green-400/90"
          style="background: oklch(0.13 0.01 250); caret-color: oklch(0.8 0.15 140);"
          spellcheck="false"
          placeholder="# .env file will appear here&#10;KEY=value"
        />
      </div>

      <div v-else class="flex-1 flex items-center justify-center text-center p-6">
        <div class="space-y-1">
          <FileKey class="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p class="text-xs text-muted-foreground">Enter a .env file path and click Load</p>
        </div>
      </div>
    </div>
  </WidgetShell>
</template>
