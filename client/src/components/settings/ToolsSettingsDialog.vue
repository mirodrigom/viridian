<script setup lang="ts">
import { ref } from 'vue';
import { useSettingsStore, COMMON_TOOLS, PERMISSION_OPTIONS } from '@/stores/settings';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Settings, AlertTriangle, Shield, Plus, X, Zap,
} from 'lucide-vue-next';

const settings = useSettingsStore();
const open = defineModel<boolean>('open', { default: false });

const newAllowedTool = ref('');
const newDisallowedTool = ref('');

function addAllowed() {
  const tool = newAllowedTool.value.trim();
  if (tool) {
    settings.addAllowedTool(tool);
    newAllowedTool.value = '';
  }
}

function addDisallowed() {
  const tool = newDisallowedTool.value.trim();
  if (tool) {
    settings.addDisallowedTool(tool);
    newDisallowedTool.value = '';
  }
}

function quickAddAllowed(tool: string) {
  settings.addAllowedTool(tool);
}

function toggleSkipPermissions(checked: boolean) {
  settings.permissionMode = checked ? 'bypassPermissions' : 'default';
  settings.save();
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Settings class="h-5 w-5" />
          Tools Settings
        </DialogTitle>
        <DialogDescription>
          Configure tool permissions and access controls
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-2">
        <!-- Permission Settings -->
        <div>
          <h4 class="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle class="h-4 w-4 text-amber-500" />
            Permission Settings
          </h4>
          <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">Skip permission prompts (use with caution)</p>
                <p class="text-xs text-amber-600 dark:text-amber-400">
                  Equivalent to --dangerously-skip-permissions flag
                </p>
              </div>
              <Switch
                :checked="settings.permissionMode === 'bypassPermissions'"
                @update:checked="toggleSkipPermissions"
              />
            </div>
          </div>
        </div>

        <Separator />

        <!-- Allowed Tools -->
        <div>
          <h4 class="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Shield class="h-4 w-4 text-primary" />
            Allowed Tools
          </h4>
          <p class="mb-3 text-xs text-muted-foreground">
            Tools that are automatically allowed without prompting for permission
          </p>

          <!-- Add tool input -->
          <div class="mb-3 flex gap-2">
            <Input
              v-model="newAllowedTool"
              placeholder='e.g., "Bash(git log:*)" or "Write"'
              class="text-sm"
              @keydown.enter="addAllowed"
            />
            <Button size="sm" class="shrink-0 gap-1" @click="addAllowed" :disabled="!newAllowedTool.trim()">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>

          <!-- Quick add common tools -->
          <div class="mb-3">
            <p class="mb-2 text-xs font-medium text-muted-foreground">Quick add common tools:</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="tool in COMMON_TOOLS"
                :key="tool"
                class="rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                :class="{ 'opacity-40 pointer-events-none': settings.allowedTools.includes(tool) }"
                @click="quickAddAllowed(tool)"
              >
                {{ tool }}
              </button>
            </div>
          </div>

          <!-- Current allowed tools -->
          <div v-if="settings.allowedTools.length > 0" class="space-y-1.5">
            <div
              v-for="tool in settings.allowedTools"
              :key="tool"
              class="flex items-center justify-between rounded-md bg-primary/5 px-3 py-1.5"
            >
              <span class="text-sm text-foreground">{{ tool }}</span>
              <button
                class="text-muted-foreground transition-colors hover:text-destructive"
                @click="settings.removeAllowedTool(tool)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p v-else class="text-center text-xs text-muted-foreground py-2">
            No allowed tools configured
          </p>
        </div>

        <Separator />

        <!-- Disallowed Tools -->
        <div>
          <h4 class="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle class="h-4 w-4 text-destructive" />
            Disallowed Tools
          </h4>
          <p class="mb-3 text-xs text-muted-foreground">
            Tools that are never allowed, even in auto-approve mode
          </p>

          <div class="mb-3 flex gap-2">
            <Input
              v-model="newDisallowedTool"
              placeholder='e.g., "Bash(rm:*)"'
              class="text-sm"
              @keydown.enter="addDisallowed"
            />
            <Button size="sm" variant="destructive" class="shrink-0 gap-1" @click="addDisallowed" :disabled="!newDisallowedTool.trim()">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>

          <div v-if="settings.disallowedTools.length > 0" class="space-y-1.5">
            <div
              v-for="tool in settings.disallowedTools"
              :key="tool"
              class="flex items-center justify-between rounded-md bg-destructive/5 px-3 py-1.5"
            >
              <span class="text-sm text-foreground">{{ tool }}</span>
              <button
                class="text-muted-foreground transition-colors hover:text-foreground"
                @click="settings.removeDisallowedTool(tool)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p v-else class="text-center text-xs text-muted-foreground py-2">
            No disallowed tools configured
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
