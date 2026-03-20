<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore, PERMISSION_OPTIONS, THINKING_OPTIONS } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  Zap, Shield, FileEdit, ClipboardList, Brain, FileDown, Cpu,
  ChevronsDown, ChevronsUpDown, CircleAlert, CheckCircle2,
} from 'lucide-vue-next';
import { exportSession } from '@/composables/useKeyboardShortcuts';
import { useProviderLogo } from '@/composables/useProviderLogo';

const chat = useChatStore();
const settings = useSettingsStore();
const providerStore = useProviderStore();
const { activeLogo, getLogoComponent } = useProviderLogo();

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

const permissionIcons: Record<string, typeof Zap> = {
  bypassPermissions: Zap,
  acceptEdits: FileEdit,
  plan: ClipboardList,
  default: Shield,
};

const effectivePermissionLabel = computed(() =>
  chat.inPlanMode ? 'Plan Mode' : settings.permissionLabel
);

const effectivePermissionIcon = computed(() =>
  chat.inPlanMode ? ClipboardList : (permissionIcons[settings.permissionMode] || Shield)
);

const permissionColorClass = 'bg-primary/15 text-primary hover:bg-primary/25';

/** Is the active provider ready to use? */
const isActiveReady = computed(() => {
  const p = providerStore.activeProvider;
  return p.available && p.configured && !providerStore.failedProviderIds.has(p.id);
});

