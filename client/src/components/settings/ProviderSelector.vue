<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProviderStore } from '@/stores/provider';
import { apiFetch } from '@/lib/apiFetch';
import { CheckCircle, XCircle, Download, Loader2, Terminal, Settings2, AlertTriangle } from 'lucide-vue-next';
import { useProviderLogo } from '@/composables/useProviderLogo';
import { toast } from 'vue-sonner';
import type { ProviderId, ProviderInfo } from '@/types/provider';
import ProviderConfigDialog from './ProviderConfigDialog.vue';

const providerStore = useProviderStore();
const { getLogoComponent } = useProviderLogo();

const installing = ref<ProviderId | null>(null);
const installOutput = ref<{ provider: ProviderInfo; output: string; success: boolean } | null>(null);

// Config dialog state
const configDialogOpen = ref(false);
const configuringProvider = ref<ProviderInfo | null>(null);

function isKeyInvalid(provider: ProviderInfo): boolean {
  return provider.configured && providerStore.failedProviderIds.has(provider.id);
}

// A provider is truly selectable only if configured AND not known-failed
function isSelectable(provider: ProviderInfo): boolean {
  return provider.available && provider.configured && !providerStore.failedProviderIds.has(provider.id);
}

// Card state helpers
const cardState = computed(() => (provider: ProviderInfo) => {
  if (provider.id === providerStore.defaultProvider) return 'active';
  if (!provider.available) return 'unavailable';
  if (isKeyInvalid(provider)) return 'invalid';
  if (!provider.configured) return 'unconfigured';
  return 'ready';
});

function handleProviderClick(provider: ProviderInfo) {
  if (!provider.available) return;
  // Block selection if not configured OR if last test failed
  if (!provider.configured || providerStore.failedProviderIds.has(provider.id)) {
    configuringProvider.value = provider;
    configDialogOpen.value = true;
    return;
  }
  selectProvider(provider.id);
}

function openConfigDialog(provider: ProviderInfo) {
  configuringProvider.value = provider;
  configDialogOpen.value = true;
}

function selectProvider(id: ProviderId) {
  providerStore.setDefaultProvider(id);
}

function onConfigured(anySuccess: boolean, failedModelIds: string[]) {
  if (!configuringProvider.value) return;
  const id = configuringProvider.value.id;
  const name = configuringProvider.value.name;

  // Always persist per-model failure info for use in the model selector
  providerStore.setFailedModels(id, failedModelIds);

  if (anySuccess) {
    providerStore.setFailedProvider(id, false);
    selectProvider(id);
    return;
  }

  // All models failed — block card selection
  providerStore.setFailedProvider(id, true);

  // If this was the active provider, fall back to another verified one
  if (providerStore.defaultProvider === id) {
    const fallback = providerStore.providers.find(
      p => p.available && p.configured && p.id !== id && !providerStore.failedProviderIds.has(p.id),
    );
    if (fallback) {
      selectProvider(fallback.id);
      toast.error(`Key invalid for ${name}. Switched to ${fallback.name}.`);
    } else {
      toast.error(`Key invalid for ${name}. No working provider available.`);
    }
  } else {
    toast.error(`Key invalid for ${name}. Check your credentials.`);
  }
}

async function installProvider(provider: ProviderInfo) {
  if (installing.value) return;
  installing.value = provider.id;
  installOutput.value = null;

  try {
    const res = await apiFetch(`/api/providers/${provider.id}/install`, {
      method: 'POST',
    });
    const data = await res.json() as { output?: string; success?: boolean };

    installOutput.value = {
      provider,
      output: data.output || (data.success ? 'Installed successfully.' : 'Installation failed.'),
      success: data.success ?? false,
    };

    if (data.success) {
      toast.success(`${provider.name} installed successfully!`);
      await providerStore.fetchProviders();
    } else {
      toast.error(`Failed to install ${provider.name}`);
    }
  } catch (err) {
    installOutput.value = {
      provider,
      output: err instanceof Error ? err.message : 'Network error',
      success: false,
    };
    toast.error(`Failed to install ${provider.name}`);
  } finally {
    installing.value = null;
  }
}
</script>

