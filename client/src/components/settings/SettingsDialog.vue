<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import McpSettingsDialog from './McpSettingsDialog.vue';
import ProviderSelector from './ProviderSelector.vue';
import { Server } from 'lucide-vue-next';

const auth = useAuthStore();
const chat = useChatStore();

const open = defineModel<boolean>('open', { default: false });

// Git user config
const gitName = ref('');
const gitEmail = ref('');
const gitConfigLoading = ref(false);
const gitConfigSaved = ref(false);
const showMcpDialog = ref(false);

watch(open, async (isOpen) => {
  if (isOpen && chat.projectPath) {
    gitConfigLoading.value = true;
    try {
      const res = await fetch(
        `/api/git/user-config?cwd=${encodeURIComponent(chat.projectPath)}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        gitName.value = data.name || '';
        gitEmail.value = data.email || '';
      }
    } catch { /* ignore */ }
    gitConfigLoading.value = false;
  }
});

async function saveGitConfig() {
  if (!chat.projectPath || gitConfigLoading.value) return;
  try {
    await fetch('/api/git/user-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ cwd: chat.projectPath, name: gitName.value, email: gitEmail.value }),
    });
    gitConfigSaved.value = true;
    setTimeout(() => { gitConfigSaved.value = false; }, 2000);
  } catch { /* ignore */ }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-md overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Configure your Viridian preferences</DialogDescription>
      </DialogHeader>

      <div class="space-y-5 py-4">
        <!-- AI Provider -->
        <ProviderSelector />

        <Separator />

        <!-- MCP Servers -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Integrations</h4>
          <div class="space-y-2">
            <Button variant="outline" size="sm" class="w-full gap-2" @click="showMcpDialog = true">
              <Server class="h-4 w-4" />
              MCP Servers
            </Button>
          </div>
        </div>

        <Separator />

        <!-- Git User Config -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Git Identity</h4>
          <div v-if="!chat.projectPath" class="text-xs text-muted-foreground">
            Open a project to configure git identity
          </div>
          <div v-else class="space-y-3">
            <div class="space-y-1.5">
              <Label class="text-xs">Name</Label>
              <Input
                v-model="gitName"
                placeholder="Your Name"
                class="h-8 text-sm"
                :disabled="gitConfigLoading"
                @blur="saveGitConfig"
              />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs">Email</Label>
              <Input
                v-model="gitEmail"
                placeholder="your@email.com"
                class="h-8 text-sm"
                :disabled="gitConfigLoading"
                @blur="saveGitConfig"
              />
            </div>
            <p v-if="gitConfigSaved" class="text-xs text-green-500">Git identity saved.</p>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
  <McpSettingsDialog v-model:open="showMcpDialog" />
</template>
