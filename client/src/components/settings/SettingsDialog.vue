<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import McpSettingsDialog from './McpSettingsDialog.vue';
import ApiKeysDialog from './ApiKeysDialog.vue';
import { Server, Key } from 'lucide-vue-next';

const settings = useSettingsStore();
const auth = useAuthStore();
const chat = useChatStore();

const open = defineModel<boolean>('open', { default: false });

// Git user config
const gitName = ref('');
const gitEmail = ref('');
const gitConfigLoading = ref(false);
const gitConfigSaved = ref(false);
const showMcpDialog = ref(false);
const showApiKeysDialog = ref(false);

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
  if (!chat.projectPath) return;
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
        <!-- Appearance -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Appearance</h4>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Editor Font Size</Label>
              <Select :model-value="String(settings.fontSize)" @update:model-value="(v: any) => { settings.fontSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="11">11px</SelectItem>
                  <SelectItem value="12">12px</SelectItem>
                  <SelectItem value="13">13px</SelectItem>
                  <SelectItem value="14">14px</SelectItem>
                  <SelectItem value="16">16px</SelectItem>
                  <SelectItem value="18">18px</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        <!-- Editor Settings -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Editor</h4>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Font Size</Label>
              <Select :model-value="String(settings.editorFontSize)" @update:model-value="(v: any) => { settings.editorFontSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="11">11px</SelectItem>
                  <SelectItem value="12">12px</SelectItem>
                  <SelectItem value="13">13px</SelectItem>
                  <SelectItem value="14">14px</SelectItem>
                  <SelectItem value="16">16px</SelectItem>
                  <SelectItem value="18">18px</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex items-center justify-between">
              <Label>Tab Size</Label>
              <Select :model-value="String(settings.editorTabSize)" @update:model-value="(v: any) => { settings.editorTabSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 spaces</SelectItem>
                  <SelectItem value="4">4 spaces</SelectItem>
                  <SelectItem value="8">8 spaces</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex items-center justify-between">
              <Label>Word Wrap</Label>
              <Switch :checked="settings.editorWordWrap" @update:checked="(v: boolean) => { settings.editorWordWrap = v; settings.save(); }" />
            </div>
            <div class="flex items-center justify-between">
              <Label>Line Numbers</Label>
              <Switch :checked="settings.editorShowLineNumbers" @update:checked="(v: boolean) => { settings.editorShowLineNumbers = v; settings.save(); }" />
            </div>
            <div class="flex items-center justify-between">
              <Label>Minimap</Label>
              <Switch :checked="settings.editorMinimap" @update:checked="(v: boolean) => { settings.editorMinimap = v; settings.save(); }" />
            </div>
          </div>
        </div>

        <Separator />

        <!-- MCP Servers -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Integrations</h4>
          <div class="space-y-2">
            <Button variant="outline" size="sm" class="w-full gap-2" @click="showMcpDialog = true">
              <Server class="h-4 w-4" />
              MCP Servers
            </Button>
            <Button variant="outline" size="sm" class="w-full gap-2" @click="showApiKeysDialog = true">
              <Key class="h-4 w-4" />
              API Keys
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
              <Input v-model="gitName" placeholder="Your Name" class="h-8 text-sm" :disabled="gitConfigLoading" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs">Email</Label>
              <Input v-model="gitEmail" placeholder="your@email.com" class="h-8 text-sm" :disabled="gitConfigLoading" />
            </div>
            <div class="flex items-center gap-2">
              <Button size="sm" class="h-7 text-xs" @click="saveGitConfig" :disabled="gitConfigLoading">
                Save
              </Button>
              <span v-if="gitConfigSaved" class="text-xs text-green-500">Saved!</span>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
  <McpSettingsDialog v-model:open="showMcpDialog" />
  <ApiKeysDialog v-model:open="showApiKeysDialog" />
</template>
