<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAudioProviderStore } from '@/stores/audioProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Check, X, Loader2, ExternalLink } from 'lucide-vue-next';
import { Switch } from '@/components/ui/switch';
import type { AudioProviderId, AudioProviderInfo } from '@/types/audio-provider';

const audioStore = useAudioProviderStore();

const configProviderId = ref<AudioProviderId | null>(null);
const configApiKey = ref('');
const testing = ref<AudioProviderId | null>(null);
const testResult = ref<{ success: boolean; message: string } | null>(null);

const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
];

const currentProvider = computed(() =>
  audioStore.providers.find(p => p.id === audioStore.activeProviderId),
);

function selectProvider(id: string) {
  audioStore.setProvider(id as AudioProviderId);
}

function selectLanguage(lang: string) {
  audioStore.setLanguage(lang);
}

function selectModel(modelId: string) {
  audioStore.setModel(modelId === 'default' ? null : modelId);
}

function startConfig(provider: AudioProviderInfo) {
  configProviderId.value = provider.id;
  configApiKey.value = '';
  testResult.value = null;
}

function cancelConfig() {
  configProviderId.value = null;
  configApiKey.value = '';
  testResult.value = null;
}

async function saveConfig() {
  if (!configProviderId.value || !configApiKey.value.trim()) return;
  const ok = await audioStore.configure(configProviderId.value, configApiKey.value.trim());
  if (ok) {
    cancelConfig();
  }
}

async function testProvider(id: AudioProviderId) {
  testing.value = id;
  testResult.value = null;
  testResult.value = await audioStore.testProvider(id);
  testing.value = null;
}

async function removeProvider(id: AudioProviderId) {
  await audioStore.removeConfig(id);
  if (audioStore.activeProviderId === id) {
    audioStore.setProvider('audio-browser');
  }
}

onMounted(() => {
  audioStore.fetchProviders();
});
</script>

<template>
  <div>
    <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Speech-to-Text</h4>
    <div class="space-y-3">
      <!-- Active Provider Selection -->
      <div class="space-y-1.5">
        <Label class="text-xs">Provider</Label>
        <Select :model-value="audioStore.activeProviderId" @update:model-value="(v: any) =>selectProvider(String(v ?? ''))">
          <SelectTrigger class="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="p in audioStore.providers"
              :key="p.id"
              :value="p.id"
              :disabled="p.id !== 'audio-browser' && !p.configured"
            >
              <span class="flex items-center gap-2">
                <span>{{ p.name }}</span>
                <span v-if="p.id !== 'audio-browser' && !p.configured" class="text-[10px] text-muted-foreground">(not configured)</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Language Selection -->
      <div class="space-y-1.5">
        <Label class="text-xs">Language</Label>
        <Select :model-value="audioStore.language" @update:model-value="(v: any) =>selectLanguage(String(v ?? ''))">
          <SelectTrigger class="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="lang in LANGUAGES" :key="lang.value" :value="lang.value">
              {{ lang.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Model Selection (when provider has multiple models) -->
      <div v-if="currentProvider && currentProvider.models.length > 1" class="space-y-1.5">
        <Label class="text-xs">Model</Label>
        <Select
          :model-value="audioStore.selectedModelId || 'default'"
          @update:model-value="(v: any) =>selectModel(String(v ?? ''))"
        >
          <SelectTrigger class="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              {{ currentProvider.models.find(m => m.isDefault)?.label || currentProvider.models[0]?.label }} (default)
            </SelectItem>
            <SelectItem
              v-for="m in currentProvider.models.filter(m => !m.isDefault)"
              :key="m.id"
              :value="m.id"
            >
              <span class="flex flex-col">
                <span>{{ m.label }}</span>
                <span class="text-[10px] text-muted-foreground">{{ m.description }}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Current provider info -->
      <div v-if="currentProvider" class="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
        <div>{{ currentProvider.description }}</div>
        <div class="mt-1 font-medium">{{ currentProvider.pricing }}</div>
      </div>

      <!-- Provider Configuration List -->
      <div class="space-y-1.5">
        <Label class="text-xs">Configuration</Label>
        <div class="space-y-1">
          <div
            v-for="p in audioStore.providers.filter(p => p.id !== 'audio-browser')"
            :key="p.id"
            class="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5"
          >
            <div class="flex items-center gap-2">
              <div class="h-2 w-2 rounded-full" :class="p.configured ? 'bg-green-500' : 'bg-muted-foreground/30'" />
              <span class="text-xs font-medium">{{ p.name }}</span>
            </div>
            <div class="flex items-center gap-1">
              <template v-if="p.configured">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[10px]"
                  :disabled="testing === p.id"
                  @click="testProvider(p.id)"
                >
                  <Loader2 v-if="testing === p.id" class="mr-1 h-3 w-3 animate-spin" />
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive"
                  @click="removeProvider(p.id)"
                >
                  Remove
                </Button>
              </template>
              <Button
                v-else
                variant="ghost"
                size="sm"
                class="h-6 px-1.5 text-[10px]"
                @click="startConfig(p)"
              >
                Configure
              </Button>
              <a :href="p.website" target="_blank" class="text-muted-foreground hover:text-foreground">
                <ExternalLink class="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Test Result -->
      <div v-if="testResult" class="flex items-start gap-2 rounded-md p-2" :class="testResult.success ? 'bg-green-500/10' : 'bg-destructive/10'">
        <Check v-if="testResult.success" class="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
        <X v-else class="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
        <span class="text-xs" :class="testResult.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'">
          {{ testResult.message }}
        </span>
      </div>

      <!-- Inline Config Form -->
      <div v-if="configProviderId" class="space-y-2 rounded-md border border-border p-3">
        <div class="text-xs font-medium">
          Configure {{ audioStore.providers.find(p => p.id === configProviderId)?.name }}
        </div>
        <Input
          v-model="configApiKey"
          :type="audioStore.providers.find(p => p.id === configProviderId)?.configLabel ? 'text' : 'password'"
          :placeholder="audioStore.providers.find(p => p.id === configProviderId)?.configLabel || 'API Key'"
          class="h-8 text-sm"
          @keydown.enter="saveConfig"
        />
        <div class="flex gap-2">
          <Button size="sm" class="h-7 text-xs" :disabled="!configApiKey.trim()" @click="saveConfig">Save</Button>
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="cancelConfig">Cancel</Button>
        </div>
      </div>

      <!-- Wake Word -->
      <div class="space-y-1.5 border-t border-border pt-3">
        <div class="flex items-center justify-between">
          <div>
            <Label class="text-xs">"Hey Buddy" Wake Word</Label>
            <p class="mt-0.5 text-[10px] text-muted-foreground">
              Always-on listening — opens voice input when you say "Hey Buddy"
            </p>
          </div>
          <Switch
            :model-value="audioStore.wakeWordEnabled"
            @update:model-value="(val: boolean) => { audioStore.setWakeWordEnabled(val); }"
          />
        </div>
        <p v-if="audioStore.wakeWordEnabled" class="text-[10px] text-muted-foreground/70">
          Uses browser speech recognition. Audio may be sent to Google for processing.
        </p>
      </div>
    </div>
  </div>
</template>
