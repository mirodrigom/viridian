<script setup lang="ts">
import { ref } from 'vue';
import { useProviderStore } from '@/stores/provider';
import { useAuthStore } from '@/stores/auth';
import { CheckCircle, XCircle, Download, Loader2, Terminal } from 'lucide-vue-next';
import { useProviderLogo } from '@/composables/useProviderLogo';
import { toast } from 'vue-sonner';
import type { ProviderId, ProviderInfo } from '@/types/provider';

const providerStore = useProviderStore();
const auth = useAuthStore();
const { getLogoComponent } = useProviderLogo();

const installing = ref<ProviderId | null>(null);
const installOutput = ref<{ provider: ProviderInfo; output: string; success: boolean } | null>(null);

function selectProvider(id: ProviderId) {
  providerStore.setDefaultProvider(id);
}

async function installProvider(provider: ProviderInfo) {
  if (installing.value) return;
  installing.value = provider.id;
  installOutput.value = null;

  try {
    const res = await fetch(`/api/providers/${provider.id}/install`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = await res.json();

    installOutput.value = {
      provider,
      output: data.output || (data.success ? 'Installed successfully.' : 'Installation failed.'),
      success: data.success,
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
        :class="[
          provider.id === providerStore.defaultProvider
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
            : provider.available
              ? 'border-border hover:bg-accent/50 cursor-pointer'
              : 'border-border',
        ]"
        @click="provider.available && selectProvider(provider.id)"
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
            <CheckCircle
              v-if="provider.available"
              class="h-3 w-3 shrink-0 text-green-500"
            />
            <XCircle
              v-else
              class="h-3 w-3 shrink-0 text-red-400"
            />
          </div>
          <p v-if="provider.available" class="text-[10px] text-muted-foreground truncate">
            {{ provider.models.length }} models
          </p>
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
</template>