function providerStatus(p: { id: string; available: boolean; configured: boolean }) {
  if (!p.available) return 'unavailable';
  if (!p.configured || providerStore.failedProviderIds.has(p.id as any)) return 'unconfigured';
  return 'ready';
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="mb-1 sm:mb-2 flex flex-wrap items-center justify-center gap-0.5 sm:gap-1 md:gap-2">
      <!-- Provider selector — always visible, shows all available providers with status -->
      <Select
        v-if="providerStore.availableProviders.length > 0"
        :model-value="providerStore.activeProviderId"
        @update:model-value="(v: any) => providerStore.setDefaultProvider(v)"
      >
        <SelectTrigger
          class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none px-2 text-[11px] shrink-0 transition-colors"
          :class="isActiveReady
            ? 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'"
          :title="`Provider: ${providerStore.activeProvider.name}${isActiveReady ? '' : ' (not authenticated)'}`"
        >
          <component :is="activeLogo" class="h-3 w-3" />
          <span class="hidden sm:inline">{{ providerStore.activeProvider.name }}</span>
          <CircleAlert v-if="!isActiveReady" class="h-3 w-3 text-red-400" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="p in providerStore.availableProviders"
            :key="p.id"
            :value="p.id"
          >
            <div class="flex items-center gap-2">
              <component :is="getLogoComponent(p.icon)" :size="14" class="shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm flex items-center gap-1.5">
                  {{ p.name }}
                  <CheckCircle2 v-if="providerStatus(p) === 'ready'" class="h-3 w-3 text-green-500" />
                  <CircleAlert v-else-if="providerStatus(p) === 'unconfigured'" class="h-3 w-3 text-amber-500" />
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ providerStatus(p) === 'ready' ? p.description : providerStatus(p) === 'unconfigured' ? 'Not authenticated' : 'Not installed' }}
                </div>
              </div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- Model selector -->
      <Select :model-value="settings.model" :disabled="!isActiveReady || !providerStore.supportsModelSelection" @update:model-value="(v: any) => { settings.model = v; settings.save(); }">
        <SelectTrigger
          class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
          :class="{ 'opacity-50 cursor-not-allowed': !isActiveReady || !providerStore.supportsModelSelection }"
          :title="!isActiveReady ? 'Sign in first' : providerStore.supportsModelSelection ? settings.modelLabel : settings.modelLabel + ' (model selection not available for this provider)'"
        >
          <Cpu class="h-3 w-3 sm:hidden" />
          <span class="hidden sm:inline">{{ settings.modelLabel }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="m in providerStore.activeModels"
            :key="m.id"
            :value="m.id"
            :disabled="providerStore.activeFailedModelIds.has(m.id)"
            :class="providerStore.activeFailedModelIds.has(m.id) ? 'bg-red-500/10 data-[highlighted]:bg-red-500/15 opacity-60' : ''"
          >
            <div>
              <div class="text-sm" :class="providerStore.activeFailedModelIds.has(m.id) ? 'text-red-400' : ''">{{ m.label }}</div>
              <div class="text-xs text-muted-foreground">{{ m.description }}</div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- Permission mode -->
      <Select :model-value="settings.permissionMode" @update:model-value="(v: any) => { settings.permissionMode = v; settings.save(); if (v !== 'plan') chat.inPlanMode = false; }">
        <SelectTrigger
          class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none px-2 text-[11px] transition-colors shrink-0"
          :class="permissionColorClass"
          :title="effectivePermissionLabel"
        >
          <component :is="effectivePermissionIcon" class="h-3 w-3" />
          <span class="hidden sm:inline">{{ effectivePermissionLabel }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="p in PERMISSION_OPTIONS.filter(o => providerStore.activeCapabilities.supportedPermissionModes.includes(o.value))" :key="p.value" :value="p.value">
            <div class="flex items-center gap-2">
              <span>{{ p.icon }}</span>
              <div>
                <div class="text-sm">{{ p.label }}</div>
                <div class="text-xs text-muted-foreground">{{ p.description }}</div>
              </div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- Thinking mode (hidden when provider doesn't support it) -->
      <Select v-if="providerStore.supportsThinking" :model-value="settings.thinkingMode" @update:model-value="(v: any) => { settings.thinkingMode = v; settings.save(); }">
        <SelectTrigger class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground shrink-0" :title="settings.thinkingLabel">
          <Brain class="h-3 w-3" />
          <span class="hidden sm:inline">{{ settings.thinkingLabel }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="t in THINKING_OPTIONS" :key="t.value" :value="t.value">
            <div>
              <div class="text-sm">{{ t.label }}</div>
              <div class="text-xs text-muted-foreground">{{ t.description }}</div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- Context usage -->
      <Tooltip v-if="chat.usage.inputTokens > 0 || chat.usage.outputTokens > 0 || chat.messages.length === 0">
        <TooltipTrigger as-child>
          <div class="flex h-8 sm:h-auto items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5 cursor-default shrink-0">
            <span class="text-[10px] tabular-nums text-muted-foreground">
              {{ chat.contextPercent }}%
            </span>
            <div class="h-1.5 w-12 sm:w-16 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="chat.contextPercent > 80 ? 'bg-destructive' : chat.contextPercent > 50 ? 'bg-yellow-500' : 'bg-primary'"
                :style="{ width: `${Math.max(chat.contextPercent, 2)}%` }"
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div class="space-y-1.5 text-xs">
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full bg-primary" />
              Input: {{ formatTokens(chat.usage.inputTokens) }} tokens
            </div>
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
              Output: {{ formatTokens(chat.usage.outputTokens) }} tokens
            </div>
            <div class="border-t border-border pt-1">Context: {{ chat.contextPercent }}% used</div>
            <div v-if="chat.lastResponseMs">Last: {{ (chat.lastResponseMs / 1000).toFixed(1) }}s</div>
            <div v-if="chat.tokensPerMin > 0">Rate: {{ formatTokens(chat.tokensPerMin) }}/min</div>
            <div v-if="chat.usage.totalCost > 0">Cost: ${{ chat.usage.totalCost.toFixed(4) }}</div>
            <div v-if="chat.sessionDurationMin > 0" class="border-t border-border pt-1 text-muted-foreground">Session: {{ chat.sessionDurationMin }}min</div>
          </div>
        </TooltipContent>
      </Tooltip>

      <!-- Export session -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="hidden sm:flex h-8 sm:h-6 items-center gap-1 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            :disabled="chat.messages.length === 0"
            @click="exportSession"
          >
            <FileDown class="h-3 w-3" />
            <span class="hidden sm:inline">Export</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Export session as Markdown (Ctrl+Shift+E)</TooltipContent>
      </Tooltip>

      <!-- Auto-scroll toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="hidden sm:flex h-8 sm:h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-colors shrink-0"
            :class="chat.autoScroll
              ? 'bg-primary/15 text-primary hover:bg-primary/25'
              : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="chat.autoScroll = !chat.autoScroll"
          >
            <ChevronsDown v-if="chat.autoScroll" class="h-3 w-3" />
            <ChevronsUpDown v-else class="h-3 w-3" />
            <span class="hidden sm:inline">{{ chat.autoScroll ? 'Auto-scroll' : 'Scroll locked' }}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ chat.autoScroll ? 'Auto-scroll enabled — click to disable' : 'Auto-scroll disabled — click to enable' }}</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