<template>
  <div>
    <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">AI Provider</h4>
    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="provider in providerStore.providers"
        :key="provider.id"
        class="flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors"
        :class="{
          'border-primary bg-primary/5 ring-1 ring-primary/30': cardState(provider) === 'active',
          'border-border hover:bg-accent/50 cursor-pointer': cardState(provider) === 'ready',
          'border-red-500/40 hover:bg-red-500/5 cursor-pointer': cardState(provider) === 'invalid',
          'border-amber-500/40 hover:bg-amber-500/5 cursor-pointer': cardState(provider) === 'unconfigured',
          'border-border': cardState(provider) === 'unavailable',
        }"
        @click="handleProviderClick(provider)"
      >
        <component
          :is="getLogoComponent(provider.icon)"
          :size="20"
          class="shrink-0"
          :class="provider.id === providerStore.defaultProvider ? 'text-primary' : 'text-muted-foreground'"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium truncate">{{ provider.name }}</span>
            <!-- Verified (configured + passed test) -->
            <CheckCircle
              v-if="isSelectable(provider)"
              class="h-3 w-3 shrink-0 text-green-500"
            />
            <!-- Stored but test failed -->
            <AlertTriangle
              v-else-if="isKeyInvalid(provider)"
              class="h-3 w-3 shrink-0 text-red-400"
            />
            <!-- Installed but no key stored -->
            <Settings2
              v-else-if="provider.available && !provider.configured"
              class="h-3 w-3 shrink-0 text-amber-400"
            />
            <!-- Not installed -->
            <XCircle
              v-else
              class="h-3 w-3 shrink-0 text-red-400"
            />
          </div>

          <!-- Ready: model count + reconfigure button -->
          <div v-if="isSelectable(provider)" class="flex items-center gap-1.5">
            <p class="text-[10px] text-muted-foreground truncate">{{ provider.models.length }} models</p>
            <button
              class="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Update credentials"
              @click.stop="openConfigDialog(provider)"
            >
              <Settings2 class="h-2.5 w-2.5" />
            </button>
          </div>

          <!-- Invalid key: prompt to fix -->
          <button
            v-else-if="isKeyInvalid(provider)"
            class="mt-0.5 flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
            @click.stop="openConfigDialog(provider)"
          >
            <Settings2 class="h-2.5 w-2.5" />
            Fix credentials
          </button>

          <!-- Not configured: configure prompt -->
          <button
            v-else-if="provider.available && !provider.configured"
            class="mt-0.5 flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
            @click.stop="handleProviderClick(provider)"
          >
            <Settings2 class="h-2.5 w-2.5" />
            Configure
          </button>

          <!-- Not installed: install button -->
          <button
            v-else
            class="mt-0.5 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            :disabled="installing === provider.id"
            @click.stop="installProvider(provider)"
          >
            <Loader2 v-if="installing === provider.id" class="h-2.5 w-2.5 animate-spin" />
            <Download v-else class="h-2.5 w-2.5" />
            {{ installing === provider.id ? 'Installing...' : 'Install' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Install output panel -->
    <div
      v-if="installOutput"
      class="mt-3 rounded-lg border p-3"
      :class="installOutput.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'"
    >
      <div class="flex items-center gap-2 mb-1.5">
        <Terminal class="h-3.5 w-3.5" :class="installOutput.success ? 'text-green-500' : 'text-red-400'" />
        <span class="text-xs font-medium">
          {{ installOutput.provider.name }} — {{ installOutput.success ? 'Installed' : 'Failed' }}
        </span>
      </div>
      <pre class="text-[10px] text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto font-mono leading-relaxed">{{ installOutput.output }}</pre>
      <p class="mt-1.5 text-[10px] text-muted-foreground/70 font-mono">
        $ {{ installOutput.provider.installCommand }}
      </p>
    </div>

    <p class="mt-2 text-[10px] text-muted-foreground">
      Changes apply to new sessions only. Active sessions keep their provider.
    </p>
  </div>

  <!-- Configure dialog -->
  <ProviderConfigDialog
    v-model:open="configDialogOpen"
    :provider="configuringProvider"
    @configured="onConfigured"
  />
</template>
